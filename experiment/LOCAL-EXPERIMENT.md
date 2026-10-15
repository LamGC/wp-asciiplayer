# Isolated resource-budget experiment, 2026-10-15

This is experimental evidence, not a production patch or security clearance. No repository source was changed or published; no CI, production system, or external hostile endpoint was exercised.

## Environment and boundaries

Node 24.19.0. Installed player 3.17.0 bundle SHA-256 a13c37632e1b5c49fe9128417b9319a9b5bc64cb457dd5ae52cbba8a3aceb880. PHP-WASM 7.4.33 / 8.3.33 via @php-wasm/node 3.1.57. Browser attempted: Chromium 154.0.8037.57, Playwright 1.64.0; blocked before page creation by socket EPERM. No DOM/playback/seek measurement succeeded. No alternate browser bypass attempted.

Synthetic tests were process-time-limited and Node heaps limited. PHP memory limit 128 MiB, with separate subprocess monitoring. Inputs remain bounded; no intentional host resource exhaustion.

## Remote loader prototype

17 baseline loader cases, 8 edge cases, a stalled-reader test, and actual upstream parser compatibility tests pass. Existing hello/replacement/resize/v1-pretty/v3-comments fixtures yield identical events, durations and dimensions through the installed parser and preparation functions. Only the export list in an isolated copy of the upstream core module was changed to expose those functions; this does not execute DOM or terminal rendering.

A controlled 2,220,037-byte stream baseline fully buffers and parses 20,000 events. With an intentionally small 64-KiB test cap, protected loader cancels after 65,638 bytes and never returns player input. Recorded Node heap delta: baseline 7,166,144 B versus protected 1,796,216 B; 48.15 ms versus 10.30 ms in that single sample. Heap/timing numbers are illustrative, not stable production benchmarks.

A 300,048-byte event line is rejected before parsing it. Initial dimensions and late resize dimensions above the candidate per-axis limit are rejected. UTF-8 split into single bytes and CRLF work; invalid UTF-8 is rejected. Unknown event codes remain supported. A normal 100,000-output-event cast is accepted. A stalled stream using a 25-ms experimental read deadline was canceled at 30.5 ms.

## Marker experiment

Shared preflight accepts 0/100/500/1,000 markers and rejects 1,001/3,000 at marker 1,001. With the actual installed upstream parser/recording preparation, a 3,000-marker baseline retains 3,000 markers; protected loader rejects before calling that parser (zero calls). This validates the pre-player gate. The source-derived three-span-per-marker relationship has NOT been empirically measured in a running browser here.

## PHP v1 experiment

PHP tracked peak allocation (not total process RSS):

- 260k empty metadata objects, 780,070 bytes: PHP 7.4 16,955,544 -> 1,232,192 B; PHP 8.3 12,761,472 -> 1,224,552 B.
- 800k metadata scalars, 1,600,070 bytes: PHP 7.4 35,656,088 -> 2,051,392 B; PHP 8.3 18,879,104 -> 2,043,752 B.
- Rejection before json_decode at offsets 300,105 and 800,049; approximately 89–94% peak reduction.
- Existing PHP regression suite passes all 233 assertions baseline and gated on BOTH versions. Thirteen extra scanner assertions also pass.
- Normal v1, large escaped strings, and 100,000 simple frames remain accepted. The last still uses ~43.4 MB on PHP 7.4 / ~25.3 MB on 8.3.
- Scanning increases CPU time, up to ~455 ms in one WASM sample.

## Decisions and unverified work before formal fix

Candidates are experiments, not approved defaults: 32 MiB overall, 2 MiB v1, 256 KiB JSONL line, 100,000 events, 1,000 markers, depth 16, dimensions <=1,000 per axis. PHP gate separately experiments with 100,016 containers / 400,000 scalar-and-key tokens.

Upstream accepts zero dimensions as defaults and skips blank/non-event lines; the prototype follows stricter existing upload behavior. Applying this remotely changes compatibility and must be deliberately resolved. Per-axis bounds still admit one million terminal cells; a total-cell/work budget requires profiling. Current JS v1 prototype stores line strings until bounded whole-document preflight; production implementation should avoid large per-line overhead. A single oversized stream chunk may already be allocated by the platform before code can reject it. Default deadlines, cancellation on source changes/disposal, credential/CORS behavior, localization, multiple-player aggregate memory and real WordPress/browser playback need integration validation. Native PHP deployment memory is not established by WASM results.

Recommendation: the mitigation mechanism is empirically effective for the tested PHP and parser-input paths. Do not call all three findings fixed or choose final thresholds yet. Resolve compatibility and obtain browser/native integration evidence before publishing a formal patch.

## Scope

These are prior local measurements. CI artifacts provide separate native PHP and browser results. Experimental files are not loaded by the plugin.
