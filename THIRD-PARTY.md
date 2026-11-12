# 第三方组件

本项目包含以下第三方软件的构建产物，其版权与许可归原作者所有。

## LibreDWG

- **本项目使用的分发**：[`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web) v0.8.8
- **上游项目**：[LibreDWG](https://www.gnu.org/software/libredwg/) — GNU 项目
- **许可证**：GPL-3.0-or-later

`libredwg/wasm/libredwg-web.wasm` 与 `libredwg/wasm/libredwg-web.js` 是 LibreDWG 的 WebAssembly 构建产物。
`libredwg/dist/libredwg-web.js` 是 `@mlightcad/libredwg-web` 的 JavaScript 封装层。

## 关于许可证

由于本项目打包了 GPL-3.0 的 LibreDWG WASM 产物，**整个项目以 GPL-3.0 发布**。

这意味着：你可以自由使用、修改、再分发，但再分发时必须同样以 GPL-3.0 开源，并提供完整源码。

如果你需要在不兼容 GPL 的项目中使用，需自行取得 LibreDWG 的例外授权，或换用其他解析方案。

## 我自己写的部分

`index.html`、`viewer.js`、`selfcheck.mjs` — 同样以 GPL-3.0 发布。
