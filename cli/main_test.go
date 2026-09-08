package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

// branchServer stands in for GitHub's branches endpoint, handing out one page per
// argument and announcing the next one with the Link header, as api.github.com does.
// The returned counter is how many pages the command actually asked for.
func branchServer(t *testing.T, pages ...[]string) (*httptest.Server, *int) {
	t.Helper()
	calls := 0
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		page := 1
		if p := r.URL.Query().Get("page"); p != "" {
			page, _ = strconv.Atoi(p)
		}
		if page < len(pages) {
			w.Header().Set("Link", fmt.Sprintf(`<%s%s?per_page=100&page=%d>; rel="next"`, srv.URL, r.URL.Path, page+1))
		}
		body := []map[string]string{}
		if page >= 1 && page <= len(pages) {
			for _, name := range pages[page-1] {
				body = append(body, map[string]string{"name": name})
			}
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// issue-00035 / spec-00013-AC-13.3: a language that only has variants has no
// lang/<l> branch, so the listing must not offer `--lang <l>`; its group header
// says the language has no base branch.
func TestListLangsOmitsTheBaseLineForAVariantOnlyLanguage(t *testing.T) {
	srv, _ := branchServer(t, []string{"main", "lang/go", "lang/java/ddd"})

	var out strings.Builder
	if err := cmdLangs(&out, srv.URL); err != nil {
		t.Fatal(err)
	}
	got := out.String()

	if strings.Contains(got, "--lang java") {
		t.Errorf("there is no lang/java branch, yet the listing offers it:\n%s", got)
	}
	for _, want := range []string{"--lang go", "--variant ddd", "no lang/java branch"} {
		if !strings.Contains(got, want) {
			t.Errorf("listing is missing %q:\n%s", want, got)
		}
	}
}

// issue-00036 / spec-00013-AC-13.4: branches spanning more than one page must all
// be listed — the command follows the Link header until it runs out.
func TestListLangsFollowsPaginationToTheLastPage(t *testing.T) {
	srv, calls := branchServer(t, []string{"main", "lang/go"}, []string{"lang/zzz"})

	var out strings.Builder
	if err := cmdLangs(&out, srv.URL); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); !strings.Contains(got, "--lang zzz") {
		t.Errorf("zzz is on the second page and never made it into the listing:\n%s", got)
	}
	if *calls != 2 {
		t.Errorf("asked for %d page(s), want 2", *calls)
	}
}

// issue-00037 / spec-00013-AC-4.4: a second positional argument is rejected with the
// usage and a non-zero exit, and nothing is created.
func TestNewRejectsASecondPositionalArgument(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)

	err := cmdNew([]string{"demo", "extra"})
	if err == nil || !strings.Contains(err.Error(), `"extra"`) || !strings.Contains(err.Error(), "usage: persimmon new") {
		t.Fatalf("cmdNew error = %v, want it to name the extra argument and give the usage", err)
	}
	entries, rerr := os.ReadDir(dir)
	if rerr != nil {
		t.Fatal(rerr)
	}
	if len(entries) != 0 {
		t.Errorf("created %v, want an untouched directory", entries)
	}
}
