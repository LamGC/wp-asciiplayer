# wp-asciiplayer

为 WordPress 提供原生 Asciicast Player 区块，可在编辑器内真实播放终端录屏，
同时兼容原有 `[asciiplayer]` shortcode。

## 安装与使用

将构建得到的 `wp-asciiplayer.zip` 上传到「插件 → 安装插件 → 上传插件」并启用。
GitHub 源码 ZIP 需要先构建，不能直接当发行包安装。构建方法见 [SOURCE.md](SOURCE.md)。
要求 WordPress 6.3+、PHP 7.4+；具体测试版本见仓库 CI。

插入「Asciicast Player」区块，粘贴录制文件的 HTTP(S) URL，应用后即可在编辑器内播放、
暂停和拖动。主题、速度、循环、控制栏、尺寸、起始时间和空闲压缩等选项在区块设置中调整。
保存文章或页面后，前台使用同一播放器。重新打开已有区块时点击「Load preview」加载预览；
编辑预览不会自动播放，前台自动播放设置仍会保留。

URL 必须指向录制文件（例如 `.cast`），不能直接使用分享页面地址。跨域文件需要允许
来自你站点的 CORS 请求；HTTPS 页面上的 HTTP 文件可能被浏览器阻止。优先使用同源 HTTPS。
本插件不提供远程文件代理、不扩展上传类型，也不创建额外的录屏管理文章类型。

## 旧文章兼容

原有 shortcode 继续有效，无须批量修改文章：

    [asciiplayer]https://example.org/demo.cast[/asciiplayer]
    [asciiplayer theme="monokai" speed="1.5" controls="false"]https://example.org/demo.cast[/asciiplayer]
    [asciiplayer startAt="2" idleTimeLimit="3" style="width: 80%;"]https://example.org/demo.cast[/asciiplayer]

布尔值、数值和历史 camelCase 参数会归一化处理；自定义 style 经过 WordPress 安全 CSS 过滤。
区块提供 shortcode 转换能力，转换后请检查设置再保存，不会自动重写旧文章。
经典编辑器继续使用 shortcode，暂不增加 TinyMCE 自定义界面。

## 资源与隐私

播放器 JavaScript、CSS、WebAssembly 全部本地附带，不再请求 jsDelivr，
旧 `ap_use_local_resources` 开关不再使用。没有统计追踪或后台远程 API 请求。

你选择的录制文件会由读者浏览器直接请求；外部文件主机可能收到 IP、浏览器请求信息和
依浏览器/站点策略发送的来源信息。应用 URL 或点击加载预览时，编辑器也会发起这类请求。
请使用可信主机，发布前检查录屏是否包含终端里的敏感信息。外部主机适用其自身隐私政策。

## 开发与许可

[构建与测试说明](SOURCE.md) · [第三方许可证](THIRD-PARTY-NOTICES.md)

本插件保持 GPL-3.0-only，播放器及依赖保留各自的兼容许可证。
