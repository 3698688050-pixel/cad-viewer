/**
 * 重排版：在「不压线、不出框」约束下重算字高与位置。
 *
 * 关键约束（上一版漏掉的）：
 *   1. 文字框不得与任何线条相交（不只是"宽度够不够"）
 *   2. 左对齐且向右会越界时，改为居中，而不是硬顶到右边线
 *   3. 缩字高优先保住「不压线」，幅度不够时再考虑改译词
 *
 * 用法：node relayout.mjs <输入.dwg> <输出.dwg> <map.json>
 */
import fs from 'fs';
import iconv from 'iconv-lite';

const O = globalThis.TextDecoder;
globalThis.TextDecoder = class {
  #ic = null; #t = null;
  constructor(e, o) { try { this.#t = new O(e, o); } catch { this.#ic = e; } }
  decode(b) { return this.#ic ? iconv.decode(Buffer.from(b), this.#ic) : this.#t.decode(b); }
};

const Acad = await import('@node-projects/acad-ts');
const [src, dst, mapFile] = process.argv.slice(2);
const MAP = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
delete MAP._note;
const KEYS = Object.keys(MAP).sort((a, b) => b.length - a.length);

const CTRL = /\\[A-Za-z][^;\\{}]*;|\\P/g;
const plain = (s) => String(s ?? '').replace(CTRL, '');

// 与 CAD 实际字宽一致的系数（英文约 0.5 字高/字符）
const W = { cjk: 1.0, ascii: 0.52, space: 0.28 };
function tw(str, h, wf) {
  let w = 0;
  for (const c of str) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c)) w += W.cjk;
    else if (c === ' ') w += W.space;
    else w += W.ascii;
  }
  return w * h * wf;
}

function translate(raw) {
  const s = String(raw);
  const parts = [];
  let last = 0, m;
  const re = new RegExp(CTRL.source, 'g');
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ t: 'txt', v: s.slice(last, m.index) });
    parts.push({ t: 'ctl', v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ t: 'txt', v: s.slice(last) });

  let changed = false;
  for (const p of parts) {
    if (p.t !== 'txt') continue;
    let v = p.v;
    for (const k of KEYS) if (v.includes(k)) { v = v.split(k).join(MAP[k]); changed = true; }
    p.v = v;
  }
  return { text: parts.map((p) => p.v).join(''), changed };
}

const buf = fs.readFileSync(src);
const doc = new Acad.DwgReader(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
).read();
const all = [...doc.modelSpace.entities];

// ── 线条索引（线段，含斜线）──────────────────
const SEGS = [];
for (const e of all) {
  if (e.constructor.name === 'Line' && e.startPoint && e.endPoint) {
    SEGS.push([e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y]);
  }
}

// 线段与矩形是否相交（Liang–Barsky 裁剪）
function segHitsRect(x1, y1, x2, y2, r) {
  const { x0, y0, x1: rx1, y1: ry1 } = r;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - x0, rx1 - x1, y1 - y0, ry1 - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

function countHits(box, skipY) {
  let n = 0;
  for (const s of SEGS) {
    if (segHitsRect(s[0], s[1], s[2], s[3], box)) n++;
  }
  return n;
}

/** 给定字高与对齐方式，算文字框 */
function boxFor(x, y, w, h, anchor) {
  let x0 = x;
  if (anchor === 'center') x0 = x - w / 2;
  else if (anchor === 'right') x0 = x - w;
  return { x0, y0: y, x1: x0 + w, y1: y + h };
}

function anchorOf(e) {
  if (e.constructor.name === 'MText') {
    const ap = e.attachmentPoint ?? 1;
    if ([1, 4, 7].includes(ap)) return 'left';
    if ([2, 5, 8].includes(ap)) return 'center';
    return 'right';
  }
  const ha = e.horizontalAlignment ?? 0;
  return ha === 0 ? 'left' : [1, 4].includes(ha) ? 'center' : 'right';
}

let changed = 0, adjusted = 0;
const log = [];

for (const e of all) {
  if (!/Text|MText/i.test(e.constructor.name)) continue;
  const raw = String(e.value ?? '');
  if (!/[\u4e00-\u9fff]/.test(raw)) continue;

  const { text } = translate(raw);
  const h0 = e.height || 60;
  const wf = e.widthFactor ?? e.horizontalWidth ?? 0.9;
  const ip = e.insertPoint || e.alignmentPoint;
  if (!ip) continue;

  const anchor0 = anchorOf(e);
  const origTxt = plain(raw).trim();

  // 原图文字框，作为允许的活动范围
  const wOrig = tw(origTxt, h0, wf);
  const boxOrig = boxFor(ip.x, ip.y, wOrig, h0, anchor0);

  // 原图这条文字本身就压线？压线数作为容忍上限
  const origHits = countHits(boxOrig);

  let best = null;
  // 依次尝试：原锚点 → 居中；字高 100% 起每档降 5%，最低 65%
  // 先试原尺寸，能不压线就不缩，尽量保住字号
  for (const anchor of [...new Set([anchor0, 'center'])]) {
    for (let k = 1.0; k >= 0.649; k -= 0.05) {
      const h = h0 * k;
      const w = tw(plain(text).trim(), h, wf);
      // 位置固定：不改锚点就原地，改居中则以原框中心为轴
      const bx = anchor === 'center' ? (boxOrig.x0 + boxOrig.x1) / 2 : ip.x;
      const box = boxFor(bx, ip.y, w, h, anchor);

      // 不得超出原框过多，防止乱挪
      const tol = Math.max(wOrig * 0.15, h0 * 0.25);
      if (boxOrig.x0 - box.x0 > tol) continue;
      if (box.x1 - boxOrig.x1 > tol) continue;

      const hits = countHits(box);
      // 原图本就压线的，只要不比原来更糟即可
      const ok = origHits > 0 ? hits <= origHits : hits === 0;
      if (ok) { best = { h, anchor, box, hits, origHits }; break; }
      if (!best || hits < best.hits) best = { h, anchor, box, hits, origHits };
    }
    if (best && (origHits > 0 ? best.hits <= origHits : best.hits === 0)) break;
  }

  // 竖直微调：整体下移一点，避开顶部横线（最多挪半个字高）
  if (best && best.hits > 0) {
    for (let dy = 1; dy <= h0 * 0.5; dy += h0 * 0.08) {
      const box = { ...best.box, y0: best.box.y0 + dy, y1: best.box.y1 + dy };
      if (countHits(box) === 0) {
        best = { ...best, box, dy, hits: 0 };
        break;
      }
    }
  }

  e.value = text;
  if (best) {
    if (Math.abs(best.h - h0) > 0.01) { e.height = best.h; adjusted++; }
    // 水平：改锚点时同步移动插入点
    if (best.anchor === 'center') {
      const cx = (boxOrig.x0 + boxOrig.x1) / 2;
      if (e.constructor.name === 'MText') e.attachmentPoint = 2;
      else { e.horizontalAlignment = 1; }
      const p = e.insertPoint || e.alignmentPoint;
      if (p) p.x = cx;
    }
    // 竖直微调
    if (best.dy) {
      const p = e.insertPoint || e.alignmentPoint;
      if (p) p.y = ip.y - best.dy;
    }
    changed++;
    log.push({ handle: e.handle, from: origTxt, to: plain(text).trim(),
      h: `${h0.toFixed(0)}→${best.h.toFixed(0)}`,
      anchor: `${anchor0}→${best.anchor}`,
      dy: best.dy ? best.dy.toFixed(0) : 0, hits: best.hits });
  } else {
    changed++;
    log.push({ handle: e.handle, from: origTxt, to: plain(text).trim(), note: '无解' });
  }
}

const cap = buf.length + 8 * 1024 * 1024;
const out = new Uint8Array(cap);
const w = new Acad.DwgWriter(out, doc);
w.write();
fs.writeFileSync(dst, Buffer.from(out.buffer, out.byteOffset, w.bytesWritten));
console.log(`改写 ${changed} 条，调整 ${adjusted} 条`);
fs.writeFileSync(dst + '.relayout.json', JSON.stringify(log, null, 1));
