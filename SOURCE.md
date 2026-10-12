# Source and reproducible build

This distribution contains the plugin's PHP and JavaScript source, block metadata,
build configuration, scripts, and npm lockfile. The development repository is
https://github.com/LamGC/wp-asciiplayer .

Use Node.js 24 (24.15 or later), npm, and the standard `zip` command:

    npm ci
    npm run build
    npm run package

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
