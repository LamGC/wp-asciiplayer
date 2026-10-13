=== Asciicast Player ===
Contributors: lamgc
Tags: asciicast, asciiplayer, asciinema, terminal, block
Requires at least: 6.3
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.2.0
License: GPL-3.0-only
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Play terminal recordings with a native block, real editor playback previews, and compatible shortcodes.

== Description ==

Insert an Asciicast Player block, apply a recording-file URL, and play it directly in the editor. Configure theme, speed, looping, controls, sizing, start time and idle-time limit. Existing [asciiplayer] shortcodes remain supported without rewriting your posts.

* Locally bundled asciinema-player, JavaScript, CSS and WebAssembly.
* Native block-editor controls and iframe-aware interactive preview.
* Compatible shortcode rendering in posts and pages.
* Explicit editor preview loading and clear loading/failure feedback.
* No account, analytics, remote proxy, custom post type or extra upload permissions.

The source and reproducible build instructions are included in the ZIP and available at https://github.com/LamGC/wp-asciiplayer . Third-party licenses are in THIRD-PARTY-NOTICES.md and licenses/.

= External recordings and privacy =

The plugin itself uses no external runtime service. When you choose an external recording URL, the visitor's browser requests that URL directly. The host may receive IP address, browser request metadata and a referrer according to browser/site policy. Applying a URL or loading a preview in the editor makes the same request. Choose a trusted host and consult its privacy policy. Use a same-site HTTPS recording URL to avoid third-party requests. Review terminal output for sensitive data before publishing.

== Installation ==

1. Upload the built wp-asciiplayer.zip using Plugins → Add New → Upload Plugin.
2. Activate Asciicast Player.
3. Insert an Asciicast Player block or retain your existing shortcode.

A GitHub source ZIP needs npm ci and npm run build before installation. See SOURCE.md for packaging instructions.

== Frequently Asked Questions ==

= Does it change old articles? =

No. The [asciiplayer] shortcode remains available. You can explicitly convert supported shortcodes to blocks and review them before saving.

= Why does a remote recording fail to load? =

Use a recording-file URL rather than a share-page URL. The remote server must permit cross-origin (CORS) requests. HTTPS sites may block HTTP recordings. Network errors, invalid formats or missing files can also prevent playback. The plugin does not work around these restrictions through a server proxy.

= Are player resources loaded from a CDN? =

No. The JavaScript, CSS and WebAssembly ship with the plugin. The previous ap_use_local_resources setting is no longer used.

= Is the Classic Editor supported? =

Existing shortcodes work in the Classic Editor. The new visual controls and inline playback preview are for the block editor.

== Changelog ==

= 1.2.0 =
* Add responsive display-width presets/custom lengths, left/center/right placement and captions.
* Preserve recorded terminal dimensions and resize events by default; expose optional row/column overrides.
* Isolate terminal typography and frames from common host-theme code-block styles.
* Add a local static block-inserter preview without recording requests.

= 1.1.0 =
* Add a native block with typed controls and interactive, iframe-aware preview.
* Preserve shortcode support and normalize historical parameter names and types.
* Escape output, constrain recording URLs, and filter custom styles.
* Bundle player 3.17.0 locally and add reproducible build/install ZIP tooling.
* Improve asset loading for posts, pages and render-time shortcode use.
* Add unit and real WordPress browser integration tests.

= 1.0.0 =
* Set the version attribute for resource files and add documentation.

= 0.1.0 =
* First available version; asciinema-player 3.4.0.
