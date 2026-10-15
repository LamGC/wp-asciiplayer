# wp-asciiplayer

Play terminal recordings in WordPress posts and pages. Add an **Asciicast Player**
block to preview the recording while you edit, or keep using the `[asciiplayer]`
shortcode in existing posts.

[中文说明](README-zh.md)

## Install

Requires **WordPress 6.3+** and **PHP 7.4+**.

1. Upload the built `wp-asciiplayer.zip` through **Plugins → Add New → Upload Plugin**.
2. Activate **Asciicast Player**.

A GitHub source ZIP needs to be built before you can install it. See the
[build instructions](SOURCE.md). The [CI workflow](.github/workflows/ci.yml)
lists the combinations we test; check the plugin with your own theme too.

## Add a recording

1. Insert an **Asciicast Player** block.
2. Paste a recording-file URL, or click **Choose recording** to select or upload a
   `.cast` file from the Media Library.
3. The preview loads about half a second after you stop typing. Click **Apply URL**
   to load it immediately, then play, pause or seek through the recording.
4. Use **Display** to set the width and alignment. You can choose a preset or enter
   a CSS length such as `480px` or `65%`. Add a caption below the player.
5. Adjust the theme, speed, looping, controls, fit, start time and idle-time limit
   in the block settings, then save your post or page.

Saved recordings load again when you reopen the editor. Previews do not autoplay,
even if you enable autoplay for the published page. Empty or invalid URLs do not
start a request. The block inserter uses a static example, so it does not fetch a
recording either.

### Display width and terminal size

The display width controls how much space the player takes on the page. It stays
within the available width. Changing it, or using `fit: width`, scales the picture
without changing the terminal's columns and rows.

Leave **Columns** and **Rows** empty to use the recording's dimensions and resize
events. To override them, use **Terminal size** in the block toolbar or sidebar;
both controls update the same settings. **Use recording size** clears the overrides.

After loading, the empty fields show the recording's original dimensions as hints.
Changing the URL updates those hints but keeps any values you entered. The hints
come from the first 64 KiB of the preview response; if they cannot be read, the
fields keep a generic placeholder. Later resize events do not change the hints.

The player includes styles to keep terminal text aligned and keyboard focus
visible. Some themes may still need CSS adjustments. Playback tips and recording
privacy information are in the sidebar's **Help** panel.

### Recording URLs

Use an HTTP(S) URL that points to the recording file, not an asciinema share page.
A file hosted on another domain must allow CORS requests from your site. Browsers
may block HTTP recordings on HTTPS pages; a same-site HTTPS URL is the simplest
option. The plugin does not proxy or copy remote files.

## Existing shortcodes

Existing posts keep working without a content migration:

```text
[asciiplayer]https://example.org/demo.cast[/asciiplayer]
[asciiplayer theme="monokai" speed="1.5" controls="false"]https://example.org/demo.cast[/asciiplayer]
[asciiplayer startAt="2" idleTimeLimit="3" style="width: 80%;"]https://example.org/demo.cast[/asciiplayer]
```

Boolean, numeric and older camelCase options are handled automatically. Inline
styles go through WordPress's safe-CSS filter; unsafe URLs, markup and executable
or object-valued options are not accepted.

You can convert supported shortcodes into blocks. Check the settings before
saving; the plugin never rewrites old posts automatically. The Classic Editor
supports shortcodes, but has no custom player-editing interface.

## Media Library uploads

You can upload `.cast` files if your account already has WordPress's `upload_files`
permission. Multisite networks must also allow the `cast` extension. The plugin
does not grant extra upload permissions or add a separate recording-management
post type.

Uploads and browser playback (including remote recordings) use the same resource limits:

- **32 MiB** of received recording data; **2 MiB** for legacy v1.
- **100,000** events or stream lines, including ignored lines.
- **256 KiB** per JSONL line and **1,000** marker events.
- **1,000** columns or rows per axis, and **40,000** terminal cells (columns × rows).
- At most **15** nested JSON containers, **400,000** scalar/key tokens and **100,016** containers in v1, or **20,000** scalar/key tokens per JSONL line, checked before decoding. Unknown metadata and duplicate keys count too.
- Browser requests stop after **30 seconds** total or **10 seconds** without the next response/chunk; the editor also allows 30 seconds for player assets and loading together.

The cell budget covers initial dimensions and every resize, including effective
Columns/Rows overrides. Overrides are also checked against the player's initial
80×24 defaults before creating its terminal, so a single-axis override must fit
both the initial terminal and the recording. A zero header dimension uses the player's default;
ordinary blank/comment lines and safe unknown event types remain compatible.
Asciicast v2 and v3 use JSONL; legacy v1 remains supported within its smaller limit.
Lower site or server upload limits still apply. Invalid recordings are rejected;
this does not enable general JSON, HTML or SVG uploads.

These limits also apply to older or externally hosted recordings at playback.
Very large terminals or marker-heavy recordings that previously loaded may now
show a clear limit error. Split or simplify those recordings rather than relying
on the browser to handle unlimited data. Existing files and posts are not rewritten.

The browser reads and validates a single recording request before handing it to
the player. There is no server proxy or additional metadata request. A timed-out
or canceled load is stopped; switching recordings and leaving a preview cancel
its old request. Remote hosts must still allow CORS, and browser credentials and
referrer rules are unchanged.

## Languages

The plugin's interface includes English and Simplified Chinese (`zh_CN`).

- In the editor, choose **Users → Profile → Language**, or use the site default.
- On public pages, the language follows **Settings → General → Site Language**.

Translations are included in the ZIP and work offline. English is the fallback;
there is no separate `en_US` catalog. Other Chinese locales, including `zh_TW`, are
not automatically mapped to Simplified Chinese.

Recorded terminal output and your captions are unchanged. The bundled player's
own playback controls and help remain in English; its files are kept as supplied
by the upstream project.

## Resources and privacy

The player’s JavaScript, CSS and WebAssembly are bundled locally. The plugin does
not contact jsDelivr, add analytics or make background remote API calls. The old
`ap_use_local_resources` option is no longer used.

Recordings are different: visitors' browsers fetch the URL you choose directly.
An external host may receive their IP address, browser request details and a
referrer, depending on browser and site settings. Editor previews make the same
request whenever a valid URL loads, including when you reopen a saved block.

Use a trusted host and check recordings for sensitive terminal output before
publishing. The host's privacy policy applies; the plugin cannot make an external
recording private.

## Build and license

See [SOURCE.md](SOURCE.md) for build, test and ZIP packaging commands.

The plugin is GPL-3.0-only. The player and its dependencies keep their own
compatible licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
