# CAD 图纸翻译（中文 → 英文）

把 DWG/DXF 图纸里的中文标注翻成英文，**原位置、原排版、原字号**，不压线不出框。

## 特点

- **直接读写 DWG**：不经过 DXF 中转，输出仍是原版本（实测 AC1018）
- **排版保真**：按实测可用空间自动调字号，不压线、不出框、不叠字
- **中文不损坏**：解决了库写出时中文变 `?` 的坑（见下）
- **独立校验**：用另一套系数复算，必须全绿才算完成

## 快速开始

```bash
# 1. 装环境（Node 依赖 + GBK 补丁 + 绘图库）
sh scripts/setup.sh .

# 2. 体检：看图纸里有什么文字，能不能翻
node scripts/inspect.mjs 图纸.dwg

# 3. 建翻译表（参考 references/glossary-cn-en.json）
cp references/example-map.json map.json
#    编辑 map.json，填入本图的术语

# 4. 翻译并写回
node scripts/translate.mjs 图纸.dwg map.json 图纸-EN.dwg

# 5. 校验（必做）
node scripts/collide.mjs 图纸-EN.dwg          # 查压线
node scripts/verify.mjs 图纸-EN.dwg 图纸.dwg   # 查结构与越界

# 6. 出预览图
node scripts/preview.mjs 图纸-EN.dwg preview.png
```

## 脚本说明

| 脚本 | 作用 |
|---|---|
| `inspect.mjs` | 体检：读版本、统计文字、判断能否翻译 |
| `translate.mjs` | 翻译 + 写回，自动调整字号防压线 |
| `collide.mjs` | 检测文字框与线条是否相交（真正的「压线」） |
| `verify.mjs` | 结构完整性 + 越界检查，用另一套系数复算 |
| `relayout.mjs` | 更强的排版算法（碰撞检测 + 位置微调） |
| `preview.mjs` | 渲染 PNG 预览 |
| `cadkit.mjs` | 公共模块（GBK 处理、宽度估算、对齐判定） |
| `patch_acadts.py` | 给库打 GBK 写出补丁 |
| `setup.sh` | 一键安装 |

## 核心难点

### 中文写回会变 `?`

`@node-projects/acad-ts` 写出 DWG 时，非 ASCII 字符一律走 `encodeAsciiCompatible()`，
实现是 `code <= 0x7F ? code : 0x3F`，中文全部变成问号。

**实测**：原文一个字不改、仅仅「读出再写回」，图层名 `中心线层` 就变成 `????`。

修法：`scripts/patch_acadts.py` 把 GBK 双字节映射表（21791 条）内联进该模块，
重写该函数。**注意 `npm install` 会覆盖补丁，重装后必须重打**（`setup.sh` 已自动处理）。

### 「宽度够用」不等于「不压线」

只算「文字宽度是否超出左右最近竖线」是不够的——文字可能**横穿框内的结构线**，
肉眼就是糊成一团。

必须用 `collide.mjs` 做矩形×线段相交检测。

### Node 没有 GBK 解码器

`new TextDecoder('gbk')` 抛 `ERR_ENCODING_NOT_SUPPORTED`。
`cadkit.mjs` 已用 iconv-lite 垫好。

### 字段名与 acad-ts 不同

本库（libredwg-web）与 acad-ts 的字段名完全不同：

| | libredwg-web | acad-ts |
|---|---|---|
| TEXT 位置 | `startPoint` | `insertPoint` |
| MTEXT 位置 | `insertionPoint` | `insertPoint` |
| 字高 | `textHeight` | `height` |
| 宽高比 | `widthFactor` / `horizontalWidth` | 同名但取值不同 |

### `attachmentPoint` 有 9 种取值

不能简化成「≥2 居中」：`1/4/7=左`、`2/5/8=中`、`3/6/9=右`。
MTEXT 还有 `rectangleWidth`（真实框宽），优先用它。

## 已知局限

- **只处理模型空间（modelSpace）的文字**。文字若在块定义内（图框标题栏常见），需扩展遍历 `blockRecords`
- **样条用折线近似**（仅影响预览，不影响 DWG）
- **只支持单行/多行文字**，不处理尺寸标注里的文字
- 部分图纸的原图本身就存在文字压线（引注、挤在设备间的标注），这些不属于本次缺陷，但会如实报告

## 术语表

`references/glossary-cn-en.json` — 97 条，覆盖：

气力输送 / 粉碎系统 / 压缩空气站 / 除尘 / 仪表位号 / 机械图框标题栏 / 通用工艺标注

新图纸优先复用，缺的补进去。

## 许可证

GPL-3.0。依赖的 `@mlightcad/libredwg-web` 与上游 LibreDWG 均为 GPL-3.0。
