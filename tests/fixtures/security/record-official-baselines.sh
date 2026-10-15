#!/usr/bin/env bash
# Regenerate genuine CLI captures. Real PTY timing and wall clock are nondeterministic.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${ASCIINEMA3:?Set ASCIINEMA3 to the verified official asciinema 3.0.1 executable}"
: "${ASCIINEMA1_SRC:?Set ASCIINEMA1_SRC to the extracted, unmodified PyPI asciinema-1.4.0 directory}"
ASCIINEMA3=$(realpath "$ASCIINEMA3")
ASCIINEMA1_SRC=$(realpath "$ASCIINEMA1_SRC")
PYTHON=$(command -v python3)
SAFE_PATH="$(dirname "$PYTHON"):/usr/bin:/bin"
OUT=$(realpath -m "${1:-$PWD/raw}")
mkdir -p "$OUT"
for v in 1 2 3; do
  if [ -e "$OUT/official-v$v.cast" ]; then
    printf 'Refusing to overwrite %s\n' "$OUT/official-v$v.cast" >&2
    exit 1
  fi
done
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$WORKDIR/home" "$WORKDIR/config-legacy" "$WORKDIR/config-modern"
# CLI 1.4.0 requires a token field even for a local-only rec command. This is a
# fixed, noncredential dummy; no credential is created and no upload is invoked.
printf '[api]\ntoken = fixture-no-upload\n' > "$WORKDIR/config-legacy/config"
: > "$WORKDIR/config-modern/config.toml"
cp "$SCRIPT_DIR/synthetic-output.py" "$WORKDIR/synthetic-output.py"
cd "$WORKDIR"
COMMON=(env -i "PATH=$SAFE_PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color SHELL=/bin/sh "HOME=$WORKDIR/home")
"${COMMON[@]}" "ASCIINEMA_CONFIG_HOME=$WORKDIR/config-modern" "$ASCIINEMA3" --version
"${COMMON[@]}" "ASCIINEMA_CONFIG_HOME=$WORKDIR/config-legacy" "PYTHONPATH=$ASCIINEMA1_SRC" "$PYTHON" -m asciinema --version
for v in 2 3; do
  "${COMMON[@]}" "ASCIINEMA_CONFIG_HOME=$WORKDIR/config-modern" "$ASCIINEMA3" rec \
    --headless --window-size 80x24 --output-format "asciicast-v$v" \
    --title 'PR41 synthetic baseline' --command 'python3 synthetic-output.py' \
    "$OUT/official-v$v.cast"
done
"${COMMON[@]}" "ASCIINEMA_CONFIG_HOME=$WORKDIR/config-legacy" "PYTHONPATH=$ASCIINEMA1_SRC" \
  COLUMNS=80 LINES=24 "$PYTHON" -m asciinema rec \
  --title 'PR41 synthetic baseline' --command 'python3 synthetic-output.py' \
  "$OUT/official-v1.cast"
for v in 1 2 3; do
  "${COMMON[@]}" "ASCIINEMA_CONFIG_HOME=$WORKDIR/config-modern" "$ASCIINEMA3" convert \
    --output-format raw "$OUT/official-v$v.cast" "$OUT/official-v$v.output"
done
cmp "$OUT/official-v1.output" "$OUT/official-v2.output"
cmp "$OUT/official-v2.output" "$OUT/official-v3.output"
sha256sum "$OUT"/official-v{1,2,3}.cast "$OUT"/official-v1.output
