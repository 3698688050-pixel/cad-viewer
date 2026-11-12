# CAD 查看器

轻量 DWG/DXF 浏览器端查看器。**不用装任何东西**，直接用浏览器打开 `index.html`。

浏览器端解析 DWG，不上传、不经过服务器——图纸只留在你自己机器上。

## 用

1. 用浏览器打开 [index.html](minis://workspace/cad-viewer/index.html)
2. 点「打开图纸」选 DWG，或把文件拖进窗口
3. 滚轮缩放 · 拖动平移 · 双指捏合

## 实现

| 部分 | 方案 |
|---|---|
| 解析 | `@mlightcad/libredwg-web`（LibreDWG 的 WASM 移植） |
| 渲染 | Canvas 2D，手写 |
| 代码量 | **13.6KB**（HTML + JS，不含 WASM） |

没有构建步骤，没有框架，没有依赖安装。

## 支持

LINE / CIRCLE / ARC / ELLIPSE / LWPOLYLINE / POLYLINE / SPLINE / TEXT / MTEXT / ATTDEF / INSERT / HATCH(仅跳过)

DWG 版本：实测 AC1018（AutoCAD 2004）正常。理论上 AC1015–AC1032 都支持（LibreDWG 的能力）。

## 已知限制

- **样条是折线近似**，放大后可见折角（`viewer.js` 里有 `shortcut:` 注释）
- **HATCH 填充不画**，只画轮廓
- **INSERT 块参照只取文字**，不递归展开块内图形 —— 本图设备图形是散实体所以没影响，但别的图纸若把设备做成块，会显示不全
- **手机整图显示时文字被钳到 9px**，因为原尺寸只有 2.5px。放大后恢复正常比例
- 首次打开需编译 11MB WASM，约 10–20 秒（之后的会话有缓存会快）

## 自检

```bash
node selfcheck.mjs
```

覆盖控制符剥离、字段兜底、最小字号钳制、坐标变换四项。改 `viewer.js` 的纯函数后请同步 `selfcheck.mjs`。

## 为什么不用现成的

GitHub 上 `mlightcad/cad-viewer`（★1243）功能完整，但需要 7 个依赖 + Vite 构建。本任务只要"能看"，13KB 手写比装一套构建链更省事。

如果后续需要：图层开关、测量、块内图形展开、导出 PDF —— 那时再换用完整版更划算。

## 许可证

GPL-3.0。因为打包了 GPL-3.0 的 LibreDWG WASM 产物，整个项目随之采用 GPL-3.0。

详见 [THIRD-PARTY.md](./THIRD-PARTY.md)。

## 部署到网页

纯静态文件，扔到任何静态托管都能跑：

- **GitHub Pages**：Settings → Pages → Branch 选 `main`，目录 `/ (root)`
- **Cloudflare Pages / Vercel / Netlify**：直接连仓库，无需构建命令

本地预览别用 `file://` 直接打开（ES module 与 WASM 的 fetch 会被 CORS 拦），起个静态服务：

```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```
