/**
 * 检测文字框是否与线条相交（真正的"压线"，不是"宽度够不够"）。
 * 用法: node collide.mjs <图纸.dwg>
 * 输出每条压线文字被多少条线穿过，按严重度排序。
 */
import { openDwg, plain, textWidth, widthFactorOf, anchorOf } from './cadkit.mjs';

const file = process.argv[2];
if (!file) { console.error('用法: node collide.mjs <图纸.dwg>'); process.exit(1); }

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
  if (hit > 0) rows.push({ hit, t, handle: e.handle });
}

rows.sort((a, b) => b.hit - a.hit);
console.log(`压线文字 ${rows.length} 条：`);
for (const r of rows) console.log(`  ${String(r.hit).padStart(3)}条线  ${String(r.handle).padStart(5)}  ${r.t.slice(0, 40)}`);
console.log('\n提示：对比原图再看，原图就压线的条目（如引注、挤在设备间的标注）属于原始设计，不算本次缺陷。');
