// Trims the CC0 KayKit source models in assets-src/ down to what the game uses and
// writes compact .glb files to public/models/. Run with: npm run models
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, quantize, resample } from '@gltf-transform/functions';
import { mkdirSync, copyFileSync } from 'node:fs';

const KEEP_ANIMATIONS = new Set(['Sit_Chair_Idle', 'Sit_Chair_Pose', 'Hit_A', 'Cheer', 'Interact']);
const KEEP_PARTS = /(_Body|_Head|_ArmLeft|_ArmRight|_LegLeft|_LegRight)$/;
const CHARACTERS = ['Mage', 'Rogue', 'Barbarian', 'Knight'];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync('public/models', { recursive: true });

for (const name of CHARACTERS) {
  const doc = await io.read(`assets-src/kaykit-characters/${name}.glb`);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    if (KEEP_ANIMATIONS.has(anim.getName())) continue;
    // Samplers keep their keyframe data alive unless disposed; prune() then drops the data.
    for (const sampler of anim.listSamplers()) sampler.dispose();
    for (const channel of anim.listChannels()) channel.dispose();
    anim.dispose();
  }
  // Weapons, shields, capes and hats: everything that isn't the body itself.
  for (const node of root.listNodes()) if (node.getMesh() && !KEEP_PARTS.test(node.getName())) node.dispose();
  await doc.transform(resample(), prune(), dedup(), quantize());
  await io.write(`public/models/${name}.glb`, doc);
}

const chair = await io.read('assets-src/kaykit-furniture/chair_A_wood.gltf');
await io.write('public/models/chair.glb', chair);
copyFileSync('assets-src/kaykit-characters/LICENSE.txt', 'public/models/LICENSE-kaykit.txt');
console.log('models written to public/models');
