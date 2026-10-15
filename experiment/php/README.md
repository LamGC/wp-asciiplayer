# Native PHP allocation experiment (not production code)

Run from an unchanged plugin checkout, with this directory copied to `experiment/php`:

    php -d memory_limit=128M experiment/php/run.php /repo /results

Requires native PHP 7.4+ CLI with `proc_open`; no Python, Composer, network, or downloaded dependency is needed. Run separately under PHP 7.4 and 8.3. `/repo` is the checkout root, `/results` a writable artifact directory. A readonly checkout is supported. The controller creates only temporary data under the system temporary directory and raw outputs plus `results.json` under the specified results directory.

Suggested isolation: official `php:7.4-cli` / `php:8.3-cli` Docker images, network disabled, 512 MiB container memory, read-only root, writable 256 MiB `/tmp` tmpfs, checkout mounted `/repo:ro`, result directory mounted `/results:rw`.

Each measurement launches a fresh native PHP subprocess with `memory_limit=128M` and a 20-second controller watchdog. Synthetic fixtures stay below the existing 2 MiB v1 cap. No large fixtures are checked in. The controller compares baseline and gated validation, asserts expected acceptance/rejection and rejection positions, and requires >50% lower PHP tracked peak on both deliberately wide rejected shapes. It records exact PHP version, integer size, bytes, tracked/allocated peaks, timings, and whether decode was reached. Runtime failure, unexpected validity, insufficient reduction, or regression-test failure makes the controller exit nonzero.

The original suite (229 assertions without build/runtime.asset.php, 233 with it) runs on a temporary copy, first unchanged and then with the experimental gate injected at the start of `is_cast_v1`. All production sources remain unchanged. Thirteen focused scanner assertions also run.

The gate is a lexical budget check, not a JSON validator. It respects strings/backslash escapes without constructing a token array. Limits are experimental (100,016 containers, 400,000 scalar/key tokens, depth 15), intentionally admitting 100,000 minimal frames. Existing byte limits and downstream JSON/schema validation remain necessary. Large previously valid metadata can now be rejected, and legal 100,000-frame recordings still allocate substantial memory. CI results do not establish production WordPress memory headroom or concurrent-request safety. Timing is recorded but no speedup is promised.

All child stdout/stderr is saved, including on failure. The machine-readable summary is `/results/results.json`. Local syntax/measurement checks use WASM only; success of native CLI orchestration must be established by CI.
