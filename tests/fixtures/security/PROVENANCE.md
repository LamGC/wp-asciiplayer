# Official asciinema fixture provenance

These three small baselines were recorded by the official, unmodified asciinema CLI. They are genuine recordings, not hand-written files labeled as recorder output. They contain only a controlled synthetic program and are safe for public source control. None includes input capture, credentials, a user name, a host name, or an absolute workspace path.

## Recorder support and sources

- asciicast v1: official PyPI `asciinema` **1.4.0** source distribution, executed unchanged using Python **3.12.14** and its `python3 -m asciinema` entrypoint. [Published package and hash](https://pypi.org/project/asciinema/1.4.0/#files).
- asciicast v2 and v3: official Linux x86_64 GNU release binary of asciinema **3.0.1**. [Official release](https://github.com/asciinema/asciinema/releases/tag/v3.0.1), [release asset metadata](https://api.github.com/repos/asciinema/asciinema/releases/tags/v3.0.1).
- CLI 3.x defaults to v3 and provides `--output-format asciicast-v2`. It does not offer v1 recording output. Using the historical CLI for v1 avoids a custom conversion here. [Official 3.0 release notes](https://github.com/asciinema/asciinema/releases/tag/v3.0.0).

The source downloads were verified against the publisher-provided SHA-256 values before execution:

| Download | SHA-256 |
| --- | --- |
| `asciinema-x86_64-unknown-linux-gnu`, v3.0.1 | `eb3a55e8778f6b86575ad58b47f1ee21d934e4baa8f01abaa5151cad490021f8` |
| `asciinema-1.4.0.tar.gz` | `fb31457e7a4689340b872f625658dbaea33bcf6863fb5d696cf3857010432ecb` |

The binaries and legacy package are not vendored in the test corpus. The official [installation guide](https://docs.asciinema.org/manual/cli/installation/) documents release binaries and the historical PyPI package.

## Safe, reproducible payload

`synthetic-output.py` writes a fixed introductory line, four harmless hexadecimal samples, and an ANSI green completion line. It reads no files or user input and uses no network. The seed is `0x41c0ffee` (1103167470), with unsigned 32-bit xorshift operations `<< 13`, `>> 17`, `<< 5`. Terminal line discipline converts its newline characters to CRLF in the captures.

All recorders receive an environment cleared with `env -i`, a temporary HOME and configuration directory, fixed locale/TERM/SHELL values, and an 80×24 terminal. CLI 1.4.0 requires a token field even for local recording; its isolated config contains the fixed noncredential value `fixture-no-upload`. No real credential is created, loaded or sent. Every `rec` command has an explicit local filename, and no upload, streaming or authentication command is used.

The recorded command is exactly `python3 synthetic-output.py`. `record-official-baselines.sh` contains the complete shell invocations and refuses to overwrite a previous capture. With the two verified tools available:

```sh
ASCIINEMA3=/path/to/asciinema-3.0.1 \
ASCIINEMA1_SRC=/path/to/asciinema-1.4.0 \
./record-official-baselines.sh /path/to/new-captures
```

The essential recorder commands are:

```sh
python3 -m asciinema rec --title 'PR41 synthetic baseline' \
  --command 'python3 synthetic-output.py' official-v1.cast

asciinema-3.0.1 rec --headless --window-size 80x24 \
  --output-format asciicast-v2 --title 'PR41 synthetic baseline' \
  --command 'python3 synthetic-output.py' official-v2.cast

asciinema-3.0.1 rec --headless --window-size 80x24 \
  --output-format asciicast-v3 --title 'PR41 synthetic baseline' \
  --command 'python3 synthetic-output.py' official-v3.cast
```

Use the wrapper to supply the isolation, Python module path and legacy terminal dimensions; the commands alone omit that setup.

## Baseline identity and validation

| Raw capture | SHA-256 |
| --- | --- |
| `official-v1.cast` | `5570c9cdec60a779585db195ecd8dee4756d84706d6b27d3ccd87cf3ba311c97` |
| `official-v2.cast` | `6be6f5cd70d4a428692fc7807549b9c1437c1c8b60902220ad5e7e01a201f3ee` |
| `official-v3.cast` | `8c07c04edf86605558a9795152fcba32337d72aeaa073bc89adb1c285f06763e` |

All three captures were successfully read using the official CLI 3.0.1 `convert --output-format raw` command. The resulting 187-byte exports are identical by `cmp` and SHA-256: `c759f03280f9a48ecfafbe7b11d7f2b75a2b418d368bc5fd5d13f1d957ee7d4d`. The official converter prepends the terminal-size escape sequence `ESC[8;24;80t`. Independently concatenating the recorded output events produces the same 177 bytes for all three formats, SHA-256 `390dbc2f2102cc0540c71c6db823622e1869596bd0b71c1d0721125083ca6550`.

Each has six output events. The v2 and v3 captures also contain the official recorder's trailing `x` exit event. Preserve those raw files exactly; do not silently delete metadata or events and continue calling the result an unmodified capture.

`provenance.json` records tool/source versions, source hashes, exact command arguments, baseline hashes, header fields, event counts and shared output hash. The repository tests exercise the raw baselines and deterministic derived fixtures against its pinned asciinema-player **3.17.0** parser/core; see the test results separately for what was executed.

## What is deterministic

The payload, seed and corpus mutation recipes are deterministic. A fresh terminal recording is **not byte-for-byte deterministic**: wall-clock timestamps, scheduling delays, total duration and PTY read boundaries can differ. The checked-in raw captures are therefore immutable, hash-pinned provenance anchors. Large and boundary fixtures are explicitly generated derivatives, with fixed timing/metadata and documented mutation recipes; they must not be described as untouched CLI output.

Format semantics are checked against the official specifications: [v1](https://docs.asciinema.org/manual/asciicast/v1/) uses a whole JSON document with per-output delays; [v2](https://docs.asciinema.org/manual/asciicast/v2/) uses JSON lines with elapsed timestamps; [v3](https://docs.asciinema.org/manual/asciicast/v3/) uses JSON lines with relative event intervals and nested terminal dimensions. Format conformance and genuine provenance complement, rather than replace, resource-boundary and real-player regression tests.
