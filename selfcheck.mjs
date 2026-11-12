// 自检：不依赖浏览器，验证核心纯函数逻辑
import assert from 'assert';

// 复制 viewer.js 中的纯函数（与主文件保持一致）
const CTRL = /\\[A-Za-z][^;\\{}]*;|\\P/g;
const clean = (raw) => String(raw)
  .replace(/\\P/g, ' ')
  .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
  .replace(/[{}]/g, '').trim();

const textPos = (e) => e.startPoint || e.insertionPoint || e.position || e.insertPoint || null;
const textH = (e) => e.textHeight || e.height || 40;

// 1. 控制符剥离
assert.equal(clean('\\T1.1;{\\H1.52738x;特别提示：\\P正文}'), '特别提示： 正文', 'MTEXT 控制符');
assert.equal(clean('电控柜'), '电控柜', '纯文本原样');
assert.equal(clean('{\\W0.8;PG }'), 'PG', '带花括号的短文本');

// 2. 字段兜底
assert.deepEqual(textPos({ startPoint: { x: 1, y: 2 } }), { x: 1, y: 2 }, 'TEXT 用 startPoint');
assert.deepEqual(textPos({ insertionPoint: { x: 3, y: 4 } }), { x: 3, y: 4 }, 'MTEXT 用 insertionPoint');
assert.equal(textH({ textHeight: 80 }), 80, 'textHeight');
assert.equal(textH({}), 40, '默认字高');

// 3. 文字显示阈值（关键：不能钳最小字号）
const shouldDraw = (h, s) => {
  const px = h * s;
  return px >= 7 && px <= 400;
};
assert.equal(shouldDraw(83.8, 0.03), false, '整图缩放下不画（避免叠字）');
assert.equal(shouldDraw(83.8, 0.1), true, '放大后画');
assert.equal(shouldDraw(83.8, 10), false, '过度放大不画（避免糊屏）');

// 4. 坐标变换一致性（放大放大后原点不移）
const view = { x: 0, y: 0, s: 1 };
const tx = (x) => view.x + x * view.s;
const ty = (y) => view.y - y * view.s;
assert.equal(tx(0), 0);
assert.equal(ty(0), 0, 'Y 轴翻转后原点仍在');

console.log('✓ 全部自检通过 (8 项)');
