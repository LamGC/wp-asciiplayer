# wp-asciiplayer

Play Ascicast files in the post!

[中文文档](README-zh.md)

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
