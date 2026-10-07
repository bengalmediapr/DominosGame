"""Removes third-party brand marks from the Sketchfab domino table textures.

The tablero (frame) has a beer brand's name twice and the tope (felt) has its logo in the middle.
Each mark is covered with a feathered patch of the same texture taken from right beside it.
Usage: python3 scripts/clean-table-textures.py assets-src/table/textures assets-src/table/textures-clean
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

src_dir, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)

# (target box, source offset) in 2048px texture coordinates.
FRAME_MARKS = [
    ((190, 470, 505, 570), (320, 0)),     # upper-left brand name: copy wood from its right
    ((1130, 1900, 1455, 2000), (-330, 0)),  # lower brand name: copy wood from its left
]
FELT_LOGO = ((1000, 990), 440)  # center and radius of the felt logo
FELT_CLEAN = (80, 80, 580, 580)  # a corner of plain felt, far from the logo


def patch(im, box, offset, mask):
    x0, y0, x1, y1 = box
    dx, dy = offset
    piece = im.crop((x0 + dx, y0 + dy, x1 + dx, y1 + dy))
    im.paste(piece, (x0, y0), mask)


def rect_mask(w, h, feather=14):
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rectangle((feather, feather, w - feather, h - feather), fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather / 2))


for name in sorted(os.listdir(src_dir)):
    im = Image.open(os.path.join(src_dir, name))
    mode = im.mode
    im = im.convert('RGB')
    if name.startswith('tablero_'):
        for box, offset in FRAME_MARKS:
            patch(im, box, offset, rect_mask(box[2] - box[0], box[3] - box[1]))
    elif name.startswith('tope_'):
        (cx, cy), r = FELT_LOGO
        # Plain felt patch: a clean corner mirrored 2x2 (no seams), tinted to the felt around the logo.
        tile = im.crop(FELT_CLEAN)
        w, h = tile.size
        felt = Image.new('RGB', (w * 2, h * 2))
        felt.paste(tile, (0, 0))
        felt.paste(tile.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
        felt.paste(tile.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
        felt.paste(tile.transpose(Image.ROTATE_180), (w, h))
        felt = felt.resize((2 * r, 2 * r))
        # Felt colour around the logo: average of four boxes just outside it.
        boxes = [(cx - r - 160, cy - 80, cx - r - 20, cy + 80), (cx + r + 20, cy - 80, cx + r + 160, cy + 80),
                 (cx - 80, cy - r - 160, cx + 80, cy - r - 20), (cx - 80, cy + r + 20, cx + 80, cy + r + 160)]
        samples = [im.crop(b).resize((1, 1), Image.BOX).getpixel((0, 0)) for b in boxes]
        ring = tuple(sum(c[k] for c in samples) / len(samples) for k in range(3))
        mean = felt.resize((1, 1), Image.BOX).getpixel((0, 0))
        felt = Image.merge('RGB', [band.point(lambda v, k=k: max(0, min(255, round(v * ring[k] / max(mean[k], 1)))))
                                   for k, band in enumerate(felt.split())])
        m = Image.new('L', (2 * r, 2 * r), 0)
        ImageDraw.Draw(m).ellipse((50, 50, 2 * r - 50, 2 * r - 50), fill=255)
        im.paste(felt, (cx - r, cy - r), m.filter(ImageFilter.GaussianBlur(28)))
    im.convert(mode if mode in ('RGB', 'L') else 'RGB').save(os.path.join(out_dir, name), quality=92)
    print('cleaned' if name.startswith(('tablero_', 'tope_')) else 'copied ', name)
