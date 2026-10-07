"""Shrinks the revolver textures to 1024 px and packs AO / roughness / metal into one glTF ORM map.

Input: assets-src/revolver/textures (d = colour, n = normal, a = AO, g = gloss, m = metal).
Output: assets-src/revolver/packed, read by scripts/blender/export-revolver.py.
"""
from pathlib import Path
from PIL import Image, ImageOps

src = Path('assets-src/revolver/textures')
out = Path('assets-src/revolver/packed')
out.mkdir(exist_ok=True)
size = (1024, 1024)
load = lambda k, mode: Image.open(src / f'rev_{k}.tga.png').convert(mode).resize(size, Image.LANCZOS)
load('d', 'RGB').save(out / 'revolver_color.jpg', quality=88)
load('n', 'RGB').save(out / 'revolver_normal.jpg', quality=92)
Image.merge('RGB', (load('a', 'L'), ImageOps.invert(load('g', 'L')), load('m', 'L'))).save(out / 'revolver_orm.jpg', quality=90)
