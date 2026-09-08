// Command persimmon scaffolds a new project from the ai-native-project-template.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/ryan-alexander-zhang/persimmon/cli/internal/hostproc"
	"github.com/ryan-alexander-zhang/persimmon/cli/internal/project"
	"github.com/ryan-alexander-zhang/persimmon/cli/internal/registry"
	"github.com/ryan-alexander-zhang/persimmon/cli/internal/scaffold"
)

// githubAPI is the base URL of the template repository's host API; tests point it
// at an httptest stub instead.
const githubAPI = "https://api.github.com"

// newUsage is the one-line usage of the "new" subcommand, shown when its arguments
// do not name exactly one project.
const newUsage = "usage: persimmon new <name> [--lang go] [--variant ddd] [--dir .] [--set K=V]"

// defaultPort is the port every path of the command uses when `PORT` names
// none (design-00003 §8). This is the one place that default is resolved: the
// host is handed the port explicitly, so it never reads a default of its own
// (design-00004 §3 追注).
const defaultPort = 4173

// registryUsage is the one line `add`, `remove` and `list` print when their
// arguments are not what they take (design-00003 §8).
const registryUsage = "usage: persimmon [add [path] [--name <name>] | remove <id|path> | list]"

// unasserted is the availability of an entry the command found nothing wrong
// with and still cannot call available: `available` is the conclusion of the
// whole judgement, flow config validator included, and the command carries no
// second copy of that (design-00004 §4 追注).
const unasserted = "-"

// judgementNeedsNode is the one sentence a listing carries when the host
// package's judgement could not be had (spec-00011-FR-21): what is shown is
// only what the command settles on its own.
const judgementNeedsNode = "完整的可用性判定需要 Node（取不到 host 包）——可用性一列的 - 是未断言，不是可用"

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
	os.Exit(run(os.Args[1:]))
}

// command is what the subcommands that touch the registry read from the world,
// so a test hands them a registry file and a port of their own instead of the
// developer's (design-00003 §2).
type command struct {
	registry *registry.Registry
	// port is the one the whole command uses: probed, handed to the host, and
	// named in the "already in use" refusal.
	port int
	// dir is where a search for the enclosing project starts, normally the cwd.
	dir string
	// version is this build's own (spec-00012-FR-9) and hostDir the development
	// override; between them they decide whether the host package can be had at
	// all (design-00004 §3).
	version        string
	hostDir        string
	stdout, stderr io.Writer
}

// newCommand reads the world once: the registry file from the home directory
// (design-00003 §2), the port from the environment, and the development
// override from `PERSIMMON_HOST`.
func newCommand() (command, error) {
	path, err := registry.Path()
	if err != nil {
		return command{}, err
	}
	port, err := resolvePort(os.Getenv("PORT"))
	if err != nil {
		return command{}, err
	}
	dir, err := os.Getwd()
	if err != nil {
		return command{}, err
	}
	return command{
		registry: registry.New(path),
		port:     port,
		dir:      dir,
		version:  version,
		hostDir:  os.Getenv("PERSIMMON_HOST"),
		stdout:   os.Stdout,
		stderr:   os.Stderr,
	}, nil
}

// resolvePort is `PORT` or the default. A value that is no port at all is
// refused rather than folded into the default: silently serving somewhere else
// than the user asked is worse than one sentence.
func resolvePort(text string) (int, error) {
	if text == "" {
		return defaultPort, nil
	}
	port, err := strconv.Atoi(text)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("PORT must be a port number, got %q", text)
	}
	return port, nil
}

// run is main with the exit code returned rather than taken, which is what lets
// a test observe it.
func run(args []string) int {
	// The subcommands that need neither the registry nor the port come first:
	// none of them may fail over a home directory or a `PORT` they never read.
	if len(args) > 0 {
		switch args[0] {
		case "update":
			cmdUpdate(args[1:])
			return 0
		case "list-langs":
			return report(cmdLangs(os.Stdout, githubAPI))
		case "version", "-v", "--version":
			fmt.Println("persimmon", version)
			return 0
		case "help", "-h", "--help":
			usage()
			return 0
		}
	}
	c, err := newCommand()
	if err != nil {
		return fail(err)
	}
	switch {
	case len(args) == 0:
		return cmdStart(c)
	case args[0] == "new":
		return report(cmdNew(c, args[1:]))
	case args[0] == "add":
		return refused(cmdAdd(c, args[1:]))
	case args[0] == "remove":
		return refused(cmdRemove(c, args[1:]))
	case args[0] == "list":
		return refused(cmdList(c))
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", args[0])
		usage()
		return 1
	}
}

// cmdStart is `persimmon` with no subcommand (spec-00011-FR-13): the handshake
// and the host behind it are hostproc's, and its result is this command's exit
// code (spec-00012-FR-3).
func cmdStart(c command) int {
	return hostproc.Run(context.Background(), hostproc.Options{
		Version:  c.version,
		Port:     c.port,
		Dir:      c.dir,
		Registry: c.registry,
		HostDir:  c.hostDir,
		Stdin:    os.Stdin,
		Stdout:   c.stdout,
		Stderr:   c.stderr,
	})
}

// report prints what a subcommand refused, as the subcommand worded it — the
// scaffold half spells its own "error: " prefix (spec-00013-FR-4).
func report(err error) int {
	if err == nil {
		return 0
	}
	fmt.Fprintln(os.Stderr, err)
	return 1
}

// refused prints what one of the registry subcommands refused, in the shape
// they have always printed it (design-00003 §8).
func refused(err error) int {
	if err == nil {
		return 0
	}
	return fail(err)
}

// fail is one sentence on stderr and a non-zero exit, never a stack — the
// prefix the command has always printed for what it refuses itself.
func fail(err error) int {
	fmt.Fprintf(os.Stderr, "persimmon: %s\n", err)
	return 1
}

func usage() {
	fmt.Print(`persimmon — scaffold a project from the ai-native-project-template, and open its whiteboard

Usage:
  persimmon
  persimmon new <name> [--lang go] [--variant ddd] [--dir .] [--ref <branch>] [--set KEY=VALUE]
  persimmon update [--dir .]
  persimmon list-langs
  persimmon add [path] [--name <name>]
  persimmon remove <id|path>
  persimmon list
  persimmon version
  persimmon help

With no subcommand persimmon opens the board for the project the current
directory is in. "version" also answers to -v and --version, "help" to -h and
--help.

Flags for "new":
  --lang     language branch to use (lang/<lang>); empty uses the base template (main)
  --variant  variant under a language (lang/<lang>/<variant>); requires --lang
  --dir      parent directory for the new project (default ".")
  --ref      branch override (default: main, lang/<lang>, or lang/<lang>/<variant>)
  --set      set a template variable, repeatable (e.g. --set MODULE_PATH=example.com/x)

"update" 3-way merges later template changes into an existing project (using the
.ainpt.json written at creation). Resolve any conflict markers, then commit.

Environment:
  PORT                      the port the board is served on (default 4173)
  PERSIMMON_HOST            a built local checkout to open the board from, instead
                            of the published host package
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

func cmdNew(c command, args []string) error {
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

	// The project is the main product and the registration an attendant step: a
	// scaffold that failed registers nothing, and a registration that failed
	// rolls nothing back — `persimmon add` picks it up once the cause is gone
	// (spec-00013-FR-8, design-00004 §5). A port held by someone who is not a
	// persimmon writes the file all the same, which is where `new` parts from
	// `add` deliberately (spec-00013-FR-7).
	entry, err := register(c, hostproc.Probe(context.Background(), c.port).Kind, filepath.Join(*dir, name), "")
	if err != nil {
		return fmt.Errorf("error: %w", err)
	}
	fmt.Fprintf(c.stdout, "已登记为 workspace %s——在项目内执行 persimmon 打开\n", entry.ID)
	return nil
}

// register puts one directory in the registry through whoever holds the port
// (design-00003 §8): a running process registers it, so its writes stay
// serialised and its switcher shows the entry at once; anything else writes the
// file directly.
func register(c command, kind hostproc.Kind, path, name string) (registry.Entry, error) {
	if kind == hostproc.Running {
		return hostproc.Post(context.Background(), c.port, path, name)
	}
	return c.registry.Add(path, name)
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

// cmdAdd is `persimmon add [path] [--name <name>]` (spec-00011-FR-2):
// non-interactive, idempotent, and 0 on an entry that was already there. It
// writes, so a port held by somebody who is not a persimmon is a refusal rather
// than a blind write — a stranger there leaves it unknown whether another
// persimmon holds the same registry (spec-00011-FR-15).
func cmdAdd(c command, args []string) error {
	path, name, err := parseAdd(args)
	if err != nil {
		return err
	}
	target := path
	if target == "" {
		root, inProject := project.FindRoot(c.dir)
		if !inProject {
			return fmt.Errorf("no flow config at %s or any parent directory", filepath.Join(c.dir, project.ConfigFile))
		}
		target = root
	}
	kind := hostproc.Probe(context.Background(), c.port).Kind
	if kind == hostproc.Occupied {
		return occupied(c.port)
	}
	entry, err := register(c, kind, target, name)
	if err != nil {
		return err
	}
	printEntry(c.stdout, entry)
	return nil
}

// parseAdd reads `add`'s arguments: one optional path and an optional --name,
// in either order and nothing else (design-00003 §8). A second positional or an
// unknown flag is the usage, because guessing which one was meant is worse than
// asking.
func parseAdd(args []string) (path, name string, err error) {
	for at := 0; at < len(args); at++ {
		switch {
		case args[at] == "--name":
			at++
			if at == len(args) {
				return "", "", errors.New(registryUsage)
			}
			name = args[at]
		case path != "" || strings.HasPrefix(args[at], "-"):
			return "", "", errors.New(registryUsage)
		default:
			path = args[at]
		}
	}
	return path, name, nil
}

// cmdRemove is `persimmon remove <id|path>` (spec-00011-FR-4). Nothing inside
// the directory is touched; whether a running session forbids the removal is
// the running process's check, which on the no-process path holds empty — no
// process, no session (spec-00011-FR-5, design-00004 §4).
func cmdRemove(c command, args []string) error {
	if len(args) != 1 {
		return errors.New(registryUsage)
	}
	idOrPath := args[0]
	ctx := context.Background()
	switch hostproc.Probe(ctx, c.port).Kind {
	case hostproc.Occupied:
		return occupied(c.port)
	case hostproc.Running:
		rows, err := hostproc.Workspaces(ctx, c.port)
		if err != nil {
			return err
		}
		id, err := identify(idOrPath, rows)
		if err != nil {
			return err
		}
		entry, err := hostproc.Delete(ctx, c.port, id)
		if err != nil {
			return err
		}
		printEntry(c.stdout, entry)
		return nil
	default:
		entry, err := c.registry.Remove(idOrPath)
		if err != nil {
			return err
		}
		printEntry(c.stdout, entry)
		return nil
	}
}

// identify is the id one argument names among what the running process holds:
// the path form is resolved and then looked up like an id, so the removal
// itself stays one code path (design-00003 §8).
func identify(idOrPath string, rows []hostproc.Workspace) (string, error) {
	path, err := filepath.EvalSymlinks(idOrPath)
	if err != nil {
		path, _ = filepath.Abs(idOrPath)
	}
	for _, row := range rows {
		if row.ID == idOrPath || row.Path == path {
			return row.ID, nil
		}
	}
	return "", fmt.Errorf("workspace %q is not registered", idOrPath)
}

// cmdList is `persimmon list` (spec-00011-FR-21): every entry with its id,
// display name, path and availability, and a zero exit. It writes nothing and
// wants no port of its own, so a stranger holding the port is no reason to
// refuse — the file is read instead (spec-00011-AC-15.4). An ill-formed
// registry is refused all the same (spec-00011-FR-18).
func cmdList(c command) error {
	ctx := context.Background()
	if hostproc.Probe(ctx, c.port).Kind == hostproc.Running {
		// While a process is there it is the one that knows which workspaces are
		// live, so its judgement is the listing's (design-00003 §8).
		rows, err := hostproc.Workspaces(ctx, c.port)
		if err != nil {
			return err
		}
		printRows(c.stdout, rows)
		return nil
	}
	entries, err := c.registry.Read()
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		return nil
	}
	// Anything the host package could not be asked — no published version to
	// pair with, no Node, a query mode that answered nothing readable — is the
	// same retreat: what the command settles on its own, and one sentence saying
	// the rest needs Node (spec-00011-FR-21, design-00004 §4 追注).
	if judged, err := hostproc.Judge(ctx, hostproc.Options{Version: c.version, HostDir: c.hostDir, Stderr: c.stderr}); err == nil {
		printRows(c.stdout, judged)
		return nil
	}
	rows := make([]hostproc.Workspace, 0, len(entries))
	for _, entry := range entries {
		rows = append(rows, hostproc.Workspace{Entry: entry, Availability: judgeLocally(entry)})
	}
	printRows(c.stdout, rows)
	fmt.Fprintf(c.stderr, "persimmon: %s\n", judgementNeedsNode)
	return nil
}

// judgeLocally is the three unavailabilities one local check each settles, in
// the order design-00003 §3 draws them: a directory that is gone, one that is
// no git repository of its own, one holding no flow config. Nothing else is
// asserted.
func judgeLocally(entry registry.Entry) string {
	if info, err := os.Stat(entry.Path); err != nil || !info.IsDir() {
		return "missing"
	}
	if !isRepoRoot(entry.Path) {
		return "noGit"
	}
	if _, err := os.Stat(filepath.Join(entry.Path, project.ConfigFile)); err != nil {
		return "noConfig"
	}
	return unasserted
}

// isRepoRoot is git's top level for the directory against the directory itself:
// a subdirectory of another repository is no workspace (design-00003 §3). A
// missing `.git` is a certain no and costs no child process. Both sides are
// resolved, because git answers with the path it was reached by.
func isRepoRoot(path string) bool {
	if _, err := os.Stat(filepath.Join(path, ".git")); err != nil {
		return false
	}
	printed, err := exec.Command("git", "-C", path, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return false
	}
	top, err := filepath.EvalSymlinks(strings.TrimSpace(string(printed)))
	if err != nil {
		return false
	}
	here, err := filepath.EvalSymlinks(path)
	return err == nil && top == here
}

// printRows is the table of design-00003 §8: id, name, path and availability,
// each of the first three padded to the widest of its column.
func printRows(out io.Writer, rows []hostproc.Workspace) {
	var widths [3]int
	for _, row := range rows {
		for at, cell := range [3]string{row.ID, row.Name, row.Path} {
			widths[at] = max(widths[at], len(cell))
		}
	}
	for _, row := range rows {
		fmt.Fprintf(out, "%-*s  %-*s  %-*s  %s\n", widths[0], row.ID, widths[1], row.Name, widths[2], row.Path, row.Availability)
	}
}

// printEntry is one entry as `add` and `remove` have always printed it: a line
// of compact JSON, so a script reads what a person reads (design-00003 §8).
// Three strings never fail to marshal.
func printEntry(out io.Writer, entry registry.Entry) {
	text, _ := json.Marshal(entry)
	fmt.Fprintln(out, string(text))
}

// occupied is what a port held by somebody who is not a persimmon gets from the
// two subcommands that write (spec-00011-FR-15).
func occupied(port int) error {
	return fmt.Errorf("port %d is already in use", port)
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
