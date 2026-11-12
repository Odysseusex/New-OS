#!/usr/bin/env python3
"""Contact sheet of stills:  python3 tools/sheet.py out/stills out/sheet.png [--cols 4] [--width 640]
Each tile is labelled with its time (taken from the file name t-SSS.SS.png)."""
import sys, os, re
from PIL import Image, ImageDraw, ImageFont
args = sys.argv[1:]
def opt(name, default):
    if "--" + name in args:
        i = args.index("--" + name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
cols = int(opt("cols", 4)); width = int(opt("width", 640))
src, out = args[0], args[1]
files = sorted(f for f in os.listdir(src) if f.endswith(".png"))
tiles = []
for f in files:
    im = Image.open(os.path.join(src, f)).convert("RGB")
    h = round(im.height * width / im.width)
    tiles.append((f, im.resize((width, h), Image.LANCZOS)))
if not tiles: sys.exit("no stills in " + src)
h = tiles[0][1].height; pad = 8; label = 30
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (width + pad) + pad, rows * (h + label + pad) + pad), (34, 34, 34))
d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
except Exception: font = ImageFont.load_default()
for i, (f, im) in enumerate(tiles):
    x = pad + (i % cols) * (width + pad); y = pad + (i // cols) * (h + label + pad)
    m = re.search(r"(\d+\.\d+)\.png$", f)
    d.text((x + 4, y + 3), (m.group(1).lstrip("0") or "0") + " s" if m else f, fill=(255, 220, 150), font=font)
    sheet.paste(im, (x, y + label))
sheet.save(out)
print(out, sheet.size)
