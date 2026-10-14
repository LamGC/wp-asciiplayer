# Third-party notices

The WordPress plugin's own code is licensed under GPL-3.0-only; see the root
`LICENSE`. The third-party components below retain their respective licenses.
This file records attribution and provenance and does not replace those terms.

## asciinema-player 3.17.0

- Author: Marcin Kulik. The upstream license includes
  “Copyright 2011-2021 Marcin Kulik”.
- Upstream source: https://github.com/asciinema/asciinema-player/tree/v3.17.0
- npm package: https://www.npmjs.com/package/asciinema-player/v/3.17.0
- License: Apache-2.0. Full upstream text: `licenses/asciinema-player-LICENSE`.
- The embedded terminal implementation in `src/vt` also provides MIT and
  Apache-2.0 texts, preserved as `licenses/vt-js-LICENSE-MIT` and
  `licenses/vt-js-LICENSE-APACHE`. Its MIT notice is
  “Copyright (c) 2018 Marcin Kulik <m@ku1ik.com>”.

`scripts/vendor.mjs` copies the official npm standalone JavaScript and CSS
byte-for-byte into `build/player.js` and `build/player.css`, respectively.
It does not rebuild or modify the upstream player. The JavaScript includes
the upstream Apache-2.0 license banner and an inline WebAssembly module.

Verified SHA-256 hashes of the original npm files:

- `dist/bundle/asciinema-player.min.js`:
  `a13c37632e1b5c49fe9128417b9319a9b5bc64cb457dd5ae52cbba8a3aceb880`
- `dist/bundle/asciinema-player.css`:
  `f619fe17597043564f03b2c6918b3daf890ee8b912fb408542fba11afade4fdb`

The upstream v3.17.0 source tree contains the three license files above and
no separate NOTICE file. Recheck this when updating the player.

## JavaScript dependency notices

The following versions are from the upstream player's v3.17.0
`package-lock.json`, rather than this plugin's newer resolved installation
dependencies. Their MIT license texts, including copyright notices, are
preserved under `licenses/`.

| Package | Upstream lock version | License file |
| --- | --- | --- |
| @babel/runtime | 7.27.0 | babel-runtime-LICENSE |
| solid-js | 1.9.6 | solid-js-LICENSE |
| solid-transition-group | 0.2.3 | solid-transition-group-LICENSE |
| @solid-primitives/refs | 1.1.2 | solid-primitives-LICENSE |
| @solid-primitives/transition-group | 1.1.2 | solid-primitives-LICENSE |
| @solid-primitives/utils | 6.3.2 | solid-primitives-LICENSE |
| regenerator-runtime | 0.14.1 | regenerator-runtime-LICENSE |
| seroval | 1.5.0 | seroval-LICENSE |
| seroval-plugins | 1.3.0 | seroval-plugins-LICENSE |
| csstype | 3.1.1 | csstype-LICENSE |

This conservatively covers all non-development dependency entries in that
upstream npm lockfile. It does not assert that every package, type definition,
or function survives the upstream browser build's tree-shaking.
`licenses/upstream-npm-production-dependencies.json` records these entries.

## Rust / WebAssembly dependency notices

The following is the dependency closure of the normal dependencies declared
by `src/vt/Cargo.toml`, using the versions in upstream v3.17.0
`src/vt/Cargo.lock`. It includes compile-time macro dependencies, even where
their own runtime code is not shipped. The original lockfile is preserved as
`licenses/upstream-asciinema-player-Cargo.lock`.

For projects offering MIT as an alternative license, the MIT text is included
here. The upstream projects retain any other licensing options they offer.

| Package | Upstream lock version | Included license text |
| --- | --- | --- |
| allocator-api2 | 0.4.0 | allocator-api2-LICENSE (MIT) |
| avt | 0.16.0 | avt-LICENSE (Apache-2.0) |
| bumpalo | 3.12.0 | bumpalo-LICENSE (MIT) |
| bytemuck | 1.18.0 | bytemuck-LICENSE (MIT) |
| cfg-if | 1.0.0 | cfg-if-LICENSE (MIT) |
| itoa | 1.0.5 | itoa-LICENSE (MIT) |
| js-sys | 0.3.61 | js-sys-LICENSE (MIT) |
| lock_api | 0.4.14 | lock_api-LICENSE (MIT) |
| once_cell | 1.17.1 | once_cell-LICENSE (MIT) |
| proc-macro2 | 1.0.84 | proc-macro2-LICENSE (MIT) |
| quote | 1.0.36 | quote-LICENSE (MIT) |
| rgb | 0.8.50 | rgb-LICENSE (MIT) |
| rustversion | 1.0.22 | rustversion-LICENSE (MIT) |
| ryu | 1.0.12 | ryu-LICENSE (Apache-2.0) |
| scopeguard | 1.2.0 | scopeguard-LICENSE (MIT) |
| serde, serde_derive | 1.0.203 | serde-LICENSE (MIT) |
| serde-wasm-bindgen | 0.6.5 | serde-wasm-bindgen-LICENSE (MIT) |
| serde_json | 1.0.93 | serde_json-LICENSE (MIT) |
| syn | 2.0.66 | syn-LICENSE (MIT) |
| talc | 5.0.3 | talc-LICENSE (MIT) |
| unicode-ident | 1.0.6 | unicode-ident-MIT-LICENSE and unicode-ident-LICENSE (Unicode data terms) |
| unicode-width | 0.1.14 | unicode-width-LICENSE (MIT), unicode-width-COPYRIGHT-LICENSE |
| wasm-bindgen, wasm-bindgen-macro, wasm-bindgen-macro-support, wasm-bindgen-shared | 0.2.106 | wasm-bindgen-LICENSE (MIT) |

The `js-sys` license comes from its corresponding wasm-bindgen 0.2.84
source release. Test-only dependency branches in the upstream Rust lockfile
are not represented as shipped components.

The upstream `flake.nix` pins Rust 1.85.0, which also appears in source-path
strings in the supplied WASM. Rust's MIT and Apache-2.0 texts and copyright
inventory are preserved as `rust-1.85.0-LICENSE-MIT`,
`rust-1.85.0-LICENSE-APACHE`, and `rust-1.85.0-COPYRIGHT`.
Rust 1.85.0's library lockfile selects compiler_builtins 0.1.140; that project's
combined MIT and Apache-2.0 WITH LLVM-exception text is preserved as
`compiler-builtins-LICENSE`, with the referenced upstream compiler-rt
contributor list in `compiler-rt-CREDITS`. These compiler-runtime notices are
included conservatively; they are not a claim that every standard-library
dependency listed in Rust's source distribution is linked into this player.

## Provenance and verification limits

`licenses/SOURCES.json` identifies the source of each preserved text.
These are source-based notices for the official upstream bundle, not an
independently generated binary SBOM or a legal audit. The dependency versions
above are the upstream source lockfile entries; this plugin's build does not
resolve or rebuild that embedded Rust code. The supplied WASM independently
contains paths identifying avt 0.16.0, unicode-width 0.1.14,
serde-wasm-bindgen 0.6.5, and wasm-bindgen 0.2.106. It does not expose a complete
machine-readable inventory of all compiled dependencies.

When changing the player version or rebuilding it from source, review the
new lockfiles, actual linked components, copyright/NOTICE files, compiler
runtime, and any added dependencies; update this inventory and preserved
texts before distribution. Keep this file and the complete `licenses/`
directory in the plugin release ZIP. Source and build instructions are in
`SOURCE.md`.
