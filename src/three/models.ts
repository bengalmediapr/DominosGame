import * as THREE from 'three';
import {
  feltTexture, flagTexture, muralTexture, neonTexture, tileBackTexture, tileFaceTexture, woodTexture,
} from './textures';

/** World units: 1 = the width of a domino tile (~2.5 cm). Table top is at y = 0. */
export const TILE_T = 0.34;
export const TABLE_HALF = 17;
export const FLOOR_Y = -30;
export const SEAT_DIST = 24;

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

// ---------- characters ----------

export interface Character {
  group: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  gunArm: THREE.Object3D;
  /** Materials to grey out when the character is eliminated. */
  tint: THREE.MeshStandardMaterial[];
  /** Where the name tag goes (chest), in the character's local space. */
  tagAnchor: THREE.Vector3;
}

interface CharacterSpec {
  skin: string;
  shirt: string;
  pants: string;
  decorate(head: THREE.Group, torso: THREE.Group, add: (m: THREE.Mesh) => THREE.Mesh, tinted: (c: string, o?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial): void;
}

function eye(add: (m: THREE.Mesh) => THREE.Mesh, x: number, y: number, z: number, r = 0.8): void {
  const white = add(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat('#ffffff', { roughness: 0.2 })));
  white.position.set(x, y, z);
  const pupil = add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 10, 8), mat('#111', { roughness: 0.1 })));
  pupil.position.set(x, y, z - r * 0.7);
}

const SPECS: CharacterSpec[] = [
  // Papo: vejigante mask (Loíza / Ponce carnival) with coconut-shell horns.
  {
    skin: '#8d5524', shirt: '#ffcc00', pants: '#1b1b1f',
    decorate(head, torso, add, tinted) {
      const mask = add(new THREE.Mesh(new THREE.SphereGeometry(4.6, 24, 18), tinted('#e4002b')));
      mask.scale.set(1, 1.05, 1);
      head.add(mask);
      const hornMats = [tinted('#ffcc00'), tinted('#00a86b'), tinted('#ffffff'), tinted('#0050f0')];
      const horns: [number, number, number, number][] = [
        [0, 5.2, -0.5, 0], [-3, 4.2, -1.5, 0.6], [3, 4.2, -1.5, -0.6], [-4.8, 1.5, -1.5, 1.3], [4.8, 1.5, -1.5, -1.3],
        [-2.2, 3.5, -3.6, 0.5], [2.2, 3.5, -3.6, -0.5],
      ];
      horns.forEach(([x, y, z, rz], i) => {
        const horn = add(new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.2, 12), hornMats[i % hornMats.length]));
        horn.position.set(x, y, z);
        horn.rotation.set(-0.5, 0, rz);
        head.add(horn);
      });
      for (let i = 0; i < 18; i++) {
        const dot = add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), tinted(i % 2 ? '#ffcc00' : '#000000')));
        const a = (i / 18) * Math.PI * 2;
        dot.position.set(Math.cos(a) * 4.3, 1.2 + Math.sin(a * 2) * 1.5, -Math.abs(Math.sin(a)) * 1.6 - 1.2);
        head.add(dot);
      }
      const mouth = add(new THREE.Mesh(new THREE.BoxGeometry(4, 1.3, 1), mat('#111')));
      mouth.position.set(0, -2, -4);
      head.add(mouth);
      for (let i = 0; i < 6; i++) {
        const tooth = add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), mat('#ffffff')));
        tooth.position.set(-1.6 + i * 0.64, -1.55, -4.5);
        tooth.rotation.x = Math.PI;
        head.add(tooth);
      }
      const dots = add(new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.5, 8, 24), tinted('#00a86b')));
      dots.rotation.x = Math.PI / 2;
      dots.position.y = 3;
      torso.add(dots);
    },
  },
  // Doña Lola: rolos in her hair under a scarf, big glasses, gold earrings.
  {
    skin: '#c68642', shirt: '#9b5de5', pants: '#3d2b56',
    decorate(head, _torso, add, tinted) {
      const scarf = add(new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.1), tinted('#f15bb5')));
      scarf.position.y = 0.6;
      head.add(scarf);
      for (let i = 0; i < 5; i++) {
        const rolo = add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.6, 12), tinted('#ff8fd8')));
        rolo.rotation.z = Math.PI / 2;
        rolo.position.set(-2.8 + i * 1.4, 3.6 - Math.abs(i - 2) * 0.5, -2.6 + Math.abs(i - 2) * 0.4);
        head.add(rolo);
      }
      for (const x of [-1.6, 1.6]) {
        const lens = add(new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.22, 8, 20), mat('#222')));
        lens.position.set(x, 0.6, -4.2);
        head.add(lens);
        const earring = add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.15, 8, 16), mat('#ffc93c', { metalness: 1, roughness: 0.2 })));
        earring.position.set(x * 2.7, -1.6, -0.4);
        earring.rotation.y = Math.PI / 2;
        head.add(earring);
      }
      const lips = add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), tinted('#c2185b')));
      lips.scale.set(1.4, 0.5, 0.5);
      lips.position.set(0, -2.1, -3.9);
      head.add(lips);
    },
  },
  // Cheo: jíbaro with a pava straw hat, mustache, guayabera and a cigar.
  {
    skin: '#a0673f', shirt: '#f4f1e6', pants: '#5b4636',
    decorate(head, torso, add, tinted) {
      const straw = tinted('#e6c46a', { roughness: 0.9 });
      const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.4, 32), straw));
      brim.position.y = 3.2;
      const crown = add(new THREE.Mesh(new THREE.ConeGeometry(4.2, 4.5, 24), straw));
      crown.position.y = 5.4;
      const band = add(new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.8, 24, 1, true), tinted('#1b1b1f')));
      band.position.y = 4;
      head.add(brim, crown, band);
      const stache = add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 0.9), mat('#1b1b1f')));
      stache.position.set(0, -1.2, -4.1);
      head.add(stache);
      const cigar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3, 8), mat('#5d3a1a')));
      cigar.rotation.x = Math.PI / 2.4;
      cigar.position.set(1.2, -2.1, -5);
      const ember = add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a1f' }) as unknown as THREE.MeshStandardMaterial));
      ember.position.set(1.2, -2.6, -6.3);
      head.add(cigar, ember);
      for (const x of [-1.6, 1.6]) {
        const pocket = add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 0.3), tinted('#e0dccb')));
        pocket.position.set(x, 1, -4.9);
        torso.add(pocket);
      }
    },
  },
];

/** Seated character for seats 1-3, built facing -z (toward the table). */
export function makeCharacter(index: number): Character {
  const spec = SPECS[index % SPECS.length];
  const tint: THREE.MeshStandardMaterial[] = [];
  const tinted = (c: string, o: THREE.MeshStandardMaterialParameters = {}) => {
    const m = mat(c, o);
    tint.push(m);
    return m;
  };
  const add = (m: THREE.Mesh) => {
    m.castShadow = true;
    return m;
  };
  const group = new THREE.Group();
  const skin = tinted(spec.skin, { roughness: 0.6 });
  const shirt = tinted(spec.shirt);

  // Chair
  const chairWood = mat('#4a2511');
  const seat = mesh(new THREE.BoxGeometry(14, 1.5, 12), chairWood);
  seat.position.set(0, -12, 2);
  const back = mesh(new THREE.BoxGeometry(14, 22, 1.5), chairWood);
  back.position.set(0, -1, 8.5);
  group.add(seat, back);
  for (const [x, z] of [[-6, -3], [6, -3], [-6, 7], [6, 7]]) {
    const leg = mesh(new THREE.BoxGeometry(1.2, 18, 1.2), chairWood);
    leg.position.set(x, -21, z);
    group.add(leg);
  }

  const torso = new THREE.Group();
  torso.position.set(0, -4, 2);
  const body = add(new THREE.Mesh(new THREE.CapsuleGeometry(5, 8, 8, 16), shirt));
  body.position.y = 4;
  torso.add(body);
  group.add(torso);

  const head = new THREE.Group();
  head.position.set(0, 13, 0);
  const skull = add(new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 18), skin));
  head.add(skull);
  const nose = add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), skin));
  nose.position.set(0, -0.3, -4.2);
  head.add(nose);
  eye((m) => { head.add(m); return add(m); }, -1.6, 0.8, -3.6);
  eye((m) => { head.add(m); return add(m); }, 1.6, 0.8, -3.6);
  torso.add(head);
  spec.decorate(head, torso, add, tinted);

  // Arms: left resting on the table, right one (gunArm) pivots at the shoulder.
  const makeArm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 6, 9.5, 0);
    const upper = add(new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 7, 6, 10), shirt));
    upper.position.y = -4;
    const hand = add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), skin));
    hand.position.y = -9;
    pivot.add(upper, hand);
    pivot.rotation.x = 1.1;
    torso.add(pivot);
    return pivot;
  };
  makeArm(-1);
  const gunArm = makeArm(1);

  return { group, head, torso, gunArm, tint, tagAnchor: new THREE.Vector3(0, 3, -3.5) };
}
