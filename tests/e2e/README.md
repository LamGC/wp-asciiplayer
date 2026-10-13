# Real WordPress browser integration

These tests run Chromium against WordPress itself. They do not replace WordPress,
PHP rendering, the editor iframe, the media parser, or the player with static mocks.
Recording files are small local fixtures; playback does not depend on a public CDN.

## Run locally (Docker)

Use Node 24 and Docker, then run from the repository root:

```sh
npm ci
npm run build
npm test
npm run package
npm run wp-env -- start
npm run wp-env -- run cli wp plugin install /var/www/html/wp-content/asciiplayer-packages/wp-asciiplayer.zip --activate --force
npx --no-install playwright install chromium
npm run test:e2e
npm run wp-env -- stop
```

The default site is http://localhost:8888 with wp-env's development-only account
`admin` / `password`. Never use these credentials on a public site. `WP_BASE_URL`,
`WP_USERNAME` and `WP_PASSWORD` can override browser-test settings. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an already-installed Chromium binary.

The plugin's source tree is deliberately not mounted as an active plugin in the
committed wp-env configuration. The build ZIP is installed into WordPress through
WP-CLI, so missing package files cause a real integration failure. Fixtures are
mapped under uploads; the package directory is mapped separately for WP-CLI.

## Coverage

- A real iframe editor loads and plays the real local player after applying a URL
- The iframe player actually plays; Space pauses/resumes it and resizing stays inside the canvas
- An inspector speed/theme change rebuilds the player without duplicate instances
- Duplicate, delete, undo, save, reload, and front-end playback preserve the block
- Posts and Pages work, including a mobile-width published Page
- Multiple legacy shortcodes preserve false booleans, hidden controls, and camelCase options
- HTTP 404, malformed asciicast, and an actual no-CORS second origin recover after a valid URL
- Actual terminal output proves successful front-end parsing/playback
- Editor and front-end requests must not load plugin assets from jsDelivr

The preview automatically loads valid saved URLs and debounces typed changes.
Tests check the request count, stale-response cleanup, immediate Apply, error
retry, and no requests for empty/invalid URLs or static inserter examples.
Floating-toolbar dimension controls are checked against the collapsed sidebar,
including keyboard focus, Escape/close/reopen, and shared attribute values.

## CI evidence and limits

GitHub Actions checks the minimum WordPress 6.3 / PHP 7.4 combination and the latest
stable WordPress / PHP 8.2. It logs the actual core version, installs the ZIP, and
retains screenshots, failure traces/video, WordPress logs, and the package. A
separate job checks PHP 7.4 and 8.3 syntax and focused regression tests.

Latest WordPress also runs Plugin Check and retains its report as an advisory
step. Advisory output is not a passing directory review. Review any findings
before submission, and do not interpret a green browser job as marketplace
approval. Tests do not cover every browser, theme, or third-party plugin.

WordPress Playground is also usable for local smoke tests when Docker is absent,
but its SQLite/PHP-WASM runtime is additional evidence, not a substitute for the
Docker/MySQL matrix above.

References:
- https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/
- https://developer.wordpress.org/block-editor/reference-guides/block-api/block-api-versions/block-migration-for-iframe-editor-compatibility/
- https://github.com/WordPress/plugin-check/blob/trunk/docs/CLI.md
