# Source and reproducible build

This distribution contains the plugin's PHP and JavaScript source, block metadata,
build configuration, scripts, and npm lockfile. The development repository is
https://github.com/LamGC/wp-asciiplayer .

Use Node.js 24.18+ (24.x) or 26+, npm 11.16+, and the standard `zip` command:

    npm ci
    npm run build
    npm run package

Node.js 22 and 25 are not supported by the complete development toolchain.
The Node requirement is for building/testing only; the plugin still supports
WordPress 6.3 and PHP 7.4.

The installable output is `dist/wp-asciiplayer.zip`. Generated assets are never
loaded from a CDN. `scripts/vendor.mjs` copies the pinned official npm
`asciinema-player@3.17.0` distribution, verified by package-lock integrity, into
`build/player.js` and `build/player.css`. WordPress-provided JavaScript packages
are externalized by @wordpress/scripts, not bundled with a second React.

The upstream player's corresponding source and build instructions are at
https://github.com/asciinema/asciinema-player/tree/v3.17.0 . Its JavaScript bundle
includes the upstream terminal WebAssembly implementation. Third-party notices
and applicable license texts are included alongside this file.

Development tests require the full repository (tests are not in the install ZIP):

    npm test
    npm run test:php
    npm run wp-env -- start
    npm run test:e2e

PHP tests require a PHP runtime. WordPress integration tests require Docker and
Chromium; the repository CI records the exact WordPress version under test and
installs the release ZIP into the test site before checking it. Refer to the
workflow for setup details. Running a unit test is not a substitute for the
WordPress browser integration suite.

## Translation maintenance

The English gettext strings are the fallback. Edit `languages/wp-asciiplayer-zh_CN.po`
to maintain Simplified Chinese; `npm run i18n` extracts the current static PHP/JS
and block-metadata strings into the POT and compiles the MO and WordPress Jed JSON.
`npm run i18n:check` fails for missing/fuzzy translations, stale generated files,
unsupported plural extraction, and mismatched printf placeholders. Build runs
compilation and tests check it reproducibly, without a network service or timestamps.
For new strings, run `node scripts/i18n.mjs --pot-only`, merge into the maintained
PO with a gettext editor, translate, and run `npm run i18n` again.

JSON files use WordPress's supported domain-locale-script-handle names for the
actual `lamgc-asciiplayer-editor` and `lamgc-asciiplayer-view` handles. The editor
bundle has no lazy translated chunks. `wp_set_script_translations` registers both
paths after scripts; PHP registers `load_plugin_textdomain` during `init`, before
block metadata is translated. The generated assets and all catalogs are packaged.
The upstream vendor bundle is byte-for-byte unchanged and its own controls remain
English. Runtime JS/CSS versions use build content hashes even though the preview
package version stays `1.1.0-dev`.

References:
- https://developer.wordpress.org/reference/functions/wp_set_script_translations/
- https://developer.wordpress.org/reference/functions/load_script_textdomain/
- https://developer.wordpress.org/reference/functions/load_plugin_textdomain/
