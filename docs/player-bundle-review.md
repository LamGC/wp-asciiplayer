# Prebuilt player dependency reachability review

Reviewed 2026-10-14 for `asciinema-player@3.17.0`. This is a static review of
specific published bytes, not an independent rebuild or a full security audit.

`scripts/vendor.mjs` copies the npm package's prebuilt browser bundle unchanged.
The root lockfile therefore does not describe all components used to build it.
The upstream dependency inventory is deliberately conservative: it includes
Seroval 1.5.0 through Solid 1.9.6, including server-only dependency paths.

## Verified artifact

The official npm package integrity is recorded in package-lock.json.

- Minified bundle SHA-256: `a13c37632e1b5c49fe9128417b9319a9b5bc64cb457dd5ae52cbba8a3aceb880`
- Readable bundle SHA-256: `4d63cfb88859f158d1eef5d8a5550861abcb7ec195fb5d684f35f6446a29fe11`

The minified hash also matches THIRD-PARTY-NOTICES.md and the installed package.

## Import and artifact evidence

1. [Player view.js](https://github.com/asciinema/asciinema-player/blob/v3.17.0/src/view.js)
   imports `render` from `solid-js/web`.
2. Solid 1.9.6's package exports select `web/dist/web.js` for the browser/default
   import. Its only external import is `solid-js`; the client `dist/solid.js`
   has no imports. Neither imports Seroval.
3. Seroval is imported by the separate `web/dist/server.js` SSR renderer,
   not the browser renderer.
4. The [Rollup configuration](https://github.com/asciinema/asciinema-player/blob/v3.17.0/rollup.config.mjs)
   creates both readable and minified IIFEs from the same intermediate ESM bundle.
   The inspected readable IIFE contains the client renderer and does not contain
   Seroval deserialization implementations.
5. Both bundles lack `Seroval`, `fromJSON`, `fromCrossJSON`, `deserialize`,
   `__SEROVAL_STREAM__`, and distinctive Seroval error/typed-array registry
   signatures. Name searches alone are not proof; they corroborate the import trace.
6. Recording/live input paths use native `JSON.parse`/`response.json`, not
   Seroval decoding.

## Advisory-specific conclusion

No reachable affected Seroval decoder was found in these browser bundle bytes:

- [GHSA-mv8w-475r-vwqw](https://github.com/advisories/GHSA-mv8w-475r-vwqw):
  affected <=1.5.2, fixed 1.5.3; requires `fromJSON` Promise-control deserialization.
- [GHSA-p6vx-979v-rg4c](https://github.com/advisories/GHSA-p6vx-979v-rg4c):
  affected >=0.12.0, <=1.6.0, fixed 1.6.2; requires `fromJSON` with plugin-produced
  callables and Promise assimilation.
- [GHSA-jp82-f5mq-hwhp](https://github.com/advisories/GHSA-jp82-f5mq-hwhp):
  affected <=1.6.2, fixed 1.6.3; requires Seroval typed-array JSON deserialization.

Seroval 1.5.0 is inside these version ranges, but the necessary decoder is absent
from this browser dependency path. Do not label the player vulnerable solely from
that inventory, or claim the entire plugin safe from this limited review.
Re-review after any player artifact or build-path change.

## Reproduction

Fetch official npm tarballs into separate directories using `npm pack --ignore-scripts`
for `asciinema-player@3.17.0`, `solid-js@1.9.6`, and `seroval@1.5.0`.
Verify both player hashes with `sha256sum`, inspect Solid's package exports and
client/server imports, and compare the readable bundle implementation against
those modules. Search both bundles for the decoder names/signatures above.
