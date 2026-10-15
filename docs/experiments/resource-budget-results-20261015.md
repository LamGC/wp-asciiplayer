# Resource-budget experiment results

Experiment only. No production implementation, merge, release or deployment.

## Verified run

[GitHub Actions run 38667731485](https://github.com/LamGC/wp-asciiplayer/actions/runs/38667731485) passed all three jobs on tested commit `fcaf9be8103214d60485e761858f269d13f55cd7`, based on main `ffff9704e5bca7a07d5f57a2f832475ac102d01c`.

Runtime versions: Node 24.18.0, Playwright 1.64.0, Chromium 156.0.8078.4, asciinema-player 3.17.0; native PHP 7.4.33 and 8.3.35 in official Docker images. The raw PHP artifacts include the resolved image digests. The player bundle SHA-256 matched `a13c37632e1b5c49fe9128417b9319a9b5bc64cb457dd5ae52cbba8a3aceb880`.

## Actual browser evidence

All 31 controlled cases passed, including baseline/prototype v1/v2/v3 playback and seek, top-level and same-origin iframe, marker boundaries, and safe rejection of late resize and excessive terminal cell counts. No dangerous-dimension baseline was rendered.

| Case | Baseline | Prototype |
|---|---:|---:|
| 1,000 markers, added DOM elements | 3,049 | 3,049 (accepted) |
| 1,001 markers, added DOM elements | 3,052 | 0 (rejected before player creation) |
| 3,000 markers, added DOM elements | 9,049 | 0 (rejected before player creation) |
| 3,000 markers, initialization / seek | 738.2 ms / 413.2 ms | Rejected in 10.6 ms |

Zero-marker baseline added 49 elements: the measured differences agree with three additional elements per marker. Baseline 3,000-marker sampled JS heap delta was 4,110,979 bytes; this is not total browser memory or process RSS. Timings are single-run diagnostics on one CI runner, not statistical or mobile performance claims. The protected rejection path made zero player creation calls.

## Native PHP evidence

Each measured sample runs in a fresh CLI process with a 128 MiB PHP memory limit and a 20-second watchdog. Values below are PHP tracked peak allocation, not OS RSS.

| Input | PHP | Baseline peak | Gated peak |
|---|---|---:|---:|
| 260,000 empty metadata objects, 780,070 bytes | 7.4.33 | 22,122,216 B | 1,255,960 B |
| Same | 8.3.35 | 17,927,440 B | 1,247,624 B |
| 800,000 metadata scalars, 1,600,070 bytes | 7.4.33 | 35,618,240 B | 2,075,136 B |
| Same | 8.3.35 | 18,840,552 B | 2,066,800 B |

Both rejected shapes stop before json_decode, reducing measured peak allocation by approximately 89–94%. Both versions passed all 229 source-only regression assertions with and without the gate, plus 13 scanner assertions. The earlier local count of 233 included four generated-asset-manifest checks; this source-only CI intentionally did not fabricate build manifests.

Normal v1, escaped strings and 100,000 simple frames remain accepted. That last case still peaks at 43,763,464 B on PHP 7.4 and 25,666,160 B on PHP 8.3. Preflight adds CPU work: in these native samples the normal 100k-frame check went from 25.4 to 60.7 ms / 38.9 to 76.5 ms, respectively.

## Confirmed compatibility and remaining work

The experiment deliberately exposes two compatibility gaps: the original player accepts zero dimensions as defaults and skips blank JSONL lines, while this prototype rejects both. Production integration should preserve safe accepted forms rather than copy the prototype unchanged. Compact single-line v1 and other upstream-tolerated inputs need explicit compatibility decisions.

Candidate marker limit 1,000, adapter cell budget 40,000, parser/byte/event limits and PHP token budgets are experimental. They are not final recommendations. Per-axis bounds alone still allow an excessive cell product. The browser cell test uses an explicit pre-player adapter seam. Local stream tests established early byte/line rejection; this CI browser harness does not independently reproduce every streaming/network edge case.

A formal implementation still needs shared upload/playback policy, cancellation on URL changes/disposal, real WordPress editor integration, localization, CORS/credential checks, aggregate multiple-player budgets and low-memory profiling. Same-origin synthetic iframe success is not a full WordPress integration pass. No Cloud finding state was changed.

## Evidence artifacts

Artifacts are retained for seven days by this experiment workflow:

- [Browser raw results](https://github.com/LamGC/wp-asciiplayer/actions/runs/38667731485/artifacts/11942427047)
- [Native PHP 7.4 raw results and logs](https://github.com/LamGC/wp-asciiplayer/actions/runs/38667731485/artifacts/11943311264)
- [Native PHP 8.3 raw results and logs](https://github.com/LamGC/wp-asciiplayer/actions/runs/38667731485/artifacts/11943136266)

Conclusion: the tested resource gates demonstrably prevent the intended allocation/rendering paths while preserving the ordinary fixtures. This supports proceeding to a carefully integrated fix after compatibility decisions; it does not establish that the production plugin is already fixed.
