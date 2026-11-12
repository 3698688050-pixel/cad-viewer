---
name: cad-translate
description: "DWG/DXF 图纸中译英的固定 SOP：原地、原排版、原字号翻成英文，不压线不出框，成品仍是原版本 DWG。用户说「把这个图纸翻译成英文」「DWG 翻成英文排版不变」「图纸英化」「交客户要英文版图纸」「CAD 图纸翻译」时调用。流程：setup 装环境 → inspect 体检（先确认文字是实体还是被炸成线条）→ glossary2map 建词表（埃尔派图纸用官方词库）→ translate 写回 → collide + verify 双校验（必须全绿）→ preview 出图。已实测 AC1018；内含 GBK 编码补丁、排版保真算法、埃尔派官方术语库。"
license: GPL-3.0
metadata: {"scripts": "/var/minis/skills/cad-translate/scripts", "references": "/var/minis/skills/cad-translate/references", "verified": "2026-11-12", "verified_against": "AC1018 DWG, 2254 entities, 28 CJK texts"}
---

# CAD 图纸翻译（中文 → 英文）

把 DWG/DXF 图纸里的中文标注翻成英文，**原位置、原排版、原字号**，不压线不出框。

---

## 给接手者的第一条指令

**先读 `references/verification.md`，用任意一张样例图纸把六步跑一遍。**
只有输出与文档里的「预期」一致，才说明环境正确。不要跳过这步直接处理客户图纸。

---

## 一句话原则

**先 inspect，再谈能不能翻。** 文字若被炸成线条，一切都白搭——这个判据只花几秒，却决定整个任务成不成。

---

## 六步流程

### 0. 环境

```bash
sh scripts/setup.sh .
```

装 Node 依赖、打 GBK 补丁、装 PIL 与中文字体。**必须在最终运行脚本的目录下执行**，
脚本靠从 cwd 逐级向上找 `node_modules`。

### 1. 体检（必做，只读）

```bash
node scripts/inspect.mjs 图纸.dwg
```

看三个数字：**版本**、**含中文文字条数**、**实体类型分布**。

| 现象 | 判断 |
|---|---|
| 含中文 > 0 | ✅ 可原地翻，继续 |
| 含中文 0，但大量 Line/LwPolyline | ❌ 文字已炸成线条（TXTPEXP），**停手告诉用户**，只能在 CAD 里改 |
| 含中文 0，图纸本来就是英文 | 无需处理 |
| TextEntity/MText 为 0 但块很多 | 文字可能在块定义里，需扩展 inspect 遍历 blockRecords |

⚠️ **别用 GDAL 的 `gdal-driver-cad`**：libopencad 0.3.4 只认 AC1015，遇到 AC1018 直接报错。
本技能用 `@node-projects/acad-ts`，实测 AC1018 读写正常。

### 2. 建词表

**埃尔派（ALPA）的图纸一律先用官方词库**：

```bash
# 图纸用短称（防压线，默认用这个）
node scripts/glossary2map.mjs references/alpa-glossary.json map.json --short

# 正式交付/说明书用全称
node scripts/glossary2map.mjs references/alpa-glossary.json map.json
```

官方词库 113 条，每条标注来源（`official` = 官网原文，`industry` = 行业通用）。

| 中文 | 全称 | 短称（图纸用） |
|---|---|---|
| 气流粉碎机 | Fluidized Bed Opposed Air Jet Mill | Air Jet Mill |
| 微油螺杆空压机 | Oil-Injected Screw Air Compressor | Screw Comp. |
| 冷干机 | Refrigerated Air Dryer | Ref. Dryer |

**实测：同一张图，全称模式新增溢出 4 条，短称模式 0 条。**

其他厂商用 `references/glossary-cn-en.json`（通用 97 条），或自建 `{"中文":"English"}`。

**必须问用户三项口径**：术语风格、标题栏处理、公司名译法。

### 3. 翻译

```bash
node scripts/translate.mjs 图纸.dwg map.json 图纸-EN.dwg
```

脚本自动：
- 保留 MTEXT 控制符（`\T1.1;` `\H1.5x;` `\P`），只替换正文
- 长词优先匹配（`微油螺杆空压机` 不会被 `空压机` 抢先命中）
- 按实测可用空间缩字高，下限 70%
- 输出 `<输出>.log.json` 记录每条改动

**输出里出现 `⚠ N 条未命中词表` 或 `⚠ 译文里仍有中文片段` → 补词后重跑，不许交付。**

### 4. 校验一：压线

```bash
node scripts/collide.mjs 图纸-EN.dwg 图纸.dwg
```

**必须带原图参数**，否则无法区分「本次引入」与「原图固有」。
退出码 0 = 无新增压线；2 = 有，必须处理。

### 5. 校验二：结构完整性

```bash
node scripts/verify.mjs 图纸-EN.dwg 图纸.dwg
```

要求全绿：新增溢出 0、实体/图层/块计数一致、图层名块名全保留、残留中文 0。
退出码 0 且结论「通过」才算完。

### 6. 预览 + 交付

```bash
node scripts/preview.mjs 图纸-EN.dwg preview.png
```

交付 `图纸-EN.dwg` + 预览图。

⚠ 预览用 PIL 渲染，字体与 CAD 实际不同，**可能文字粘连的假象——以量化结果为准**。

---

## 脚本清单

| 脚本 | 作用 |
|---|---|
| `setup.sh` | 一键装环境 + 打补丁 |
| `inspect.mjs` | 体检，判断能否翻译 |
| `glossary2map.mjs` | 分类术语库 → 平铺 map |
| `translate.mjs` | 翻译 + 写回 |
| `collide.mjs` | 文字×线条相交检测（真正的压线） |
| `verify.mjs` | 结构完整性 + 越界（另一套系数复算） |
| `relayout.mjs` | 更强的排版（碰撞避让 + 位置微调） |
| `preview.mjs` | 渲染 PNG |
| `cadkit.mjs` | 公共模块 |
| `patch_acadts.py` | GBK 写出补丁 |

---

## 七个坑（全是实测踩出来的）

### 1. Node 没有 GBK 解码器
`new TextDecoder('gbk')` 抛 `ERR_ENCODING_NOT_SUPPORTED`。`cadkit.mjs` 已用 iconv-lite 垫好。
> 派生 class 里访问 `this` 前必须 `super()`，用私有字段 + try/catch 更安全。

### 2. 库写出时中文变 `?`（最致命）
未改一字、仅「读出再写回」，`中心线层` 就变 `????`。
根因：`IO/TextEncoding.js` 的 `encodeAsciiCompatible()` 写死 `code <= 0x7F ? code : 0x3F`。
修法：跑 `scripts/patch_acadts.py`（内联 21791 条 GBK 映射）。
> **`npm install` 会覆盖补丁，重装后必须重打**。`setup.sh` 已自动处理。
> 全局 `TextEncoder` 垫片**对该模块无效**——它是独立作用域。

### 3. `widthFactor` 不是统一字段
`TextEntity` 用 `.widthFactor`，`MText` 用 `.horizontalWidth`。用 `cadkit.widthFactorOf()`。

### 4. `attachmentPoint` 有 9 种取值
不能简化成「≥2 居中」：`1/4/7=左`、`2/5/8=中`、`3/6/9=右`。
MText 还有 `rectangleWidth`（真实框宽），**优先用它**。用 `cadkit.anchorOf()`。

### 5. 别用 GDAL 的 `gdal-driver-cad`
libopencad 0.3.4 只支持 DWG R2000（AC1015）。
LibreDWG 源码编译也别碰：`autoreconf` 在手机上要十几分钟且零输出。

### 6. 「宽度够用」不等于「不压线」
第一版只算「文字宽度是否超出左右最近竖线」，校验全绿，交付后用户看到明显叠字。
真实原因：文字**横穿了框内的结构线**。
**必须用 `collide.mjs` 做矩形×线段相交检测**，不能只比宽度。

### 7. 左对齐文字向右顶会撞边
左对齐 + 英文变长 → 文字一路向右延伸到贴着右边线，看起来「正好放下」，
实际已和框线糊在一起。
做法：超出时改锚点为居中（`MText.attachmentPoint=2` / `TextEntity.horizontalAlignment=1`）。

---

## 已知局限

- **只处理 modelSpace 的文字**。文字若在块定义内（图框标题栏常见），需扩展遍历 `blockRecords`——本版本未做。
- **图框里的汉字若是矢量线条**（CAXA 常见，汉字被转成线段），无法通过改文字翻译，只能重画。
- 样条用折线近似（仅影响预览，不影响 DWG）。
- 不处理尺寸标注内的文字。
- 部分图纸原图本身就存在文字压线，这些会如实报告但不计为缺陷。

---

## 环境

```bash
apk add nodejs npm py3-pillow font-noto-cjk
sh scripts/setup.sh <工程目录>
```

依赖：`@node-projects/acad-ts`（读写 DWG）、`iconv-lite`（GBK）。

**脚本从 cwd 逐级向上找 `node_modules`，所以要在装了依赖的目录下运行。**

---

## 许可证

GPL-3.0。依赖的 `@node-projects/libredwg-web`、`@node-projects/acad-ts` 与上游 LibreDWG 均为 GPL-3.0。
