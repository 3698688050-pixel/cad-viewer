#!/bin/sh
# 一次性环境安装：Node 依赖 + GBK 补丁 + Python 绘图库
#
# 用法: sh setup.sh [工作目录]
#   默认装到脚本所在目录的父级（skills/cad-translate/），
#   也可以指定一个项目目录，把 node_modules 建在那里。

set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:-"$HERE/.."}

echo "== 目标目录: $WORK"
mkdir -p "$WORK"
cd "$WORK"

echo "== 检查 Node"
if ! command -v node > /dev/null 2>&1; then
  echo "✗ 没有 node，先装：apk add nodejs npm"
  exit 1
fi
node -v

echo "== 安装 npm 依赖"
if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi
npm install --silent @node-projects/acad-ts iconv-lite 2>&1 | tail -3

echo "== 打 GBK 写出补丁"
python3 "$HERE/patch_acadts.py" "$WORK"

echo "== 检查 Python 绘图库"
if python3 -c "import PIL" 2>/dev/null; then
  echo "   PIL 已装"
else
  echo "   安装 py3-pillow…"
  apk add -q py3-pillow
fi

if [ -f /usr/share/fonts/noto/NotoSansCJK-Regular.ttc ]; then
  echo "   中文字体 ✓"
else
  echo "   安装中文字体…"
  apk add -q font-noto-cjk || echo "   ⚠ 字体装不上，预览里中文会显示成方块（不影响 DWG）"
fi

echo ""
echo "✓ 环境就绪"
echo "  下一步：node $HERE/inspect.mjs <图纸.dwg>"
