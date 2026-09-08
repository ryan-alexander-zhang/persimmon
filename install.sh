#!/bin/sh
# Install the persimmon CLI from the latest GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/ryan-alexander-zhang/persimmon/main/install.sh | sh
set -e

OWNER="ryan-alexander-zhang"
REPO="persimmon"
BIN="persimmon"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64 | amd64) ARCH=amd64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
case "$OS" in
  linux | darwin) ;;
  *) echo "unsupported OS: $OS" >&2; exit 1 ;;
esac

ASSET="${BIN}_${OS}_${ARCH}.tar.gz"
# The download base and the install directory are overridable so the checksum
# policy below can be exercised against a local stub (test/install.test.ts);
# unset, both are exactly what a user gets.
BASE="${PERSIMMON_INSTALL_BASE_URL:-https://github.com/${OWNER}/${REPO}/releases/latest/download}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ${ASSET} ..."
curl -fsSL "${BASE}/${ASSET}" -o "${TMP}/${ASSET}"

# Checksum policy (spec-00012-FR-11, issue-00038): a checksum we cannot confirm
# aborts before anything is unpacked or installed. Only a missing checksums file
# or a machine with no checksum tool degrades to a warning — that is one thing
# missing here, not evidence the archive was touched.
if command -v sha256sum >/dev/null 2>&1; then
  SUM="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SUM="shasum -a 256"
else
  SUM=""
fi

if ! curl -fsSL "${BASE}/checksums.txt" -o "${TMP}/checksums.txt" 2>/dev/null; then
  echo "warning: checksums.txt is not available, checksum not verified" >&2
elif [ -z "$SUM" ]; then
  echo "warning: neither sha256sum nor shasum is on PATH, checksum not verified" >&2
else
  EXPECTED=$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print tolower($1) }' "${TMP}/checksums.txt")
  if [ -z "$EXPECTED" ]; then
    echo "error: checksums.txt has no line for ${ASSET}, refusing to install" >&2
    exit 1
  fi
  if ! printf '%s' "$EXPECTED" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "error: the checksum recorded for ${ASSET} is malformed, refusing to install" >&2
    exit 1
  fi
  ACTUAL=$(cd "$TMP" && $SUM "$ASSET" | cut -d' ' -f1)
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "error: checksum mismatch for ${ASSET} (expected ${EXPECTED}, got ${ACTUAL}), refusing to install" >&2
    exit 1
  fi
  echo "checksum ok"
fi

tar -xzf "${TMP}/${ASSET}" -C "$TMP"

DEST="/usr/local/bin"
if [ -n "${PERSIMMON_INSTALL_DIR:-}" ]; then
  DEST="$PERSIMMON_INSTALL_DIR"
  mkdir -p "$DEST"
  install -m 0755 "${TMP}/${BIN}" "${DEST}/${BIN}"
elif [ -w "$DEST" ]; then
  install -m 0755 "${TMP}/${BIN}" "${DEST}/${BIN}"
elif command -v sudo >/dev/null 2>&1; then
  sudo install -m 0755 "${TMP}/${BIN}" "${DEST}/${BIN}"
else
  DEST="${HOME}/.local/bin"
  mkdir -p "$DEST"
  install -m 0755 "${TMP}/${BIN}" "${DEST}/${BIN}"
fi

echo "Installed ${BIN} to ${DEST}"
echo "Run: ${BIN} new my-project"
