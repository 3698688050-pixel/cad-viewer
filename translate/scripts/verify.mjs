/**
 * 独立校验：重新量一遍每段文字是否压线，并与原图比对结构完整性。
 * 刻意用与 translate.mjs 不同的宽度系数，避免"自己验自己"。
 *
 * 用法:
 *   node verify.mjs <输出.dwg> [原图.dwg]
 */
import fs from 'fs';
import {
  openDwg, plain, textWidth, widthFactorOf,
  anchorOf, buildVLineIndex, freeSpaceAt, dwgVersion,
} from './cadkit.mjs';

const out = process.argv[2];
const src = process.argv[3];
if (!out) {
  console.error('用法: node verify.mjs <输出.dwg> [原图.dwg]');
  process.exit(1);
}

// 与转换脚本不同的系数 —— 有意为之
const K = { cjk: 1.0, ascii: 0.52, space: 0.27 };
const bar = "─" .repeat(78);

const doc = openDwg(out);
const all = [...doc.modelSpace.entities];
const vlines = buildVLineIndex(all);

// ── 一、压线检查 ────────────────────────
// 先量原图，把"本来就溢出"的 handle 记下来，避免误报给翻译
const srcDoc = src ? openDwg(src) : null;
const preExisting = new Set();

function measure(docObj) {
  const ents = [...docObj.modelSpace.entities];
  const vl = buildVLineIndex(ents);
  const res = new Map();
  for (const e of ents) {
    if (!/Text|MText/i.test(e.constructor.name)) continue;
    const v = plain(e.value).trim();
    if (!v) continue;
    const ip = e.insertPoint || e.alignmentPoint;
    if (!ip) continue;
    const h = e.height || 60;
    const wf = widthFactorOf(e);
    const anchor = anchorOf(e);
    const rectW = e.rectangleWidth > 10 ? e.rectangleWidth : null;
    const w = textWidth(v, h, wf, K);
    let over, note;
    if (rectW) {
      over = w - rectW;
      note = `框宽${rectW.toFixed(0)}`;
    } else {
      const sp = freeSpaceAt(vl, ip.x, ip.y);
      let lim;
      if (anchor === 'center') { lim = 2 * Math.min(sp.left, sp.right); note = `居中 可用${lim.toFixed(0)}`; }
      else if (anchor === 'left') { lim = sp.right; note = `左对齐 可用${lim.toFixed(0)}`; }
      else { lim = sp.left; note = `右对齐 可用${lim.toFixed(0)}`; }
      over = isFinite(lim) ? w - lim : -1e9;
    }
    res.set(String(e.handle), { e, v, w, note, over });
  }
  return res;
}

const before = srcDoc ? measure(srcDoc) : new Map();
for (const [h, m] of before) if (m.over > 0) preExisting.add(h);

const after = measure(doc);

let overflow = 0, tight = 0, inherited = 0;
const problems = [];

for (const [handle, m] of after) {
  if (m.over > 0) {
    if (preExisting.has(handle)) {
      inherited++;
      continue;               // 原图就有，不算本次引入
    }
    overflow++;
    problems.push(m);
  } else if (m.over > -10) tight++;
}

if (problems.length === 0) {
  console.log('✓ 无新增压线');
} else {
  console.log('✗ 本次引入的压线：');
  for (const p of problems) {
    console.log(`  ${String(p.e.handle).padStart(5)} ${p.v.slice(0, 30).padEnd(30)} 宽${p.w.toFixed(0)} / ${p.note}  超出 ${p.over.toFixed(0)}`);
  }
}

if (inherited) {
  console.log(`\nℹ 另有 ${inherited} 条原图就溢出（与翻译无关，未列入问题）:`);
  for (const h of preExisting) {
    const m = after.get(h);
    if (m && m.over > 0) console.log(`  ${h.padStart(5)} ${m.v.slice(0, 30)}`);
  }
}

console.log(`\n新增溢出 ${overflow} 条 | 原图固有 ${inherited} 条 | 贴边 ${tight} 条`);

// ── 二、结构完整性 ────────────────────────
if (src) {
  console.log('\n' + bar);
  console.log('二、结构完整性（对比原图）');
  console.log(bar);

  const a = openDwg(src);
  const b = doc;
  const ea = [...a.modelSpace.entities];
  const eb = [...b.modelSpace.entities];

  const sig = (ents) => {
    const c = {};
    for (const e of ents) {
      const n = e.constructor.name;
      c[n] = (c[n] || 0) + 1;
    }
    return c;
  };
  const ca = sig(ea), cb = sig(eb);

  const chunk = (x, y) => (x === y ? '✓' : '✗');
  console.log(`实体     ${ea.length} → ${eb.length} ${chunk(ea.length, eb.length)}`);
  console.log(`图层     ${[...a.layers].length} → ${[...b.layers].length} ${chunk([...a.layers].length, [...b.layers].length)}`);
  console.log(`块       ${[...a.blockRecords].length} → ${[...b.blockRecords].length} ${chunk([...a.blockRecords].length, [...b.blockRecords].length)}`);

  const la = [...a.layers].map((l) => l.name);
  const lb = [...b.layers].map((l) => l.name);
  const lostLayers = la.filter((n) => !lb.includes(n));
  console.log(`图层名   ${lostLayers.length ? '✗ 丢失 ' + lostLayers.join(', ') : '✓ 全部保留'}`);

  const ba = [...a.blockRecords].map((x) => x.name);
  const bb = [...b.blockRecords].map((x) => x.name);
  const lostBlocks = ba.filter((n) => !bb.includes(n));
  if (lostBlocks.length) console.log(`块名     ✗ 丢失 ${lostBlocks.slice(0, 5).join(', ')}...`);
  else console.log('块名     ✓ 全部保留');

  console.log('\n各类型计数:');
  let mismatch = 0;
  for (const k of Object.keys(ca)) {
    const ok = ca[k] === cb[k];
    if (!ok) mismatch++;
    console.log(`  ${k.padEnd(14)} ${String(ca[k]).padStart(5)} → ${String(cb[k]).padStart(5)} ${ok ? '✓' : '✗'}`);
  }
  for (const k of Object.keys(cb)) {
    if (!(k in ca)) { console.log(`  ${k.padEnd(14)} ${String(0).padStart(5)} → ${String(cb[k]).padStart(5)} ✗ 新增`); mismatch++; }
  }

  // 残留中文
  const leftover = eb.filter((e) => /Text|MText/i.test(e.constructor.name)
    && /[\u4e00-\u9fff]/.test(plain(e.value)));
  console.log(`\n残留中文  ${leftover.length === 0 ? '✓ 0 条' : '⚠ ' + leftover.length + ' 条'}`);
  for (const e of leftover.slice(0, 10)) {
    console.log(`  ${e.handle}  ${plain(e.value).slice(0, 40)}`);
  }

  console.log('\n' + bar);
  const ok = overflow === 0 && mismatch === 0 && lostLayers.length === 0 && lostBlocks.length === 0;
  console.log(ok ? '结论：通过' : '结论：有问题，需复查上面标 ✗ 的项');
  console.log(bar);
  process.exitCode = ok ? 0 : 2;
}
