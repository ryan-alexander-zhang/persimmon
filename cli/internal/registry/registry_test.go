package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ryan-alexander-zhang/persimmon/cli/internal/project"
)

// home is a temporary stand-in for the user's home, pointed at by HOME the way
// the TS suite points the registry path at a temporary directory
// (design-00003 §2 末段). EvalSymlinks because macOS puts the temporary
// directory behind a symlink.
func home(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", dir)
	return dir
}

// projectDir is a project directory: a name and a flow config inside it, which
// is all Add looks at.
func projectDir(t *testing.T, parent, name string, config ...string) string {
	t.Helper()
	body := "types: {}\n"
	if len(config) == 1 {
		body = config[0]
	}
	dir := filepath.Join(parent, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, project.ConfigFile), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// registryPath is the path Path derives under the temporary home.
func registryPath(t *testing.T) string {
	t.Helper()
	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	return path
}

// store is the registry under the temporary home, with the file already written
// when the test wants one.
func store(t *testing.T, body any) *Registry {
	t.Helper()
	path := registryPath(t)
	if body != nil {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		text, ok := body.(string)
		if !ok {
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			text = string(encoded)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return New(path)
}

func read(t *testing.T, r *Registry) []Entry {
	t.Helper()
	entries, err := r.Read()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return entries
}

func ids(entries []Entry) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.ID)
	}
	return out
}

func mustFail(t *testing.T, err error, wants ...string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected a refusal, got none")
	}
	for _, want := range wants {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("refusal %q does not name %q", err, want)
		}
	}
}

func TestReadingTheRegistry(t *testing.T) {
	// design-00003 §2「文件不存在 = 空注册表」at the data level
	t.Run("reads an absent file as an empty registry", func(t *testing.T) {
		home(t)

		if entries := read(t, store(t, nil)); len(entries) != 0 {
			t.Fatalf("expected an empty registry, got %v", entries)
		}
	})

	// design-00003 §2: the order in the file is the switcher order
	t.Run("returns the entries in file order, and an empty list for an empty registry", func(t *testing.T) {
		home(t)
		want := []Entry{
			{ID: "alpha", Name: "alpha", Path: "/work/alpha"},
			{ID: "demo", Name: "demo", Path: "/work/demo"},
		}

		got := read(t, store(t, registryFile{Version: 1, Workspaces: want}))

		if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
			t.Fatalf("got %v, want %v", got, want)
		}
		home(t)
		if entries := read(t, store(t, registryFile{Version: 1, Workspaces: nil})); len(entries) != 0 {
			t.Fatalf("expected an empty registry, got %v", entries)
		}
	})

	// design-00003 §2「每次读都重读文件」: a hand edit needs no restart
	t.Run("sees a hand edit on the next read", func(t *testing.T) {
		home(t)
		r := store(t, registryFile{Version: 1, Workspaces: []Entry{{ID: "alpha", Name: "alpha", Path: "/work/alpha"}}})

		edited, err := json.Marshal(registryFile{Version: 1, Workspaces: []Entry{
			{ID: "alpha", Name: "alpha", Path: "/work/alpha"},
			{ID: "demo", Name: "Demo", Path: "/work/demo"},
		}})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(registryPath(t), edited, 0o644); err != nil {
			t.Fatal(err)
		}

		if got := ids(read(t, r)); strings.Join(got, ",") != "alpha,demo" {
			t.Fatalf("got %v", got)
		}
	})

	// spec-00011-AC-18.1 and spec-00011-AC-18.2, and every other reading of
	// 「整份不合式」(spec-00011-FR-18): the refusal names the file path and the
	// problem, and the caller — the command's start or a subcommand — refuses
	// with it.
	t.Run("refuses an ill-formed file, naming the path and the problem", func(t *testing.T) {
		for _, testCase := range []struct {
			body    any
			problem string
		}{
			{"not json at all", "not readable JSON"},
			{[]Entry{}, "must hold a mapping"},
			{"null", "must hold a mapping"},
			{registryFile{Version: 2}, "`version`"},
			{map[string]any{"version": 1, "workspaces": map[string]any{}}, "`workspaces`"},
			{map[string]any{"version": 1, "workspaces": []any{"demo"}}, "workspaces[0]"},
			{map[string]any{"version": 1, "workspaces": []any{map[string]any{"name": "demo", "path": "/work/demo"}}}, ".id`"},
			{map[string]any{"version": 1, "workspaces": []any{map[string]any{"id": "demo", "path": "/work/demo"}}}, ".name`"},
			{map[string]any{"version": 1, "workspaces": []any{map[string]any{"id": "demo", "name": "demo"}}}, ".path`"},
			{registryFile{Version: 1, Workspaces: []Entry{{ID: "Demo", Name: "demo", Path: "/work/demo"}}}, "[a-z0-9-]"},
			{registryFile{Version: 1, Workspaces: []Entry{{ID: "demo", Name: "demo", Path: "work/demo"}}}, "absolute"},
			{registryFile{Version: 1, Workspaces: []Entry{
				{ID: "demo", Name: "demo", Path: "/work/demo"},
				{ID: "demo", Name: "other", Path: "/work/other"},
			}}, "twice"},
		} {
			t.Run(testCase.problem, func(t *testing.T) {
				home(t)
				r := store(t, testCase.body)

				_, err := r.Read()

				mustFail(t, err, testCase.problem, registryPath(t))
			})
		}
	})

	// spec-00011-AC-18.1 末句: the file is the user's, so a refusal never rewrites it
	t.Run("leaves an ill-formed file as it stands", func(t *testing.T) {
		at := home(t)
		r := store(t, "not json at all")

		_, err := r.Add(projectDir(t, at, "demo"), "")

		mustFail(t, err, "not readable JSON")
		body, err := os.ReadFile(registryPath(t))
		if err != nil || string(body) != "not json at all" {
			t.Fatalf("file is %q (%v)", body, err)
		}
	})

	// spec-00011-AC-18.3: `~/.persimmon` is a file, so the directory itself cannot be read
	t.Run("refuses when the registry directory is a file, naming the path", func(t *testing.T) {
		at := home(t)
		if err := os.WriteFile(filepath.Join(at, ".persimmon"), []byte("not a directory"), 0o644); err != nil {
			t.Fatal(err)
		}
		r := New(registryPath(t))

		_, err := r.Read()
		mustFail(t, err, registryPath(t))

		_, err = r.Add(projectDir(t, at, "demo"), "")
		mustFail(t, err, registryPath(t))
	})
}

func TestAddingAWorkspace(t *testing.T) {
	// spec-00011-AC-2.1: the derived id, the name defaulting to it, and the file shape of design-00003 §2
	t.Run("appends one entry with the id derived from the directory name", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		dir := projectDir(t, at, "demo")

		entry, err := r.Add(dir, "")

		if err != nil || entry != (Entry{ID: "demo", Name: "demo", Path: dir}) {
			t.Fatalf("got %+v (%v)", entry, err)
		}
		body, err := os.ReadFile(registryPath(t))
		if err != nil {
			t.Fatal(err)
		}
		var got registryFile
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatal(err)
		}
		if got.Version != 1 || len(got.Workspaces) != 1 || got.Workspaces[0] != entry {
			t.Fatalf("file holds %+v", got)
		}
	})

	// spec-00011-AC-2.2: two `demo` directories, and the name follows the id so the two are tellable apart
	t.Run("numbers a colliding id and keeps both entries", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		if _, err := r.Add(projectDir(t, at, "demo"), ""); err != nil {
			t.Fatal(err)
		}
		second := projectDir(t, filepath.Join(at, "elsewhere"), "demo")

		entry, err := r.Add(second, "")

		if err != nil || entry != (Entry{ID: "demo-2", Name: "demo-2", Path: second}) {
			t.Fatalf("got %+v (%v)", entry, err)
		}
		if got := ids(read(t, r)); strings.Join(got, ",") != "demo,demo-2" {
			t.Fatalf("got %v", got)
		}
	})

	// spec-00011-AC-2.3: the idempotence `persimmon new`'s registration step rests on (design-00003 §8)
	t.Run("returns the existing entry for an already registered path", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		dir := projectDir(t, at, "demo")
		first, err := r.Add(dir, "")
		if err != nil {
			t.Fatal(err)
		}

		again, err := r.Add(dir, "a different name")

		if err != nil || again != first {
			t.Fatalf("got %+v (%v), want %+v", again, err, first)
		}
		if entries := read(t, r); len(entries) != 1 || entries[0] != first {
			t.Fatalf("registry holds %v", entries)
		}
	})

	// spec-00011-AC-2.5: `/tmp` behind a symlink is the same directory, so it is the same entry
	t.Run("collapses a symlinked spelling of a registered path", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		dir := projectDir(t, at, "demo")
		link := filepath.Join(at, "link")
		if err := os.Symlink(at, link); err != nil {
			t.Fatal(err)
		}
		first, err := r.Add(dir, "")
		if err != nil {
			t.Fatal(err)
		}

		again, err := r.Add(filepath.Join(link, "demo"), "")

		if err != nil || again != first {
			t.Fatalf("got %+v (%v), want %+v", again, err, first)
		}
		if entries := read(t, r); len(entries) != 1 || entries[0] != first {
			t.Fatalf("registry holds %v", entries)
		}
	})

	// spec-00011-AC-2.6: a directory name with no ASCII alphanumerics still gets a URL-safe id
	t.Run("falls back to `workspace` when the directory name derives an empty id", func(t *testing.T) {
		at := home(t)

		entry, err := store(t, nil).Add(projectDir(t, at, "演示"), "演示")

		if err != nil || entry != (Entry{ID: "workspace", Name: "演示", Path: filepath.Join(at, "演示")}) {
			t.Fatalf("got %+v (%v)", entry, err)
		}
	})

	// design-00004 §4 的 422 口径 (spec-00011-FR-3): the path does not exist
	t.Run("refuses a path that does not exist, leaving the registry alone", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		if _, err := r.Add(projectDir(t, at, "demo"), ""); err != nil {
			t.Fatal(err)
		}

		_, err := r.Add(filepath.Join(at, "nope"), "")

		mustFail(t, err, "does not exist")
		if got := ids(read(t, r)); strings.Join(got, ",") != "demo" {
			t.Fatalf("got %v", got)
		}
	})

	t.Run("refuses a path that is not a directory", func(t *testing.T) {
		at := home(t)
		file := filepath.Join(at, "plain.txt")
		if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}

		_, err := store(t, nil).Add(file, "")

		mustFail(t, err, "not a directory")
	})

	// spec-00011-AC-3.2: no flow config in the directory
	t.Run("refuses a directory without a flow config, naming the file it looked for", func(t *testing.T) {
		at := home(t)
		dir := filepath.Join(at, "plain")
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}

		_, err := store(t, nil).Add(dir, "")

		mustFail(t, err, project.ConfigFile)
	})

	// spec-00011-AC-3.3: an illegal flow config is availability, not a refusal to register
	t.Run("registers a directory whose flow config is invalid", func(t *testing.T) {
		at := home(t)

		entry, err := store(t, nil).Add(projectDir(t, at, "demo", "max_sessions: -1\n"), "")

		if err != nil || entry.ID != "demo" {
			t.Fatalf("got %+v (%v)", entry, err)
		}
	})

	// spec-00011-AC-3.4: no ancestry check — a nested directory with its own git repo registers
	t.Run("registers a directory nested inside another workspace", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		alpha := projectDir(t, at, "alpha")
		sub := projectDir(t, filepath.Join(alpha, "vendor"), "sub")
		if err := os.Mkdir(filepath.Join(sub, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
		if _, err := r.Add(alpha, ""); err != nil {
			t.Fatal(err)
		}

		entry, err := r.Add(sub, "")

		if err != nil || entry != (Entry{ID: "sub", Name: "sub", Path: sub}) {
			t.Fatalf("got %+v (%v)", entry, err)
		}
		if got := ids(read(t, r)); strings.Join(got, ",") != "alpha,sub" {
			t.Fatalf("got %v", got)
		}
	})

	// design-00003 §2 的原子写: the file on disk is the old one or the new one and
	// never half of either. A directory in the staging file's place is a write
	// that cannot succeed, whoever runs the test.
	t.Run("leaves the previous file intact when the write fails", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		first, err := r.Add(projectDir(t, at, "demo"), "")
		if err != nil {
			t.Fatal(err)
		}
		before, err := os.ReadFile(registryPath(t))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(registryPath(t)+".tmp", 0o755); err != nil {
			t.Fatal(err)
		}

		_, err = r.Add(projectDir(t, at, "alpha"), "")

		mustFail(t, err, registryPath(t))
		after, err := os.ReadFile(registryPath(t))
		if err != nil || string(after) != string(before) {
			t.Fatalf("file is %q (%v)", after, err)
		}
		if entries := read(t, r); len(entries) != 1 || entries[0] != first {
			t.Fatalf("registry holds %v", entries)
		}
	})
}

func TestRemovingAWorkspace(t *testing.T) {
	// spec-00011-FR-4: only the entry goes; nothing inside the directory is touched
	t.Run("removes the entry named by id and leaves the directory alone", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		dir := projectDir(t, at, "demo")
		if _, err := r.Add(projectDir(t, at, "alpha"), ""); err != nil {
			t.Fatal(err)
		}
		demo, err := r.Add(dir, "")
		if err != nil {
			t.Fatal(err)
		}

		removed, err := r.Remove("demo")

		if err != nil || removed != demo {
			t.Fatalf("got %+v (%v)", removed, err)
		}
		if got := ids(read(t, r)); strings.Join(got, ",") != "alpha" {
			t.Fatalf("got %v", got)
		}
		body, err := os.ReadFile(filepath.Join(dir, project.ConfigFile))
		if err != nil || string(body) != "types: {}\n" {
			t.Fatalf("flow config is %q (%v)", body, err)
		}
	})

	// design-00003 §8: the path form is resolved to a real path first, then looked up as an id
	t.Run("removes the entry named by a symlinked path", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		demo, err := r.Add(projectDir(t, at, "demo"), "")
		if err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(at, "link")
		if err := os.Symlink(at, link); err != nil {
			t.Fatal(err)
		}

		removed, err := r.Remove(filepath.Join(link, "demo"))

		if err != nil || removed != demo {
			t.Fatalf("got %+v (%v)", removed, err)
		}
		if entries := read(t, r); len(entries) != 0 {
			t.Fatalf("registry holds %v", entries)
		}
	})

	// spec-00011-FR-4: a deleted directory cannot be resolved, and is removable all the same
	t.Run("removes the entry named by the path of a directory that is gone", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		dir := projectDir(t, at, "demo")
		if _, err := r.Add(dir, ""); err != nil {
			t.Fatal(err)
		}
		if err := os.RemoveAll(dir); err != nil {
			t.Fatal(err)
		}

		removed, err := r.Remove(dir)

		if err != nil || removed.ID != "demo" {
			t.Fatalf("got %+v (%v)", removed, err)
		}
		if entries := read(t, r); len(entries) != 0 {
			t.Fatalf("registry holds %v", entries)
		}
	})

	// spec-00011-FR-5 末句: an id nothing answers to is refused, and the registry is untouched
	t.Run("refuses an id or path that is not registered", func(t *testing.T) {
		at := home(t)
		r := store(t, nil)
		demo, err := r.Add(projectDir(t, at, "demo"), "")
		if err != nil {
			t.Fatal(err)
		}

		_, err = r.Remove("ghost")
		mustFail(t, err, "ghost", "not registered")

		_, err = r.Remove(filepath.Join(at, "ghost"))
		mustFail(t, err, "not registered")

		if entries := read(t, r); len(entries) != 1 || entries[0] != demo {
			t.Fatalf("registry holds %v", entries)
		}
	})
}

// design-00003 §2: the command derives the same path from the user's home
func TestPath(t *testing.T) {
	at := home(t)

	path, err := Path()

	if err != nil || path != filepath.Join(at, ".persimmon", "workspaces.json") {
		t.Fatalf("got %q (%v)", path, err)
	}
}
