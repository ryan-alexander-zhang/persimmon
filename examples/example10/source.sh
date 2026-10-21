#!/bin/sh
# The Source system of example10: example09's three claims apps, each its own git checkout under one directory, so the
# Rewrite pack reads a directory of checkouts (40-pack-rewrite.md). Usage: sh source.sh <directory outside the project>
set -e
dir="$1"; [ -n "$dir" ] || { echo "usage: sh source.sh <directory>"; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
for app in js java go; do
  rm -rf "$dir/$app"; mkdir -p "$dir/$app"
  (cd "$here/../example09/$app" && tar cf - --exclude node_modules --exclude target --exclude overrides.yaml --exclude change.patch --exclude round-2.patch --exclude record.yaml .) | (cd "$dir/$app" && tar xf -)
  git -C "$dir/$app" init -q && git -C "$dir/$app" add -A && git -C "$dir/$app" -c user.name=example10 -c user.email=example10@persimmon -c commit.gpgsign=false commit -qm "claims ($app)"
  echo "$app $(git -C "$dir/$app" rev-parse --short HEAD)"
done
