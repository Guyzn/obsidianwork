# ObsidianWork 图标

基底沿用 **Obsidian 官方三瓣花形**（取自 `https://obsidian.md/favicon.svg`，墨盒经实测后重定位），
改动集中在配色、容器与质感，不动形状本身——所以远看仍是 Obsidian 的血统，近看是 ObsidianWork 自己的东西。

## 文件

| 文件 | 用途 |
|---|---|
| `icon.svg` | 主图标 1024×1024。**朱砂墨夜**：墨色 squircle + 朱砂三瓣 |
| `icon-alt-amethyst.svg` | 备选配色。**紫晶纸夜**：Obsidian 紫渐变 squircle + 纸白三瓣 |
| `icon-tiny.svg` | ≤32px 专用。瓣间缝隙加粗，避免小尺寸糊成一团 |
| `icon.icns` | macOS 应用图标，含 16→1024 全尺寸（`iconutil` 生成，10 个成员） |
| `../web/favicon.svg` `favicon-16/32/48.png` | 浏览器页签 |
| `../web/apple-touch-icon.png` | iOS 主屏（180px） |
| `../web/icon-192.png` `icon-512.png` | PWA / Android |
| `../web/app-icon.svg` | 侧栏品牌标记（= `icon-tiny.svg`） |
| `banner.svg` / `banner-2560.png` | README 横幅，与图标同色板同网格 |

## 设计参数

**容器**：macOS squircle，超椭圆 `|x/a|^5 + |y/b|^5 = 1` 满幅 1024，连续圆角无折点——
普通 `border-radius` 在四角会显得过圆，Apple 的连续圆角必须用超椭圆近似。
底色纵向微渐变（`#3A342C → #1E1A14`），上端 5.5% 白受光，下端 24% 黑压深，
做出「实体」感。这两层是原生图标与网页方图的差别所在。

**标记**：Obsidian 三瓣原样保留，仅重着色。长边占图标 66%（实测墨盒宽高比 0.776，
故为宽 60% / 高 85%）。`icon-tiny.svg` 用「先满幅画一层容器色、再叠 94% 标记色」的
办法把瓣间缝隙加宽约 6%，实测 16px 下可读性不低于 Obsidian 官方原图。

**配色**：与 `web/css/app.css` 的「复古数字人文风」同源。

| 语义 | 纸面（浅色） | 墨夜（深色） |
|---|---|---|
| 容器 | `#3A342C → #1E1A14` | 同左 |
| 标记 | `#D05A3C` | 同左 |

朱砂取的是深色主题下的 `--vermilion`（比浅色主题的 `#C4442C` 亮一档），
因为墨底上的橙红需要更高明度才能在 Dock 小尺寸下不糊。

**侧栏装裱**：图标外加一圈 `2px solid var(--ink-main)` + `2px 2px` 硬阴影。
浅色下这圈是墨色，墨夜下自动转纸白——用同一套变量保证双主题都能和纸面拉开。

## 换配色

改 `icon.svg` 里 `<defs>` 的两个渐变 stop 和标记 `fill` 即可，其余不用动。
想整体换成 Obsidian 紫晶系，直接用 `icon-alt-amethyst.svg` 顶替 `icon.svg` 再重跑管线。

## 横幅

`banner.svg` 与 `banner-2560.png` 由 `scripts/generate-banner.py` 生成，内联展开 `icon.svg` 的
`<defs>` 与绘制内容，所以改图标配色后重跑一次横幅脚本即可同步。版面：纸面 + 24px 米字稿纸，
上下 10px 硬墨规，左侧图标配墨色装裱框与硬阴影，右侧 Georgia 衬线刊名 + 宋体副题 + 等宽元信息。

## 重新生成

```bash
# 依赖：rsvg-convert（librsvg）、iconutil（macOS 自带）
python3 scripts/generate-icon.py
```

脚本会重新测量 Obsidian 墨盒、重建 squircle、导出全尺寸 PNG、打成 `.icns`、
并刷新 `web/` 下所有 favicon。改 `MARK_SCALE` 可调标记占比，改 `THEMES` 可加配色。

## 封装 Mac 应用时

`icon.icns` 已就绪。几种常见打包方式的用法：

- **Electron / Tauri**：把 `icon.icns` 放进包资源，构建配置里指过去
  （Tauri 的 `bundle.icon` 数组里写 `["assets/icon.icns"]`；electron-builder 用 `build.icon`）
- **Platypus / Swift 脚本打包**：把 `.icns` 设为 App 包的 `CFBundleIconFile`
- 注意 macOS 要求 icns 内含 512×512@2x（即 1024px）成员，本文件已含

商标提醒：Obsidian 的 logo 与名称归其作者所有。本图标仅供 ObsidianWork 自用，
不要用于公开发布的产品物料，除非确认获得授权。
