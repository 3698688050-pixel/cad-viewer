/**
 * 按翻译表替换图纸中的文字，并按可用空间自动调整字高，保证不压线。
 *
 * 用法:
 *   node translate.mjs <源.dwg> <翻译表.json> <输出.dwg> [--dry-run]
 *
 * 翻译表格式: { "原文": "译文", ... }   （长词优先匹配，自动排序）
 * --dry-run 只报告将要改什么，不写文件
 */
import fs from 'fs';
import {
  openDwg, saveDwg, CTRL, plain, textWidth, widthFactorOf,
  anchorOf, buildVLineIndex, freeSpaceAt, dwgVersion,
} from './cadkit.mjs';

const [src, mapFile, dst, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!src || !mapFile || !dst) {
  console.error('用法: node translate.mjs <源.dwg> <翻译表.json> <输出.dwg> [--dry-run]');
  process.exit(1);
}

const MAP = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
delete MAP._note;
// 长词优先，避免「空压机」抢在「微油螺杆空压机」之前
const KEYS = Object.keys(MAP).sort((a, b) => b.length - a.length);

/** 按段翻译，控制符原样保留 */
function translate(raw) {
  const s = String(raw);
  const parts = [];
  let last = 0;
  const re = new RegExp(CTRL.source, 'g');
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ t: 'txt', v: s.slice(last, m.index) });
    parts.push({ t: 'ctl', v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ t: 'txt', v: s.slice(last) });

  let changed = false;
  const missed = [];
  for (const p of parts) {
    if (p.t !== 'txt') continue;
    let v = p.v;
    for (const k of KEYS) {
      if (v.includes(k)) { v = v.split(k).join(MAP[k]); changed = true; }
    }
    // 仍是中文说明没命中词表
    if (/[\u4e00-\u9fff]/.test(v)) missed.push(v.trim());
    p.v = v;
  }
  return { text: parts.map((p) => p.v).join(''), changed, missed };
}

const doc = openDwg(src);
const all = [...doc.modelSpace.entities];
const vlines = buildVLineIndex(all);

const log = [];
let nChanged = 0;

for (const e of all) {
  if (!/Text|MText/i.test(e.constructor.name)) continue;
  const raw = String(e.value ?? '');
  if (!/[\u4e00-\u9fff]/.test(raw)) continue;

  const { text, changed, missed } = translate(raw);
  if (!changed) {
    log.push({ handle: e.handle, action: 'skip', reason: '词表未命中', raw: plain(raw) });
    continue;
  }

  const h0 = e.height || 60;
  const wf = widthFactorOf(e);
  const oldW = textWidth(plain(raw), h0, wf);
  let newW = textWidth(plain(text), h0, wf);
  let h1 = h0;

  if (newW > oldW) {
    const rectW = e.rectangleWidth > 10 ? e.rectangleWidth : null;
    const ip = e.insertPoint || e.alignmentPoint;
    const anchor = anchorOf(e);
    let avail = null;

    if (rectW) {
      avail = rectW * 0.98;                    // MText 自带框宽，最可靠
    } else if (ip) {
      const sp = freeSpaceAt(vlines, ip.x, ip.y);
      if (anchor === 'center') avail = 2 * Math.min(sp.left, sp.right) * 0.90;
      else if (anchor === 'left') avail = sp.right * 0.90;
      else avail = sp.left * 0.90;
      if (!isFinite(avail) || avail <= 0) avail = null;
    }

    if (avail && newW > avail) {
      h1 = Math.max(h0 * 0.70, h0 * (avail / newW));   // 下限 70%
    } else if (!avail) {
      h1 = Math.max(h0 * 0.80, h0 * (oldW / newW));    // 无参照时温和收缩
    }
  }

  e.value = text;
  if (Math.abs(h1 - h0) > 0.01) e.height = h1;
  nChanged++;

  log.push({
    handle: e.handle,
    type: e.constructor.name,
    action: 'changed',
    from: plain(raw),
    to: plain(text),
    hFrom: +h0.toFixed(1),
    hTo: +h1.toFixed(1),
    missed: missed.filter(Boolean),
  });
}

const shrunk = log.filter((x) => x.action === 'changed' && x.hTo < x.hFrom - 0.1);
console.log(`改写 ${nChanged} 条，其中缩字高 ${shrunk.length} 条`);

const skipped = log.filter((x) => x.action === 'skip');
if (skipped.length) {
  console.log(`\n⚠ ${skipped.length} 条未命中词表（需补充翻译）:`);
  for (const s of skipped) console.log(`  ${s.handle}  ${s.raw}`);
}

const leftover = log.flatMap((x) => (x.missed ? x.missed : []));
if (leftover.length) {
  console.log(`\n⚠ 译文里仍有中文片段:`);
  for (const s of [...new Set(leftover)]) console.log(`  ${s}`);
}

if (dryRun) {
  console.log('\n[dry-run] 未写文件');
} else {
  const n = saveDwg(dst, doc);
  console.log(`\n已写出 ${dst}: ${n} 字节, 头 ${dwgVersion(dst)}`);
  console.log(`原图 ${dwgVersion(src)} → 译文 ${dwgVersion(dst)}`);
}

fs.writeFileSync(dst + '.log.json', JSON.stringify(log, null, 1), 'utf8');
console.log(`改动明细: ${dst}.log.json`);
