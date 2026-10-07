// Optimises the San Juan house for the game.
// Input: assets-src/house/house-raw.glb (converted once from SanJuanModernHouse2.fbx; see docs).
// Output: public/models/house.glb, with meshes merged per material and quantized.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, quantize, weld } from '@gltf-transform/functions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('assets-src/house/house-raw.glb');
await doc.transform(dedup(), flatten(), weld(), join(), prune(), quantize());
const root = doc.getRoot();
console.log(`meshes ${root.listMeshes().length}, materials ${root.listMaterials().map((m) => m.getName()).join(', ')}`);
await io.write('public/models/house.glb', doc);
