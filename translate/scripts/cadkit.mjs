/**
 * CAD 图纸翻译工具箱 —— 读取、修改、写回 DWG，并保证中文不损坏。
 *
 * 用法：import { openDwg, saveDwg, ... } from './cadkit.mjs'
 *
 * 两个必须踩过的坑，这里都封好了：
 *  1. Node 没有 GBK 解码器 → 全局垫一个 TextDecoder
 *  2. 库写出时中文变 '?' → 需先跑 scripts/patch_acadts.py
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';

// ── 依赖解析 ────────────────────────────────────────
// 脚本装在 skills/ 下，但 node_modules 通常建在工作目录。
// 从 cwd 逐级向上找 node_modules，找到了就从那里加载。
function findNodeModules() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const nm = path.join(dir, 'node_modules');
    if (fs.existsSync(nm)) return nm;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // 退而求其次：脚本自身目录
  const self = path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules');
  return fs.existsSync(self) ? self : null;
}

const NM = findNodeModules();
if (!NM) {
  const setup = path.join(path.dirname(fileURLToPath(import.meta.url)), 'setup.sh');
  throw new Error(
    `找不到 node_modules。请先在工作目录执行安装:\n` +
    `  sh ${setup} <工程目录>\n` +
    `然后在同一目录下运行本脚本。`
  );
}

async function loadPkg(name) {
  const pkg = path.join(NM, name);
  if (!fs.existsSync(pkg)) {
    const setup = path.join(path.dirname(fileURLToPath(import.meta.url)), 'setup.sh');
    throw new Error(`缺少依赖 ${name}，请执行: sh ${setup} <工程目录>`);
  }
  const pj = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  let entry = pj.module || pj.main || 'index.js';
  if (pj.exports) {
    const dot = typeof pj.exports === 'object' ? (pj.exports['.'] ?? pj.exports) : pj.exports;
    if (typeof dot === 'string') entry = dot;
    else if (dot) entry = dot.import || dot.default || dot.require || entry;
  }
  const m = await import(pathToFileURL(path.join(pkg, entry)).href);
  return m.default ?? m;
}

const iconv = await loadPkg('iconv-lite');

// ── 1. GBK 解码器垫片 ─────────────────────────────────
const OrigTD = globalThis.TextDecoder;
if (!globalThis.__gbkTD) {
  globalThis.TextDecoder = class {
    #ic = null;
    #t = null;
    constructor(enc, opts) {
      try { this.#t = new OrigTD(enc, opts); }
      catch { this.#ic = enc; }
    }
    decode(b) {
      return this.#ic
        ? iconv.decode(Buffer.from(b), this.#ic)
        : this.#t.decode(b);
    }
  };
  globalThis.__gbkTD = true;
}

const Acad = await loadPkg('@node-projects/acad-ts');

/** MTEXT/TEXT 内嵌控制符，如 \T1.1; \H1.5x; \P */
export const CTRL = /\\[A-Za-z][^;\\{}]*;|\\P/g;

/** 剥掉控制符，只留正文 */
export const plain = (s) => String(s ?? '').replace(CTRL, '');

/**
 * 估算文字宽度。
 * 用两套系数，校验脚本应换一套，避免"自己验自己"。
 */
export function textWidth(str, h, wf, k = {}) {
  const CJK = k.cjk ?? 1.0;
  const ASC = k.ascii ?? 0.50;
  const SPC = k.space ?? 0.28;
  let w = 0;
  for (const ch of str) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) w += CJK;
    else if (ch === ' ') w += SPC;
    else w += ASC;
  }
  return w * h * wf;
}

/** 取文字的宽高比：TextEntity 与 MText 字段名不同 */
export const widthFactorOf = (e) => e.widthFactor ?? e.horizontalWidth ?? 0.9;

/**
 * 判断水平对齐方向：'left' | 'center' | 'right'
 * attachmentPoint 有 9 种取值，不能简化为「>=2 居中」：
 *   1左上 2中上 3右上 / 4左中 5正中 6右中 / 7左下 8中下 9右下
 */
export function anchorOf(e) {
  if (e.constructor.name === 'MText') {
    const ap = e.attachmentPoint ?? 1;
    if ([1, 4, 7].includes(ap)) return 'left';
    if ([2, 5, 8].includes(ap)) return 'center';
    return 'right';
  }
  const ha = e.horizontalAlignment ?? 0;
  if (ha === 0) return 'left';
  if ([1, 4].includes(ha)) return 'center';
  return 'right';
}

/** 建立竖直线索引，用于测量文字左右可用空间 */
export function buildVLineIndex(entities) {
  const v = [];
  for (const e of entities) {
    if (e.constructor.name === 'Line' && e.startPoint && e.endPoint) {
      const { startPoint: s, endPoint: t } = e;
      if (Math.abs(s.x - t.x) < 1)
        v.push({ x: s.x, y1: Math.min(s.y, t.y), y2: Math.max(s.y, t.y) });
    }
  }
  return v;
}

/** 在 y 高度处，x 左右最近竖线的距离 */
export function freeSpaceAt(vlines, x, y, tol = 5) {
  const near = vlines.filter((l) => y >= l.y1 - tol && y <= l.y2 + tol);
  const L = near.filter((l) => l.x < x).sort((a, b) => b.x - a.x)[0];
  const R = near.filter((l) => l.x > x).sort((a, b) => a.x - b.x)[0];
  return {
    left: L ? x - L.x : Infinity,
    right: R ? R.x - x : Infinity,
  };
}

/** 打开 DWG/DXF 文档 */
export function openDwg(path) {
  const buf = fs.readFileSync(path);
  return new Acad.DwgReader(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  ).read();
}

/** 写回 DWG。返回字节数 */
export function saveDwg(path, doc, spareMB = 8) {
  const cap = 16 * 1024 * 1024 * spareMB;
  const out = new Uint8Array(cap);
  const w = new Acad.DwgWriter(out, doc);
  w.write();
  const n = w.bytesWritten;
  fs.writeFileSync(path, Buffer.from(out.buffer, out.byteOffset, n));
  return n;
}

/** 文件头版本，如 AC1018 */
export function dwgVersion(path) {
  return fs.readFileSync(path).subarray(0, 6).toString();
}

export { Acad };
