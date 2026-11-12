// DWG/图纸查看器 —— 解析用 @mlightcad/libredwg-web (WASM)，渲染用 Canvas 2D。
// 只处理本类图纸实际出现的实体类型，其余静默跳过。
import { LibreDwg, Dwg_File_Type } from './libredwg/dist/libredwg-web.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#screen');
const ctx = canvas.getContext('2d');

let libredwg = null;
let scene = null;          // { entities, bbox }
let view = { x: 0, y: 0, s: 1 };   // 平移 + 缩放
let dpr = window.devicePixelRatio || 1;

// ── 初始化 WASM ──────────────────────────────
async function init() {
  setStatus('加载 WASM…');
  libredwg = await LibreDwg.create('./libredwg/wasm/');
  setStatus('就绪 — 拖入或选择 DWG 文件');
  $('#file').disabled = false;
  document.body.classList.add('ready');
}

function setStatus(t) { $('#status').textContent = t; }

// ── 读取文件 ─────────────────────────────────
async function openFile(file) {
  setStatus(`解析 ${file.name}…`);
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dwg = libredwg.dwg_read_data(buf, Dwg_File_Type.DWG);
    if (!dwg) throw new Error('无法解析，可能不是有效的 DWG');
    const db = libredwg.convert(dwg);

    const ents = [];
    const blocks = db.tables?.BLOCK_RECORD?.entries || {};
    for (const rec of Object.values(blocks)) {
      for (const e of rec?.entities || []) {
        if (e.isVisible === false) continue;
        ents.push(e);
      }
    }
    scene = { entities: ents, bbox: bboxOf(ents) };
    fit();
    draw();
    $('#info').textContent =
      `${file.name} · ${ents.length} 个实体 · ${Object.keys(blocks).length} 个块`;
    setStatus('就绪');
    $('#empty').hidden = true;
  } catch (err) {
    setStatus('解析失败：' + err.message);
    console.error(err);
  }
}

// ── 文字定位 ─────────────────────────────────
// 字段名与 acad-ts 不同：TEXT 用 startPoint+textHeight，MTEXT 用 insertionPoint+textHeight
function textPos(e) {
  return e.startPoint || e.insertionPoint || e.position || e.insertPoint || null;
}
function textH(e) {
  return e.textHeight || e.height || 40;
}

// ── 包围盒 ───────────────────────────────────
function expand(b, x, y) {
  if (!isFinite(x) || !isFinite(y)) return;
  if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
}

function bboxOf(ents) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const e of ents) {
    switch (e.type) {
      case 'LINE':
        expand(b, e.startPoint?.x, e.startPoint?.y);
        expand(b, e.endPoint?.x, e.endPoint?.y);
        break;
      case 'CIRCLE':
      case 'ARC':
        if (e.center) {
          const r = e.radius || 0;
          expand(b, e.center.x - r, e.center.y - r);
          expand(b, e.center.x + r, e.center.y + r);
        }
        break;
      case 'ELLIPSE':
        if (e.center) {
          const mx = Math.hypot(e.majorAxisEndPoint?.x || 0, e.majorAxisEndPoint?.y || 0);
          expand(b, e.center.x - mx, e.center.y - mx);
          expand(b, e.center.x + mx, e.center.y + mx);
        }
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        for (const p of e.vertices || []) expand(b, p.x, p.y);
        break;
      case 'SPLINE':
        for (const p of e.controlPoints || []) expand(b, p.x, p.y);
        break;
      case 'TEXT':
      case 'MTEXT':
      case 'ATTDEF': {
        const p = textPos(e);
        if (p) { expand(b, p.x, p.y); expand(b, p.x, p.y + textH(e)); }
        break;
      }
      case 'INSERT':
        if (e.insertionPoint) expand(b, e.insertionPoint.x, e.insertionPoint.y);
        break;
    }
  }
  if (!isFinite(b.x0)) return { x0: 0, y0: 0, x1: 100, y1: 100 };
  return b;
}

// ── 视图变换 ─────────────────────────────────
function fit() {
  if (!scene) return;
  const b = scene.bbox;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const w = b.x1 - b.x0 || 1, h = b.y1 - b.y0 || 1;
  const s = Math.min(W / w, H / h) * 0.94;
  view.s = s;
  view.x = W / 2 - ((b.x0 + b.x1) / 2) * s;
  view.y = H / 2 + ((b.y0 + b.y1) / 2) * s;   // Y 轴翻转
}

const tx = (x) => view.x + x * view.s;
const ty = (y) => view.y - y * view.s;

function resize() {
  const r = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

// ── 绘制 ─────────────────────────────────────
function draw() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(0, 0, W, H);
  if (!scene) { ctx.restore(); return; }

  ctx.strokeStyle = '#cfd2d8';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 文字单独收集，最后画（避免被线条压住）
  const texts = [];

  for (const e of scene.entities) {
    ctx.beginPath();
    switch (e.type) {
      case 'LINE':
        if (!e.startPoint || !e.endPoint) break;
        ctx.moveTo(tx(e.startPoint.x), ty(e.startPoint.y));
        ctx.lineTo(tx(e.endPoint.x), ty(e.endPoint.y));
        ctx.stroke();
        break;

      case 'CIRCLE':
        if (!e.center) break;
        ctx.arc(tx(e.center.x), ty(e.center.y), Math.max(0.5, (e.radius || 0) * view.s), 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'ARC': {
        if (!e.center) break;
        // CAD 角度逆时针，Y 轴翻转后需取负
        ctx.arc(tx(e.center.x), ty(e.center.y), Math.max(0.5, (e.radius || 0) * view.s),
          -(e.endAngle ?? 0), -(e.startAngle ?? 0));
        ctx.stroke();
        break;
      }

      case 'ELLIPSE': {
        if (!e.center || !e.majorAxisEndPoint) break;
        const a = Math.hypot(e.majorAxisEndPoint.x, e.majorAxisEndPoint.y);
        const b2 = a * (e.axisRatio ?? 1);
        const rot = Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x);
        ctx.ellipse(tx(e.center.x), ty(e.center.y), Math.max(0.5, a * view.s),
          Math.max(0.5, b2 * view.s), -rot, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const vs = e.vertices || [];
        if (!vs.length) break;
        ctx.moveTo(tx(vs[0].x), ty(vs[0].y));
        for (let i = 1; i < vs.length; i++) ctx.lineTo(tx(vs[i].x), ty(vs[i].y));
        if (e.closed) ctx.closePath();
        ctx.stroke();
        break;
      }

      case 'SPLINE': {
        const ps = e.controlPoints || [];
        if (!ps.length) break;
        // 简化：用控制点折线近似。shortcut: 非精确样条，放大后可见折角
        ctx.moveTo(tx(ps[0].x), ty(ps[0].y));
        for (let i = 1; i < ps.length; i++) ctx.lineTo(tx(ps[i].x), ty(ps[i].y));
        ctx.stroke();
        break;
      }

      case 'HATCH':
        // 填充略过，只画边界（有边界的话）
        break;

      case 'TEXT':
      case 'MTEXT':
      case 'ATTDEF':
        texts.push(e);
        break;

      case 'INSERT':
        texts.push(e);   // 块参照仅取其文字（不递归展开图形）
        break;
    }
  }

  // 文字
  // 手机屏整图显示时字高只剩 2-3px，直接按原尺寸画不可读。
  // 设最小 9px：太小就按 9px 画（宁可略大，也不能看不见）。
  ctx.fillStyle = '#9db4cd';
  for (const e of texts) {
    const p = textPos(e);
    if (!p) continue;
    const raw = e.text ?? e.value ?? '';
    if (!raw) continue;
    // 剥掉 MTEXT 控制符与其包裹的花括号；\P 是换行，先换成空格
    const clean = String(raw)
      .replace(/\\P/g, ' ')
      .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
      .replace(/[{}]/g, '')
      .trim();
    if (!clean) continue;
    const h = Math.min(300, Math.max(9, textH(e) * view.s));
    ctx.font = `${h.toFixed(1)}px system-ui, "PingFang SC", sans-serif`;
    ctx.fillText(clean, tx(p.x), ty(p.y));
  }

  ctx.restore();
}

// ── 交互 ─────────────────────────────────────
let drag = null;
canvas.addEventListener('pointerdown', (ev) => {
  drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  view.x = drag.vx + (ev.clientX - drag.x);
  view.y = drag.vy + (ev.clientY - drag.y);
  draw();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const k = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAt(ev.offsetX, ev.offsetY, k);
}, { passive: false });

function zoomAt(cx, cy, k) {
  const wx = (cx - view.x) / view.s;
  const wy = (view.y - cy) / view.s;
  view.s *= k;
  view.x = cx - wx * view.s;
  view.y = cy + wy * view.s;
  draw();
}

// 双指缩放
let pinch = null;
canvas.addEventListener('touchstart', (ev) => {
  if (ev.touches.length === 2) {
    const [a, b] = ev.touches;
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: view.s };
  }
}, { passive: true });
canvas.addEventListener('touchmove', (ev) => {
  if (ev.touches.length === 2 && pinch) {
    ev.preventDefault();
    const [a, b] = ev.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const r = canvas.getBoundingClientRect();
    const cx = (a.clientX + b.clientX) / 2 - r.left;
    const cy = (a.clientY + b.clientY) / 2 - r.top;
    zoomAt(cx, cy, (pinch.s * d / pinch.d) / view.s);
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { pinch = null; });

// ── 文件入口 ─────────────────────────────────
$('#file').addEventListener('change', (ev) => {
  const f = ev.target.files?.[0];
  if (f) openFile(f);
});

['dragover', 'drop'].forEach((t) =>
  window.addEventListener(t, (ev) => {
    ev.preventDefault();
    if (t === 'drop') {
      const f = ev.dataTransfer?.files?.[0];
      if (f) openFile(f);
    }
  })
);

$('#fit').addEventListener('click', () => { fit(); draw(); });

window.addEventListener('resize', resize);

// ── 启动 ─────────────────────────────────────
resize();
init().catch((e) => setStatus('WASM 加载失败：' + e.message));
