package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ryan-alexander-zhang/persimmon/cli/internal/hostproc"
	"github.com/ryan-alexander-zhang/persimmon/cli/internal/project"
	"github.com/ryan-alexander-zhang/persimmon/cli/internal/registry"
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

	err := cmdNew(newHarness(t).command, []string{"demo", "extra"})
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
	case spec == "none":
		os.Args = []string{"persimmon"}
		main()
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
	cmd.Env = append(append(os.Environ(), childEnv+"="+spec, "HOME="+t.TempDir()), env...)
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
	for _, tree := range trees {
		// Every tree carries a flow config because the real template does: what
		// `new` closes with is the same registration `add` does, and that refuses
		// a directory holding none (spec-00013-FR-6, spec-00011-FR-3).
		if _, ok := tree[project.ConfigFile]; !ok {
			tree[project.ConfigFile] = "types:\n  idea: { kind: living }\n"
		}
	}
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
		// Only the template repository is stubbed. The loopback calls of the
		// handshake go where they were addressed, so a case can scaffold and
		// register in the same run (spec-00013-FR-6).
		if r.URL.Hostname() == "127.0.0.1" || r.URL.Hostname() == "localhost" {
			return real.RoundTrip(r)
		}
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

// newIn runs the new subcommand from dir on a command of its own, for the cases that
// only care what was scaffolded.
func newIn(t *testing.T, dir string, args ...string) error {
	t.Helper()
	return newInWith(t, newHarness(t).command, dir, args...)
}

// newInWith runs the new subcommand from dir with os.Stdout captured, since the scaffold
// reports its progress there. What the registration prints goes to c.stdout instead, so a
// caller reads it without the scaffold's own lines around it.
func newInWith(t *testing.T, c command, dir string, args ...string) error {
	t.Helper()
	t.Chdir(dir)
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	cmdErr := cmdNew(c, args)
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

// ---------------------------------------------------------------------------
// The registry half of the command: `new`'s registration closure (spec-00013
// FR-6 … FR-8) and the three registry subcommands (design-00003 §8). Every case
// runs against a registry file and a port of its own — no test may write into
// the developer's own registry (design-00003 §2).

// freePort is a port nobody listens on: taken and given straight back, so a
// probe of it is refused rather than answered.
func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return port
}

// tempDir is a temporary directory as it goes on disk: macOS puts it behind a
// symlink and the registry stores the resolved path (design-00003 §2).
func tempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// harness is a command with a registry file, a free port and streams of its
// own, plus the two things a test needs to look at afterwards: what the command
// printed, and where the registry file is.
type harness struct {
	command
	stdout *bytes.Buffer
	// file is the registry file, and home the `.persimmon` directory holding it.
	file, home string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	dir := filepath.Join(tempDir(t), ".persimmon")
	file := filepath.Join(dir, "workspaces.json")
	stdout := &bytes.Buffer{}
	return &harness{
		command: command{
			registry: registry.New(file),
			port:     freePort(t),
			dir:      tempDir(t),
			version:  version,
			stdout:   stdout,
			stderr:   io.Discard,
		},
		stdout: stdout,
		file:   file,
		home:   dir,
	}
}

// entries is the registry as it stands on disk.
func (h *harness) entries(t *testing.T) []registry.Entry {
	t.Helper()
	entries, err := h.registry.Read()
	if err != nil {
		t.Fatal(err)
	}
	return entries
}

// writeRegistry puts a file where this harness keeps its registry, ill-formed or not.
func (h *harness) writeRegistry(t *testing.T, text string) {
	t.Helper()
	if err := os.MkdirAll(h.home, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(h.file, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}

// projectAt is a directory a registration accepts: one that exists and holds a
// flow config (spec-00011-FR-3).
func projectAt(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, project.ConfigFile), []byte("types: {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// fakeHost is a process already on the port: `/api/instance` names it a
// persimmon, and the workspace routes record what went through it
// (design-00003 §5). It is not a whiteboard — what is under test is the
// command's half of the exchange.
type fakeHost struct {
	port int
	// added is every path registered through it, in order.
	added []string
	// deleted is every id dropped through it.
	deleted []string
	// listed is what GET /api/workspaces answers with.
	listed []hostproc.Workspace
	// refuse, when set, is the 422 every registration gets instead.
	refuse string
}

func newFakeHost(t *testing.T) *fakeHost {
	t.Helper()
	host := &fakeHost{}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/instance", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"app": "persimmon", "version": "9.9.9"})
	})
	mux.HandleFunc("/api/workspaces", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]any{"workspaces": host.listed})
			return
		}
		var body struct{ Path, Name string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		if host.refuse != "" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": host.refuse})
			return
		}
		host.added = append(host.added, body.Path)
		name := body.Name
		if name == "" {
			name = filepath.Base(body.Path)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"workspace": registry.Entry{ID: filepath.Base(body.Path), Name: name, Path: body.Path},
		})
	})
	mux.HandleFunc("/api/workspaces/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/workspaces/")
		for _, entry := range host.listed {
			if entry.ID != id {
				continue
			}
			host.deleted = append(host.deleted, id)
			_ = json.NewEncoder(w).Encode(map[string]any{"workspace": entry.Entry})
			return
		}
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("workspace %q is not registered", id)})
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	host.port = portOf(t, server.URL)
	return host
}

// strangerOn is somebody who is not a persimmon holding the port: it answers,
// so the probe reads the port as occupied rather than free (design-00003 §8).
func strangerOn(t *testing.T) int {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "not persimmon")
	}))
	t.Cleanup(server.Close)
	return portOf(t, server.URL)
}

func portOf(t *testing.T, address string) int {
	t.Helper()
	parsed, err := url.Parse(address)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		t.Fatal(err)
	}
	return port
}

// spec-00013-AC-6.1: with nobody on the port the registration writes the file,
// and the entry is the project that was just scaffolded.
func TestNewRegistersWhatItScaffolded(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	work := tempDir(t)

	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work); err != nil {
		t.Fatal(err)
	}

	entries := h.entries(t)
	if len(entries) != 1 || entries[0].Path != filepath.Join(work, "demo") {
		t.Fatalf("registry = %+v, want one entry at %s", entries, filepath.Join(work, "demo"))
	}
}

// spec-00013-AC-6.2: a process already on the port registers it, so its writes
// stay serialised and its switcher shows the entry at once; the command writes
// no registry file of its own and starts no second service.
func TestNewRegistersThroughTheProcessAlreadyRunning(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	host := newFakeHost(t)
	h := newHarness(t)
	h.port = host.port
	work := tempDir(t)

	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work); err != nil {
		t.Fatal(err)
	}

	if want := []string{filepath.Join(work, "demo")}; !slices.Equal(host.added, want) {
		t.Errorf("the running process was handed %v, want %v", host.added, want)
	}
	if entries := h.entries(t); len(entries) != 0 {
		t.Errorf("the command wrote the registry file itself: %+v", entries)
	}
}

// spec-00013-AC-6.3: the last line names the entry and says how to open it. The
// scaffold's own progress goes to os.Stdout, so in production this line is the
// last one the user sees.
func TestNewClosesWithTheRegisteredIDAndHowToOpenIt(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)

	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", tempDir(t)); err != nil {
		t.Fatal(err)
	}

	line := strings.TrimSpace(h.stdout.String())
	id := h.entries(t)[0].ID
	if !strings.Contains(line, id) || !strings.Contains(line, "persimmon 打开") {
		t.Errorf("last line = %q, want the id %q and how to open it", line, id)
	}
}

// spec-00013-AC-6.4: the entry's path is the one on disk, so a directory reached
// through a symlink is one entry however it is spelled.
func TestNewRegistersTheResolvedPath(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	root := tempDir(t)
	real, link := filepath.Join(root, "private-work"), filepath.Join(root, "work")
	if err := os.Mkdir(real, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}

	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", link); err != nil {
		t.Fatal(err)
	}

	if got, want := h.entries(t)[0].Path, filepath.Join(real, "demo"); got != want {
		t.Errorf("entry path = %q, want %q", got, want)
	}
}

// spec-00013-AC-6.5: the registration has no off switch, so a flag asking for
// one is an unknown flag — refused before anything is created.
func TestNewRefusesAFlagThatWouldSkipTheRegistration(t *testing.T) {
	dir := t.TempDir()

	out, code := runChild(t, dir, "new demo --no-register")

	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero\n%s", out)
	}
	if !strings.Contains(out, "no-register") {
		t.Errorf("output did not name the unknown flag:\n%s", out)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("created %v, want an untouched directory", entries)
	}
}

// spec-00013-AC-7.1: a port held by somebody who is not a persimmon writes the
// file all the same — the project is built, and an unrelated process on the port
// is no reason to leave it unregistered. This is where `new` parts from `add`
// deliberately (design-00004 §5).
func TestNewRegistersDespiteAPortHeldBySomebodyElse(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	h.port = strangerOn(t)
	work := tempDir(t)

	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work); err != nil {
		t.Fatalf("cmdNew = %v, want the registration to go to the file", err)
	}

	if entries := h.entries(t); len(entries) != 1 || entries[0].Path != filepath.Join(work, "demo") {
		t.Errorf("registry = %+v, want the entry written directly", entries)
	}
}

// spec-00013-AC-7.2: the file that direct write produced is the file contract
// and nothing else (design-00003 §2), which is what makes the entry
// indistinguishable from one a running process registered when a process is
// next started on the same registry.
func TestNewWritesTheSameFileContractAProcessWouldRead(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	h.port = strangerOn(t)

	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", tempDir(t)); err != nil {
		t.Fatal(err)
	}

	var file struct {
		Version    int                          `json:"version"`
		Workspaces []map[string]json.RawMessage `json:"workspaces"`
	}
	text, err := os.ReadFile(h.file)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(text, &file); err != nil {
		t.Fatal(err)
	}
	if file.Version != 1 || len(file.Workspaces) != 1 {
		t.Fatalf("registry file = %s, want version 1 and one entry", text)
	}
	for _, key := range []string{"id", "name", "path"} {
		if _, ok := file.Workspaces[0][key]; !ok {
			t.Errorf("the entry has no %q: %s", key, text)
		}
	}
	if len(file.Workspaces[0]) != 3 {
		t.Errorf("the entry carries fields the contract does not name: %s", text)
	}
}

// spec-00013-AC-8.1: an ill-formed registry keeps the project, reports the
// registry's problem in one sentence and rewrites nothing.
func TestNewKeepsTheProjectWhenTheRegistryIsIllFormed(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	h.writeRegistry(t, "not json at all")
	work := tempDir(t)

	err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work)

	if err == nil || !strings.Contains(err.Error(), h.file) || !strings.Contains(err.Error(), "not readable JSON") {
		t.Fatalf("cmdNew = %v, want the registry file and its problem named", err)
	}
	if got := source(t, work, "demo"); got != "main" {
		t.Errorf("the project was not left complete: SOURCE.md = %q", got)
	}
	if text, readErr := os.ReadFile(h.file); readErr != nil || string(text) != "not json at all" {
		t.Errorf("the registry file was rewritten: %q, %v", text, readErr)
	}
}

// spec-00013-AC-8.2: a registry that cannot be written keeps the project and
// reports the write.
func TestNewKeepsTheProjectWhenTheRegistryCannotBeWritten(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("root writes into a read-only directory all the same")
	}
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	h.writeRegistry(t, `{"version": 1, "workspaces": []}`)
	if err := os.Chmod(h.home, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(h.home, 0o700) })
	work := tempDir(t)

	err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work)

	if err == nil || !strings.Contains(err.Error(), "could not be written") {
		t.Fatalf("cmdNew = %v, want the failed write reported", err)
	}
	if got := source(t, work, "demo"); got != "main" {
		t.Errorf("the project was not left complete: SOURCE.md = %q", got)
	}
}

// spec-00013-AC-8.3: a running process that refuses the registration keeps the
// project, and the sentence the user reads is the process's own.
func TestNewKeepsTheProjectWhenTheRunningProcessRefuses(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	host := newFakeHost(t)
	host.refuse = "the directory holds no whiteboard.config.yaml: /work/demo"
	h := newHarness(t)
	h.port = host.port
	work := tempDir(t)

	err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work)

	if err == nil || !strings.Contains(err.Error(), host.refuse) {
		t.Fatalf("cmdNew = %v, want the refusal the process gave", err)
	}
	if got := source(t, work, "demo"); got != "main" {
		t.Errorf("the project was not left complete: SOURCE.md = %q", got)
	}
}

// spec-00012-AC-7.2: `new` never asks for Node — the project is built and
// registered on a machine that has none, and the command exits 0.
func TestNewWorksWithNoNodeOnThePath(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	work := tempDir(t)
	t.Setenv("PATH", "")

	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work); err != nil {
		t.Fatalf("cmdNew = %v, want a project and a registration without Node", err)
	}

	if entries := h.entries(t); len(entries) != 1 || entries[0].Path != filepath.Join(work, "demo") {
		t.Errorf("registry = %+v, want the project registered", entries)
	}
}

// spec-00013-AC-8.4: the project is a project whatever the registration did, so
// `persimmon add` picks it up once the cause is gone — which is why a failed
// registration rolls nothing back (spec-00013-FR-8).
func TestAProjectLeftUnregisteredRegistersOnceTheCauseIsGone(t *testing.T) {
	stubTemplateRepo(t, map[string]map[string]string{"main": sourced("main")})
	h := newHarness(t)
	h.writeRegistry(t, "not json at all")
	work := tempDir(t)
	if err := newInWith(t, h.command, tempDir(t), "demo", "--dir", work); err == nil {
		t.Fatal("cmdNew = nil, want the ill-formed registry reported")
	}

	h.writeRegistry(t, `{"version": 1, "workspaces": []}`)
	h.dir = filepath.Join(work, "demo")

	if err := cmdAdd(h.command, nil); err != nil {
		t.Fatalf("cmdAdd = %v, want the project registered once the registry reads", err)
	}
	if entries := h.entries(t); len(entries) != 1 || entries[0].Path != filepath.Join(work, "demo") {
		t.Errorf("registry = %+v, want the project that was left unregistered", entries)
	}
}

// ---------------------------------------------------------------------------
// `add`, `remove`, `list` and the closed subcommand set (spec-00012-FR-1,
// spec-00012-FR-2, spec-00011-FR-15, spec-00011-FR-21).

// printed is what f wrote to os.Stdout, for the paths that print through the
// package's own streams rather than a command's.
func printed(t *testing.T, f func()) string {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = writer
	f()
	os.Stdout = saved
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	text, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	return string(text)
}

// hostStub is the development override's target: the checkout hostproc's own
// tests launch, whose `bin/host.js` answers `--judge` with the JSON
// `STUB_JUDGE` names. One stub serves both packages — a second copy of it would
// be two things to keep in step.
func hostStub(t *testing.T, judgement string) string {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not on PATH")
	}
	dir, err := filepath.Abs(filepath.Join("internal", "hostproc", "testdata", "host"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("STUB_JUDGE", judgement)
	return dir
}

// pathWithoutNode is a PATH with git on it and no Node at all: the machine of
// spec-00011-AC-21.3, where the judgement cannot be had but the command's own
// git check still can be made.
func pathWithoutNode(t *testing.T) {
	t.Helper()
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("git is not on PATH")
	}
	dir := t.TempDir()
	if err := os.Symlink(git, filepath.Join(dir, "git")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
}

// gitRepo makes dir a git repository of its own, which is what the availability
// judgement's second check asks for (design-00003 §3).
func gitRepo(t *testing.T, dir string) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not on PATH")
	}
	command := exec.Command("git", "init", "--quiet", dir)
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	return dir
}

// spec-00012-AC-1.2: the subcommands the usage lists are exactly the closed set
// of spec-00012-FR-1, the no-subcommand start included, and nothing else.
func TestHelpListsExactlyTheClosedSubcommandSet(t *testing.T) {
	text := printed(t, usage)

	_, block, ok := strings.Cut(text, "Usage:\n")
	if !ok {
		t.Fatalf("the usage has no Usage: block:\n%s", text)
	}
	listed := map[string]bool{}
	for _, line := range strings.Split(block, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			break
		}
		if fields[0] != "persimmon" {
			t.Fatalf("the Usage: block holds a line that is no invocation: %q", line)
		}
		if len(fields) == 1 {
			listed[""] = true
			continue
		}
		listed[fields[1]] = true
	}
	want := map[string]bool{
		"": true, "new": true, "update": true, "list-langs": true,
		"add": true, "remove": true, "list": true, "version": true, "help": true,
	}
	if !maps.Equal(listed, want) {
		t.Errorf("the usage lists %v, want exactly %v", slices.Sorted(maps.Keys(listed)), slices.Sorted(maps.Keys(want)))
	}
}

// spec-00012-AC-2.1: an unknown subcommand is named, the usage is printed, the
// exit is non-zero and the registry is left as it was.
func TestAnUnknownSubcommandIsRefusedAndLeavesTheRegistryAlone(t *testing.T) {
	home := tempDir(t)
	file := filepath.Join(home, ".persimmon", "workspaces.json")
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		t.Fatal(err)
	}
	before := `{"version": 1, "workspaces": [{"id": "alpha", "name": "alpha", "path": "/alpha"}]}`
	if err := os.WriteFile(file, []byte(before), 0o600); err != nil {
		t.Fatal(err)
	}

	out, code := runChild(t, t.TempDir(), "frobnicate", "HOME="+home)

	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero\n%s", out)
	}
	if !strings.Contains(out, `"frobnicate"`) || !strings.Contains(out, "Usage:") {
		t.Errorf("output did not name the unknown subcommand and print the usage:\n%s", out)
	}
	if text, err := os.ReadFile(file); err != nil || string(text) != before {
		t.Errorf("the registry was touched: %q, %v", text, err)
	}
}

// spec-00012-AC-2.2: a first argument that looks like a path is an unknown
// subcommand too — the command never reads it as "the directory to open".
func TestAPathLikeFirstArgumentIsAnUnknownSubcommand(t *testing.T) {
	dir := tempDir(t)
	projectAt(t, filepath.Join(dir, "some-project"))
	home := tempDir(t)

	out, code := runChild(t, dir, "./some-project", "HOME="+home)

	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero\n%s", out)
	}
	if !strings.Contains(out, "./some-project") || !strings.Contains(out, "Usage:") {
		t.Errorf("output did not refuse it as an unknown subcommand:\n%s", out)
	}
	if _, err := os.Stat(filepath.Join(home, ".persimmon")); err == nil {
		t.Error("a registry was written for a subcommand that was refused")
	}
}

// spec-00011-AC-20.4: this repository's own root registers, and none of the
// three unavailabilities the command settles on its own holds against it. The
// affirmative `available` is the whole judgement's, flow config validator
// included, and that lives in the host package (design-00004 §4 追注).
func TestAddRegistersThisRepositoryAtItsRoot(t *testing.T) {
	root, inProject := project.FindRoot(mustGetwd(t))
	if !inProject {
		t.Fatal("the test does not run inside this repository")
	}
	h := newHarness(t)
	h.dir = mustGetwd(t)

	if err := cmdAdd(h.command, nil); err != nil {
		t.Fatal(err)
	}

	entries := h.entries(t)
	if len(entries) != 1 || entries[0].Path != root {
		t.Fatalf("registry = %+v, want this repository at %s", entries, root)
	}
	if got := judgeLocally(entries[0]); got != unasserted {
		t.Errorf("availability = %q, want none of the three unavailabilities to hold", got)
	}
	if h.stdout.String() != fmt.Sprintf("{\"id\":%q,\"name\":%q,\"path\":%q}\n", entries[0].ID, entries[0].Name, root) {
		t.Errorf("printed %q, want the entry as one line of JSON", h.stdout.String())
	}
}

func mustGetwd(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// spec-00011-AC-21.1: every entry is listed with its availability, and the two
// states come from the host package's judgement (design-00004 §4).
func TestListShowsEveryEntryWithItsAvailability(t *testing.T) {
	h := newHarness(t)
	h.hostDir = hostStub(t, `{"workspaces": [
	  {"id": "alpha", "name": "alpha", "path": "/work/alpha", "availability": "available"},
	  {"id": "demo", "name": "demo", "path": "/work/demo", "availability": "missing",
	   "error": "workspace directory does not exist: /work/demo"}
	]}`)
	h.writeRegistry(t, `{"version": 1, "workspaces": [
	  {"id": "alpha", "name": "alpha", "path": "/work/alpha"},
	  {"id": "demo", "name": "demo", "path": "/work/demo"}
	]}`)

	if err := cmdList(h.command); err != nil {
		t.Fatal(err)
	}

	lines := strings.Split(strings.TrimSuffix(h.stdout.String(), "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("listing = %q, want two lines", h.stdout.String())
	}
	if !strings.Contains(lines[0], "alpha") || !strings.HasSuffix(lines[0], "available") {
		t.Errorf("first line = %q, want alpha marked available", lines[0])
	}
	if !strings.Contains(lines[1], "/work/demo") || !strings.HasSuffix(lines[1], "missing") {
		t.Errorf("second line = %q, want demo marked missing", lines[1])
	}
}

// spec-00011-AC-21.2: an empty registry is an empty listing and a zero exit.
func TestListPrintsNothingOnAnEmptyRegistry(t *testing.T) {
	h := newHarness(t)

	if err := cmdList(h.command); err != nil {
		t.Fatal(err)
	}

	if h.stdout.String() != "" {
		t.Errorf("listing = %q, want nothing at all", h.stdout.String())
	}
}

// spec-00011-AC-21.3: with no process and no Node the listing still comes, and
// an entry none of the three local checks hits is shown as unasserted with one
// sentence saying the rest needs Node — never as available.
func TestListRetreatsToWhatItCanSettleWithoutNode(t *testing.T) {
	h := newHarness(t)
	h.version = "0.2.0"
	broken := gitRepo(t, projectAt(t, filepath.Join(tempDir(t), "broken")))
	h.writeRegistry(t, fmt.Sprintf(`{"version": 1, "workspaces": [{"id": "broken", "name": "broken", "path": %q}]}`, broken))
	hints := &bytes.Buffer{}
	h.stderr = hints
	pathWithoutNode(t)

	if err := cmdList(h.command); err != nil {
		t.Fatal(err)
	}

	if !strings.HasSuffix(strings.TrimSpace(h.stdout.String()), unasserted) {
		t.Errorf("listing = %q, want the availability column unasserted", h.stdout.String())
	}
	if !strings.Contains(hints.String(), "需要 Node") {
		t.Errorf("hint = %q, want one sentence saying the full judgement needs Node", hints.String())
	}
}

// spec-00011-AC-21.4: the three the command settles on its own are given in the
// retreat all the same — the unasserted column falls only to entries none of
// them hits.
func TestListStillNamesTheUnavailabilitiesItCanSettle(t *testing.T) {
	h := newHarness(t)
	h.version = "0.2.0"
	gone := filepath.Join(tempDir(t), "gone")
	h.writeRegistry(t, fmt.Sprintf(`{"version": 1, "workspaces": [{"id": "demo", "name": "demo", "path": %q}]}`, gone))
	pathWithoutNode(t)

	if err := cmdList(h.command); err != nil {
		t.Fatal(err)
	}

	if !strings.HasSuffix(strings.TrimSpace(h.stdout.String()), "missing") {
		t.Errorf("listing = %q, want demo marked missing", h.stdout.String())
	}
}

// spec-00012-AC-8.2: an unreleased build with no development override has no
// host package to pair with, and `list` works all the same — spec-00012-FR-8
// stops the opening path and nothing else.
func TestListWorksOnADevelopmentBuildWithNoOverride(t *testing.T) {
	h := newHarness(t)
	h.version = "dev"
	h.hostDir = ""
	gone := filepath.Join(tempDir(t), "gone")
	h.writeRegistry(t, fmt.Sprintf(`{"version": 1, "workspaces": [{"id": "demo", "name": "demo", "path": %q}]}`, gone))

	if err := cmdList(h.command); err != nil {
		t.Fatalf("cmdList = %v, want the listing all the same", err)
	}

	if !strings.Contains(h.stdout.String(), "demo") {
		t.Errorf("listing = %q, want the entry listed", h.stdout.String())
	}
}

// spec-00011-AC-15.4: `list` neither wants the port nor writes, so a stranger
// holding it is no reason to refuse — the file is read and the exit is 0.
func TestListReadsTheFileWhenAStrangerHoldsThePort(t *testing.T) {
	h := newHarness(t)
	h.port = strangerOn(t)
	h.writeRegistry(t, `{"version": 1, "workspaces": [{"id": "alpha", "name": "alpha", "path": "/work/alpha"}]}`)

	if err := cmdList(h.command); err != nil {
		t.Fatalf("cmdList = %v, want the file read instead", err)
	}

	if !strings.Contains(h.stdout.String(), "alpha") {
		t.Errorf("listing = %q, want alpha in it", h.stdout.String())
	}
}

// spec-00011-AC-2.1 on the command's side, and the shape `add` prints: the
// registration goes through the process already on the port, so its writes stay
// serialised and its switcher shows the entry at once (design-00003 §8).
func TestAddRegistersThroughTheProcessAlreadyRunning(t *testing.T) {
	host := newFakeHost(t)
	h := newHarness(t)
	h.port = host.port
	path := projectAt(t, filepath.Join(tempDir(t), "demo"))

	if err := cmdAdd(h.command, []string{path, "--name", "Demo"}); err != nil {
		t.Fatal(err)
	}

	if want := []string{path}; !slices.Equal(host.added, want) {
		t.Errorf("the running process was handed %v, want %v", host.added, want)
	}
	if got := strings.TrimSpace(h.stdout.String()); !strings.Contains(got, `"name":"Demo"`) {
		t.Errorf("printed %q, want the entry the process answered with", got)
	}
	if entries := h.entries(t); len(entries) != 0 {
		t.Errorf("the command wrote the registry file itself: %+v", entries)
	}
}

// spec-00011-FR-15: `add` writes, and a stranger on the port leaves it unknown
// whether another persimmon holds the same registry — so it refuses rather than
// write blind.
func TestAddRefusesWhenAStrangerHoldsThePort(t *testing.T) {
	h := newHarness(t)
	h.port = strangerOn(t)
	path := projectAt(t, filepath.Join(tempDir(t), "demo"))

	err := cmdAdd(h.command, []string{path})

	if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("port %d is already in use", h.port)) {
		t.Fatalf("cmdAdd = %v, want the port reported as in use", err)
	}
	if entries := h.entries(t); len(entries) != 0 {
		t.Errorf("registry = %+v, want nothing written", entries)
	}
}

// spec-00011-FR-13's reading for `add`: with no path and no project above the
// cwd there is nothing to register, and the sentence names the file it looked
// for.
func TestAddOutsideEveryProjectNamesWhatItLookedFor(t *testing.T) {
	h := newHarness(t)
	h.dir = tempDir(t)

	err := cmdAdd(h.command, nil)

	if err == nil || !strings.Contains(err.Error(), project.ConfigFile) {
		t.Fatalf("cmdAdd = %v, want the flow config it looked for named", err)
	}
}

// parseAdd's whole reading, one line each: what `add` takes and what it does not
// (design-00003 §8).
func TestAddReadsItsArguments(t *testing.T) {
	for _, testCase := range []struct {
		args       []string
		path, name string
		refused    bool
	}{
		{args: nil},
		{args: []string{"/work/demo"}, path: "/work/demo"},
		{args: []string{"--name", "Demo"}, name: "Demo"},
		{args: []string{"--name", "Demo", "/work/demo"}, path: "/work/demo", name: "Demo"},
		{args: []string{"/work/demo", "--name", "Demo"}, path: "/work/demo", name: "Demo"},
		{args: []string{"--name"}, refused: true},
		{args: []string{"/one", "/two"}, refused: true},
		{args: []string{"--force"}, refused: true},
	} {
		path, name, err := parseAdd(testCase.args)
		if testCase.refused {
			if err == nil || !strings.Contains(err.Error(), registryUsage) {
				t.Errorf("parseAdd(%q) = %v, want the usage", testCase.args, err)
			}
			continue
		}
		if err != nil || path != testCase.path || name != testCase.name {
			t.Errorf("parseAdd(%q) = %q, %q, %v; want %q, %q", testCase.args, path, name, err, testCase.path, testCase.name)
		}
	}
}

// spec-00011-AC-4.1 on the command's side: the path form is resolved and looked
// up as an id, the entry goes and the directory stays.
func TestRemoveDropsTheEntryThePathNames(t *testing.T) {
	h := newHarness(t)
	path := projectAt(t, filepath.Join(tempDir(t), "demo"))
	if err := cmdAdd(h.command, []string{path}); err != nil {
		t.Fatal(err)
	}
	h.stdout.Reset()

	if err := cmdRemove(h.command, []string{path}); err != nil {
		t.Fatal(err)
	}

	if entries := h.entries(t); len(entries) != 0 {
		t.Errorf("registry = %+v, want it empty", entries)
	}
	if !strings.Contains(h.stdout.String(), path) {
		t.Errorf("printed %q, want the entry that went", h.stdout.String())
	}
	if _, err := os.Stat(filepath.Join(path, project.ConfigFile)); err != nil {
		t.Errorf("the directory was touched: %v", err)
	}
}

// spec-00011-AC-4.1 through the process already running: the path form is
// looked up among what it holds and dropped by id (design-00003 §8).
func TestRemoveDropsTheEntryThroughTheProcessAlreadyRunning(t *testing.T) {
	host := newFakeHost(t)
	h := newHarness(t)
	h.port = host.port
	path := projectAt(t, filepath.Join(tempDir(t), "demo"))
	host.listed = []hostproc.Workspace{{
		Entry:        registry.Entry{ID: "demo", Name: "demo", Path: path},
		Availability: "available",
	}}

	if err := cmdRemove(h.command, []string{path}); err != nil {
		t.Fatal(err)
	}

	if want := []string{"demo"}; !slices.Equal(host.deleted, want) {
		t.Errorf("the running process dropped %v, want %v", host.deleted, want)
	}
	if !strings.Contains(h.stdout.String(), `"id":"demo"`) {
		t.Errorf("printed %q, want the entry the process answered with", h.stdout.String())
	}
}

// spec-00011-AC-5.2: an id nobody registered is reported and nothing changes —
// on both paths, since the running process holds the same registry.
func TestRemoveReportsAnIDThatIsNotRegistered(t *testing.T) {
	host := newFakeHost(t)
	for _, testCase := range []struct {
		name string
		port int
	}{
		{name: "from the file", port: freePort(t)},
		{name: "through the running process", port: host.port},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)
			h.port = testCase.port
			h.writeRegistry(t, `{"version": 1, "workspaces": []}`)

			err := cmdRemove(h.command, []string{"ghost"})

			if err == nil || !strings.Contains(err.Error(), `"ghost" is not registered`) {
				t.Fatalf("cmdRemove = %v, want the id reported as unregistered", err)
			}
		})
	}
}

// spec-00011-FR-15: `remove` writes too, so a stranger on the port refuses it.
func TestRemoveRefusesWhenAStrangerHoldsThePort(t *testing.T) {
	h := newHarness(t)
	h.port = strangerOn(t)

	err := cmdRemove(h.command, []string{"demo"})

	if err == nil || !strings.Contains(err.Error(), "already in use") {
		t.Fatalf("cmdRemove = %v, want the port reported as in use", err)
	}
}

// design-00003 §8: `remove` takes exactly one id or path, and anything else is
// the usage.
func TestRemoveTakesExactlyOneArgument(t *testing.T) {
	h := newHarness(t)

	for _, args := range [][]string{nil, {"a", "b"}} {
		if err := cmdRemove(h.command, args); err == nil || !strings.Contains(err.Error(), registryUsage) {
			t.Errorf("cmdRemove(%q) = %v, want the usage", args, err)
		}
	}
}

// design-00003 §8: while a process is there its judgement is the listing's — it
// is the one that knows which workspaces are live.
func TestListTakesTheListingFromTheProcessAlreadyRunning(t *testing.T) {
	host := newFakeHost(t)
	h := newHarness(t)
	h.port = host.port
	host.listed = []hostproc.Workspace{
		{Entry: registry.Entry{ID: "alpha", Name: "alpha", Path: "/work/alpha"}, Availability: "available"},
	}

	if err := cmdList(h.command); err != nil {
		t.Fatal(err)
	}

	if got := strings.TrimSpace(h.stdout.String()); got != "alpha  alpha  /work/alpha  available" {
		t.Errorf("listing = %q, want the row the process answered with", got)
	}
}

// spec-00011-FR-18: an ill-formed registry is refused by `list` as by the rest,
// naming the file and the problem.
func TestListRefusesAnIllFormedRegistry(t *testing.T) {
	h := newHarness(t)
	h.writeRegistry(t, `{"version": 2, "workspaces": []}`)

	err := cmdList(h.command)

	if err == nil || !strings.Contains(err.Error(), h.file) || !strings.Contains(err.Error(), "`version` must be 1") {
		t.Fatalf("cmdList = %v, want the file and the problem named", err)
	}
}

// design-00003 §3: the second and third of the checks the command settles on its
// own — a directory that is no git repository of its own, and one holding no
// flow config.
func TestTheThreeUnavailabilitiesTheCommandSettlesItself(t *testing.T) {
	root := tempDir(t)
	plain := projectAt(t, filepath.Join(root, "plain"))
	bare := gitRepo(t, filepath.Join(root, "bare"))
	broken := filepath.Join(root, "broken")
	projectAt(t, broken)
	if err := os.WriteFile(filepath.Join(broken, ".git"), []byte("not a gitdir\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, testCase := range []struct{ path, want string }{
		{path: filepath.Join(root, "gone"), want: "missing"},
		{path: plain, want: "noGit"},
		{path: broken, want: "noGit"},
		{path: bare, want: "noConfig"},
		{path: gitRepo(t, projectAt(t, filepath.Join(root, "whole"))), want: unasserted},
	} {
		if got := judgeLocally(registry.Entry{ID: "x", Name: "x", Path: testCase.path}); got != testCase.want {
			t.Errorf("judgeLocally(%s) = %q, want %q", testCase.path, got, testCase.want)
		}
	}
}

// design-00004 §3 追注: the port's default is resolved in this one place, and a
// `PORT` that is no port is refused rather than folded into it.
func TestThePortIsTheEnvironmentOrTheDefault(t *testing.T) {
	for _, testCase := range []struct {
		text    string
		port    int
		refused bool
	}{
		{text: "", port: defaultPort},
		{text: "5000", port: 5000},
		{text: "nope", refused: true},
		{text: "0", refused: true},
		{text: "70000", refused: true},
	} {
		port, err := resolvePort(testCase.text)
		if testCase.refused {
			if err == nil || !strings.Contains(err.Error(), testCase.text) {
				t.Errorf("resolvePort(%q) = %d, %v; want it refused", testCase.text, port, err)
			}
			continue
		}
		if err != nil || port != testCase.port {
			t.Errorf("resolvePort(%q) = %d, %v; want %d", testCase.text, port, err, testCase.port)
		}
	}
}

// design-00003 §2: the registry lives in the home directory and takes no
// environment variable of its own, and what the command reads from the world it
// reads once.
func TestNewCommandReadsTheWorldOnce(t *testing.T) {
	home := tempDir(t)
	t.Setenv("HOME", home)
	t.Setenv("PORT", "5000")
	t.Setenv("PERSIMMON_HOST", "/checkout")

	c, err := newCommand()
	if err != nil {
		t.Fatal(err)
	}

	if c.port != 5000 || c.hostDir != "/checkout" || c.version != version {
		t.Errorf("command = %+v, want the port, the override and the version read", c)
	}
	if _, addErr := c.registry.Add(projectAt(t, filepath.Join(tempDir(t), "demo")), ""); addErr != nil {
		t.Fatal(addErr)
	}
	if _, statErr := os.Stat(filepath.Join(home, ".persimmon", "workspaces.json")); statErr != nil {
		t.Errorf("the registry did not land in the home directory: %v", statErr)
	}
}

// The two ways reading the world fails: no home directory to keep the registry
// in, and a `PORT` that is no port.
func TestNewCommandReportsAWorldItCannotRead(t *testing.T) {
	t.Setenv("HOME", "")
	if _, err := newCommand(); err == nil {
		t.Error("newCommand = nil, want the missing home directory reported")
	}
	t.Setenv("HOME", tempDir(t))
	t.Setenv("PORT", "nope")
	if _, err := newCommand(); err == nil {
		t.Error("newCommand = nil, want the unreadable PORT reported")
	}
}

// spec-00012-AC-9.2 and AC-9.3 on the dispatch: version, its two aliases and
// help all answer without a registry or a port, and every subcommand of the
// closed set reaches its own code (spec-00012-FR-1).
func TestTheDispatchAnswersEveryFormOfTheClosedSet(t *testing.T) {
	home := tempDir(t)
	path := projectAt(t, filepath.Join(tempDir(t), "demo"))

	for _, testCase := range []struct {
		spec, contains string
		code           int
	}{
		{spec: "version", contains: "persimmon dev"},
		{spec: "-v", contains: "persimmon dev"},
		{spec: "--version", contains: "persimmon dev"},
		{spec: "help", contains: "Usage:"},
		{spec: "-h", contains: "Usage:"},
		{spec: "--help", contains: "Usage:"},
		{spec: "add " + path, contains: `"path":"` + path + `"`},
		{spec: "list", contains: "demo"},
		{spec: "remove demo", contains: `"id":"demo"`},
		{spec: "remove ghost", contains: "not registered", code: 1},
		// An unreleased build has no published host package to pair with, and
		// the opening path says so rather than guessing a version
		// (spec-00012-AC-8.1).
		{spec: "none", contains: "PERSIMMON_HOST", code: 1},
	} {
		t.Run(testCase.spec, func(t *testing.T) {
			out, code := runChild(t, t.TempDir(), testCase.spec, "HOME="+home, "PORT="+strconv.Itoa(freePort(t)))
			if code != testCase.code {
				t.Errorf("exit code = %d, want %d\n%s", code, testCase.code, out)
			}
			if !strings.Contains(out, testCase.contains) {
				t.Errorf("output did not carry %q:\n%s", testCase.contains, out)
			}
		})
	}
}

// spec-00013-FR-9: `update` reaches the scaffold's merge and reports what it
// cannot do — a directory with no creation marker is not a project it made.
func TestUpdateOutsideAProjectItCreatedIsReported(t *testing.T) {
	out, code := runChild(t, tempDir(t), "update")

	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero\n%s", out)
	}
	if !strings.Contains(out, "error:") {
		t.Errorf("output did not report the missing creation marker:\n%s", out)
	}
}

// spec-00012-AC-1.1: the command is one executable and needs no other. On a PATH holding
// nothing at all — `ainpt`, the tool this scaffold was carved out of, least of all —
// `list-langs` still lists the template.
func TestListLangsNeedsNothingElseOnThePath(t *testing.T) {
	srv, _ := branchServer(t, []string{"main", "lang/go"})
	t.Setenv("PATH", t.TempDir())
	if _, err := exec.LookPath("ainpt"); err == nil {
		t.Fatal("ainpt is still on PATH; the case cannot say anything")
	}

	var out strings.Builder
	if err := cmdLangs(&out, srv.URL); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); !strings.Contains(got, "--lang go") {
		t.Errorf("listing = %q, want the template listed with no other executable around", got)
	}
}

// spec-00012-AC-9.1: what `version` prints is the build-injected `version`, in all three
// spellings — set it here to a value no source default could produce. That the release
// archive's binary really carries the release's number is the ldflags half, proven by the
// `goreleaser release --snapshot --clean` run recorded in
// docs/record/record-00035-persimmon-command-acceptance.md.
func TestVersionPrintsTheInjectedVersion(t *testing.T) {
	saved := version
	version = "1.2.3"
	t.Cleanup(func() { version = saved })

	for _, spelling := range []string{"version", "-v", "--version"} {
		t.Run(spelling, func(t *testing.T) {
			var code int
			out := printed(t, func() { code = run([]string{spelling}) })
			if code != 0 {
				t.Errorf("exit code = %d, want 0", code)
			}
			if strings.TrimSpace(out) != "persimmon 1.2.3" {
				t.Errorf("output = %q, want %q", out, "persimmon 1.2.3")
			}
		})
	}
}

// spec-00012-AC-10.3: nothing in the command needs Node. On a PATH holding neither `node`
// nor `npx` every subcommand still does its work. `update` is the sixth of them and is
// covered by spec-00012-AC-7.3 (scaffold.TestUpdateMergesOnAMachineWithoutNode), which
// merges with git alone.
func TestEverySubcommandRunsWithoutNode(t *testing.T) {
	h := newHarness(t)
	path := projectAt(t, filepath.Join(tempDir(t), "demo"))
	srv, _ := branchServer(t, []string{"main", "lang/go"})
	t.Setenv("PATH", t.TempDir())
	for _, tool := range []string{"node", "npx"} {
		if _, err := exec.LookPath(tool); err == nil {
			t.Fatalf("%s is still on PATH; the case cannot say anything", tool)
		}
	}

	// The order is the one a user would take: register, list, drop. Each case reports
	// what it printed, so the assertion is on this run alone.
	buffered := func(f func() error) func() (string, error) {
		return func() (string, error) {
			h.stdout.Reset()
			err := f()
			return h.stdout.String(), err
		}
	}
	for _, testCase := range []struct {
		name, contains string
		do             func() (string, error)
	}{
		{"add", `"path":"` + path + `"`, buffered(func() error { return cmdAdd(h.command, []string{path}) })},
		{"list", "demo", buffered(func() error { return cmdList(h.command) })},
		{"remove", `"id":"demo"`, buffered(func() error { return cmdRemove(h.command, []string{"demo"}) })},
		{"list-langs", "--lang go", buffered(func() error { return cmdLangs(h.stdout, srv.URL) })},
		{"version", "persimmon", func() (string, error) {
			var code int
			out := printed(t, func() { code = run([]string{"version"}) })
			if code != 0 {
				return out, fmt.Errorf("exit code = %d", code)
			}
			return out, nil
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			out, err := testCase.do()
			if err != nil {
				t.Fatalf("%s = %v, want it to work with no Node on the machine", testCase.name, err)
			}
			if !strings.Contains(out, testCase.contains) {
				t.Errorf("output did not carry %q:\n%s", testCase.contains, out)
			}
		})
	}
}
