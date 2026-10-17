#!/usr/bin/env python3
"""
ObsidianWork README 横幅生成器
风格与 assets/icon.svg、web/css/app.css 的「复古数字人文风」同源：
纸面 / 墨色 / 朱砂，0 圆角，硬边框，米字稿纸网格。

产物：assets/banner.svg + assets/banner-2560.png
"""
import subprocess, math
from pathlib import Path

ROOT = Path("/Users/songshunsteel/Workbuddy/Claw/ObsidianWork")
OUT = ROOT / "assets"
ICON_SVG = OUT / "icon.svg"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 2560, 720
PAPER = "#F4EEE1"
INK = "#2B2620"
MUTED = "#6B6257"
FAINT = "#9A9083"
VERM = "#C4442C"
GRID = "rgba(43,38,32,0.045)"

# ---------- 稿纸网格：24px 淡墨线 + 坐标十字点 ----------
grid_lines, grid_dots = [], []
x = 24
while x < W:
    grid_lines.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{H}"/>')
    x += 24
y = 24
while y < H:
    grid_lines.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}"/>')
    y += 24
gx = 24
while gx < W:
    gy = 24
    while gy < H:
        grid_dots.append(f'<circle cx="{gx}" cy="{gy}" r="1.6"/>')
        gy += 24
    gx += 24

# ---------- 版面 ----------
# 图标：沿用 assets/icon.svg 本体（内联展开，避免外部引用）
icon_src = ICON_SVG.read_text(encoding="utf-8")
icon_inner = icon_src[icon_src.index("<defs>") + len("<defs>"):icon_src.index("</defs>")]
# 绘制内容 = </defs> 之后到 </svg> 之前（容器底、受光/压深、三瓣标记）
icon_body = icon_src[icon_src.index("</defs>") + len("</defs>"):icon_src.rindex("</svg>")]

ICON_X, ICON_Y, ICON_S = 96, 128, 452
FRAME_PAD = 22

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  <!-- ObsidianWork 横幅 · 复古数字人文风
       设计语言与 assets/icon.svg、web/css/app.css 同源：纸面 / 墨色 / 朱砂。 -->
  <defs>
    {icon_inner}
    <pattern id="owgrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="{GRID}" stroke-width="1"/>
      <circle cx="0" cy="0" r="1.6" fill="{GRID}"/>
    </pattern>
    <clipPath id="iconclip">
      <rect x="{ICON_X}" y="{ICON_Y}" width="{ICON_S}" height="{ICON_S}"/>
    </clipPath>
  </defs>

  <!-- 纸面 + 米字稿纸 -->
  <rect width="{W}" height="{H}" fill="{PAPER}"/>
  <rect width="{W}" height="{H}" fill="url(#owgrid)"/>

  <!-- 上下硬墨规（报刊 masthead rule） -->
  <rect x="0" y="0" width="{W}" height="10" fill="{INK}"/>
  <rect x="0" y="{H-10}" width="{W}" height="10" fill="{INK}"/>

  <!-- 图标 + 墨色装裱框 + 硬阴影 -->
  <rect x="{ICON_X-FRAME_PAD}" y="{ICON_Y-FRAME_PAD}"
        width="{ICON_S+FRAME_PAD*2}" height="{ICON_S+FRAME_PAD*2}"
        fill="none" stroke="{INK}" stroke-width="6"/>
  <rect x="{ICON_X-FRAME_PAD+14}" y="{ICON_Y-FRAME_PAD+14}"
        width="{ICON_S+FRAME_PAD*2}" height="{ICON_S+FRAME_PAD*2}"
        fill="{INK}" opacity="0.10"/>
  <g transform="translate({ICON_X} {ICON_Y}) scale({ICON_S/1024})">
    {icon_body}
  </g>

  <!-- 文字区 -->
  <g font-family="Menlo, monospace">
    <text x="648" y="196" font-size="30" letter-spacing="7" fill="{VERM}">LOCAL WORKBENCH // OBSIDIAN VAULT</text>
  </g>

  <text x="644" y="356" font-family="Georgia, 'Noto Serif CJK SC', serif"
        font-size="176" font-weight="700" letter-spacing="-3" fill="{INK}">ObsidianWork</text>

  <!-- 分隔线：墨色 + 朱砂起段 -->
  <rect x="648" y="404" width="150" height="6" fill="{VERM}"/>
  <rect x="798" y="404" width="1152" height="6" fill="{INK}"/>

  <text x="648" y="496" font-family="'Songti SC', 'Noto Serif CJK SC', serif"
        font-size="50" fill="{INK}">与 Obsidian 实时互通的本地业务工作台</text>

  <text x="648" y="566" font-family="Menlo, monospace" font-size="28" fill="{MUTED}">Markdown is the database · Obsidian is the editor · this is the workbench</text>

  <g font-family="Menlo, monospace" font-size="24" fill="{FAINT}" letter-spacing="3">
    <text x="648" y="634">ZERO DEPENDENCIES</text>
    <text x="1024" y="634">NO BUILD STEP</text>
    <text x="1304" y="634">macOS</text>
    <text x="1456" y="634">MIT</text>
  </g>
</svg>
'''

(OUT / "banner.svg").write_text(svg, encoding="utf-8")
subprocess.run(["rsvg-convert", "-w", str(W), "-h", str(H),
                str(OUT / "banner.svg"), "-o", str(OUT / "banner-2560.png")], check=True)
print(f"✓ assets/banner.svg  ({(OUT/'banner.svg').stat().st_size} bytes)")
print(f"✓ assets/banner-2560.png  ({(OUT/'banner-2560.png').stat().st_size} bytes)")
