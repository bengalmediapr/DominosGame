import * as THREE from 'three';
import {
  feltTexture, flagTexture, muralTexture, neonTexture, tileBackTexture, tileFaceTexture, woodTexture,
} from './textures';

/** World units: 1 = the width of a domino tile (~2.5 cm). Table top is at y = 0. */
export const TILE_T = 0.34;
export const TABLE_HALF = 17;
export const FLOOR_Y = -30;
export const SEAT_DIST = 26;

const mat = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

// ---------- tiles ----------

const tileBody = new THREE.BoxGeometry(1, TILE_T, 2);
const tileBodyMat = mat('#efe6d0', { roughness: 0.35 });
const facePlane = new THREE.PlaneGeometry(0.96, 1.96);
const faceMats = new Map<string, THREE.MeshStandardMaterial>();
let backMat: THREE.MeshStandardMaterial | null = null;

/** A domino lying flat, face up, `top` value toward -z. */
export function makeTile(top: number, bottom: number, faceUp = true): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(tileBody, tileBodyMat));
  const key = `${top}-${bottom}`;
  if (!faceMats.has(key)) faceMats.set(key, new THREE.MeshStandardMaterial({ map: tileFaceTexture(top, bottom), roughness: 0.3 }));
  backMat ??= new THREE.MeshStandardMaterial({ map: tileBackTexture(), roughness: 0.3 });
  const face = new THREE.Mesh(facePlane, faceMats.get(key)!);
  face.rotation.x = -Math.PI / 2;
  face.position.y = TILE_T / 2 + 0.002;
  const back = new THREE.Mesh(facePlane, backMat);
  back.rotation.x = Math.PI / 2;
  back.position.y = -TILE_T / 2 - 0.002;
  g.add(face, back);
  if (!faceUp) g.rotation.z = Math.PI;
  return g;
}

// ---------- table and room ----------

export function makeTable(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#ffffff', { map: woodTexture('#7a3e1e', '#2a1206'), roughness: 0.55 });
  const felt = mesh(new THREE.BoxGeometry(TABLE_HALF * 2 - 3, 0.4, TABLE_HALF * 2 - 3), mat('#ffffff', { map: feltTexture(), roughness: 0.95 }));
  felt.position.y = -0.2;
  g.add(felt);
  // Raised wooden rim with cup holders in the corners, like a real Puerto Rican domino table.
  const rimH = 1.2;
  for (let i = 0; i < 4; i++) {
    const rim = mesh(new THREE.BoxGeometry(TABLE_HALF * 2 + 1, rimH, 2.5), wood);
    const a = (i * Math.PI) / 2;
    rim.position.set(Math.sin(a) * (TABLE_HALF - 0.75), rimH / 2 - 0.4, Math.cos(a) * (TABLE_HALF - 0.75));
    rim.rotation.y = a;
    g.add(rim);
    const cup = mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.4, 20, 1, true), mat('#3a2010', { side: THREE.DoubleSide }));
    const corner = a + Math.PI / 4;
    cup.position.set(Math.sin(corner) * (TABLE_HALF + 1.6) * Math.SQRT2 * 0.72, 0.1, Math.cos(corner) * (TABLE_HALF + 1.6) * Math.SQRT2 * 0.72);
    g.add(cup);
  }
  const apron = mesh(new THREE.BoxGeometry(TABLE_HALF * 2, 3, TABLE_HALF * 2), wood);
  apron.position.y = -2;
  g.add(apron);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = mesh(new THREE.BoxGeometry(2, -FLOOR_Y - 3, 2), wood);
    leg.position.set(x * (TABLE_HALF - 2), (FLOOR_Y - 3) / 2, z * (TABLE_HALF - 2));
    g.add(leg);
  }
  // A cold Medalla-style beer can in one cup holder (unbranded).
  const can = mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.6, 20), mat('#e8e8f0', { metalness: 0.8, roughness: 0.3 }));
  can.position.set(TABLE_HALF + 0.3, 1.6, TABLE_HALF + 0.3);
  const label = mesh(new THREE.CylinderGeometry(1.22, 1.22, 2.4, 20, 1, true), mat('#0050f0', { metalness: 0.5, roughness: 0.4 }));
  label.position.copy(can.position);
  g.add(can, label);
  return g;
}

export interface Room {
  group: THREE.Group;
  fan: THREE.Object3D;
  bulbs: THREE.Mesh[];
  neon: THREE.Mesh;
}

export function makeRoom(): Room {
  const g = new THREE.Group();
  const W = 80;
  const H = 80;
  const floor = mesh(new THREE.PlaneGeometry(W * 2, W * 2), mat('#ffffff', { map: woodTexture('#4a2a17', '#1c0e06', 6), roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  g.add(floor);
  const wallMat = mat('#3b2a4a', { roughness: 0.95 });
  for (let i = 0; i < 4; i++) {
    const wall = mesh(new THREE.PlaneGeometry(W * 2, H), wallMat, false);
    const a = (i * Math.PI) / 2;
    wall.position.set(-Math.sin(a) * W, FLOOR_Y + H / 2, -Math.cos(a) * W);
    wall.rotation.y = a;
    wall.receiveShadow = true;
    g.add(wall);
  }
  const ceiling = mesh(new THREE.PlaneGeometry(W * 2, W * 2), mat('#1d1424'), false);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = FLOOR_Y + H;
  g.add(ceiling);

  // Neon sign over the far side of the table.
  const neon = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 18),
    new THREE.MeshBasicMaterial({ map: neonTexture('El Chinchorro', 'DOMINÓ • CERVEZA FRÍA'), transparent: true, fog: false }),
  );
  neon.position.set(0, 28, -W + 0.5);
  g.add(neon);

  // Mural of Old San Juan on the left wall, flag on the right wall.
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(120, 30), mat('#ffffff', { map: muralTexture(), roughness: 1 }));
  mural.position.set(-W + 0.5, FLOOR_Y + 30, 0);
  mural.rotation.y = Math.PI / 2;
  g.add(mural);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(36, 24), mat('#ffffff', { map: flagTexture(), roughness: 0.9 }));
  flag.position.set(W - 0.5, 22, -10);
  flag.rotation.y = -Math.PI / 2;
  g.add(flag);

  // Bar shelf with bottles under the sign.
  const shelf = mesh(new THREE.BoxGeometry(70, 1.5, 8), mat('#5a2d14'));
  shelf.position.set(0, 6, -W + 4);
  g.add(shelf);
  const bottleColors = ['#2e7d32', '#8d5524', '#c62828', '#f9a825', '#6d4c41', '#1565c0'];
  for (let i = 0; i < 16; i++) {
    const h = 6 + (i % 3) * 1.5;
    const b = mesh(new THREE.CylinderGeometry(1, 1.2, h, 10), mat(bottleColors[i % bottleColors.length], { roughness: 0.15, transparent: true, opacity: 0.85 }));
    b.position.set(-32 + i * 4.2, 6.75 + h / 2, -W + 4);
    g.add(b);
  }

  // String of party lights across the ceiling.
  const bulbs: THREE.Mesh[] = [];
  const bulbColors = ['#ff4f6a', '#ffd166', '#4d8dff', '#06d6a0', '#ff8fd8'];
  for (const z of [-40, 0, 40]) {
    for (let i = 0; i <= 20; i++) {
      const x = -W + (i / 20) * W * 2;
      const sag = Math.cos(((i - 10) / 10) * (Math.PI / 2)) * 6;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ color: bulbColors[(i + z / 40 + 5) % 5], fog: false }));
      bulb.position.set(x, FLOOR_Y + H - 6 - sag, z);
      bulbs.push(bulb);
      g.add(bulb);
    }
  }

  // Hanging lamp over the table and a ceiling fan.
  const shade = mesh(new THREE.ConeGeometry(7, 5, 24, 1, true), mat('#1f5c3a', { side: THREE.DoubleSide, metalness: 0.4, roughness: 0.4 }), false);
  shade.position.set(0, 34, 0);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 14), mat('#111'));
  cord.position.set(0, 43, 0);
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff3d0' }));
  lampBulb.position.set(0, 32, 0);
  g.add(shade, cord, lampBulb);

  const fan = new THREE.Group();
  fan.position.set(30, FLOOR_Y + H - 3, 30);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 2.5), mat('#6b4423'));
    blade.position.x = 7;
    const arm = new THREE.Group();
    arm.rotation.y = (i * Math.PI) / 2;
    arm.add(blade);
    fan.add(arm);
  }
  g.add(fan);
  return { group: g, fan, bulbs, neon };
}

// ---------- revolver ----------

/** Revolver pointing along +x, grip down, roughly 10 units long. */
export function makeRevolver(): { group: THREE.Group; drum: THREE.Object3D } {
  const g = new THREE.Group();
  const steel = mat('#3c3f45', { metalness: 0.9, roughness: 0.35 });
  const grip = mat('#6b3519', { roughness: 0.6 });
  const barrel = mesh(new THREE.CylinderGeometry(0.38, 0.38, 5.2, 16), steel);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(3.3, 0.4, 0);
  const rib = mesh(new THREE.BoxGeometry(5.2, 0.35, 0.3), steel);
  rib.position.set(3.3, 0.85, 0);
  const frame = mesh(new THREE.BoxGeometry(3.2, 1.9, 0.9), steel);
  frame.position.set(0, 0, 0);
  const drum = new THREE.Group();
  const drumBody = mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.9, 18), steel);
  drum.add(drumBody);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.92, 8), mat('#0b0b0d'));
    hole.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
    drum.add(hole);
  }
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0.3, 0.1, 0);
  const handle = mesh(new THREE.BoxGeometry(1.3, 3.6, 0.95), grip);
  handle.position.set(-1.7, -2, 0);
  handle.rotation.z = -0.35;
  const hammer = mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), steel);
  hammer.position.set(-1.6, 1.1, 0);
  hammer.rotation.z = 0.5;
  const guard = mesh(new THREE.TorusGeometry(0.7, 0.12, 8, 16, Math.PI), steel);
  guard.position.set(-0.3, -1, 0);
  guard.rotation.z = Math.PI;
  const trigger = mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), steel);
  trigger.position.set(-0.4, -1.1, 0);
  g.add(barrel, rib, frame, drum, handle, hammer, guard, trigger);
  return { group: g, drum };
}
