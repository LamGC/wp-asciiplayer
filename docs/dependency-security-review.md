# Dependency security review

Reviewed 2026-10-14 against the main-branch lockfile and fresh npm audit. Baseline: **44 affected package records (2 critical, 19 high, 20 moderate, 3 low), representing 15 distinct advisories**. The package-record count includes vulnerable packages and their affected parents; it is not 44 distinct security defects. All mapped paths originate in development dependencies. The final production-only root-lock audit reports zero findings; the separately vendored browser player is assessed in [player-bundle-review.md](player-bundle-review.md).

## Implemented narrow changes

Retain the current WordPress parent packages: npm registry reports `@wordpress/env@11.17.0` and `@wordpress/scripts@36.1.0` as current latest. This change uses scoped overrides:

```json
{
  "copy-webpack-plugin": { "serialize-javascript": "7.0.5" },
  "markdownlint-cli": { "js-yaml": "5.4.3", "smol-toml": "1.9.1" },
  "simple-git": { "@simple-git/argv-parser": "2.0.1" }
}
```

- `serialize-javascript`: the current `copy-webpack-plugin@10.2.4` calls the CommonJS serializer for cache keys. Version 7 retains that callable CommonJS API. Its major-version requirement is Node >=20, already satisfied by this project. Isolated serialization smoke tests passed. Upgrading the entire plugin to 14 would be a larger, unnecessary compatibility change. [v7 release](https://github.com/yahoo/serialize-javascript/releases/tag/v7.0.0)
- `js-yaml`: 5.4.1 is the minimum patched version; 5.4.3 is the latest verified patch. Scope it to `markdownlint-cli`; that package pins `~5.2.1`. Do not override js-yaml globally: wp-env still calls `yaml.safeLoad`, which is unavailable in modern majors. The separate wp-env -> js-yaml 3 -> argparse 1 -> sprintf-js path remains.
- `smol-toml`: 1.9.0 is the minimum patched version; 1.9.1 is the latest verified patch. Scope it to markdownlint-cli, which pins `~1.7.0`. The CommonJS parse API works and the null-prototype result matches the installed older version.
- `qs`: 6.16.0 fixes both findings. **Prefer the in-range Express 4.22.2 -> 4.22.3 update**, because official metadata confirms 4.22.3 pins qs `~6.16.0`. If lockfile regeneration cannot resolve that parent update, a scoped `express -> qs: 6.16.0` override is a fallback. Avoid a disruptive Express 5 migration. The existing body-parser path already has 6.16.0.
- `@simple-git/argv-parser`: the scoped 2.0.1 override is a partial mitigation only, with targeted no-execution tests. Preserve and document remaining simple-git alerts; details below.

These recommendations were based on official npm metadata, published tarballs, source inspection, and small isolated API smoke tests. Local build, 41 JS tests and packaging pass on Node 24.18.0. CI covers PHP 7.4/8.3 and real WordPress 6.3/PHP 7.4 and latest/PHP 8.2 integration.

## Critical simple-git findings: migration blocker

Path: `@wordpress/env@11.17.0 -> simple-git@3.36.0 -> @simple-git/argv-parser@1.1.1`.

**Do not directly override simple-git to v4.** v4 removes the callable CommonJS default export and requires `const { simpleGit } = require('simple-git')`. wp-env currently uses `const SimpleGit = require('simple-git')` and then calls it in both `lib/download-sources.js` and `lib/runtime/docker/download-wp-phpunit.js`. A direct v4 override would fail during Git source/PHPUnit downloads. [Official v4 breaking changes](https://github.com/steveukx/git-js/releases/tag/simple-git@4.0.0)

The fully patched latest combination is simple-git **4.0.2**, which pins argv-parser **2.0.1**. Note that simple-git 4.0.1 pins parser 2.0.0, so it does not by itself clear the VISUAL finding.

A scoped parser-only override to 2.0.1 is included as a **partial mitigation**, with regression tests of the CommonJS API and rejected unsafe inputs. The `vulnerabilityCheck(tokens, env)` signature is unchanged, and isolated simple-git 3.36.0 with parser 2.0.1 passed read-only `checkIsRepo('root')`, `raw('rev-parse', '--show-toplevel')`, and `status()` checks. Parser checks rejected VISUAL, trailer command configuration, and include.path. However, `--receive-p` still produced no finding in that parser-only combination, and version-based simple-git advisories remain. This is not a complete fix and has not been validated through all wp-env Docker/download flows. It is reasonable to include the scoped parser override with the focused regressions while explicitly retaining the residual alerts; a full fix still needs a reviewed wp-env migration.

The examined wp-env call sites use clone/fetch/checkout/reset and fixed sparse-checkout commands; no commit, rebase, interpret-trailers, push, or explicit `.env()` calls were observed in these files. This reduces reachability of the reported flows for ordinary trusted wp-env use, but does not establish that the vulnerable dependency is harmless. Keep development configuration, Git arguments, environment values and source URLs trusted; do not run these tools on attacker-controlled configuration with privileged credentials.

## Advisory matrix

Ranges below are the audit's affected ranges and GitHub Advisory Database's patched versions. Registry availability was checked on the review date.

| Package / baseline | Advisory | Affected range | First patched version | Decision |
|---|---|---|---|---|
| @simple-git/argv-parser 1.1.1 | [VISUAL editor bypass](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) | <2.0.1 | 2.0.1 | Parser 2.0.1 removes this finding; simple-git mitigation remains incomplete overall |
| simple-git 3.36.0 | [Trailer command configuration](https://github.com/advisories/GHSA-x6jw-m9v5-85vh) | >=3.15.0 <4.0.1 | 4.0.1 | v4 is not drop-in for wp-env |
| simple-git 3.36.0 | [Git configuration includes](https://github.com/advisories/GHSA-g4wm-2vf7-vfgr) | <=3.36.0 | 4.0.0 | Same migration blocker |
| simple-git 3.36.0 | [Long-option abbreviation bypass](https://github.com/advisories/GHSA-858h-whjf-mvg5) | <=3.36.0 | 4.0.0 | Parser-only override does not fix this path |
| serialize-javascript 6.0.2 | [RegExp/Date code injection](https://github.com/advisories/GHSA-5c6j-r48x-rmvq) | <=7.0.2 | 7.0.3 | Scoped 7.0.5 clears both findings |
| serialize-javascript 6.0.2 | [Array-like object CPU exhaustion](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v) | >=5.0.0 <7.0.5 | 7.0.5 | Scoped 7.0.5 |
| braces 3.0.3 | [Deep nesting stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | <=3.0.3 | None | Latest published version still affected; trusted build globs only |
| js-yaml 5.2.3 | [Empty merge source CPU exhaustion](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) | >=5.0.0 <=5.4.0 | 5.4.1 | Scoped 5.4.3 under markdownlint-cli |
| smol-toml 1.7.2 | [Quadratic key parsing](https://github.com/advisories/GHSA-r4xh-jqrq-34v2) | <=1.8.0 | 1.9.0 | Scoped 1.9.1 |
| sprintf-js 1.0.3 | [Unbounded precision DoS](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | <=1.1.3 | None | Latest published version still affected; wp-env parent migration needed |
| qs 6.15.3 | [Array-limit bypass](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | >=6.14.2 <=6.15.3 | 6.16.0 | Express 4.22.3 / qs 6.16.0 |
| qs 6.15.3 | [Attacker-controlled isBuffer](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | >=2.2.5 <6.16.0 | 6.16.0 | Scoped 6.16.0 |
| postcss-selector-parser 6.1.4 | [Flat selector CPU exhaustion](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | <7.1.6 | 7.1.6 | Requires v6 -> v7 range override or parent migration; defer pending CSS-specific regression tests |
| uuid 8.3.2 | [Missing output buffer checks](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | <11.1.1 (installed line) | 11.1.1 | Cross-major candidate; sockjs only calls v4(), not the affected v3/v5/v6 APIs |
| katex 0.16.47 | [Prototype pollution trust bypass](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | >=0.11.0 <0.18.2 | 0.18.2 | 0.x minor-range migration; defer pending markdown math regression validation |

The KaTeX advisory range is from the fresh npm audit. Its GitHub advisory page could not be retrieved during this pass; registry 0.18.2 was downloaded and its rendering API smoke-tested. The fix boundary is inferred from the audit range rather than independently confirmed from that advisory page.

## Paths behind remaining package records

- braces: scripts -> fast-glob -> micromatch -> braces; also transitively affects copy-webpack-plugin, stylelint-family tooling, webpack-dev-server's chokidar and http-proxy-middleware paths. No patched braces release is available, despite some propagated `fixAvailable: true` flags in npm audit.
- postcss-selector-parser: scripts -> cssnano 6.1.2 -> cssnano-preset-default 6.1.2 -> postcss-calc 9.0.1, postcss-merge-rules 6.1.1, postcss-minify-selectors 6.0.4, postcss-unique-selectors 6.0.4, or postcss-merge-longhand 6.0.5 -> stylehacks 6.1.1. Each currently resolves a nested parser 6.1.4. The hoisted parser 7.1.6 is already patched. v7's notable breaking behavior is safe insertion during iteration; avoid a blind global replacement. The advisory explicitly excludes ordinary build-time parsing of trusted source CSS from exposed request-path scenarios. [v7 release](https://github.com/postcss/postcss-selector-parser/releases/tag/v7.0.0)
- sprintf-js: env -> js-yaml 3.15.2 -> argparse 1.0.10 -> sprintf-js 1.0.3. Updating sprintf-js to its latest 1.1.3 does not fix the advisory. Updating js-yaml globally breaks wp-env's safeLoad call.
- uuid: scripts -> webpack-dev-server 5.2.6 -> sockjs 0.3.24 -> uuid 8.3.2. Source inspection finds `require('uuid').v4` and `uuidv4()` only. A scoped uuid11.1.1 override retains CommonJS and passed v4()/validate() smoke testing, but it remains outside sockjs's supported ^8 range. Do not choose uuid12+ blindly because of later module-format changes.
- KaTeX: scripts -> markdownlint-cli 0.49.1 -> markdownlint 0.41.1 -> micromark-extension-math 3.1.0 -> katex 0.16.47. Minimum nonaffected release 0.18.2 exposes renderToString and passed a basic rendering smoke test, but is outside micromark's ^0.16 range.
- qs (recommended fix): env -> @wp-playground/cli 3.1.57 -> express 4.22.2 -> qs 6.15.3; shared Express is also used by webpack-dev-server.
- serialize-javascript (recommended fix): scripts -> copy-webpack-plugin 10.2.4 -> serialize-javascript 6.0.2.

## Engine consistency

The existing Playground/PHP-WASM 3.1.57 tree requires Node >=24.18.0 and npm >=11.16.0. `@wordpress/scripts@36.1.0` accepts Node `^22.22.2 || ^24.15.0 || >=26.0.0`, so the intersection is **`^24.18.0 || >=26.0.0`**, not plain >=24.18.0 (which would misleadingly include Node 25). Use npm >=11.16.0 and test the supported minimum in CI. The build and tests were rerun on Node 24.18.0 with npm 11.19.0. CI pins these versions. Node 26 is admitted by dependency engine declarations but has not been separately exercised here.

## Verification checklist

1. Regenerate the lockfile without force and inspect that only intended subtree changes occur.
2. Run `npm ci`, build, JS tests, PHP tests where supported, and release packaging.
3. Validate markdownlint YAML and TOML configuration loading after its minor-range overrides.
4. Run final `npm audit --json` and `npm audit --omit=dev --json`; describe residuals honestly, including the critical simple-git findings.
5. Track wp-env's simple-git v4 migration and braces/sprintf-js upstream releases. Do not suppress remaining advisories merely to make the report green.

## Final audit snapshot

After these changes, npm 11.19.0 reports **39 affected package records**
(1 critical, 20 high, 14 moderate, 4 low), representing **8 distinct advisories**,
versus 15 distinct advisories in the initial snapshot. Counts can change as the
registry advisory database changes; do not equate affected parents with unique flaws.
The remaining advisory packages are braces, KaTeX, postcss-selector-parser,
simple-git (three advisories), sprintf-js and uuid. No advisory is suppressed.

`npm audit --omit=dev --json` reports zero findings for the root production lock.
This does not certify arbitrary bundled code or establish a complete security audit.
Do not run development servers or wp-env against untrusted configurations or
source URLs, or expose development services publicly. A full simple-git fix
needs a compatible wp-env migration; the parser override is not a complete fix.
