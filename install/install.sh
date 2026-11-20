#!/bin/sh
# Installs create-bildr, a single executable, from a GitHub Release.
#   curl -fsSL https://github.com/webbegg/bildr/releases/latest/download/install.sh | sh
#
# Environment:
#   BILDR_VERSION       a release tag (v0.1.0, or 0.1.0) instead of the latest release
#   BILDR_INSTALL       install root; the binary goes to $BILDR_INSTALL/bin (default: $HOME/.bildr)
#   BILDR_DOWNLOAD_URL  where the binary and SHA256SUMS are downloaded from (tests; http(s):// or file://)
#
# Everything runs inside main, called on the last line: a truncated download runs nothing.
set -eu

RELEASES=https://github.com/webbegg/bildr/releases

say() { printf '%s\n' "$*"; }
die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

fetch() { # fetch <url> <file>
  case "$1" in
    file://*) cp "${1#file://}" "$2" ;;
    *)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$1" -o "$2"
      elif command -v wget >/dev/null 2>&1; then
        wget -q "$1" -O "$2"
      else
        die 'curl or wget is required to download create-bildr.'
      fi
      ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    die 'sha256sum or shasum is required to verify the download.'
  fi
}

main() {
  # --- platform -------------------------------------------------------------
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW* | MSYS* | CYGWIN*) die 'this is the Linux/macOS installer. On Windows, run install.ps1 in PowerShell (see the release page).' ;;
    *) die "unsupported OS: $(uname -s). Supported: Linux, macOS (Windows: install.ps1)." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "unsupported architecture: $(uname -m). Supported: x86_64, arm64." ;;
  esac
  if [ "$os" = linux ]; then
    # The binaries link glibc. musl's ldd prints its banner to stderr and exits 1, hence the 2>&1.
    # Without ldd, fall back to the musl loader; with it, trust ldd (a glibc system can have musl installed too).
    musl=
    if command -v ldd >/dev/null 2>&1; then
      if ldd --version 2>&1 | grep -qi musl; then musl=1; fi
    else
      for loader in /lib/ld-musl-*; do
        if [ -e "$loader" ]; then musl=1; fi
      done
    fi
    [ -z "$musl" ] || die "Alpine/musl isn't supported yet: the create-bildr binary needs glibc. Use 'pnpm create bildr' (needs Node 22.18+ and pnpm) instead."
  fi
  # Under Rosetta uname reports x86_64 for a shell started as x64: the machine is arm64.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  name="create-bildr-$os-$arch"

  # --- where from and to ----------------------------------------------------
  version=${BILDR_VERSION:-}
  if [ -n "$version" ]; then
    case "$version" in
      [0-9]*) version="v$version" ;;
    esac
    # The character check first: grep matches per line, so a value with a newline must not reach it.
    case "$version" in
      *[!0-9A-Za-z.-]*) version= ;;
    esac
    if [ -z "$version" ] || ! printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
      die "BILDR_VERSION='$BILDR_VERSION' is not a release version. Use a tag like v0.1.0 (or 0.1.0, or v0.2.0-rc.1)."
    fi
  fi
  if [ -n "${BILDR_DOWNLOAD_URL:-}" ]; then
    base=${BILDR_DOWNLOAD_URL%/}
  elif [ -n "$version" ]; then
    base="$RELEASES/download/$version"
  else
    base="$RELEASES/latest/download"
  fi
  install_root=${BILDR_INSTALL:-${HOME:-}/.bildr}
  [ -n "${BILDR_INSTALL:-}" ] || [ -n "${HOME:-}" ] || die 'HOME is not set; set BILDR_INSTALL to the install directory.'
  bin_dir="$install_root/bin"

  # --- download -------------------------------------------------------------
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/create-bildr.XXXXXX") || die 'could not create a temporary directory.'
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' INT TERM HUP

  say "Downloading $name from $base"
  fetch "$base/$name" "$tmp/$name" || die "could not download $base/$name (is there a release for $os-$arch?)."
  fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || die "could not download $base/SHA256SUMS."

  # --- verify ---------------------------------------------------------------
  expected=$(awk -v n="$name" '$2 == n || $2 == "*" n { print $1; exit }' "$tmp/SHA256SUMS")
  [ -n "$expected" ] || die "SHA256SUMS has no entry for $name."
  actual=$(sha256_of "$tmp/$name")
  [ "$expected" = "$actual" ] || die "checksum mismatch for $name (expected $expected, got $actual). Nothing was installed."

  # --- install --------------------------------------------------------------
  mkdir -p "$bin_dir"
  chmod +x "$tmp/$name"
  mv -f "$tmp/$name" "$bin_dir/create-bildr"

  say "Installed create-bildr to $bin_dir/create-bildr"
  case ":${PATH:-}:" in
    *":$bin_dir:"*) ;;
    *)
      say ''
      say "Add it to your PATH (in ~/.bashrc, ~/.zshrc or your shell's profile):"
      say "  export PATH=\"$bin_dir:\$PATH\""
      ;;
  esac
  say ''
  say 'Next:'
  say '  create-bildr my-app'
  say ''
  say 'Running the created project needs Node 22.18+ and pnpm.'
}

main "$@"
