=== Asciicast Player ===
Contributors: lamgc
Tags: asciicast, asciiplayer, asciinema, terminal, block
Requires at least: 6.3
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0-dev
License: GPL-3.0-only
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Play terminal recordings with a native block, real editor playback previews, and compatible shortcodes.

== Description ==

Insert an Asciicast Player block, apply a recording-file URL, and play it directly in the editor. Configure theme, speed, looping, controls, sizing, start time and idle-time limit. Existing [asciiplayer] shortcodes remain supported without rewriting your posts.

* Locally bundled asciinema-player, JavaScript, CSS and WebAssembly.
* Native block-editor controls and iframe-aware interactive preview.
* Compatible shortcode rendering in posts and pages.
* Automatic preview loading for valid URLs, debounced editing, and clear loading/failure feedback.
* Media Library selection and validated .cast uploads using existing WordPress upload permissions.
* No account, analytics, remote proxy, custom post type or extra upload capabilities.

The source and reproducible build instructions are included in the ZIP and available at https://github.com/LamGC/wp-asciiplayer . Third-party licenses are in THIRD-PARTY-NOTICES.md and licenses/.

= External recordings and privacy =

The plugin itself uses no external runtime service. When you choose an external recording URL, the visitor's browser requests that URL directly. The host may receive IP address, browser request metadata and a referrer according to browser/site policy. A valid URL automatically loads the editor preview and makes the same request, including when reopening a saved block. Choose a trusted host and consult its privacy policy. Use a same-site HTTPS recording URL to avoid third-party requests. Review terminal output for sensitive data before publishing.

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

= What recording limits apply? =

Uploads and browser playback, including remote files, are bounded to 32 MiB (v1: 2 MiB), 100,000 events or stream lines, 256 KiB per JSONL line, 1,000 markers, 1,000 columns/rows per axis and 40,000 terminal cells. Initial dimensions, resize events and effective overrides are checked. JSON nesting and structure are checked before decoding. Existing files/posts are not rewritten; unusually large recordings may need splitting or simplification. The browser validates one request before playback, without an extra metadata request or a server proxy.

= Are player resources loaded from a CDN? =

No. The JavaScript, CSS and WebAssembly ship with the plugin. The previous ap_use_local_resources setting is no longer used.

= Is the Classic Editor supported? =

Existing shortcodes work in the Classic Editor. The new visual controls and inline playback preview are for the block editor.

= Which languages are included? =

English (en_US fallback) and Simplified Chinese (zh_CN) are bundled and work offline. Plugin-owned editor controls follow the WordPress user language; public pages follow the site language. Set these in Users > Profile and Settings > General. Other Chinese locales, including zh_TW, are not mapped to zh_CN. Recording output and author captions are never translated. The upstream player's own controls and help remain English.
