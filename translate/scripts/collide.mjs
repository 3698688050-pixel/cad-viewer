/**
 * 检测文字框是否与线条相交（真正的"压线"，不是"宽度够不够"）。
 *
 * 用法: node collide.mjs <图纸.dwg> [原图.dwg]
 *   只传一个参数：列出所有压线文字
 *   传两个参数：以原图为基准，区分「本次新增」与「原图固有」
 *
 * 退出码：0 = 无新增压线；2 = 有新增压线
 */
import { openDwg, plain, textWidth, widthFactorOf, anchorOf } from './cadkit.mjs';

const [file, baseline] = process.argv.slice(2);
if (!file) { console.error('用法: node collide.mjs <图纸.dwg> [原图.dwg]'); process.exit(1); }

const doc = openDwg(file);
const all = [...doc.modelSpace.entities];

const SEGS = [];
for (const e of all) {
  if (e.constructor.name === 'Line' && e.startPoint && e.endPoint)
    SEGS.push([e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y]);
}

// Liang–Barsky，矩形内缩 eps 避免擦边误报
function segHitsRect(x1, y1, x2, y2, r, eps = 2) {
  const rx0 = r.x0 + eps, ry0 = r.y0 + eps, rx1 = r.x1 - eps, ry1 = r.y1 - eps;
  if (rx1 <= rx0 || ry1 <= ry0) return false;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const pq = [[-dx, x1 - rx0], [dx, rx1 - x1], [-dy, y1 - ry0], [dy, ry1 - y1]];
  for (const [p, q] of pq) {
    if (p === 0) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

const rows = [];
for (const e of all) {
  if (!/Text|MText/i.test(e.constructor.name)) continue;
  const t = plain(e.value).trim();
  if (!t) continue;
  const p = e.insertPoint || e.alignmentPoint;
  if (!p) continue;
  const h = e.height || 60;
  const w = textWidth(t, h, widthFactorOf(e));
  const a = anchorOf(e);
  const x0 = a === 'center' ? p.x - w / 2 : a === 'right' ? p.x - w : p.x;
  const hit = SEGS.filter((s) => segHitsRect(s[0], s[1], s[2], s[3], { x0, y0: p.y, x1: x0 + w, y1: p.y + h })).length;
  if (hit > 0) rows.push({ hit, t, handle: String(e.handle) });
}

rows.sort((a, b) => b.hit - a.hit);

// 有基准图时，区分「原图固有」与「本次新增」
let preExisting = new Set();
if (baseline) {
  const bdoc = openDwg(baseline);
  const ball = [...bdoc.modelSpace.entities];
  const bsegs = [];
  for (const e of ball) {
    if (e.constructor.name === 'Line' && e.startPoint && e.endPoint)
      bsegs.push([e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y]);
  }
  for (const e of ball) {
    if (!/Text|MText/i.test(e.constructor.name)) continue;
    const t = plain(e.value).trim();
    if (!t) continue;
    const p = e.insertPoint || e.alignmentPoint;
    if (!p) continue;
    const h = e.height || 60;
    const w = textWidth(t, h, widthFactorOf(e));
    const a = anchorOf(e);
    const x0 = a === 'center' ? p.x - w / 2 : a === 'right' ? p.x - w : p.x;
    const hit = bsegs.filter((s) => segHitsRect(s[0], s[1], s[2], s[3], { x0, y0: p.y, x1: x0 + w, y1: p.y + h })).length;
    if (hit > 0) preExisting.add(String(e.handle));
  }
}

const isNew = (r) => !baseline || !preExisting.has(r.handle);

if (!baseline) {
  console.log(`压线文字 ${rows.length} 条（未提供基准图，无法判断是否为原图固有）：`);
  for (const r of rows) console.log(`  ${String(r.hit).padStart(3)}条线  ${r.handle.padStart(5)}  ${r.t.slice(0, 40)}`);
  console.log('\n提示：加上原图路径可区分「本次新增」与「原图固有」，例如：');
  console.log('  node collide.mjs 图纸-EN.dwg 图纸.dwg');
  process.exit(0);
}

const added = rows.filter(isNew);
const inherited = rows.filter((r) => !isNew(r));

if (added.length === 0) {
  console.log('✓ 无新增压线');
} else {
  console.log(`✗ 本次引入的压线 ${added.length} 条：`);
  for (const r of added) console.log(`  ${String(r.hit).padStart(3)}条线  ${r.handle.padStart(5)}  ${r.t.slice(0, 40)}`);
}

if (inherited.length) {
  console.log(`\nℹ 另有 ${inherited.length} 条原图就压线（与翻译无关）：`);
  for (const r of inherited) console.log(`  ${String(r.hit).padStart(3)}条线  ${r.handle.padStart(5)}  ${r.t.slice(0, 40)}`);
}

console.log(`\n新增压线 ${added.length} 条 | 原图固有 ${inherited.length} 条`);
process.exitCode = added.length === 0 ? 0 : 2;
