/**
 * 把 DWG 渲染成 PNG 预览，用于目视检查排版。
 * 只画线条和文字（不画填充），足够看出压线与错位。
 *
 * 用法:
 *   node preview.mjs <图纸.dwg> <输出.png>
 *
 * 注意：本机 PIL 的字体与 CAD 实际字体不同，可能出现"文字粘连"假象，
 *       不要据此判断数据有错 —— 以 verify.mjs 的量化结果为准。
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import { openDwg, plain, widthFactorOf } from './cadkit.mjs';

const [file, png] = process.argv.slice(2);
if (!file || !png) {
  console.error('用法: node preview.mjs <图纸.dwg> <输出.png>');
  process.exit(1);
}

const doc = openDwg(file);
const all = [...doc.modelSpace.entities];

const lines = [];
const texts = [];

for (const e of all) {
  const n = e.constructor.name;
  if (n === 'Line' && e.startPoint && e.endPoint) {
    lines.push([e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y]);
  } else if (/Text|MText/i.test(n)) {
    const ip = e.insertPoint || e.alignmentPoint;
    if (!ip) continue;
    const k = n === 'MText' ? (e.attachmentPoint ?? 1) : (e.horizontalAlignment ?? 0);
    texts.push({
      x: ip.x, y: ip.y,
      h: e.height || 60,
      t: plain(e.value).replace(/\\P/g, ' / ').trim(),
      center: n === 'MText' ? [2, 5, 8].includes(k) : [1, 4].includes(k),
    });
  }
}

const tmp = png + '.json';
fs.writeFileSync(tmp, JSON.stringify({ lines, texts }));

const py = `
import json, sys
from PIL import Image, ImageDraw, ImageFont
d = json.load(open(sys.argv[1]))
lines, texts = d['lines'], d['texts']
xs = [c for l in lines for c in (l[0], l[2])] + [t['x'] for t in texts]
ys = [c for l in lines for c in (l[1], l[3])] + [t['y'] for t in texts]
if not xs:
    print('无几何数据'); sys.exit(1)
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
pad = (x1 - x0) * 0.03 or 1
x0, x1, y0, y1 = x0 - pad, x1 + pad, y0 - pad, y1 + pad
W = 2200
sc = W / (x1 - x0)
H = max(1, int((y1 - y0) * sc))
img = Image.new('RGB', (W, H), (14, 14, 16))
dr = ImageDraw.Draw(img)
px = lambda x, y: ((x - x0) * sc, (y1 - y) * sc)
for a, b, c, e in lines:
    dr.line([px(a, b), px(c, e)], fill=(70, 72, 78), width=1)
FONT = '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc'
for t in texts:
    h = t['h'] * sc
    if h < 3 or not t['t']:
        continue
    try:
        f = ImageFont.truetype(FONT, max(6, int(h)))
    except Exception:
        f = ImageFont.load_default()
    dr.text(px(t['x'], t['y']), t['t'], font=f,
            fill=(120, 220, 255), anchor='mm' if t['center'] else 'lm')
img.save(sys.argv[2])
print(f'{W}x{H}  线={len(lines)} 文字={len(texts)}')
`;

fs.writeFileSync(png + '.render.py', py);
const out = execFileSync('python3', [png + '.render.py', tmp, png], { encoding: 'utf8' });
console.log(out.trim());
console.log(`已生成 ${png}`);
fs.unlinkSync(tmp);
fs.unlinkSync(png + '.render.py');
