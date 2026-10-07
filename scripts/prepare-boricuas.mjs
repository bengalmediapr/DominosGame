// Shrinks the four Boricua characters (assets-src/boricuas, rigged, no animations) for the game:
// duplicate data merged, unused data dropped, vertices quantized and textures capped at 1024 px.
// Output: public/models/<name>.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const name of ['don_rafa', 'nico', 'yadiel', 'tito']) {
  const doc = await io.read(`assets-src/boricuas/${name}.glb`);
  await doc.transform(
    dedup(),
    weld(),
    prune({ keepAttributes: true }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
    quantize(),
  );
  await io.write(`public/models/${name}.glb`, doc);
  console.log(name, 'done');
}
