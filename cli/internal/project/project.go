// Package project locates the project a directory sits in.
package project

import (
	"os"
	"path/filepath"
)

// ConfigFile is the flow config whose presence makes a directory a project root
// (design-00003 §8); `src/config.ts` spells the same name on the TS side.
const ConfigFile = "whiteboard.config.yaml"

// FindRoot walks up from dir — which callers pass absolute — to the nearest
// directory holding a ConfigFile. The second result is false when dir is inside
// no project at all: that is a legal starting point, not an error
// (spec-00011-FR-13).
func FindRoot(dir string) (string, bool) {
	for {
		if _, err := os.Stat(filepath.Join(dir, ConfigFile)); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}
