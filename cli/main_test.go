package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// branchServer stands in for GitHub's branches endpoint, handing out one page per
// argument and announcing the next one with the Link header, as api.github.com does.
// The returned counter is how many pages the command actually asked for.
func branchServer(t *testing.T, pages ...[]string) (*httptest.Server, *int) {
	t.Helper()
	calls := 0
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		page := 1
		if p := r.URL.Query().Get("page"); p != "" {
			page, _ = strconv.Atoi(p)
		}
		if page < len(pages) {
			w.Header().Set("Link", fmt.Sprintf(`<%s%s?per_page=100&page=%d>; rel="next"`, srv.URL, r.URL.Path, page+1))
		}
		body := []map[string]string{}
		if page >= 1 && page <= len(pages) {
			for _, name := range pages[page-1] {
				body = append(body, map[string]string{"name": name})
			}
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// issue-00035 / spec-00013-AC-13.3: a language that only has variants has no
// lang/<l> branch, so the listing must not offer `--lang <l>`; its group header
// says the language has no base branch.
func TestListLangsOmitsTheBaseLineForAVariantOnlyLanguage(t *testing.T) {
	srv, _ := branchServer(t, []string{"main", "lang/go", "lang/java/ddd"})

	var out strings.Builder
	if err := cmdLangs(&out, srv.URL); err != nil {
		t.Fatal(err)
	}
	got := out.String()

	if strings.Contains(got, "--lang java") {
		t.Errorf("there is no lang/java branch, yet the listing offers it:\n%s", got)
	}
	for _, want := range []string{"--lang go", "--variant ddd", "no lang/java branch"} {
		if !strings.Contains(got, want) {
			t.Errorf("listing is missing %q:\n%s", want, got)
		}
	}
}

// issue-00036 / spec-00013-AC-13.4: branches spanning more than one page must all
// be listed — the command follows the Link header until it runs out.
func TestListLangsFollowsPaginationToTheLastPage(t *testing.T) {
	srv, calls := branchServer(t, []string{"main", "lang/go"}, []string{"lang/zzz"})

	var out strings.Builder
	if err := cmdLangs(&out, srv.URL); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); !strings.Contains(got, "--lang zzz") {
		t.Errorf("zzz is on the second page and never made it into the listing:\n%s", got)
	}
	if *calls != 2 {
		t.Errorf("asked for %d page(s), want 2", *calls)
	}
}

// issue-00037 / spec-00013-AC-4.4: a second positional argument is rejected with the
// usage and a non-zero exit, and nothing is created.
func TestNewRejectsASecondPositionalArgument(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)

	err := cmdNew([]string{"demo", "extra"})
	if err == nil || !strings.Contains(err.Error(), `"extra"`) || !strings.Contains(err.Error(), "usage: persimmon new") {
		t.Fatalf("cmdNew error = %v, want it to name the extra argument and give the usage", err)
	}
	entries, rerr := os.ReadDir(dir)
	if rerr != nil {
		t.Fatal(rerr)
	}
	if len(entries) != 0 {
		t.Errorf("created %v, want an untouched directory", entries)
	}
}

// childEnv, when set, makes this test binary act as a subprocess instead of running the
// suite: two of the criteria below cannot be observed in the test process itself, because
// init() reads the environment before any test runs and flag.ExitOnError exits outright.
const childEnv = "PERSIMMON_TEST_CHILD"

// TestMain doubles as that subprocess entry point. "coord" prints the template
// coordinate init() derived; anything else is the argument list to run main() on.
func TestMain(m *testing.M) {
	switch spec := os.Getenv(childEnv); {
	case spec == "":
		os.Exit(m.Run())
	case spec == "coord":
		fmt.Println(owner + "/" + repo)
	default:
		os.Args = append([]string{"persimmon"}, strings.Fields(spec)...)
		main()
	}
	os.Exit(0)
}

// runChild re-executes this binary as a subprocess in dir and returns its combined
// output with its exit code.
func runChild(t *testing.T, dir, spec string, env ...string) (string, int) {
	t.Helper()
	cmd := exec.Command(os.Args[0])
	cmd.Dir = dir
	cmd.Env = append(append(os.Environ(), childEnv+"="+spec), env...)
	out, err := cmd.CombinedOutput()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return string(out), 0
	case errors.As(err, &exit):
		return string(out), exit.ExitCode()
	default:
		t.Fatalf("running the subprocess: %v\n%s", err, out)
		return "", 0
	}
}

// roundTripFunc adapts a plain function to http.RoundTripper.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// stubTemplateRepo stands in for the template repository the scaffold fetches: one
// gzipped tarball per branch in trees, and a fixed commit for every commit lookup. The
// URLs the scaffold builds name codeload.github.com and api.github.com in full, so the
// stub is installed by swapping http.DefaultTransport, which both requests route through.
func stubTemplateRepo(t *testing.T, trees map[string]map[string]string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if strings.HasPrefix(p, "repos/") {
			fmt.Fprintln(w, "abc1230000000000000000000000000000000000")
			return
		}
		ref, ok := strings.CutPrefix(p, owner+"/"+repo+"/tar.gz/refs/heads/")
		if !ok {
			http.NotFound(w, r)
			return
		}
		tree, ok := trees[ref]
		if !ok {
			http.NotFound(w, r)
			return
		}
		gz := gzip.NewWriter(w)
		tw := tar.NewWriter(gz)
		for rel, body := range tree {
			h := &tar.Header{Name: "root/" + rel, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}
			if err := tw.WriteHeader(h); err != nil {
				t.Error(err)
				return
			}
			if _, err := tw.Write([]byte(body)); err != nil {
				t.Error(err)
				return
			}
		}
		if err := tw.Close(); err != nil {
			t.Error(err)
			return
		}
		if err := gz.Close(); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(srv.Close)

	base, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	real := http.DefaultTransport
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		r = r.Clone(r.Context())
		r.URL.Scheme, r.URL.Host = base.Scheme, base.Host
		return real.RoundTrip(r)
	})
	t.Cleanup(func() { http.DefaultTransport = real })
}

// sourced is the marker each stub branch carries, so "the content came from <branch>" is
// a single assertion.
func sourced(branch string) map[string]string {
	return map[string]string{"SOURCE.md": branch + "\n"}
}

// newIn runs the new subcommand from dir with stdout captured, since the scaffold reports
// its progress there.
func newIn(t *testing.T, dir string, args ...string) error {
	t.Helper()
	t.Chdir(dir)
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	cmdErr := cmdNew(args)
	os.Stdout = saved
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(io.Discard, r); err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	return cmdErr
}

// source returns the branch the project at <parent>/<name> was scaffolded from.
func source(t *testing.T, parent, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(parent, name, "SOURCE.md"))
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(b))
}

// spec-00013-AC-1.1: with no branch flags the project comes from the base template.
func TestNewTakesTheBaseTemplateByDefault(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	dir := t.TempDir()

	if err := newIn(t, dir, "demo"); err != nil {
		t.Fatal(err)
	}
	if got := source(t, dir, "demo"); got != "main" {
		t.Errorf("demo came from %q, want main", got)
	}
}

// spec-00013-AC-1.2: --lang names the lang/<lang> branch.
func TestNewTakesTheLanguageBranchForLang(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"lang/go": sourced("lang/go")})
	dir := t.TempDir()

	if err := newIn(t, dir, "svc", "--lang", "go"); err != nil {
		t.Fatal(err)
	}
	if got := source(t, dir, "svc"); got != "lang/go" {
		t.Errorf("svc came from %q, want lang/go", got)
	}
}

// spec-00013-AC-1.3: --lang with --variant names the lang/<lang>/<variant> branch.
func TestNewTakesTheVariantBranchForLangAndVariant(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"lang/java/ddd": sourced("lang/java/ddd")})
	dir := t.TempDir()

	if err := newIn(t, dir, "app", "--lang", "java", "--variant", "ddd"); err != nil {
		t.Fatal(err)
	}
	if got := source(t, dir, "app"); got != "lang/java/ddd" {
		t.Errorf("app came from %q, want lang/java/ddd", got)
	}
}

// spec-00013-AC-1.4: --ref overrides the branch --lang would have chosen.
func TestNewLetsRefOverrideTheBranchLangImplies(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{
		"lang/go": sourced("lang/go"), "spike": sourced("spike"),
	})
	dir := t.TempDir()

	if err := newIn(t, dir, "demo", "--lang", "go", "--ref", "spike"); err != nil {
		t.Fatal(err)
	}
	if got := source(t, dir, "demo"); got != "spike" {
		t.Errorf("demo came from %q, want spike — --ref overrides --lang", got)
	}
}

// spec-00013-AC-1.5: --dir names the parent directory the project is created in.
func TestNewCreatesTheProjectUnderDir(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	cwd, work := t.TempDir(), t.TempDir()

	if err := newIn(t, cwd, "demo", "--dir", work); err != nil {
		t.Fatal(err)
	}
	if got := source(t, work, "demo"); got != "main" {
		t.Errorf("%s/demo came from %q, want main", work, got)
	}
	if _, err := os.Stat(filepath.Join(cwd, "demo")); err == nil {
		t.Error("the project was also created in the working directory")
	}
}

// spec-00013-AC-1.6: AINPT_OWNER and AINPT_REPO override the template coordinate compiled
// in. They are read at startup, so the observation is made in a subprocess.
func TestNewTakesTheTemplateCoordinateFromTheEnvironment(t *testing.T) {
	out, code := runChild(t, t.TempDir(), "coord", "AINPT_OWNER=acme", "AINPT_REPO=tpl")

	if code != 0 {
		t.Fatalf("exit code = %d\n%s", code, out)
	}
	if got := strings.TrimSpace(out); got != "acme/tpl" {
		t.Errorf("template coordinate = %q, want acme/tpl", got)
	}
}

// spec-00013-AC-1.7: --set is repeatable and every pair reaches the substitution.
func TestNewAcceptsSetMoreThanOnce(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": {
		"template.json": `{"vars": {"MODULE_PATH": {"prompt": "module"}}, "substitute": ["go.mod"]}`,
		"go.mod":        "module {{MODULE_PATH}} // {{EXTRA}}\n",
	}})
	dir := t.TempDir()

	if err := newIn(t, dir, "demo", "--set", "MODULE_PATH=example.com/x", "--set", "EXTRA=1"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "demo", "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(b); got != "module example.com/x // 1\n" {
		t.Errorf("go.mod = %q, want both variables substituted", got)
	}
}

// spec-00013-AC-1.8: a flag written before <name> gives the same result as after it.
func TestNewAcceptsFlagsBeforeTheProjectName(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"lang/go": sourced("lang/go")})
	before, after := t.TempDir(), t.TempDir()

	if err := newIn(t, before, "--lang", "go", "demo"); err != nil {
		t.Fatal(err)
	}
	if err := newIn(t, after, "demo", "--lang", "go"); err != nil {
		t.Fatal(err)
	}
	if got, want := source(t, before, "demo"), source(t, after, "demo"); got != want {
		t.Errorf("flags before <name> came from %q, after it from %q", got, want)
	}
}

// spec-00013-AC-4.1: --variant without --lang names no branch, so it is refused before
// anything is created.
func TestNewRefusesVariantWithoutLang(t *testing.T) {
	dir := t.TempDir()

	err := newIn(t, dir, "app", "--variant", "ddd")
	if err == nil || !strings.Contains(err.Error(), "--variant requires --lang") {
		t.Fatalf("cmdNew = %v, want it to say --variant requires --lang", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "app")); statErr == nil {
		t.Error("app was created despite the malformed arguments")
	}
}

// spec-00013-AC-4.2: without <name> the subcommand prints its usage and fails.
func TestNewWithoutANamePrintsTheUsage(t *testing.T) {
	dir := t.TempDir()

	err := newIn(t, dir)
	if err == nil || !strings.Contains(err.Error(), "usage: persimmon new") {
		t.Fatalf("cmdNew = %v, want the usage of the subcommand", err)
	}
	entries, readErr := os.ReadDir(dir)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(entries) != 0 {
		t.Errorf("created %v, want an untouched directory", entries)
	}
}

// spec-00013-AC-4.3: a --set value with no "=" is refused with the shape expected. The
// flag package exits the process on a bad value, so this is observed in a subprocess.
func TestNewRefusesASetValueWithoutAnEquals(t *testing.T) {
	dir := t.TempDir()

	out, code := runChild(t, dir, "new demo --set BAD")

	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero\n%s", out)
	}
	if !strings.Contains(out, "expected KEY=VALUE") {
		t.Errorf("output did not say what shape --set expects:\n%s", out)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("created %v, want an untouched directory", entries)
	}
}

// spec-00013-AC-13.1: the base template comes first, then each language in order with its
// variants beneath it.
func TestListLangsListsTheBaseTemplateThenLanguagesInOrder(t *testing.T) {
	srv, _ := branchServer(t, []string{"main", "lang/java", "lang/java/ddd", "lang/go"})

	var out strings.Builder
	if err := cmdLangs(&out, srv.URL); err != nil {
		t.Fatal(err)
	}
	got := out.String()

	base := strings.Index(got, "base template")
	goLine := strings.Index(got, "--lang go")
	java := strings.Index(got, "--lang java")
	ddd := strings.Index(got, "--variant ddd")
	if base < 0 || goLine < 0 || java < 0 || ddd < 0 {
		t.Fatalf("listing is missing an entry:\n%s", got)
	}
	if !(base < goLine && goLine < java && java < ddd) {
		t.Errorf("want base, go, java, then ddd under java:\n%s", got)
	}
}

// spec-00013-AC-13.2: with no lang/* branch at all the listing says so.
func TestListLangsSaysOnlyTheBaseTemplateIsAvailable(t *testing.T) {
	srv, _ := branchServer(t, []string{"main", "spike"})

	var out strings.Builder
	if err := cmdLangs(&out, srv.URL); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); !strings.Contains(got, "no lang/* branches yet") {
		t.Errorf("listing does not say only the base template is available:\n%s", got)
	}
}

// spec-00013-AC-14.1: a request that cannot be sent is reported as it failed.
func TestListLangsReportsARequestThatCouldNotBeSent(t *testing.T) {
	srv, _ := branchServer(t, []string{"main"})
	gone := srv.URL
	srv.Close()

	err := cmdLangs(io.Discard, gone)
	if err == nil || !strings.Contains(err.Error(), gone) {
		t.Fatalf("cmdLangs = %v, want the transport error for %s", err, gone)
	}
}

// spec-00013-AC-14.2: a non-200 reply is reported with the address and the status.
func TestListLangsReportsTheAddressAndStatusOfANon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)

	err := cmdLangs(io.Discard, srv.URL)
	if err == nil {
		t.Fatal("cmdLangs = nil, want the 403 reported")
	}
	if !strings.Contains(err.Error(), srv.URL) || !strings.Contains(err.Error(), "403") {
		t.Errorf("cmdLangs = %v, want it to name the address and the status", err)
	}
}

// spec-00013-AC-14.3: a 200 whose body is not the expected JSON is reported as a parse
// failure.
func TestListLangsReportsAnUnparseableReply(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "not json")
	}))
	t.Cleanup(srv.Close)

	err := cmdLangs(io.Discard, srv.URL)
	if err == nil || !strings.Contains(err.Error(), "invalid character") {
		t.Fatalf("cmdLangs = %v, want the JSON parse error", err)
	}
}
