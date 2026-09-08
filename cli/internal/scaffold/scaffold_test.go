package scaffold

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// writeTree materialises a map of slash-separated paths to contents under root.
func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for rel, body := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func exists(t *testing.T, root, rel string) bool {
	t.Helper()
	_, err := os.Lstat(filepath.Join(root, filepath.FromSlash(rel)))
	return err == nil
}

// writeLink materialises rel as a symlink to target, the shape CLAUDE.md -> AGENTS.md has.
func writeLink(t *testing.T, root, rel, target string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, p); err != nil {
		t.Fatal(err)
	}
}

// linkTarget fails the test unless rel is a symlink, then returns what it points at.
func linkTarget(t *testing.T, root, rel string) string {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	fi, err := os.Lstat(p)
	if err != nil {
		t.Fatalf("%s: %v", rel, err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("%s is a regular file, not a symlink", rel)
	}
	got, err := os.Readlink(p)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func readFile(t *testing.T, root, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The asymmetry that made the update walk wrong. A glob is not obliged to match at every
// depth: filepath.Match never lets `*` cross a separator, so this pattern describes the
// directory and not the file one level below it. Anything that tests files alone will
// therefore consider that file un-excluded.
func TestExcludedMatchesTheDirectoryButNotTheFileBeneathIt(t *testing.T) {
	pattern := []string{"docs/*/[^A-Z]*"}

	for _, tc := range []struct {
		rel  string
		want bool
	}{
		{"docs/reference/axon-framework", true},
		{"docs/reference/axon-framework/20260708161438-ddd-notes.md", false},
		{"docs/design/design-00001-x.md", true},
		{"docs/design/README.md", false},
	} {
		if got := excluded(tc.rel, pattern); got != tc.want {
			t.Errorf("excluded(%q) = %v, want %v", tc.rel, got, tc.want)
		}
	}

	// A trailing-slash entry is matched by the prefix branch instead, which does hold at
	// every depth — this is why .github/ never leaked while the glob above did.
	for _, rel := range []string{".github", ".github/workflows", ".github/workflows/ci.yml"} {
		if !excluded(rel, []string{".github/"}) {
			t.Errorf("excluded(%q, [.github/]) = false, want true", rel)
		}
	}
}

// Creation prunes an excluded directory with SkipDir, so nothing underneath is ever
// copied. Update has to prune it the same way, or it reinstates exactly what creation
// dropped — which is invisible until someone runs update on a real project.
func TestMergeTreePrunesExcludedDirectories(t *testing.T) {
	dir, oldSrc, newSrc := t.TempDir(), t.TempDir(), t.TempDir()

	// Both are new upstream — absent from the base — so the deletion rule below does not
	// apply and pruning is the only thing that can keep the notes out.
	writeTree(t, oldSrc, map[string]string{"AGENTS.md": "x\n"})
	writeTree(t, newSrc, map[string]string{
		"AGENTS.md":                "x\n",
		"docs/reference/README.md": "kept\n",
		"docs/reference/axon-framework/20260708161438-ddd-notes.md": "notes\n",
	})
	writeTree(t, dir, map[string]string{"AGENTS.md": "x\n"})

	res, err := mergeTree(dir, oldSrc, newSrc, []string{"docs/*/[^A-Z]*"})
	if err != nil {
		t.Fatal(err)
	}

	if exists(t, dir, "docs/reference/axon-framework/20260708161438-ddd-notes.md") {
		t.Error("an excluded directory's contents were added; the walk did not prune it")
	}
	if !exists(t, dir, "docs/reference/README.md") {
		t.Error("docs/reference/README.md was not added, but nothing excludes it")
	}
	if res.added != 1 {
		t.Errorf("added = %d, want 1", res.added)
	}
}

// Everything template.json's post_create deletes lands here: the file is in the base
// tree and gone from the project because the project removed it on purpose. A 3-way
// merge honours a deletion; treating it as "new upstream file" resurrects it on every
// update, forever.
func TestMergeTreeLeavesDeliberateDeletionsDeleted(t *testing.T) {
	dir, oldSrc, newSrc := t.TempDir(), t.TempDir(), t.TempDir()

	writeTree(t, oldSrc, map[string]string{
		"scaffold/pom.xml":   "<project/>\n",
		"scripts/new-app.sh": "#!/bin/sh\n",
	})
	writeTree(t, newSrc, map[string]string{
		"scaffold/pom.xml":   "<project/>\n",
		"scripts/new-app.sh": "#!/bin/sh\n",
	})
	// dir is empty: post_create removed both at creation time.

	res, err := mergeTree(dir, oldSrc, newSrc, nil)
	if err != nil {
		t.Fatal(err)
	}

	for _, rel := range []string{"scaffold/pom.xml", "scripts/new-app.sh"} {
		if exists(t, dir, rel) {
			t.Errorf("%s was resurrected; the project had deleted it", rel)
		}
	}
	if res.added != 0 {
		t.Errorf("added = %d, want 0", res.added)
	}
	if res.kept != 2 {
		t.Errorf("kept = %d, want 2", res.kept)
	}
}

// The other side of the same rule: absent from the base means the template really did
// add it since this project was created, so it must arrive.
func TestMergeTreeAddsFilesNewSinceTheBase(t *testing.T) {
	dir, oldSrc, newSrc := t.TempDir(), t.TempDir(), t.TempDir()

	writeTree(t, oldSrc, map[string]string{"AGENTS.md": "old\n"})
	writeTree(t, newSrc, map[string]string{"AGENTS.md": "old\n", "SECURITY.md": "new\n"})
	writeTree(t, dir, map[string]string{"AGENTS.md": "old\n"})

	res, err := mergeTree(dir, oldSrc, newSrc, nil)
	if err != nil {
		t.Fatal(err)
	}

	if !exists(t, dir, "SECURITY.md") {
		t.Error("SECURITY.md is new upstream and was not added")
	}
	if res.added != 1 {
		t.Errorf("added = %d, want 1", res.added)
	}
	if res.kept != 0 {
		t.Errorf("kept = %d, want 0", res.kept)
	}
}

// A symlink must arrive as a symlink. Reading it with os.ReadFile would follow it and
// write a second, independent copy of AGENTS.md under the name CLAUDE.md, which then
// drifts on the next edit — the one outcome the link exists to prevent.
func TestMergeTreeAddsASymlinkWithoutCopyingItsTarget(t *testing.T) {
	dir, oldSrc, newSrc := t.TempDir(), t.TempDir(), t.TempDir()

	writeTree(t, oldSrc, map[string]string{"AGENTS.md": "x\n"})
	writeTree(t, newSrc, map[string]string{"AGENTS.md": "x\n"})
	writeLink(t, newSrc, "CLAUDE.md", "AGENTS.md")
	writeTree(t, dir, map[string]string{"AGENTS.md": "x\n"})

	res, err := mergeTree(dir, oldSrc, newSrc, nil)
	if err != nil {
		t.Fatal(err)
	}

	if got := linkTarget(t, dir, "CLAUDE.md"); got != "AGENTS.md" {
		t.Errorf("CLAUDE.md -> %q, want AGENTS.md", got)
	}
	if res.added != 1 {
		t.Errorf("added = %d, want 1", res.added)
	}
}

// A project that retargeted the link decided that on purpose, and while the template
// leaves the link alone that decision must survive rather than conflict on every update.
//
// This is also where writing through a link does real damage. git merge-file follows the
// link before writing, so merging CLAUDE.md here folds the template's AGENTS.md delta
// into whatever the project pointed the link at — HOUSE-RULES.md comes back holding the
// template's text and a set of conflict markers it never asked for.
func TestMergeTreeKeepsARetargetedLinkAndSparesWhatItPointsAt(t *testing.T) {
	dir, oldSrc, newSrc := t.TempDir(), t.TempDir(), t.TempDir()

	writeTree(t, oldSrc, map[string]string{"AGENTS.md": "one\ntwo\n"})
	writeLink(t, oldSrc, "CLAUDE.md", "AGENTS.md")
	writeTree(t, newSrc, map[string]string{"AGENTS.md": "one\ntwo\nthree\n"})
	writeLink(t, newSrc, "CLAUDE.md", "AGENTS.md")
	writeTree(t, dir, map[string]string{"AGENTS.md": "one\ntwo\n", "HOUSE-RULES.md": "house rules\n"})
	writeLink(t, dir, "CLAUDE.md", "HOUSE-RULES.md")

	res, err := mergeTree(dir, oldSrc, newSrc, nil)
	if err != nil {
		t.Fatal(err)
	}

	if got := linkTarget(t, dir, "CLAUDE.md"); got != "HOUSE-RULES.md" {
		t.Errorf("CLAUDE.md -> %q, want HOUSE-RULES.md", got)
	}
	if got := readFile(t, dir, "HOUSE-RULES.md"); got != "house rules\n" {
		t.Errorf("HOUSE-RULES.md = %q; the merge wrote through the link", got)
	}
	if len(res.conflicts) != 0 {
		t.Errorf("conflicts = %v, want none — the template did not touch the link", res.conflicts)
	}
}

// When both sides moved the link there is nothing to merge and nowhere to put markers,
// so the project's link stands and the divergence is reported for a human to settle.
func TestMergeTreeReportsALinkBothSidesMoved(t *testing.T) {
	dir, oldSrc, newSrc := t.TempDir(), t.TempDir(), t.TempDir()

	writeLink(t, oldSrc, "CLAUDE.md", "AGENTS.md")
	writeLink(t, newSrc, "CLAUDE.md", "GUIDELINES.md")
	writeLink(t, dir, "CLAUDE.md", "HOUSE-RULES.md")

	res, err := mergeTree(dir, oldSrc, newSrc, nil)
	if err != nil {
		t.Fatal(err)
	}

	if got := linkTarget(t, dir, "CLAUDE.md"); got != "HOUSE-RULES.md" {
		t.Errorf("CLAUDE.md -> %q, want HOUSE-RULES.md left untouched", got)
	}
	if len(res.conflicts) != 1 || !strings.Contains(res.conflicts[0], "CLAUDE.md") {
		t.Errorf("conflicts = %v, want one naming CLAUDE.md", res.conflicts)
	}
}

// Creation has the same hazard as update: os.ReadFile follows the link.
func TestCopyTreePreservesSymlinks(t *testing.T) {
	src, dst := t.TempDir(), filepath.Join(t.TempDir(), "proj")

	writeTree(t, src, map[string]string{"AGENTS.md": "x\n"})
	writeLink(t, src, "CLAUDE.md", "AGENTS.md")

	if err := copyTree(src, dst, nil); err != nil {
		t.Fatal(err)
	}
	if got := linkTarget(t, dst, "CLAUDE.md"); got != "AGENTS.md" {
		t.Errorf("CLAUDE.md -> %q, want AGENTS.md", got)
	}
}

// A local edit must survive an unrelated upstream edit to the same file — the reason
// update is a merge and not a copy. Guards the refactor that moved this walk out of
// Update.
func TestMergeTreeKeepsLocalEditsWhileFoldingInUpstream(t *testing.T) {
	dir, oldSrc, newSrc := t.TempDir(), t.TempDir(), t.TempDir()

	writeTree(t, oldSrc, map[string]string{"README.md": "title\nbody\nfooter\n"})
	writeTree(t, newSrc, map[string]string{"README.md": "title\nbody\nfooter upstream\n"})
	writeTree(t, dir, map[string]string{"README.md": "title mine\nbody\nfooter\n"})

	res, err := mergeTree(dir, oldSrc, newSrc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.merged != 1 || len(res.conflicts) != 0 {
		t.Fatalf("merged = %d, conflicts = %v; want 1 and none", res.merged, res.conflicts)
	}

	got, err := os.ReadFile(filepath.Join(dir, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "title mine") {
		t.Errorf("the local edit was lost:\n%s", got)
	}
	if !strings.Contains(string(got), "footer upstream") {
		t.Errorf("the upstream edit was not folded in:\n%s", got)
	}
}

// issue-00034 / spec-00013-AC-11.4, spec-00013-AC-11.5: the creation marker's template
// coordinate must be exactly owner/repo. Counting the segments SplitN returned lets an
// empty owner (`/repo`) and a third segment (`owner/repo/extra`) through.
func TestUpdateRejectsATemplateThatIsNotOwnerSlashRepo(t *testing.T) {
	for _, template := range []string{"/repo", "owner/repo/extra"} {
		t.Run(template, func(t *testing.T) {
			dir := t.TempDir()
			marker := `{"template":"` + template + `","ref":"main","commit":"abc123"}` + "\n"
			writeTree(t, dir, map[string]string{".ainpt.json": marker, "README.md": "mine\n"})

			err := Update(dir)
			if err == nil || !strings.Contains(err.Error(), "owner/repo") {
				t.Fatalf("Update(%q) error = %v, want it to name the owner/repo shape", template, err)
			}
			if got := readFile(t, dir, ".ainpt.json"); got != marker {
				t.Errorf("creation marker changed to %q", got)
			}
			if got := readFile(t, dir, "README.md"); got != "mine\n" {
				t.Errorf("project file changed to %q", got)
			}
		})
	}
}

// The template repository is stubbed for every test below: fetch and resolveSHA name
// codeload.github.com and api.github.com in full, so the stub is installed by swapping
// http.DefaultTransport, which both of them route through.
const (
	stubOwner = "acme"
	stubRepo  = "tpl"
	baseSHA   = "abc1230000000000000000000000000000000000"
	headSHA   = "def4560000000000000000000000000000000000"
)

// roundTripFunc adapts a plain function to http.RoundTripper.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// tarball writes tree in the shape codeload serves a branch: every entry under one
// top-level wrapper directory, which fetch strips.
func tarball(w io.Writer, tree map[string]string) error {
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	for rel, body := range tree {
		h := &tar.Header{Name: "root/" + rel, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}
		if err := tw.WriteHeader(h); err != nil {
			return err
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// stubGitHub serves the template repository's two endpoints from an httptest server and
// points every outgoing request at it for the test's duration, so nothing reaches the
// real GitHub. heads answers the commit lookup for a branch (a branch missing from it
// answers 404, which is how a failed lookup is provoked); trees holds the tree behind
// each ref, keyed by branch name and by commit sha.
func stubGitHub(t *testing.T, heads map[string]string, trees map[string]map[string]string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if ref, ok := strings.CutPrefix(p, "repos/"+stubOwner+"/"+stubRepo+"/commits/"); ok {
			sha, ok := heads[ref]
			if !ok {
				http.NotFound(w, r)
				return
			}
			fmt.Fprintln(w, sha)
			return
		}
		ref, ok := strings.CutPrefix(p, stubOwner+"/"+stubRepo+"/tar.gz/")
		if !ok {
			http.NotFound(w, r)
			return
		}
		tree, ok := trees[strings.TrimPrefix(ref, "refs/heads/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if err := tarball(w, tree); err != nil {
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

// capture runs fn with os.Stdout redirected and returns what it printed: the command's
// warnings and its merge summary are themselves part of what several criteria assert.
func capture(t *testing.T, fn func() error) (string, error) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	fnErr := fn()
	os.Stdout = saved
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	return string(out), fnErr
}

// runNew scaffolds a project out of tree into a fresh parent directory and returns the
// project directory alongside what the command printed.
func runNew(t *testing.T, o Options, tree map[string]string) (string, string, error) {
	t.Helper()
	if o.Name == "" {
		o.Name = "demo"
	}
	if o.Dir == "" {
		o.Dir = t.TempDir()
	}
	o.Owner, o.Repo = stubOwner, stubRepo
	ref := resolveRef(o)
	stubGitHub(t, map[string]string{ref: headSHA}, map[string]map[string]string{ref: tree})
	out, err := capture(t, func() error { return Run(o) })
	return filepath.Join(o.Dir, o.Name), out, err
}

// marker is the creation marker as new writes it — and as a project scaffolded by ainpt
// before the move into this repository carries it.
func marker(sha string) string {
	return "{\n  \"template\": \"" + stubOwner + "/" + stubRepo + "\",\n" +
		"  \"ref\": \"main\",\n  \"commit\": \"" + sha + "\"\n}\n"
}

// stubUpdateRepo points the stub repository at the tree the branch held at the marker's
// merge base and the tree it holds now.
func stubUpdateRepo(t *testing.T, base, head map[string]string) {
	t.Helper()
	stubGitHub(t, map[string]string{"main": headSHA}, map[string]map[string]string{baseSHA: base, "main": head})
}

// readLock returns the project's creation marker, parsed.
func readLock(t *testing.T, dir string) Lock {
	t.Helper()
	var l Lock
	if err := json.Unmarshal([]byte(readFile(t, dir, ".ainpt.json")), &l); err != nil {
		t.Fatal(err)
	}
	return l
}

// spec-00013-AC-2.1: an exclude pattern naming a directory keeps the whole tree out.
func TestNewSkipsAnExcludedDirectory(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json":            `{"exclude": [".github/"]}`,
		".github/workflows/ci.yml": "on: push\n",
		"README.md":                "hi\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	if exists(t, dir, ".github") {
		t.Error(".github was copied, but the manifest excludes it")
	}
	if !exists(t, dir, "README.md") {
		t.Error("README.md is not excluded and was not copied")
	}
}

// spec-00013-AC-2.2: .git and template.json are never copied, and need no exclude entry.
func TestNewNeverCopiesTheGitDirectoryOrTheManifest(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{}`,
		".git/config":   "[core]\n",
		"README.md":     "hi\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{".git", "template.json"} {
		if exists(t, dir, rel) {
			t.Errorf("%s was copied; it must never reach a scaffolded project", rel)
		}
	}
}

// spec-00013-AC-2.3: a placeholder in a substituted file becomes the project name.
func TestNewSubstitutesPlaceholdersInTheListedFiles(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{"substitute": ["README.md"]}`,
		"README.md":     "# {{PROJECT_NAME}}\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dir, "README.md"); got != "# demo\n" {
		t.Errorf("README.md = %q, want the placeholder replaced by the project name", got)
	}
}

// spec-00013-AC-2.4: a variable's own default is placeholder-expanded, so a default of
// {{name}} resolves to the project name.
func TestNewExpandsPlaceholdersInsideAVariableDefault(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{"vars": {"ARTIFACT_ID": {"default": "{{name}}"}}, "substitute": ["pom.xml"]}`,
		"pom.xml":       "<artifactId>{{ARTIFACT_ID}}</artifactId>\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dir, "pom.xml"); got != "<artifactId>demo</artifactId>\n" {
		t.Errorf("pom.xml = %q, want the default expanded to demo", got)
	}
}

// spec-00013-AC-2.5: a post_create step gated on a language is skipped when no language
// was asked for.
func TestNewSkipsAPostCreateStepGatedOnAnotherLanguage(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{"post_create": [{"cmd": "touch went-go", "when_lang": "go"}]}`,
		"README.md":     "hi\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	if exists(t, dir, "went-go") {
		t.Error("the step ran, but it is gated on --lang go and no language was given")
	}
}

// spec-00013-AC-2.6: the same step runs, inside the new project, when the language matches.
func TestNewRunsAPostCreateStepGatedOnTheChosenLanguage(t *testing.T) {
	dir, _, err := runNew(t, Options{Lang: "go"}, map[string]string{
		"template.json": `{"post_create": [{"cmd": "touch went-go", "when_lang": "go"}]}`,
		"README.md":     "hi\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !exists(t, dir, "went-go") {
		t.Error("the step is gated on --lang go, which was given, and did not run in the project")
	}
}

// spec-00013-AC-2.7: post_create steps run in declaration order — the second here can
// only succeed after the first, and the third only after the second.
func TestNewRunsPostCreateStepsInDeclarationOrder(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{"post_create": [
			{"cmd": "printf one > first"},
			{"cmd": "cp first second"},
			{"cmd": "cp second third"}
		]}`,
		"README.md": "hi\n",
	})
	if err != nil {
		t.Fatalf("a later step ran before the one it depends on: %v", err)
	}
	if got := readFile(t, dir, "third"); got != "one" {
		t.Errorf("third = %q, want the value the first step wrote", got)
	}
}

// spec-00013-AC-2.8: a substitute entry the branch does not actually have is skipped.
func TestNewIgnoresASubstituteEntryTheBranchDoesNotHave(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{"substitute": ["ABSENT.md", "README.md"]}`,
		"README.md":     "# {{PROJECT_NAME}}\n",
	})
	if err != nil {
		t.Fatalf("a listed but absent file must not fail the scaffold: %v", err)
	}
	if got := readFile(t, dir, "README.md"); got != "# demo\n" {
		t.Errorf("README.md = %q; the file that does exist was still substituted", got)
	}
}

// spec-00013-AC-3.1: the creation marker records where the project came from, down to
// the commit that becomes the merge base.
func TestNewRecordsTheTemplateCoordinateRefAndBaseCommit(t *testing.T) {
	dir, _, err := runNew(t, Options{Lang: "go"}, map[string]string{"README.md": "hi\n"})
	if err != nil {
		t.Fatal(err)
	}
	got := readLock(t, dir)
	want := Lock{Template: stubOwner + "/" + stubRepo, Ref: "lang/go", Lang: "go", Commit: headSHA}
	if got.Template != want.Template || got.Ref != want.Ref || got.Lang != want.Lang || got.Commit != want.Commit {
		t.Errorf("marker = %+v, want template/ref/lang/commit %+v", got, want)
	}
}

// spec-00013-AC-3.2: the marker's variable table carries the resolved variables but not
// name, which follows the project's own name rather than the template.
func TestNewRecordsTheResolvedVariablesWithoutName(t *testing.T) {
	dir, _, err := runNew(t, Options{Sets: map[string]string{"MODULE_PATH": "example.com/x"}},
		map[string]string{"README.md": "hi\n"})
	if err != nil {
		t.Fatal(err)
	}
	vars := readLock(t, dir).Vars
	if vars["MODULE_PATH"] != "example.com/x" || vars["PROJECT_NAME"] != "demo" {
		t.Errorf("marker vars = %v, want MODULE_PATH and PROJECT_NAME", vars)
	}
	if _, ok := vars["name"]; ok {
		t.Errorf("marker vars = %v, want no name entry", vars)
	}
}

// spec-00013-AC-3.3: the marker's name and format are unchanged, so a project scaffolded
// before the move into this repository updates with no migration step.
func TestUpdateHandlesAProjectScaffoldedBeforeTheMove(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "mine\nbody\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "title\nbody\n"},
		map[string]string{"README.md": "title\nbody upstream\n"})

	out, err := capture(t, func() error { return Update(dir) })
	if err != nil {
		t.Fatalf("Update = %v, want the pre-existing marker handled as is", err)
	}
	if !strings.Contains(out, "Merged 1 file(s)") {
		t.Errorf("output did not report the merge:\n%s", out)
	}
}

// spec-00013-AC-5.1: an existing target is refused without touching what is inside it.
func TestNewRefusesATargetThatAlreadyExists(t *testing.T) {
	parent := t.TempDir()
	writeTree(t, filepath.Join(parent, "demo"), map[string]string{"mine.txt": "mine\n"})

	dir, _, err := runNew(t, Options{Dir: parent}, map[string]string{"README.md": "hi\n"})
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("Run = %v, want it to say the target already exists", err)
	}
	if got := readFile(t, dir, "mine.txt"); got != "mine\n" {
		t.Errorf("mine.txt = %q, want it untouched", got)
	}
	if exists(t, dir, "README.md") {
		t.Error("the template was copied into the existing directory")
	}
}

// spec-00013-AC-5.2: a branch that does not exist is reported with the pointer to the
// listing, and no project directory is left behind.
func TestNewReportsAMissingBranchAndPointsAtTheListing(t *testing.T) {
	parent := t.TempDir()
	stubGitHub(t, map[string]string{"main": headSHA}, map[string]map[string]string{"main": {"README.md": "hi\n"}})

	_, err := capture(t, func() error {
		return Run(Options{Name: "demo", Dir: parent, Lang: "rust", Owner: stubOwner, Repo: stubRepo})
	})
	if err == nil || !strings.Contains(err.Error(), "persimmon list-langs") {
		t.Fatalf("Run = %v, want the failure to point at `persimmon list-langs`", err)
	}
	if exists(t, parent, "demo") {
		t.Error("demo was created even though the branch could not be fetched")
	}
}

// spec-00013-AC-5.3: a declared variable with neither a default nor a --set fails with
// the flag to pass, and never prompts.
func TestNewReportsAMissingRequiredVariable(t *testing.T) {
	parent := t.TempDir()
	dir, _, err := runNew(t, Options{Dir: parent}, map[string]string{
		"template.json": `{"vars": {"MODULE_PATH": {"prompt": "Go module path"}}}`,
		"README.md":     "hi\n",
	})
	if err == nil || !strings.Contains(err.Error(), "--set MODULE_PATH=VALUE") {
		t.Fatalf("Run = %v, want it to name the variable and the --set to pass", err)
	}
	if exists(t, parent, "demo") {
		t.Errorf("%s was created before the variables were resolved", dir)
	}
}

// spec-00013-AC-5.4: a failing post_create step is reported by the step that failed, and
// the project is left without a creation marker.
func TestNewReportsWhichPostCreateStepFailedAndWritesNoMarker(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{"post_create": [{"cmd": "touch kept"}, {"cmd": "exit 3"}]}`,
		"README.md":     "hi\n",
	})
	if err == nil || !strings.Contains(err.Error(), `post_create "exit 3"`) {
		t.Fatalf("Run = %v, want it to name the step that failed", err)
	}
	if exists(t, dir, ".ainpt.json") {
		t.Error("a creation marker was written even though the scaffold failed")
	}
}

// spec-00013-AC-5.5: that failure does not roll back — what was copied stays put for the
// user to delete.
func TestNewLeavesWhatItAlreadyCopiedAfterAPostCreateFailure(t *testing.T) {
	dir, _, err := runNew(t, Options{}, map[string]string{
		"template.json": `{"post_create": [{"cmd": "touch kept"}, {"cmd": "exit 3"}]}`,
		"README.md":     "hi\n",
	})
	if err == nil {
		t.Fatal("Run = nil, want the post_create failure")
	}
	for _, rel := range []string{"README.md", "kept"} {
		if !exists(t, dir, rel) {
			t.Errorf("%s is gone; the command must not roll back", rel)
		}
	}
}

// spec-00013-AC-5.6: a branch that fetches but whose commit cannot be resolved is not a
// failure — the project is created, with a warning and an empty merge base.
func TestNewWarnsAndLeavesTheBaseEmptyWhenTheCommitCannotBeResolved(t *testing.T) {
	parent := t.TempDir()
	stubGitHub(t, nil, map[string]map[string]string{"main": {"README.md": "hi\n"}})

	out, err := capture(t, func() error {
		return Run(Options{Name: "demo", Dir: parent, Owner: stubOwner, Repo: stubRepo})
	})
	if err != nil {
		t.Fatalf("Run = %v, want the project created anyway", err)
	}
	if !strings.Contains(out, "warning: could not record template commit") {
		t.Errorf("no warning about the commit:\n%s", out)
	}
	if got := readLock(t, filepath.Join(parent, "demo")).Commit; got != "" {
		t.Errorf("marker commit = %q, want it empty", got)
	}
}

// spec-00013-AC-9.2: an overlapping edit leaves conflict markers, and the command lists
// the file with what to do about it.
func TestUpdateLeavesConflictMarkersAndListsTheFile(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "a\nmine\nc\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nupstream\nc\n"})

	out, err := capture(t, func() error { return Update(dir) })
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dir, "README.md"); !strings.Contains(got, "<<<<<<<") {
		t.Errorf("README.md carries no conflict markers:\n%s", got)
	}
	if !strings.Contains(out, "README.md") || !strings.Contains(out, "Resolve each, then commit") {
		t.Errorf("output did not list the conflict and what to do:\n%s", out)
	}
}

// spec-00013-AC-9.3: a conflict is not a failure — the markers are in the working tree
// and the command exits 0.
func TestUpdateSucceedsEvenWhenItLeavesAConflict(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "a\nmine\nc\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nupstream\nc\n"})

	if _, err := capture(t, func() error { return Update(dir) }); err != nil {
		t.Fatalf("Update = %v, want nil — a conflict left in the tree is not a failure", err)
	}
}

// spec-00013-AC-9.4: the merge base advances even when the merge left a conflict, so the
// next update continues from this upstream commit.
func TestUpdateAdvancesTheBaseAfterAConflict(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "a\nmine\nc\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nupstream\nc\n"})

	if _, err := capture(t, func() error { return Update(dir) }); err != nil {
		t.Fatal(err)
	}
	if got := readLock(t, dir).Commit; got != headSHA {
		t.Errorf("marker commit = %q, want it advanced to %q", got, headSHA)
	}
}

// spec-00013-AC-9.5: and it advances after a clean merge.
func TestUpdateAdvancesTheBaseAfterACleanMerge(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "mine\nb\nc\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nb\nupstream\n"})

	out, err := capture(t, func() error { return Update(dir) })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "No conflicts") {
		t.Fatalf("the merge was not clean:\n%s", out)
	}
	if got := readLock(t, dir).Commit; got != headSHA {
		t.Errorf("marker commit = %q, want it advanced to %q", got, headSHA)
	}
}

// spec-00013-AC-9.6: a file the template never had is the project's own and is not touched.
func TestUpdateLeavesTheProjectsOwnFilesAlone(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{
		".ainpt.json": marker(baseSHA), "README.md": "a\nb\nc\n", "NOTES.md": "mine only\n",
	})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nb\nupstream\n"})

	if _, err := capture(t, func() error { return Update(dir) }); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dir, "NOTES.md"); got != "mine only\n" {
		t.Errorf("NOTES.md = %q, want it untouched", got)
	}
}

// spec-00013-AC-9.8: an upstream file that is new since the base but already exists in
// the project is merged against an empty ancestor rather than overwritten.
func TestUpdateMergesAnUpstreamAdditionThatTheProjectAlreadyHas(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "SECURITY.md": "mine\n"})
	stubUpdateRepo(t, map[string]string{}, map[string]string{"SECURITY.md": "upstream\n"})

	out, err := capture(t, func() error { return Update(dir) })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Merged 1 file(s), added 0 new file(s)") {
		t.Errorf("output counted it as an addition rather than a merge:\n%s", out)
	}
	got := readFile(t, dir, "SECURITY.md")
	if !strings.Contains(got, "mine") || !strings.Contains(got, "<<<<<<<") {
		t.Errorf("SECURITY.md = %q, want the project's line kept and the overlap marked", got)
	}
}

// spec-00013-AC-9.9: when the branch is still at the base commit nothing is fetched or
// changed.
func TestUpdateReportsAProjectAlreadyUpToDate(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "mine\n"})
	stubGitHub(t, map[string]string{"main": baseSHA}, nil)

	out, err := capture(t, func() error { return Update(dir) })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Already up to date") {
		t.Errorf("output = %q, want it to say the project is already up to date", out)
	}
	if got := readFile(t, dir, "README.md"); got != "mine\n" {
		t.Errorf("README.md = %q, want it untouched", got)
	}
}

// spec-00013-AC-9.10: --dir names the project to merge, from anywhere.
func TestUpdateMergesTheDirectoryItWasPointedAt(t *testing.T) {
	elsewhere := t.TempDir()
	t.Chdir(elsewhere)
	writeTree(t, elsewhere, map[string]string{"README.md": "not the project\n"})
	proj := filepath.Join(t.TempDir(), "proj")
	writeTree(t, proj, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "a\nb\nc\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nb\nupstream\n"})

	if _, err := capture(t, func() error { return Update(proj) }); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, proj, "README.md"); !strings.Contains(got, "upstream") {
		t.Errorf("the named project was not merged: %q", got)
	}
	if got := readFile(t, elsewhere, "README.md"); got != "not the project\n" {
		t.Errorf("the working directory was merged instead: %q", got)
	}
}

// spec-00013-AC-10.2: the exclusion set comes from this upstream branch's manifest, so a
// pattern the template added after creation takes effect immediately.
func TestUpdateHonoursAnExcludePatternTheTemplateAddedAfterCreation(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{
		".ainpt.json": marker(baseSHA), "README.md": "a\nb\nc\n", "docs/vendor/x.md": "mine\n",
	})
	stubUpdateRepo(t,
		map[string]string{"template.json": `{}`, "README.md": "a\nb\nc\n", "docs/vendor/x.md": "base\n"},
		map[string]string{"template.json": `{"exclude": ["docs/vendor/"]}`,
			"README.md": "a\nb\nupstream\n", "docs/vendor/x.md": "upstream\n"})

	out, err := capture(t, func() error { return Update(dir) })
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dir, "docs/vendor/x.md"); got != "mine\n" {
		t.Errorf("docs/vendor/x.md = %q, want it left out of the merge", got)
	}
	if !strings.Contains(out, "Merged 1 file(s)") {
		t.Errorf("output = %q, want only README.md merged", out)
	}
}

// spec-00013-AC-11.1: a directory with no creation marker is refused, untouched.
func TestUpdateRefusesADirectoryWithNoCreationMarker(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{"README.md": "mine\n"})

	err := Update(dir)
	if err == nil || !strings.Contains(err.Error(), "no .ainpt.json") {
		t.Fatalf("Update = %v, want it to say the directory has no creation marker", err)
	}
	if got := readFile(t, dir, "README.md"); got != "mine\n" {
		t.Errorf("README.md = %q, want it untouched", got)
	}
}

// spec-00013-AC-11.2: a marker that is not valid JSON is refused, untouched.
func TestUpdateRefusesACreationMarkerThatIsNotValidJSON(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": "{oops", "README.md": "mine\n"})

	err := Update(dir)
	if err == nil || !strings.Contains(err.Error(), "parse .ainpt.json") {
		t.Fatalf("Update = %v, want it to say the marker could not be parsed", err)
	}
	if got := readFile(t, dir, "README.md"); got != "mine\n" {
		t.Errorf("README.md = %q, want it untouched", got)
	}
}

// spec-00013-AC-11.3: a marker with an empty merge base — what AC-5.6 produces — has no
// common ancestor to merge against.
func TestUpdateRefusesACreationMarkerWithAnEmptyBase(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(""), "README.md": "mine\n"})

	err := Update(dir)
	if err == nil || !strings.Contains(err.Error(), "no base commit") {
		t.Fatalf("Update = %v, want it to say there is no base commit", err)
	}
	if got := readFile(t, dir, "README.md"); got != "mine\n" {
		t.Errorf("README.md = %q, want it untouched", got)
	}
}

// spec-00013-AC-12.1: git does the 3-way merge, so without git on PATH the command fails
// on the first file that needs merging — AAA.md here, which the walk reaches first.
func TestUpdateFailsOnTheFirstMergeWhenGitIsMissing(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{
		".ainpt.json": marker(baseSHA), "AAA.md": "a\nb\nc\n", "ZZZ.md": "a\nb\nc\n",
	})
	stubUpdateRepo(t,
		map[string]string{"AAA.md": "a\nb\nc\n", "ZZZ.md": "a\nb\nc\n"},
		map[string]string{"AAA.md": "a\nb\nup\n", "ZZZ.md": "a\nb\nup\n"})
	t.Setenv("PATH", "")

	_, err := capture(t, func() error { return Update(dir) })
	if err == nil || !strings.Contains(err.Error(), "merge AAA.md") {
		t.Fatalf("Update = %v, want the first file that needed merging reported as failed", err)
	}
	if got := readFile(t, dir, "ZZZ.md"); got != "a\nb\nc\n" {
		t.Errorf("ZZZ.md = %q; the walk went on past the failure", got)
	}
}

// spec-00013-AC-12.2: and the base does not advance, so a rerun starts from the same place.
func TestUpdateLeavesTheBaseWhereItWasWhenGitIsMissing(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "a\nb\nc\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nb\nupstream\n"})
	t.Setenv("PATH", "")

	if _, err := capture(t, func() error { return Update(dir) }); err == nil {
		t.Fatal("Update = nil, want the missing-git failure")
	}
	if got := readLock(t, dir).Commit; got != baseSHA {
		t.Errorf("marker commit = %q, want it still %q", got, baseSHA)
	}
}

// spec-00012-AC-7.3: update needs git, not Node — the merge is done by git alone, so a
// machine with no node on PATH updates normally.
func TestUpdateMergesOnAMachineWithoutNode(t *testing.T) {
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skipf("git is required for the 3-way merge: %v", err)
	}
	bin := t.TempDir()
	if err := os.Symlink(git, filepath.Join(bin, "git")); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{".ainpt.json": marker(baseSHA), "README.md": "mine\nb\nc\n"})
	stubUpdateRepo(t, map[string]string{"README.md": "a\nb\nc\n"},
		map[string]string{"README.md": "a\nb\nupstream\n"})
	t.Setenv("PATH", bin)
	if _, err := exec.LookPath("node"); err == nil {
		t.Fatal("node is still on PATH; the point of this case is that it is not")
	}

	out, err := capture(t, func() error { return Update(dir) })
	if err != nil {
		t.Fatalf("Update = %v, want it to merge without Node", err)
	}
	if !strings.Contains(out, "Merged 1 file(s)") {
		t.Errorf("output did not report the merge:\n%s", out)
	}
	if got := readFile(t, dir, "README.md"); !strings.Contains(got, "mine") || !strings.Contains(got, "upstream") {
		t.Errorf("README.md = %q, want both sides folded in", got)
	}
}
