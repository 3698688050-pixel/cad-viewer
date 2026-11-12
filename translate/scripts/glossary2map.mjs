/**
 * 把分类术语库（alpa-glossary.json）转成翻译脚本能直接吃的平铺 map.json。
 *
 * 用法：
 *   node glossary2map.mjs <术语库.json> <输出map.json> [--short]
 *
 *   --short  优先用短称（图纸空间紧张时用这个）
 *   默认     用正式全称（正式交付、报表、说明书用这个）
 *
 * 术语库结构：{ "分类": { "中文": {"en":"英文","short":"短称","source":"..."} } }
 * 输出结构：  { "中文": "英文" }
 */
import fs from 'fs';

const args = process.argv.slice(2);
const useShort = args.includes('--short');
const [src, dst] = args.filter((a) => !a.startsWith('--'));

if (!src || !dst) {
  console.error('用法: node glossary2map.mjs <术语库.json> <输出map.json> [--short]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const map = {};
const stats = {};
let fallback = 0;

for (const [group, items] of Object.entries(raw)) {
  if (group.startsWith('_')) continue;
  if (!items || typeof items !== 'object') continue;
  let n = 0;
  for (const [cn, v] of Object.entries(items)) {
    if (cn.startsWith('_')) continue;
    if (typeof v === 'string') continue;          // 旧译法对照的说明文字
    if (!v || typeof v !== 'object') continue;

    let en = '';
    if (useShort) {
      en = v.short || v.en || '';
      if (!v.short && v.en) fallback++;           // 没短称，退回全称
    } else {
      en = v.en || v.short || '';
    }
    if (en.trim()) {
      map[cn] = en.trim();
      n++;
    }
  }
  if (n) stats[group] = n;
}

fs.writeFileSync(dst, JSON.stringify(map, null, 1), 'utf8');

console.log(`已生成 ${dst}（${useShort ? '短称模式' : '全称模式'}），共 ${Object.keys(map).length} 条`);
for (const [g, n] of Object.entries(stats)) console.log(`  ${g}: ${n}`);
if (fallback) console.log(`  （其中 ${fallback} 条无短称，已用全称）`);
