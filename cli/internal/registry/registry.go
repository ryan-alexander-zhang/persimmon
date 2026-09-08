// Package registry reads and writes the workspace registry file.
//
// The file contract is design-00003 §2 and it is the single source; this is its
// second implementation (design-00004 §4) — `src/workspaceRegistry.ts` is the
// first, and the two must agree down to what each refusal names.
package registry

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ryan-alexander-zhang/persimmon/cli/internal/project"
)

// Entry is one registered project directory (design-00003 §2).
type Entry struct {
	// ID is the key in URLs and the API; it matches `[a-z0-9-]+` and never
	// changes once assigned (spec-00011-FR-2).
	ID string `json:"id"`
	// Name is the display name in the switcher; it defaults to the ID, never to
	// the directory name.
	Name string `json:"name"`
	// Path is the project root, absolute and with symlinks resolved, so one
	// directory is one entry however it is spelled.
	Path string `json:"path"`
}

// Registry is the workspace registry file. The path is a field rather than an
// environment variable, so a test points it at a temporary directory.
type Registry struct {
	path string
}

// New returns the registry stored at path.
func New(path string) *Registry {
	return &Registry{path: path}
}

// Path is `~/.persimmon/workspaces.json`, the one place the registry lives
// (design-00003 §2); the directory name follows the command name.
func Path() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("workspace registry: no home directory — %w", err)
	}
	return filepath.Join(home, ".persimmon", "workspaces.json"), nil
}

type registryFile struct {
	Version    int     `json:"version"`
	Workspaces []Entry `json:"workspaces"`
}

var idPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

var nonID = regexp.MustCompile(`[^a-z0-9]+`)

// Read returns the registry as it stands, in file order. The file is re-read on
// every call, so a hand edit is visible on the next listing without a restart.
// No file at all is an empty registry and not a problem to report; anything else
// ill-formed is the whole file refused, naming the path and the problem, and the
// file is never rewritten (spec-00011-FR-18).
func (r *Registry) Read() ([]Entry, error) {
	text, err := os.ReadFile(r.path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("workspace registry: %s could not be read — %w", r.path, err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(text, &raw); err != nil {
		if !json.Valid(text) {
			return nil, fmt.Errorf("workspace registry: %s is not readable JSON — %w", r.path, err)
		}
		return nil, fmt.Errorf("workspace registry: %s must hold a mapping", r.path)
	}
	if raw == nil {
		return nil, fmt.Errorf("workspace registry: %s must hold a mapping", r.path)
	}
	var version int
	if err := json.Unmarshal(raw["version"], &version); err != nil || version != 1 {
		return nil, fmt.Errorf("workspace registry: %s: `version` must be 1, got %s", r.path, value(raw["version"]))
	}
	var list []json.RawMessage
	if err := json.Unmarshal(raw["workspaces"], &list); err != nil {
		return nil, fmt.Errorf("workspace registry: %s: `workspaces` must be a list", r.path)
	}
	entries := make([]Entry, 0, len(list))
	seen := make(map[string]bool, len(list))
	for index, item := range list {
		entry, err := r.readEntry(item, fmt.Sprintf("workspaces[%d]", index))
		if err != nil {
			return nil, err
		}
		if seen[entry.ID] {
			return nil, fmt.Errorf("workspace registry: %s: `id` %q is registered twice", r.path, entry.ID)
		}
		seen[entry.ID] = true
		entries = append(entries, entry)
	}
	return entries, nil
}

// readEntry reads one entry as the file spells it; every refusal names the file
// and the entry's position in it.
func (r *Registry) readEntry(raw json.RawMessage, at string) (Entry, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return Entry{}, fmt.Errorf("workspace registry: %s: `%s` must be a mapping", r.path, at)
	}
	var entry Entry
	for _, field := range []struct {
		key  string
		into *string
	}{{"id", &entry.ID}, {"name", &entry.Name}, {"path", &entry.Path}} {
		if err := json.Unmarshal(fields[field.key], field.into); err != nil {
			return Entry{}, fmt.Errorf("workspace registry: %s: `%s.%s` must be a string", r.path, at, field.key)
		}
	}
	if !idPattern.MatchString(entry.ID) {
		return Entry{}, fmt.Errorf("workspace registry: %s: `%s.id` must match [a-z0-9-]+, got %q", r.path, at, entry.ID)
	}
	if !filepath.IsAbs(entry.Path) {
		return Entry{}, fmt.Errorf("workspace registry: %s: `%s.path` must be an absolute path, got %q", r.path, at, entry.Path)
	}
	return entry, nil
}

// Add registers a directory (spec-00011-FR-2), appended at the end — the file
// order is the switcher order. An empty name defaults to the derived id.
// Idempotent by resolved path: adding a registered directory returns its entry
// unchanged, which is what `persimmon new`'s registration step rests on.
// Neither the flow config's content nor git is checked here: an invalid config
// and a non-git directory register fine and show up as unavailable instead
// (spec-00011-FR-3).
func (r *Registry) Add(directory, name string) (Entry, error) {
	entries, err := r.Read()
	if err != nil {
		return Entry{}, err
	}
	path, err := projectRoot(directory)
	if err != nil {
		return Entry{}, err
	}
	for _, entry := range entries {
		if entry.Path == path {
			return entry, nil
		}
	}
	id := freeID(path, entries)
	if name == "" {
		name = id
	}
	entry := Entry{ID: id, Name: name, Path: path}
	if err := r.write(append(entries, entry)); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

// Remove drops one entry (spec-00011-FR-4), by id or by path — the path form is
// resolved and then looked up like an id, so the rest is one code path
// (design-00003 §8); a directory that is gone cannot be resolved, and is
// removable all the same. Nothing inside the directory is touched. Whether a
// running session forbids the removal is the Host's check, not this one
// (spec-00011-FR-5).
func (r *Registry) Remove(idOrPath string) (Entry, error) {
	entries, err := r.Read()
	if err != nil {
		return Entry{}, err
	}
	path, err := filepath.EvalSymlinks(idOrPath)
	if err != nil {
		path, _ = filepath.Abs(idOrPath)
	}
	for index, entry := range entries {
		if entry.ID == idOrPath || entry.Path == path {
			if err := r.write(append(entries[:index:index], entries[index+1:]...)); err != nil {
				return Entry{}, err
			}
			return entry, nil
		}
	}
	return Entry{}, fmt.Errorf("workspace %q is not registered", idOrPath)
}

// write goes through a temporary name and a rename: the rename is atomic, so
// what is on disk at any moment is the old file or the new one and never half of
// either (design-00003 §2). A write that got as far as the temporary name and no
// further would leave it behind; clearing it is best-effort.
func (r *Registry) write(entries []Entry) error {
	if entries == nil {
		entries = []Entry{}
	}
	body, err := json.MarshalIndent(registryFile{Version: 1, Workspaces: entries}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return fmt.Errorf("workspace registry: %s could not be written — %w", r.path, err)
	}
	staging := r.path + ".tmp"
	err = os.WriteFile(staging, append(body, '\n'), 0o644)
	if err == nil {
		err = os.Rename(staging, r.path)
	}
	if err != nil {
		_ = os.Remove(staging)
		return fmt.Errorf("workspace registry: %s could not be written — %w", r.path, err)
	}
	return nil
}

// projectRoot is the path as it goes on disk (design-00003 §2), or the refusal
// saying which of the three registrability checks it failed — the same three
// `POST /api/workspaces` answers 422 for (design-00004 §4).
func projectRoot(directory string) (string, error) {
	path, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return "", fmt.Errorf("the workspace directory does not exist: %s", directory)
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return "", fmt.Errorf("the workspace path is not a directory: %s", directory)
	}
	if _, err := os.Stat(filepath.Join(path, project.ConfigFile)); err != nil {
		return "", fmt.Errorf("the directory holds no %s: %s", project.ConfigFile, path)
	}
	return path, nil
}

// deriveID is the id a directory name derives (design-00003 §2): lowercase,
// every other run of characters folded to one `-`.
func deriveID(directory string) string {
	id := strings.Trim(nonID.ReplaceAllString(strings.ToLower(filepath.Base(directory)), "-"), "-")
	if id == "" {
		return "workspace"
	}
	return id
}

// freeID is `demo`, then `demo-2`, `demo-3`… — a readable URL is worth this much
// de-duplication.
func freeID(directory string, entries []Entry) string {
	taken := make(map[string]bool, len(entries))
	for _, entry := range entries {
		taken[entry.ID] = true
	}
	base := deriveID(directory)
	id := base
	for n := 2; taken[id]; n++ {
		id = fmt.Sprintf("%s-%d", base, n)
	}
	return id
}

// value is a raw field as the file spells it, for the refusals that quote it;
// an absent field reads as `null`, the way JSON spells nothing.
func value(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "null"
	}
	return string(raw)
}
