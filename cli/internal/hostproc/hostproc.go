// Package hostproc is the `persimmon` command with no subcommand: the startup
// handshake, and the host process behind it.
//
// The handshake's three states are design-00003 §8 and how the host is launched
// is design-00004 §3; `bin/host.js` is the other side of both. The port's
// default is resolved once, by the command, and written into the host's
// environment from there (design-00004 §3 追注) — nothing here reads `PORT`.
package hostproc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/ryan-alexander-zhang/persimmon/cli/internal/project"
	"github.com/ryan-alexander-zhang/persimmon/cli/internal/registry"
)

// hostPackage is the npm package the released command launches, pinned to the
// command's own version — that pin is what pairs the two (spec-00012-FR-5).
const hostPackage = "@ryan-alexander-zhang/persimmon-host"

// devVersion is what an unreleased build carries (spec-00012-FR-9); no
// published host package pairs with it (spec-00012-FR-8).
const devVersion = "dev"

// probeTimeout is the second the probe waits (design-00003 §8).
const probeTimeout = time.Second

// Kind is who holds the port (design-00003 §8).
type Kind string

const (
	// Running is a persimmon host answering there: the work is handed to it.
	Running Kind = "running"
	// Free is a refused connection: nobody is there, so the host is launched.
	Free Kind = "free"
	// Occupied is everything else — a timeout, a non-200, another app's answer.
	// A running process busy with a synchronous read can answer late, and
	// reading a timeout as anything but «taken» is what would start a second
	// process on a held port.
	Occupied Kind = "occupied"
)

// Instance is what the probe found. Version is the running host's, for printing
// only: it decides nothing (design-00004 §9).
type Instance struct {
	Kind    Kind
	Version string
}

// Probe asks who holds the port (design-00003 §8). It probes 127.0.0.1, the
// address the host binds, so the probe and the bind name one pair (issue-00028).
func Probe(ctx context.Context, port int) Instance {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint(port, "/api/instance"), nil)
	if err != nil {
		return Instance{Kind: Occupied}
	}
	client := &http.Client{Timeout: probeTimeout}
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(err, syscall.ECONNREFUSED) {
			return Instance{Kind: Free}
		}
		return Instance{Kind: Occupied}
	}
	defer response.Body.Close()
	var instance struct {
		App     string `json:"app"`
		Version string `json:"version"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&instance) != nil {
		return Instance{Kind: Occupied}
	}
	if instance.App != "persimmon" {
		return Instance{Kind: Occupied}
	}
	return Instance{Kind: Running, Version: instance.Version}
}

// Post registers a directory through the running process (spec-00011-FR-14):
// its writes are serialised and its switcher shows the entry at once. The path
// goes absolute, because the answer would otherwise resolve it in its own cwd.
// A refusal is the process's sentence to say — 422 for a path it will not
// register, 500 for a write that failed (design-00003 §5) — and the caller
// reports it rather than writing the file itself (spec-00011-FR-15).
func Post(ctx context.Context, port int, path, name string) (registry.Entry, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return registry.Entry{}, err
	}
	body, err := json.Marshal(struct {
		Path string `json:"path"`
		Name string `json:"name,omitempty"`
	}{Path: absolute, Name: name})
	if err != nil {
		return registry.Entry{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint(port, "/api/workspaces"), bytes.NewReader(body))
	if err != nil {
		return registry.Entry{}, err
	}
	request.Header.Set("content-type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return registry.Entry{}, err
	}
	defer response.Body.Close()
	var answer struct {
		Workspace registry.Entry `json:"workspace"`
		Error     string         `json:"error"`
	}
	_ = json.NewDecoder(response.Body).Decode(&answer)
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		if answer.Error == "" {
			return registry.Entry{}, fmt.Errorf("POST /api/workspaces answered %d", response.StatusCode)
		}
		return registry.Entry{}, errors.New(answer.Error)
	}
	return answer.Workspace, nil
}

// Workspace is one registry entry with its availability beside it: the shape
// `GET /api/workspaces` answers with (design-00003 §5) and the shape the host
// package's `--judge` prints (design-00004 §4). Sessions are not read here —
// `list` shows availability and nothing else (spec-00011-FR-21).
type Workspace struct {
	registry.Entry
	Availability string `json:"availability"`
	Error        string `json:"error,omitempty"`
}

// Workspaces is the registry as the running process reads it, judgement
// included (design-00003 §5): while a process is there it is the one that knows
// which workspaces are live, so `list` and `remove` ask it rather than the file.
func Workspaces(ctx context.Context, port int) ([]Workspace, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint(port, "/api/workspaces"), nil)
	if err != nil {
		return nil, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var answer struct {
		Workspaces []Workspace `json:"workspaces"`
		Error      string      `json:"error"`
	}
	_ = json.NewDecoder(response.Body).Decode(&answer)
	if response.StatusCode != http.StatusOK {
		return nil, answered("GET", "/api/workspaces", response.StatusCode, answer.Error)
	}
	return answer.Workspaces, nil
}

// Delete drops one entry through the running process (design-00003 §5): its
// refusals are its own to say — 404 for an id it does not hold, 409 while a
// session of that workspace is running (spec-00011-FR-5).
func Delete(ctx context.Context, port int, id string) (registry.Entry, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint(port, "/api/workspaces/"+id), nil)
	if err != nil {
		return registry.Entry{}, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return registry.Entry{}, err
	}
	defer response.Body.Close()
	var answer struct {
		Workspace registry.Entry `json:"workspace"`
		Error     string         `json:"error"`
	}
	_ = json.NewDecoder(response.Body).Decode(&answer)
	if response.StatusCode != http.StatusOK {
		return registry.Entry{}, answered("DELETE", "/api/workspaces/"+id, response.StatusCode, answer.Error)
	}
	return answer.Workspace, nil
}

// Judge is the host package's query mode (design-00004 §4): it reads the
// registry, runs the availability judgement and prints the five states as JSON
// without listening. The command asks for it because `available` and
// `invalidConfig` both need the flow config validator, which the command does
// not carry a second copy of. Obtaining the package is the same question as
// launching it, so an unreleased build with no development override and a
// machine without Node both fail here — `list` retreats rather than failing
// (spec-00011-FR-21).
func Judge(ctx context.Context, o Options) ([]Workspace, error) {
	host, err := o.host(ctx, "--judge")
	if err != nil {
		return nil, err
	}
	printed := &bytes.Buffer{}
	host.Stdout, host.Stderr = printed, o.Stderr
	if err := host.Run(); err != nil {
		return nil, err
	}
	var answer struct {
		Workspaces []Workspace `json:"workspaces"`
	}
	if err := json.Unmarshal(printed.Bytes(), &answer); err != nil {
		return nil, fmt.Errorf("%s --judge printed no readable judgement — %w", hostPackage, err)
	}
	return answer.Workspaces, nil
}

// answered is what a call reports when the process refused it: its own sentence
// when it gave one, and the bare status when it did not.
func answered(method, path string, status int, message string) error {
	if message == "" {
		return fmt.Errorf("%s %s answered %d", method, path, status)
	}
	return errors.New(message)
}

// Options is everything Run reads from the world, so a test hands it stubs
// instead of the process it runs in.
type Options struct {
	// Version is the command's own version; `dev` is an unreleased build.
	Version string
	// Port is the port to probe and the one the host is given.
	Port int
	// Dir is where the search for the project starts, normally the cwd.
	Dir string
	// Registry is the registry file, written directly when no process is running.
	Registry *registry.Registry
	// HostDir is the development override `PERSIMMON_HOST`: a built checkout
	// whose `bin/host.js` is run instead of any published package. Set, it wins
	// over everything (spec-00012-FR-6).
	HostDir string
	// Stdin, Stdout and Stderr are the command's own streams; the host inherits
	// them as they are (spec-00012-FR-3).
	Stdin          io.Reader
	Stdout, Stderr io.Writer
	// Signals delivers the shutdown signals to forward. Nil subscribes to the
	// real ones, and only once there is a child to forward them to: with no
	// child, the default disposition is what exits the command at once
	// (spec-00012-AC-4.4).
	Signals <-chan os.Signal
}

// Run is `persimmon` with no subcommand (spec-00011-FR-13): the project the cwd
// sits in is the workspace to open, or none at all, and the port decides
// whether the work is handed to a process already there or a host is launched
// behind it. The result is the command's exit code — the host's own once one was
// launched (spec-00012-FR-3).
func Run(ctx context.Context, o Options) int {
	target, inProject := project.FindRoot(o.Dir)
	switch instance := Probe(ctx, o.Port); instance.Kind {
	case Occupied:
		return o.fail(fmt.Sprintf("port %d is already in use", o.Port))
	case Running:
		return o.join(ctx, instance, target, inProject)
	default:
		return o.launch(ctx, target, inProject)
	}
}

// join hands the work to the process already on the port (spec-00011-FR-14):
// no second service, and the address is the command's to print because the port
// is already known. The version is printed and never judged on — an older
// process is joined all the same and the user decides whether to restart it
// (design-00004 §9).
func (o Options) join(ctx context.Context, instance Instance, target string, inProject bool) int {
	id := ""
	if inProject {
		entry, err := Post(ctx, o.Port, target, "")
		if err != nil {
			return o.fail(err.Error())
		}
		id = entry.ID
	}
	fmt.Fprintf(o.Stdout, "%s — persimmon-host %s is already running\n", address(o.Port, id), instance.Version)
	return 0
}

// launch registers the target and runs the host on the port (design-00003 §8).
// Whether the host can be run at all is settled first, so a machine that cannot
// open the board is not left with an entry it never asked to register.
func (o Options) launch(ctx context.Context, target string, inProject bool) int {
	host, err := o.host(ctx)
	if err != nil {
		return o.fail(err.Error())
	}
	id := ""
	if inProject {
		entry, err := o.Registry.Add(target, "")
		if err != nil {
			return o.fail(err.Error())
		}
		id = entry.ID
	}
	// The port goes in explicitly and the entry id with it: the host prints the
	// address, and this is all it needs to write `/w/<id>` in it (design-00004 §3).
	host.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", o.Port))
	if id != "" {
		host.Env = append(host.Env, "PERSIMMON_WORKSPACE="+id)
	}
	host.Stdin, host.Stdout, host.Stderr = o.Stdin, o.Stdout, o.Stderr
	if err := host.Start(); err != nil {
		return o.fail(err.Error())
	}
	stop := o.forward(host.Process)
	defer stop()
	return o.exit(host.Wait())
}

// host is the command that runs the whiteboard service (design-00004 §3): the
// development override when it is set, and otherwise the published package
// pinned to this command's version. An unreleased build has no published
// version to pin and never guesses one — guessing would silently break the
// pairing (spec-00012-FR-8).
func (o Options) host(ctx context.Context, args ...string) (*exec.Cmd, error) {
	if o.HostDir != "" {
		node, err := exec.LookPath("node")
		if err != nil {
			return nil, nodeMissing("node")
		}
		return exec.CommandContext(ctx, node, append([]string{filepath.Join(o.HostDir, "bin", "host.js")}, args...)...), nil
	}
	if o.Version == devVersion {
		return nil, errors.New("开发态构建打不开白板：把 PERSIMMON_HOST 指向一份已 npm run build 的本地检出")
	}
	npx, err := exec.LookPath("npx")
	if err != nil {
		return nil, nodeMissing("npx")
	}
	return exec.CommandContext(ctx, npx, append([]string{"-y", hostPackage + "@" + o.Version}, args...)...), nil
}

// forward passes the shutdown signals on to the host and leaves the exiting to
// it (spec-00012-FR-4): the command does not go first, and a second one of the
// same signal is passed on too — folding it into the shutdown already running
// is the host's business (spec-00011-FR-16). The returned function stops the
// forwarding, so nothing is sent to a pid that is already gone.
func (o Options) forward(host *os.Process) func() {
	own := make(chan os.Signal, 1)
	signals := o.Signals
	if signals == nil {
		signal.Notify(own, os.Interrupt, syscall.SIGTERM)
		signals = own
	}
	stop := make(chan struct{})
	go func() {
		for {
			select {
			case received := <-signals:
				_ = host.Signal(received)
			case <-stop:
				return
			}
		}
	}()
	return func() {
		signal.Stop(own)
		close(stop)
	}
}

// exit is the host's own exit code (spec-00012-FR-3), the non-zero of its
// EADDRINUSE backstop included (design-00004 §3). Anything that is not the
// child's exit is the command's own sentence to report.
func (o Options) exit(err error) int {
	var exit *exec.ExitError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &exit):
		return exit.ExitCode()
	default:
		return o.fail(err.Error())
	}
}

// fail is one sentence on stderr and a non-zero exit, never a stack.
func (o Options) fail(message string) int {
	fmt.Fprintf(o.Stderr, "persimmon: %s\n", message)
	return 1
}

// nodeMissing is the one sentence a machine without Node gets on the opening
// path (spec-00012-FR-7, design-00004 §3); the other subcommands never ask.
func nodeMissing(binary string) error {
	return fmt.Errorf("打开白板需要 Node.js（未找到 %s）；new / update / add 不受影响", binary)
}

// endpoint is one Host-level route on the loopback address the host binds.
func endpoint(port int, path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
}

// address is what the user opens, with the workspace in it (design-00003 §8);
// a start outside every project prints the entry point.
func address(port int, id string) string {
	if id == "" {
		return fmt.Sprintf("persimmon: http://localhost:%d/", port)
	}
	return fmt.Sprintf("persimmon: http://localhost:%d/w/%s", port, id)
}
