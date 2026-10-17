#!/usr/bin/env python3
"""
ObsidianWork 图标生成器（完整管线）
  基底：Obsidian 官方三瓣花形（https://obsidian.md/favicon.svg，墨盒已实测）
  修改：ObsidianWork 品牌色重着色 + macOS squircle 容器 + 原生图标质感 + 小尺寸缝隙加粗

产物：
  assets/icon.svg                 主图标 1024（朱砂墨夜）
  assets/icon-alt-amethyst.svg    备选配色（紫晶纸夜）
  assets/icon-tiny.svg            ≤32px 专用（瓣间缝隙加粗，避免糊成一团）
  assets/icon.icns                macOS 应用图标
  web/favicon.svg / favicon-*.png 网页图标
"""
import re, subprocess, os, shutil, math
from pathlib import Path

ROOT = Path("/Users/songshunsteel/Workbuddy/Claw/ObsidianWork")
OUT = ROOT / "assets"
TMP = Path("/tmp/ow-icon")
SRC = Path("/tmp/obs-favicon.svg")
PY = "/Users/songshunsteel/.workbuddy/binaries/python/versions/3.13.12/bin/python3"
ENV = dict(os.environ, PYTHONPATH="/tmp/pil-env")
TMP.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

MARK_SCALE = 0.66          # 标记长边占图标比例
TINY_GAP_BOOST = 1.0       # 小尺寸：先满幅画一层容器色，再画 94% 标记色 → 缝隙加宽 6%

# ---------- 1. Obsidian 官方三瓣形 ----------
svg = SRC.read_text(encoding="utf-8")
paths = re.findall(r'<path[^>]*d="([^"]+)"', svg)
assert len(paths) == 3, f"预期 3 条路径，实际 {len(paths)}"
MARK_PATHS = "\n".join(f'    <path d="{d}"/>' for d in paths)

# ---------- 2. 实测墨盒 ----------
subprocess.run(["rsvg-convert", "-w", "1024", "-h", "1024", "-b", "#FFFFFF",
                str(SRC), "-o", str(TMP / "measure.png")], check=True)
r = subprocess.run([PY, "-c", """
from PIL import Image; import numpy as np
im = np.asarray(Image.open('/tmp/ow-icon/measure.png').convert('RGB')).astype(int)
m = (np.abs(im-255).sum(axis=2) > 40); ys,xs = np.where(m)
print(xs.min(), xs.max(), ys.min(), ys.max())
"""], capture_output=True, text=True, env=ENV, check=True)
x0, x1, y0, y1 = [int(v) / 4 for v in r.stdout.split()]
VX0, VY0, VW, VH = x0, y0, x1 - x0 + 1, y1 - y0 + 1

# ---------- 3. macOS squircle ----------
def squircle(size=1024, n=5.0, steps=160):
    a = b = size / 2.0
    e = 2.0 / n
    pts = []
    for i in range(steps):
        t = (i / steps) * 2 * math.pi
        ct, st = math.cos(t), math.sin(t)
        pts.append((size/2 + a*(1 if ct >= 0 else -1)*abs(ct)**e,
                    size/2 - b*(1 if st >= 0 else -1)*abs(st)**e))
    d = [f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"]
    d += [f"L {x:.2f} {y:.2f}" for x, y in pts[1:]]
    return " ".join(d) + " Z"
SQ = squircle()

# ---------- 4. 配色 ----------
THEMES = {
    "icon.svg": dict(label="朱砂墨夜（主）", bg_top="#3A342C", bg_bot="#1E1A14",
                     mark="#D05A3C", hi=0.055),
    "icon-alt-amethyst.svg": dict(label="紫晶纸夜（备）", bg_top="#9B7BF7", bg_bot="#6B49D6",
                                  mark="#FAF6EC", hi=0.10),
}

def build(mark_color, hi_op, tiny=False):
    tw = 1024 * MARK_SCALE
    sc = tw / VW
    tx = 512 - (VX0 + VW/2) * sc
    ty = 512 - (VY0 + VH/2) * sc
    if tiny:
        # 缝隙加粗：先按满幅画一层容器底色（由外层 g 的 fill 决定），再叠 94% 的标记色
        sc2 = sc * 0.94
        tx2 = 512 - (VX0 + VW/2) * sc2
        ty2 = 512 - (VY0 + VH/2) * sc2
        mark = (f'  <g transform="translate({tx:.2f} {ty:.2f}) scale({sc:.5f})" fill="{{BG}}">\n'
                f'{MARK_PATHS}\n  </g>\n'
                f'  <g transform="translate({tx2:.2f} {ty2:.2f}) scale({sc2:.5f})" fill="{mark_color}">\n'
                f'{MARK_PATHS}\n  </g>')
    else:
        mark = (f'  <g transform="translate({tx:.2f} {ty:.2f}) scale({sc:.5f})" fill="{mark_color}">\n'
                f'{MARK_PATHS}\n  </g>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- ObsidianWork 应用图标
       基底沿用 Obsidian 官方三瓣花形（obsidian.md/favicon.svg），墨盒实测后重定位。
       改动：① 品牌色重着色 ② macOS squircle 连续圆角容器 ③ 顶部受光 + 底部压深的原生质感
            ④ 小尺寸版本加粗瓣间缝隙。
       设计语言与 web/css/app.css「复古数字人文风」同源：纸面 / 墨色 / 朱砂。 -->
  <defs>
    <linearGradient id="owbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{{BG_TOP}}"/><stop offset="1" stop-color="{{BG_BOT}}"/>
    </linearGradient>
    <linearGradient id="owsheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="{hi_op}"/>
      <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="owvig" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.60" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.24"/>
    </linearGradient>
    <clipPath id="owsq"><path d="{SQ}"/></clipPath>
  </defs>
  <path d="{SQ}" fill="url(#owbg)"/>
  <g clip-path="url(#owsq)">
    <rect width="1024" height="1024" fill="url(#owsheen)"/>
    <rect width="1024" height="1024" fill="url(#owvig)"/>
  </g>
{mark}
</svg>
'''

for fname, t in THEMES.items():
    body = build(t["mark"], t["hi"]).replace("{BG}", t["bg_bot"])
    (OUT / fname).write_text(body.replace("{BG_TOP}", t["bg_top"]).replace("{BG_BOT}", t["bg_bot"]), encoding="utf-8")
    print(f"✓ assets/{fname}  ({t['label']})")

tiny = build(THEMES["icon.svg"]["mark"], THEMES["icon.svg"]["hi"], tiny=True)
tiny = (tiny.replace("{BG}", THEMES["icon.svg"]["bg_bot"])
            .replace("{BG_TOP}", THEMES["icon.svg"]["bg_top"])
            .replace("{BG_BOT}", THEMES["icon.svg"]["bg_bot"]))
(OUT / "icon-tiny.svg").write_text(tiny, encoding="utf-8")
print("✓ assets/icon-tiny.svg  (≤32px 专用，缝隙加粗)")

# ---------- 5. 全尺寸 PNG ----------
ICONSET = TMP / "ObsidianWork.iconset"
if ICONSET.exists():
    shutil.rmtree(ICONSET)
ICONSET.mkdir(parents=True)

def png(svgfile, size, dest):
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size),
                    str(OUT / svgfile), "-o", str(dest)], check=True)

MAC_SIZES = [16, 32, 64, 128, 256, 512, 1024]
for s in MAC_SIZES:
    png("icon.svg", s, TMP / f"m{s}.png")
# iconset 命名：@2x 是逻辑尺寸的 2 倍
mapping = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]
for name, px in mapping:
    shutil.copy(TMP / f"m{px}.png", ICONSET / name)

icns = OUT / "icon.icns"
subprocess.run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(icns)], check=True)
print(f"✓ assets/icon.icns  ({icns.stat().st_size} bytes)")

# ---------- 6. 网页 favicon ----------
web = ROOT / "web"
shutil.copy(OUT / "icon.svg", web / "favicon.svg")
for s in (16, 32, 48):
    png("icon.svg", s, web / f"favicon-{s}.png")
png("icon-tiny.svg", 180, web / "apple-touch-icon.png")
png("icon.svg", 192, web / "icon-192.png")
png("icon.svg", 512, web / "icon-512.png")
print("✓ web/favicon.svg · favicon-16/32/48.png · apple-touch-icon.png · icon-192/512.png")

# ---------- 7. 侧栏品牌标记（32px 用 tiny 版） ----------
png("icon-tiny.svg", 64, web / "brand-mark.png")
print("✓ web/brand-mark.png  (侧栏用，64px 源)")
