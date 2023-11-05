=== Asciicast Player ===
Contributors: lamgc
Tags: asciicast, asciiplayer, asciinema, ascii
Requires at least: 5.2
Tested up to: 6.2
Stable tag: 1.0.1
Requires PHP: 7.4
License: GPLv3
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Play Asciicast files in WordPress posts.

== Description ==

You can find the source code for all versions on [Github](https://github.com/LamGC/wp-asciiplayer).

This plugin helps you insert Asciicast files into the post, better presenting terminal operations to readers.

## Quick start

Add a shortcode to the post and enter the following:

```
[asciiplayer]https://asciinema.org/a/28307.cast[/asciiplayer]
```

The content of the shortcode is the URL of the ascicast file.

### Options

The AsciiPlayer shortcode supports the options supported by Asciinema-player, such as setting `fit` to `height` and closing the control bar:

```
[asciiplayer fit="height" controls="false"]https://asciinema.org/a/28307.cast[/asciiplayer]
```

You can find all available options [here](https://www.npmjs.com/package/asciinema-player#options).

> Currently, only the `logger` option is not supported because it requires an object to be passed in.

#### Style options

For the convenience of customizing player elements,
the plugin has added an additional `style` **option**,
which corresponds to the `style` **attribute** of the player container element:

```
[asciiplayer style="width: 80%;"]https://asciinema.org/a/28307.cast[/asciiplayer]
```

== Changelog ==

= 1.0.0 =
* Set the version attribute for the resource file in WordPress.
* Added some documents.

= 0.1.0 =
* The first available version.
* Update asciinema-player version to 3.4.0