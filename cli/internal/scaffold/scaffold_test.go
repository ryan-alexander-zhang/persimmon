package scaffold

import (
	"os"
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
