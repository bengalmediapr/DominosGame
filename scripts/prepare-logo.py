"""Turns the logo (black on transparent, assets-src/logo/capicu-logo-original.png) into cropped PNGs:
public/logo.png in white for the game's dark screens, and assets-src/logo/capicu-logo-black.png for
light backgrounds (store pages, printing). The original's transparency is kept, so edges stay smooth."""
from PIL import Image

src = Image.open('assets-src/logo/capicu-logo-original.png').convert('RGBA')
alpha = src.getchannel('A')
box = alpha.getbbox()
pad = 12
box = (max(0, box[0] - pad), max(0, box[1] - pad), min(src.width, box[2] + pad), min(src.height, box[3] + pad))
alpha = alpha.crop(box)
for colour, out in [((255, 255, 255), 'public/logo.png'), ((0, 0, 0), 'assets-src/logo/capicu-logo-black.png')]:
    img = Image.new('RGBA', alpha.size, colour + (0,))
    img.putalpha(alpha)
    img.save(out, optimize=True)
    print(out, img.size)
