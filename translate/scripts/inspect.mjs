/**
 * 查出图纸里有哪些文字、能不能翻。
 * 只读，不改文件。
 *
 * 用法：node inspect.mjs <图纸.dwg|dxf> [输出json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDwg, plain, dwgVersion } from './cadkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const file = process.argv[2];
if (!file) {
  console.error('用法: node inspect.mjs <图纸.dwg> [输出json]');
  process.exit(1);
}

const doc = openDwg(file);
const all = [...doc.modelSpace.entities];

const counts = {};
for (const e of all) {
  const n = e.constructor.name;
  counts[n] = (counts[n] || 0) + 1;
}

const texts = [];
for (const e of all) {
  if (!/Text|MText/i.test(e.constructor.name)) continue;
  const raw = String(e.value ?? '');
  texts.push({
    handle: e.handle,
    type: e.constructor.name,
    raw,
    text: plain(raw).trim(),
    hasCJK: /[\u4e00-\u9fff]/.test(raw),
    height: e.height,
    widthFactor: e.widthFactor ?? e.horizontalWidth ?? null,
    anchor: null,
  });
}

// 图层与块
const layers = [...doc.layers].map((l) => l.name);
const blocks = [...doc.blockRecords].map((b) => b.name);
const insertUsed = new Set();
for (const e of all) if (e.constructor.name === 'Insert') insertUsed.add(e.name);

const cjkTexts = texts.filter((t) => t.hasCJK);

const report = {
  file,
  version: dwgVersion(file),
  codePage: doc.header?.codePage,
  totals: {
    entities: all.length,
    layers: layers.length,
    blocks: blocks.length,
    texts: texts.length,
    cjkTexts: cjkTexts.length,
  },
  counts,
  layers,
  blocks,
  texts,
};

// ── 终端汇总 ────────────────────────────────
const bar = '─'.repeat(62);
console.log(bar);
console.log(`文件      ${path.basename(file)}`);
console.log(`版本      ${report.version}   代码页 ${report.codePage}`);
console.log(`实体      ${all.length}`);
console.log(`图层      ${layers.length}`);
console.log(`块        ${blocks.length}  (被引用 ${insertUsed.size})`);
console.log(`文字对象  ${texts.length}   其中含中文 ${cjkTexts.length}`);
console.log(bar);
console.log('实体类型:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(6)}  ${k}`);

if (cjkTexts.length === 0) {
  console.log('\n⚠ 没有提取到任何中文文字。可能原因：');
  console.log('  · 文字被炸成了线条/填充（TXTPEXP）→ 无法原地改字');
  console.log('  · 文字存放在块定义内 → 需要遍历 blockRecords');
  console.log('  · 图纸本来就是英文');
} else {
  console.log(`\n含中文的文字（共 ${cjkTexts.length} 条）:`);
  for (const t of cjkTexts.slice(0, 40)) {
    const one = t.text.replace(/\n/g, ' / ').slice(0, 48);
    console.log(`  ${String(t.handle).padStart(5)} ${t.type.padEnd(10)} ${one}`);
  }
  if (cjkTexts.length > 40) console.log(`  … 其余 ${cjkTexts.length - 40} 条见 json`);
}

// 保存供 translate 使用
const outJson = process.argv[3] || path.join(HERE, '..', 'texts.json');
fs.writeFileSync(outJson, JSON.stringify(report, null, 1), 'utf8');
console.log(`\n已保存: ${outJson}`);
