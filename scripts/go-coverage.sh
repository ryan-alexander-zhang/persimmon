#!/bin/sh
# Statement-coverage gate for the `persimmon` command (CODE_QUALITY.md §2).
#
# `go test -cover` prints the numbers but never fails the build; this script is
# what fails it. New packages must reach 90% (TESTING.md, Coverage / Go);
# `cli/internal/scaffold` arrived from ainpt as legacy debt under
# CODE_QUALITY.md §8, so its gate is the recorded value below — it ratchets up
# toward 90% as spec-00013's acceptance set lands, and is never lowered.
set -e

BAR=90
SCAFFOLD_RATCHET=82.1

cd "$(dirname "$0")/.."
OUT=$(mktemp -t go-coverage)
trap 'rm -f "$OUT" "$OUT.profile"' EXIT

go -C cli test -coverprofile="$OUT.profile" ./... | tee "$OUT"

awk -v bar="$BAR" -v ratchet="$SCAFFOLD_RATCHET" '
  # ok  <pkg>  <time>  coverage: <pct>% of statements
  $1 == "ok" && $4 == "coverage:" {
    pct = $5; sub(/%$/, "", pct)
    want = ($2 ~ /\/internal\/scaffold$/) ? ratchet : bar
    if (pct + 0 < want + 0) {
      printf "FAIL %s: statement coverage %s%% is below its %s%% bar\n", $2, pct, want
      failed = 1
    } else {
      printf "ok   %s: %s%% (bar %s%%)\n", $2, pct, want
    }
    next
  }
  # A package with no test files cannot meet any bar.
  $1 == "?" {
    printf "FAIL %s: no test files, so it cannot meet the %s%% bar\n", $2, bar
    failed = 1
  }
  END {
    if (failed) {
      print "go coverage gate failed: raise the tests, not the bar"
      print "(TESTING.md Coverage / Go; CODE_QUALITY.md §2 and §8)"
      exit 1
    }
    print "go coverage gate passed"
  }
' "$OUT"
