# wp-asciiplayer

An Asciicast Player block for WordPress, with real playback in the editor and
backwards-compatible `[asciiplayer]` shortcodes. [中文说明](README-zh.md)

## Install

Install the built `wp-asciiplayer.zip` through **Plugins → Add New → Upload
Plugin**, then activate **Asciicast Player**. A GitHub source ZIP must be built
first; it does not contain generated assets. See [SOURCE.md](SOURCE.md).

Requires WordPress 6.3+ and PHP 7.4+. Compatibility must be checked against your
site and theme; CI tests the versions listed in `.github/workflows/ci.yml`.

## Block editor

1. Insert **Asciicast Player**.
2. Paste an HTTP(S) recording-file URL (for example a `.cast` file), then apply it.
3. Play, pause and seek in the editor. **Display** offers width presets or a custom
   CSS length (for example `480px` or `65%`), plus left/center/right alignment.
   The width stays within the available space. Add a caption below the player.
4. **Terminal size** is separate: leave Columns and Rows blank to use the cast
   file's dimensions and recorded resize events. Override either axis only when
   intentional; use **Use recording size** to clear both. Display width and
   `fit: width` scale the existing grid without changing terminal columns.
5. Change theme, speed, looping, controls, fit, start time and idle-time limit
   from the remaining block settings.
6. Save the post or page; the same locally bundled player is used on the front end.

Existing saved blocks show a **Load preview** action on reopening the editor.
This keeps external recordings from loading until you choose to preview them.
Preview does not autoplay even when front-end autoplay is enabled.
The inserter preview is a local static example and never loads a recording.

Terminal typography is scoped against common theme `pre`/`span` styles so
character scaling stays aligned with the player grid. A theme with additional
custom rules may still require compatibility testing; keyboard focus indicators
remain visible.

The source must be a recording-file URL, not an asciinema share-page URL.
A recording on another origin must allow CORS requests from your WordPress site.
HTTP recordings on an HTTPS site may be blocked as mixed content. Use a same-site
HTTPS URL when possible. The plugin does not proxy or copy remote files, grant
new upload types, or add a recording-management post type.

## Existing shortcodes

Old articles remain supported; no content migration is required:

    [asciiplayer]https://example.org/demo.cast[/asciiplayer]
    [asciiplayer theme="monokai" speed="1.5" controls="false"]https://example.org/demo.cast[/asciiplayer]
    [asciiplayer startAt="2" idleTimeLimit="3" style="width: 80%;"]https://example.org/demo.cast[/asciiplayer]

Boolean and numeric options are typed, and historical camelCase options are
normalized after WordPress lowercases shortcode attribute names. Inline styles
are filtered through WordPress safe-CSS handling; unsafe protocols and markup
are rejected/escaped. Unsupported executable/object options are not accepted.
The Classic Editor continues to support shortcodes; it has no custom visual UI.
The block supports a shortcode-to-block transform for supported options. Review
converted settings before saving; articles are never rewritten automatically.

## Local resources and privacy

All player JavaScript, CSS, and WebAssembly are included in the plugin. The old
`ap_use_local_resources` switch is no longer used, and jsDelivr is not contacted.
No analytics or background remote API calls are added.

A recording URL you choose is fetched directly by the visitor's browser. Its host
can receive the visitor's IP address, browser request metadata and possibly a
referrer, according to browser/site policy. Editor previews have the same effect
when you apply a URL or click **Load preview**. Choose a trusted host and review
recordings for sensitive terminal output before publishing them. The host's own
privacy policy applies; the plugin cannot make an external recording private.

## Development

See [SOURCE.md](SOURCE.md) for locked build and ZIP packaging commands. Source
code is GPL-3.0-only. The player and its dependencies retain their own compatible
licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
