package project

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindRoot(t *testing.T) {
	at := t.TempDir()
	root := filepath.Join(at, "alpha")
	nested := filepath.Join(root, "docs", "spec")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ConfigFile), []byte("types: {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(at, "elsewhere")
	if err := os.Mkdir(outside, 0o755); err != nil {
		t.Fatal(err)
	}

	for _, testCase := range []struct {
		name  string
		from  string
		want  string
		found bool
	}{
		// spec-00011-AC-2.4: `persimmon add` with no argument, run from `alpha/docs/spec`, registers `alpha`
		{"walks up from a subdirectory to the nearest project root", nested, root, true},
		{"takes the project root itself", root, root, true},
		// spec-00011-FR-13: starting outside any project is legal, not an error
		{"reports no project when nothing above holds a flow config", outside, "", false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, found := FindRoot(testCase.from)

			if got != testCase.want || found != testCase.found {
				t.Fatalf("got %q, %v; want %q, %v", got, found, testCase.want, testCase.found)
			}
		})
	}
}
