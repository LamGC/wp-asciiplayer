# Isolated recording budget experiment

This branch adds experiments only. The plugin never loads these files. No formal fix, release, deployment or security finding closure is implied.

`resource-budget-experiment.yml` runs native PHP 7.4/8.3 and real Chromium with the pinned player 3.17.0. Results are retained as seven-day Actions artifacts. Browser payload delivery permits only controlled loopback fixtures; PHP runtime has networking disabled. Setup downloads official runtimes and locked dependencies.

Run from checkout root:

- `npm ci --ignore-scripts`
- `npx --no-install playwright install --with-deps chromium`
- `node experiment/browser.cjs`
- `php -d memory_limit=128M experiment/php/run.php "$PWD" /tmp/cast-results`

The browser harness records actual DOM marker counts, playback/seek, same-origin iframe compatibility, diagnostic timings and sampled JS heap values. Heap samples are not total process RSS; timings are one run per case, not statistical performance claims. Large terminal dimensions run only through the rejection path. Marker cap 1,000 and total-cell adapter cap 40,000 are experimental candidates. The separate loader also has an optional cell budget; this harness explicitly identifies its adapter seam.

Compatibility differences are measured explicitly: current player accepts zero dimensions as defaults and ignores blank JSONL lines; the experimental loader follows stricter upload rules. These differences need a decision before any formal implementation. Compact single-line v1 remains rejected by this prototype, as in the existing upload path. The loader's read deadline does not interrupt synchronous parsing or guarantee an overall CPU limit; process/job watchdogs bound this experiment.

Native PHP fixtures are generated in temporary storage and capped below 2 MiB. Each measurement uses a fresh process with a 128 MiB PHP memory limit and 20-second watchdog. The original regression suite runs from a temporary copy with and without the gate. PHP tracked peak allocation is reported separately from OS memory. Permitting 100,000 normal frames still consumes meaningful memory.

Do not treat passing measurements as production readiness: actual WordPress integration, cross-origin/CORS behavior, multiple-player aggregate budgets, low-memory/mobile profiling and final compatibility/default choices remain separate work.
