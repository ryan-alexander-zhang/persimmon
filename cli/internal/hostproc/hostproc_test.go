package hostproc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/ryan-alexander-zhang/persimmon/cli/internal/project"
	"github.com/ryan-alexander-zhang/persimmon/cli/internal/registry"
)

// The command's half of the startup handshake: who holds the port
// (design-00003 §8), what is handed to a process already there
// (spec-00011-FR-14), and the host launched behind a free one
// (design-00004 §3). The probe and the API halves run against an httptest
// server; the launch half runs a real child, `testdata/host/bin/host.js`
// through the development override — under a released build that override is
// the product's own development shape (spec-00012-FR-6), so the stub is not a
// test-only special case. Nothing here has a TTY, which os/exec cannot give:
// that is the in-repo half of the passthrough obligation (design-00004 §10).
//
// `test/startup.test.ts`'s two handshake cases live here now: a cwd in no
// project (spec-00011-AC-13.4) and a start that reports its address
// (spec-00011-AC-13.1). The host has no handshake of its own to judge.

const hostVersion = "0.2.0"

// requireNode skips what needs a real child: every subcommand but this one
// works without Node (spec-00012-FR-7), so its absence is not a failure.
func requireNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not on PATH")
	}
}

// hostStub is the checkout the development override points at.
func hostStub(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("testdata", "host"))
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// npxShim puts an `npx` on PATH that only reports the arguments it was given:
// what is under test is the command line the command builds, not npm.
func npxShim(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "npx"), []byte("#!/bin/sh\necho \"npx $*\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

// freePort is a port nobody listens on: taken and given straight back.
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

// projectDir is a project: a directory with a flow config in it, which is all
// that makes it one (design-00003 §8). The config's content is never read on
// this path — an invalid one registers and opens all the same
// (spec-00011-AC-13.5, spec-00011-AC-13.7).
func projectDir(t *testing.T, name string) string {
	t.Helper()
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(parent, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, project.ConfigFile), []byte("types: [\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// setup is a Run with its streams captured and a registry file of its own: no
// test may write into the developer's own (design-00003 §2). The port is the
// caller's to set, since half the tests want it free and half want it held.
func setup(t *testing.T) (Options, *bytes.Buffer, *bytes.Buffer, string) {
	t.Helper()
	file := filepath.Join(t.TempDir(), ".persimmon", "workspaces.json")
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	options := Options{
		Version:  devVersion,
		Dir:      t.TempDir(),
		Registry: registry.New(file),
		Stdout:   stdout,
		Stderr:   stderr,
		Signals:  make(chan os.Signal),
	}
	return options, stdout, stderr, file
}

// stub is a process already on the port: it answers the probe as a persimmon
// host and records what was posted to it (design-00003 §5).
type stub struct {
	port   int
	mutex  sync.Mutex
	bodies []string
}

// newStub serves `/api/instance` and `/api/workspaces`; answer writes the reply
// the registration gets.
func newStub(t *testing.T, app, version string, answer func(http.ResponseWriter)) *stub {
	t.Helper()
	holder := &stub{}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/instance", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"app": app, "version": version, "pid": 1})
	})
	mux.HandleFunc("/api/workspaces", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		holder.mutex.Lock()
		holder.bodies = append(holder.bodies, string(body))
		holder.mutex.Unlock()
		answer(w)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	address := server.Listener.Addr().(*net.TCPAddr)
	holder.port = address.Port
	return holder
}

// posted is the registrations the stub was sent, in order.
func (s *stub) posted() []string {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]string(nil), s.bodies...)
}

// created is the 201 a registration gets (design-00003 §5).
func created(id string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"workspace": registry.Entry{ID: id, Name: id, Path: "/work/" + id}})
	}
}

// noRegistry asserts the registry file was never written — every refusal on
// this path leaves it alone (spec-00011-AC-15.1).
func noRegistry(t *testing.T, file string) {
	t.Helper()
	if _, err := os.Stat(file); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the registry file was written: %v", err)
	}
}

// design-00003 §8's three states, spec-00011-AC-15.1 among them: a 200 from
// somebody else is «taken», not «one of ours».
func TestProbeReadsWhoHoldsThePort(t *testing.T) {
	refused := freePort(t)
	for _, test := range []struct {
		name    string
		port    func(*testing.T) int
		kind    Kind
		version string
	}{
		{name: "a refused connection is free", port: func(*testing.T) int { return refused }, kind: Free},
		{
			name:    "a persimmon answering 200 is running",
			port:    func(t *testing.T) int { return newStub(t, "persimmon", hostVersion, created("demo")).port },
			kind:    Running,
			version: hostVersion,
		},
		{
			name: "another app answering 200 is occupied",
			port: func(t *testing.T) int { return newStub(t, "something-else", hostVersion, created("demo")).port },
			kind: Occupied,
		},
		{
			name: "a non-200 is occupied",
			port: func(t *testing.T) int {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					http.Error(w, "no", http.StatusInternalServerError)
				}))
				t.Cleanup(server.Close)
				return server.Listener.Addr().(*net.TCPAddr).Port
			},
			kind: Occupied,
		},
		{
			name: "an answer that is not JSON is occupied",
			port: func(t *testing.T) int {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					_, _ = w.Write([]byte("<html>"))
				}))
				t.Cleanup(server.Close)
				return server.Listener.Addr().(*net.TCPAddr).Port
			},
			kind: Occupied,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			instance := Probe(context.Background(), test.port(t))
			if instance.Kind != test.kind || instance.Version != test.version {
				t.Fatalf("probe answered %+v, want kind %q version %q", instance, test.kind, test.version)
			}
		})
	}
}

// spec-00011-AC-15.2: the holder never answers, and a timeout is «taken» —
// reading it as anything else is what would start a second process on a held
// port (design-00003 §8).
func TestProbeReadsASilentHolderAsOccupied(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			defer connection.Close()
		}
	}()

	if instance := Probe(context.Background(), listener.Addr().(*net.TCPAddr).Port); instance.Kind != Occupied {
		t.Fatalf("probe answered %+v, want occupied", instance)
	}
}

// spec-00011-AC-14.1 and spec-00011-AC-14.2: no second service, the address is
// the command's to print because the port is known, and the registration goes
// through the running process — so its switcher shows the entry at once and
// this side never writes the file. spec-00012-AC-3.4 with it: nothing is
// launched, which a `dev` build with no override could not have done quietly.
func TestJoinsTheProcessOnThePort(t *testing.T) {
	options, stdout, stderr, file := setup(t)
	options.Dir = projectDir(t, "demo")
	holder := newStub(t, "persimmon", hostVersion, created("demo"))
	options.Port = holder.port

	if code := Run(context.Background(), options); code != 0 {
		t.Fatalf("exit code %d, want 0; stderr %q", code, stderr.String())
	}
	want := "persimmon: http://localhost:" + strconv.Itoa(holder.port) + "/w/demo — persimmon-host " + hostVersion + " is already running\n"
	if stdout.String() != want {
		t.Fatalf("stdout %q, want %q", stdout.String(), want)
	}
	posted := holder.posted()
	if len(posted) != 1 || !strings.Contains(posted[0], `"path":"`+options.Dir+`"`) {
		t.Fatalf("the process was posted %q, want one registration of %q", posted, options.Dir)
	}
	noRegistry(t, file)
}

// spec-00011-AC-14.3: a cwd in no project registers nothing at all, and the
// address is the entry point.
func TestJoinsOutsideEveryProject(t *testing.T) {
	options, stdout, stderr, file := setup(t)
	holder := newStub(t, "persimmon", hostVersion, created("demo"))
	options.Port = holder.port

	if code := Run(context.Background(), options); code != 0 {
		t.Fatalf("exit code %d, want 0; stderr %q", code, stderr.String())
	}
	want := "persimmon: http://localhost:" + strconv.Itoa(holder.port) + "/ — persimmon-host " + hostVersion + " is already running\n"
	if stdout.String() != want {
		t.Fatalf("stdout %q, want %q", stdout.String(), want)
	}
	if posted := holder.posted(); len(posted) != 0 {
		t.Fatalf("the process was posted %q, want nothing", posted)
	}
	noRegistry(t, file)
}

// spec-00011-AC-15.1 and spec-00011-AC-15.2 at the command: the port is wanted
// and cannot be had, so it refuses rather than starting a second process on it.
func TestRefusesAPortItCannotHave(t *testing.T) {
	for _, test := range []struct {
		name string
		port func(*testing.T) int
	}{
		{
			name: "an HTTP service that is not a persimmon",
			port: func(t *testing.T) int { return newStub(t, "something-else", hostVersion, created("demo")).port },
		},
		{
			name: "a TCP service that never answers",
			port: func(t *testing.T) int {
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { listener.Close() })
				return listener.Addr().(*net.TCPAddr).Port
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			options, stdout, stderr, file := setup(t)
			options.Dir = projectDir(t, "demo")
			options.Port = test.port(t)

			if code := Run(context.Background(), options); code != 1 {
				t.Fatalf("exit code %d, want 1", code)
			}
			want := "persimmon: port " + strconv.Itoa(options.Port) + " is already in use\n"
			if stderr.String() != want {
				t.Fatalf("stderr %q, want %q", stderr.String(), want)
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout %q, want nothing", stdout.String())
			}
			noRegistry(t, file)
		})
	}
}

// spec-00011-AC-15.3: the registration went to the running process and came
// back refused (422) or failed (500); the reason is the process's sentence to
// say, and the command reports it and starts nothing.
func TestReportsARegistrationTheProcessRefused(t *testing.T) {
	for _, test := range []struct {
		name   string
		answer func(http.ResponseWriter)
		want   string
	}{
		{
			name: "a refusal",
			answer: func(w http.ResponseWriter) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_, _ = w.Write([]byte(`{"error":"the directory holds no whiteboard.config.yaml: /work/demo"}`))
			},
			want: "persimmon: the directory holds no whiteboard.config.yaml: /work/demo\n",
		},
		{
			name: "a write that failed",
			answer: func(w http.ResponseWriter) {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"workspace registry: could not be written"}`))
			},
			want: "persimmon: workspace registry: could not be written\n",
		},
		{
			name:   "a refusal with nothing to say",
			answer: func(w http.ResponseWriter) { w.WriteHeader(http.StatusInternalServerError) },
			want:   "persimmon: POST /api/workspaces answered 500\n",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			options, stdout, stderr, file := setup(t)
			options.Dir = projectDir(t, "demo")
			options.Port = newStub(t, "persimmon", hostVersion, test.answer).port

			if code := Run(context.Background(), options); code != 1 {
				t.Fatalf("exit code %d, want 1", code)
			}
			if stderr.String() != test.want {
				t.Fatalf("stderr %q, want %q", stderr.String(), test.want)
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout %q, want nothing", stdout.String())
			}
			noRegistry(t, file)
		})
	}
}

// A registration nobody is there to take: the probe said running a moment ago
// and the process is gone by now. It is reported like any other refusal
// (spec-00011-FR-15), which is also what `add` and `remove` will rest on.
func TestPostReportsAConnectionItCannotMake(t *testing.T) {
	if _, err := Post(context.Background(), freePort(t), t.TempDir(), ""); err == nil {
		t.Fatal("the registration was accepted by nobody")
	}
}

// spec-00011-FR-15 on the free-port path: the registry file itself refused the
// write, so the reason is reported and no service is started — the same
// treatment spec-00011-AC-15.3 gives a registration the running process
// refused.
func TestReportsARegistrationTheFileRefused(t *testing.T) {
	t.Setenv("PATH", npxShim(t))
	options, stdout, stderr, _ := setup(t)
	options.Version = "1.2.3"
	options.Dir = projectDir(t, "demo")
	options.Port = freePort(t)
	blocked := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocked, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	options.Registry = registry.New(filepath.Join(blocked, "workspaces.json"))

	if code := Run(context.Background(), options); code != 1 {
		t.Fatalf("exit code %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "workspace registry: ") {
		t.Fatalf("stderr %q, want the reason the registration failed", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout %q, want nothing — no service was started", stdout.String())
	}
}

// spec-00011-AC-13.1 (from `test/startup.test.ts:122`), spec-00011-AC-13.5,
// spec-00011-AC-13.6, spec-00012-AC-3.1 and spec-00012-AC-6.1: the project the
// cwd sits in is registered — an invalid flow config and all — the host is run
// from the override rather than any published package, and the port and the
// entry id reach it, which is how the address it prints comes out right.
func TestLaunchesTheHostForTheProjectTheCwdIsIn(t *testing.T) {
	requireNode(t)
	t.Setenv("PATH", npxShim(t)+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("STUB_EXIT", "0")
	options, stdout, stderr, file := setup(t)
	options.Dir = projectDir(t, "demo")
	options.Port = freePort(t)
	options.HostDir = hostStub(t)

	if code := Run(context.Background(), options); code != 0 {
		t.Fatalf("exit code %d, want 0; stderr %q", code, stderr.String())
	}
	want := "persimmon: http://localhost:" + strconv.Itoa(options.Port) + "/w/demo\n"
	if stdout.String() != want {
		t.Fatalf("stdout %q, want %q", stdout.String(), want)
	}
	if strings.Contains(stdout.String(), "npx") {
		t.Fatalf("the override took a published host package: %q", stdout.String())
	}
	entries, err := registry.New(file).Read()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].ID != "demo" || entries[0].Path != options.Dir {
		t.Fatalf("the registry holds %+v, want one entry `demo` at %q", entries, options.Dir)
	}
}

// spec-00011-AC-13.4 (from `test/startup.test.ts:57`): a cwd in no project is a
// start with no workspace, not an error — nothing is registered and the host
// comes up on the entry point.
func TestLaunchesWithNoWorkspaceOutsideEveryProject(t *testing.T) {
	requireNode(t)
	t.Setenv("STUB_EXIT", "0")
	options, stdout, stderr, file := setup(t)
	options.Port = freePort(t)
	options.HostDir = hostStub(t)

	if code := Run(context.Background(), options); code != 0 {
		t.Fatalf("exit code %d, want 0; stderr %q", code, stderr.String())
	}
	want := "persimmon: http://localhost:" + strconv.Itoa(options.Port) + "/\n"
	if stdout.String() != want {
		t.Fatalf("stdout %q, want %q", stdout.String(), want)
	}
	noRegistry(t, file)
}

// spec-00012-AC-3.2: the host's diagnostic lands on the command's stderr, not
// swallowed and not mixed into stdout.
func TestPassesTheHostsStderrThrough(t *testing.T) {
	requireNode(t)
	t.Setenv("STUB_EXIT", "0")
	t.Setenv("STUB_STDERR", "host: a diagnostic")
	options, stdout, stderr, _ := setup(t)
	options.Port = freePort(t)
	options.HostDir = hostStub(t)

	if code := Run(context.Background(), options); code != 0 {
		t.Fatalf("exit code %d, want 0", code)
	}
	if stderr.String() != "host: a diagnostic\n" {
		t.Fatalf("stderr %q, want the host's line", stderr.String())
	}
	if strings.Contains(stdout.String(), "diagnostic") {
		t.Fatalf("the diagnostic landed on stdout: %q", stdout.String())
	}
}

// spec-00012-AC-3.3: the host lost the port between the probe and its listen
// and exited non-zero; the command exits with that same code and adds nothing
// of its own (design-00004 §3's EADDRINUSE backstop).
func TestExitsWithTheHostsCode(t *testing.T) {
	requireNode(t)
	options, stdout, stderr, _ := setup(t)
	options.Port = freePort(t)
	options.HostDir = hostStub(t)
	t.Setenv("STUB_EXIT", "17")
	t.Setenv("STUB_STDERR", "port "+strconv.Itoa(options.Port)+" is already in use")

	if code := Run(context.Background(), options); code != 17 {
		t.Fatalf("exit code %d, want the host's 17", code)
	}
	if !strings.Contains(stderr.String(), "is already in use") {
		t.Fatalf("stderr %q, want the host's refusal", stderr.String())
	}
	if strings.Contains(stdout.String(), "persimmon:") && strings.Count(stdout.String(), "\n") != 1 {
		t.Fatalf("stdout %q, want the host's own output only", stdout.String())
	}
}

// spec-00012-AC-3.1's other half: the stdio passthrough is all three streams,
// so what is typed at the command reaches the host (design-00004 §3).
func TestPassesStdinThrough(t *testing.T) {
	requireNode(t)
	t.Setenv("STUB_ECHO_STDIN", "1")
	options, stdout, _, _ := setup(t)
	options.Port = freePort(t)
	options.HostDir = hostStub(t)
	options.Stdin = strings.NewReader("a line the host echoes\n")

	if code := Run(context.Background(), options); code != 0 {
		t.Fatalf("exit code %d, want 0", code)
	}
	if !strings.Contains(stdout.String(), "a line the host echoes") {
		t.Fatalf("stdout %q, want the echoed line", stdout.String())
	}
}

// spec-00012-AC-6.2: no override and a released build takes the published host
// package pinned to the command's own version — that pin is the pairing
// (spec-00012-FR-5). The shim stands in for npm: what is under test is the
// command line the command builds.
func TestTakesThePublishedHostPackage(t *testing.T) {
	t.Setenv("PATH", npxShim(t))
	options, stdout, stderr, _ := setup(t)
	options.Version = "1.2.3"
	options.Port = freePort(t)

	if code := Run(context.Background(), options); code != 0 {
		t.Fatalf("exit code %d, want 0; stderr %q", code, stderr.String())
	}
	want := "npx -y " + hostPackage + "@1.2.3\n"
	if stdout.String() != want {
		t.Fatalf("stdout %q, want %q", stdout.String(), want)
	}
}

// spec-00012-AC-8.1: a `dev` build with no override has no published version to
// pair with, so it says so and stops — guessing one would break the pairing
// quietly (spec-00012-FR-8). Nothing is launched and nothing is registered.
func TestRefusesToGuessAVersion(t *testing.T) {
	t.Setenv("PATH", npxShim(t))
	options, stdout, stderr, file := setup(t)
	options.Dir = projectDir(t, "demo")
	options.Port = freePort(t)

	if code := Run(context.Background(), options); code != 1 {
		t.Fatalf("exit code %d, want 1", code)
	}
	if lines := strings.Count(stderr.String(), "\n"); lines != 1 || !strings.Contains(stderr.String(), "PERSIMMON_HOST") {
		t.Fatalf("stderr %q, want one sentence naming the override", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout %q, want nothing — no host package was taken", stdout.String())
	}
	noRegistry(t, file)
}

// spec-00012-AC-7.1: no Node on the machine is one sentence and a non-zero
// exit, never a stack, and nothing is launched (design-00004 §3). Both ways in
// need it — the published package through `npx`, the override through `node`.
func TestReportsAMissingNode(t *testing.T) {
	for _, test := range []struct {
		name    string
		version string
		host    func(*testing.T) string
		want    string
	}{
		{
			name:    "the published package needs npx",
			version: "1.2.3",
			host:    func(*testing.T) string { return "" },
			want:    "persimmon: 打开白板需要 Node.js（未找到 npx）；new / update / add 不受影响\n",
		},
		{
			name:    "the override needs node",
			version: devVersion,
			host:    hostStub,
			want:    "persimmon: 打开白板需要 Node.js（未找到 node）；new / update / add 不受影响\n",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PATH", t.TempDir())
			options, stdout, stderr, file := setup(t)
			options.Dir = projectDir(t, "demo")
			options.Port = freePort(t)
			options.Version = test.version
			options.HostDir = test.host(t)

			if code := Run(context.Background(), options); code != 1 {
				t.Fatalf("exit code %d, want 1", code)
			}
			if stderr.String() != test.want {
				t.Fatalf("stderr %q, want %q", stderr.String(), test.want)
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout %q, want nothing", stdout.String())
			}
			noRegistry(t, file)
		})
	}
}

// session is a Run in flight with the host's output line by line, so a test can
// wait for the host to be up before signalling it and watch what it does next.
type session struct {
	code    chan int
	lines   chan string
	signals chan os.Signal
}

func start(t *testing.T, options Options) *session {
	t.Helper()
	reader, writer := io.Pipe()
	running := &session{code: make(chan int, 1), lines: make(chan string, 16), signals: make(chan os.Signal, 2)}
	options.Signals = running.signals
	options.Stdout, options.Stderr = writer, writer
	go func() {
		code := Run(context.Background(), options)
		_ = writer.Close()
		running.code <- code
	}()
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			running.lines <- scanner.Text()
		}
		close(running.lines)
	}()
	return running
}

// line is the host's next line of output, or a failure rather than a hang.
func (s *session) line(t *testing.T) string {
	t.Helper()
	select {
	case line, open := <-s.lines:
		if !open {
			t.Fatalf("the host's output ended; the command exited with %d", s.exit(t))
		}
		return line
	case <-time.After(20 * time.Second):
		t.Fatal("timed out waiting for the host's output")
		return ""
	}
}

// exit is the code Run returned, or a failure rather than a hang.
func (s *session) exit(t *testing.T) int {
	t.Helper()
	select {
	case code := <-s.code:
		return code
	case <-time.After(20 * time.Second):
		t.Fatal("timed out waiting for the command to exit")
		return -1
	}
}

// spec-00012-AC-4.1 and spec-00012-AC-4.3: the signal is forwarded to the host,
// the command does not exit ahead of it, and a second one of the same signal is
// forwarded too — the host is the one that decides when it is done
// (spec-00011-FR-16).
func TestForwardsSIGINTAndDoesNotExitFirst(t *testing.T) {
	requireNode(t)
	t.Setenv("STUB_SIGNALS", "2")
	options, _, _, _ := setup(t)
	options.Port = freePort(t)
	options.HostDir = hostStub(t)
	running := start(t, options)
	running.line(t)

	running.signals <- os.Interrupt
	if line := running.line(t); line != "stub: SIGINT 1" {
		t.Fatalf("the host said %q, want the first SIGINT", line)
	}
	// The host is still there — it wants a second signal — so the command must
	// still be waiting on it.
	select {
	case code := <-running.code:
		t.Fatalf("the command exited with %d while the host was still shutting down", code)
	default:
	}

	running.signals <- os.Interrupt
	if line := running.line(t); line != "stub: SIGINT 2" {
		t.Fatalf("the host said %q, want the second SIGINT forwarded too", line)
	}
	if code := running.exit(t); code != 0 {
		t.Fatalf("exit code %d, want the host's 0", code)
	}
}

// spec-00012-AC-4.2: SIGTERM is forwarded the same way, and the command still
// exits with the host's code.
func TestForwardsSIGTERM(t *testing.T) {
	requireNode(t)
	t.Setenv("STUB_SIGNAL_EXIT", "3")
	options, _, _, _ := setup(t)
	options.Port = freePort(t)
	options.HostDir = hostStub(t)
	running := start(t, options)
	running.line(t)

	running.signals <- syscall.SIGTERM
	if line := running.line(t); line != "stub: SIGTERM 1" {
		t.Fatalf("the host said %q, want the SIGTERM", line)
	}
	if code := running.exit(t); code != 3 {
		t.Fatalf("exit code %d, want the host's 3", code)
	}
}

// TestMain lets this binary re-run itself as the command: a real signal needs a
// real process, and the join path's own exit is what is under test there.
func TestMain(m *testing.M) {
	if port, joining := os.LookupEnv("HOSTPROC_JOIN_PORT"); joining {
		number, err := strconv.Atoi(port)
		if err != nil {
			os.Exit(2)
		}
		os.Exit(Run(context.Background(), Options{
			Version:  devVersion,
			Port:     number,
			Dir:      os.Getenv("HOSTPROC_DIR"),
			Registry: registry.New(os.Getenv("HOSTPROC_REGISTRY")),
			Stdout:   os.Stdout,
			Stderr:   os.Stderr,
		}))
	}
	os.Exit(m.Run())
}

// spec-00012-AC-4.4: on the join path the command has no child, so it forwards
// nothing and just exits — it installs no handler at all, and the signal's
// default disposition is what takes it down. The process it was joining is
// untouched and the registry is not written. Run as a real child of this test,
// because a real signal is the only evidence of a handler that is not there.
func TestTheJoinPathIsTakenDownByTheSignal(t *testing.T) {
	arrived := make(chan struct{})
	release := make(chan struct{})
	defer close(release)
	holder := newStub(t, "persimmon", hostVersion, func(_ http.ResponseWriter) {
		close(arrived)
		<-release
	})
	file := filepath.Join(t.TempDir(), ".persimmon", "workspaces.json")

	child := exec.Command(os.Args[0])
	child.Env = append(os.Environ(),
		"HOSTPROC_JOIN_PORT="+strconv.Itoa(holder.port),
		"HOSTPROC_DIR="+projectDir(t, "demo"),
		"HOSTPROC_REGISTRY="+file,
	)
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-arrived:
	case <-time.After(20 * time.Second):
		t.Fatal("timed out waiting for the registration to reach the process")
	}
	if err := child.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}

	err := child.Wait()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != -1 || !strings.Contains(exit.String(), "interrupt") {
		t.Fatalf("the command ended as %v, want death by the interrupt itself", err)
	}
	if instance := Probe(context.Background(), holder.port); instance.Kind != Running {
		t.Fatalf("the joined process answers %+v, want it still running", instance)
	}
	noRegistry(t, file)
}
