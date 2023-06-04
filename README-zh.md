# wp-asciiplayer

把 AsciiCast 添加到你的文章！

## 快速开始

在文章中添加一个简码，然后输入以下内容：

```
[asciiplayer]https://asciinema.org/a/28307.cast[/asciiplayer]
```

简码的内容为 asciicast 文件的 URL。

### 选项

AsciiPlayer 简码支持 asciinema-player 所支持的选项，例如设置 `fit` 为 `height` 并关闭控制栏：

```
[asciiplayer fit="height" controls="false"]https://asciinema.org/a/28307.cast[/asciiplayer]
```

你可以在[这里](https://www.npmjs.com/package/asciinema-player#options)找到所有可用的选项。

> 目前只有 `logger` 选项不受支持，因为这个选项需要传入一个对象。

#### 样式选项

为了方便自定义播放器元素，插件额外添加了 `style` 选项，该选项会直接控制 Asciinema-player 容器元素的样式：

```
[asciiplayer style="width: 80%;"]https://asciinema.org/a/28307.cast[/asciiplayer]
```
