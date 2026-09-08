// Command persimmon scaffolds a new project from the ai-native-project-template.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/ryan-alexander-zhang/persimmon/cli/internal/scaffold"
)

// githubAPI is the base URL of the template repository's host API; tests point it
// at an httptest stub instead.
const githubAPI = "https://api.github.com"

// newUsage is the one-line usage of the "new" subcommand, shown when its arguments
// do not name exactly one project.
const newUsage = "usage: persimmon new <name> [--lang go] [--variant ddd] [--dir .] [--set K=V]"

// Injected at build time via -ldflags (see .goreleaser.yaml).
var (
	version = "dev"
	owner   = "ryan-alexander-zhang"
	repo    = "ai-native-project-template"
)

func init() {
	if v := os.Getenv("AINPT_OWNER"); v != "" {
		owner = v
	}
	if v := os.Getenv("AINPT_REPO"); v != "" {
		repo = v
	}
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "new":
		if err := cmdNew(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "update":
		cmdUpdate(os.Args[2:])
	case "list-langs":
		if err := cmdLangs(os.Stdout, githubAPI); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "version", "-v", "--version":
		fmt.Println("persimmon", version)
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", os.Args[1])
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Print(`persimmon — scaffold a project from the ai-native-project-template

Usage:
  persimmon new <name> [--lang go] [--variant ddd] [--dir .] [--ref <branch>] [--set KEY=VALUE]
  persimmon update [--dir .]
  persimmon list-langs
  persimmon version

Flags for "new":
  --lang     language branch to use (lang/<lang>); empty uses the base template (main)
  --variant  variant under a language (lang/<lang>/<variant>); requires --lang
  --dir      parent directory for the new project (default ".")
  --ref      branch override (default: main, lang/<lang>, or lang/<lang>/<variant>)
  --set      set a template variable, repeatable (e.g. --set MODULE_PATH=example.com/x)

"update" 3-way merges later template changes into an existing project (using the
.ainpt.json written at creation). Resolve any conflict markers, then commit.

Environment:
  AINPT_OWNER, AINPT_REPO   override the template source repository
`)
}

type setFlag map[string]string

func (s setFlag) String() string { return "" }
func (s setFlag) Set(v string) error {
	i := strings.Index(v, "=")
	if i < 0 {
		return fmt.Errorf("expected KEY=VALUE, got %q", v)
	}
	s[v[:i]] = v[i+1:]
	return nil
}

func cmdNew(args []string) error {
	fs := flag.NewFlagSet("new", flag.ExitOnError)
	lang := fs.String("lang", "", "language branch (lang/<lang>); empty = base template")
	variant := fs.String("variant", "", "variant under a language (lang/<lang>/<variant>)")
	dir := fs.String("dir", ".", "parent directory for the new project")
	ref := fs.String("ref", "", "branch override (default: main or lang/<lang>)")
	sets := setFlag{}
	fs.Var(sets, "set", "set a template variable KEY=VALUE (repeatable)")

	// The stdlib flag package stops at the first positional, so parse in two
	// passes to accept flags both before and after <name>.
	_ = fs.Parse(args)
	rest := fs.Args()
	if len(rest) < 1 {
		return errors.New(newUsage)
	}
	name := rest[0]
	_ = fs.Parse(rest[1:])
	if extra := fs.Args(); len(extra) > 0 {
		return fmt.Errorf("error: new takes a single <name>, got %q as well\n%s", extra[0], newUsage)
	}

	if *variant != "" && *lang == "" {
		return errors.New("error: --variant requires --lang (e.g. --lang java --variant ddd)")
	}

	// The "error: " prefix is the one the command has always printed on a scaffold
	// failure; cmdNew now returns it instead of printing it itself.
	if err := scaffold.Run(scaffold.Options{
		Name:    name,
		Lang:    *lang,
		Variant: *variant,
		Dir:     *dir,
		Ref:     *ref,
		Owner:   owner,
		Repo:    repo,
		Sets:    sets,
	}); err != nil {
		return fmt.Errorf("error: %w", err)
	}
	return nil
}

func cmdUpdate(args []string) {
	fs := flag.NewFlagSet("update", flag.ExitOnError)
	dir := fs.String("dir", ".", "project directory to update")
	_ = fs.Parse(args)
	if err := scaffold.Update(*dir); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// branch is one entry of the template repository's branch listing.
type branch struct {
	Name string `json:"name"`
}

// getBranchPage reads one page of branches and the URL of the next one, "" on the last.
func getBranchPage(url string) ([]branch, string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, "", fmt.Errorf("error: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("error: %s returned %s", url, resp.Status)
	}
	var page []branch
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return nil, "", fmt.Errorf("error: %w", err)
	}
	return page, nextLink(resp.Header.Get("Link")), nil
}

// nextLink returns the rel="next" URL of a Link header, or "" when there is none.
func nextLink(header string) string {
	for _, part := range strings.Split(header, ",") {
		if !strings.Contains(part, `rel="next"`) {
			continue
		}
		if i, j := strings.Index(part, "<"), strings.Index(part, ">"); i >= 0 && j > i {
			return part[i+1 : j]
		}
	}
	return ""
}

func cmdLangs(out io.Writer, api string) error {
	var branches []branch
	// The branches endpoint is paginated: per_page is a page size, not "all of them",
	// so follow the Link header's rel="next" until GitHub stops offering one.
	url := fmt.Sprintf("%s/repos/%s/%s/branches?per_page=100", api, owner, repo)
	for url != "" {
		page, next, err := getBranchPage(url)
		if err != nil {
			return err
		}
		branches = append(branches, page...)
		url = next
	}
	// Group lang/<lang> and lang/<lang>/<variant> branches under each language.
	type langInfo struct {
		hasBase  bool
		variants []string
	}
	langs := map[string]*langInfo{}
	var order []string
	for _, b := range branches {
		if !strings.HasPrefix(b.Name, "lang/") {
			continue
		}
		parts := strings.SplitN(strings.TrimPrefix(b.Name, "lang/"), "/", 2)
		l := parts[0]
		if _, ok := langs[l]; !ok {
			langs[l] = &langInfo{}
			order = append(order, l)
		}
		if len(parts) == 1 {
			langs[l].hasBase = true
		} else {
			langs[l].variants = append(langs[l].variants, parts[1])
		}
	}
	sort.Strings(order)

	fmt.Fprintln(out, "Available templates:")
	fmt.Fprintln(out, "  (default)              base template (main)")
	if len(order) == 0 {
		fmt.Fprintln(out, "  (no lang/* branches yet — only the base template is available)")
		return nil
	}
	for _, l := range order {
		info := langs[l]
		if info.hasBase {
			fmt.Fprintf(out, "  --lang %-15s lang/%s\n", l, l)
		} else {
			fmt.Fprintf(out, "  %-22s no lang/%s branch — use --variant only\n", l, l)
		}
		sort.Strings(info.variants)
		for _, v := range info.variants {
			fmt.Fprintf(out, "    --variant %-10s lang/%s/%s\n", v, l, v)
		}
	}
	return nil
}
