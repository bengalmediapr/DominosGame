import * as THREE from 'three';
import { loadGlb } from './assets';
import { feltTexture, tileBackTexture, tileFaceTexture, woodTexture } from './textures';

/** World units: 1 = the width of a domino tile (~2.5 cm). Table top is at y = 0. */
export const TILE_T = 0.3;
export const TABLE_HALF = 17;
export const FLOOR_Y = -30;
export const SEAT_DIST = 26;

const mat = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });

function mesh(geo: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

// ---------- tiles ----------

const IVORY = '#ece6d6';
const tileBox = new THREE.BoxGeometry(1, TILE_T, 2);
const tileSideMat = mat(IVORY, { roughness: 0.38 });
const facePlane = new THREE.PlaneGeometry(0.96, 1.96);
const faceMats = new Map<string, THREE.MeshStandardMaterial>();
let backMat: THREE.MeshStandardMaterial | null = null;

/** Shape from the Domino_Generator.blend brick (rounded edges), split into sides / face / back. */
let brick: THREE.BufferGeometry | null = null;

function buildBrick(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = source.clone();
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const size = b.getSize(new THREE.Vector3());
  const center = b.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -center.y, -center.z);
  // 1 wide, 2 long (like the board layout), TILE_T thick.
  geo.scale(1 / size.x, TILE_T / size.y, 2 / size.z);
  // Planar UVs over the top and bottom so the face textures cover the whole tile.
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) + 0.5;
    uv[i * 2 + 1] = 1 - (pos.getZ(i) + 1) / 2;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Order triangles by surface: 0 = sides (ivory), 1 = face (+y, pips), 2 = back (-y).
  const index = geo.getIndex() ?? new THREE.BufferAttribute(Uint32Array.from({ length: pos.count }, (_, i) => i), 1);
  const buckets: number[][] = [[], [], []];
  const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const [i0, i1, i2] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    a.fromBufferAttribute(pos, i0);
    bb.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    n.subVectors(c, bb).cross(a.clone().sub(bb)).normalize();
    buckets[n.y > 0.8 ? 1 : n.y < -0.8 ? 2 : 0].push(i0, i1, i2);
  }
  geo.setIndex(buckets.flat());
  geo.clearGroups();
  let start = 0;
  buckets.forEach((tris, materialIndex) => {
    geo.addGroup(start, tris.length, materialIndex);
    start += tris.length;
  });
  geo.computeVertexNormals();
  return geo;
}

/** Swaps the placeholder box for the modelled domino once it has loaded. */
export function loadDominoModel(): Promise<void> {
  return loadGlb('domino').then(({ scene }) => {
    let found: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !found) found = o as THREE.Mesh;
    });
    if (found) brick = buildBrick((found as THREE.Mesh).geometry);
  });
}

function faceMaterial(top: number, bottom: number): THREE.MeshStandardMaterial {
  const key = `${top}-${bottom}`;
  let m = faceMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tileFaceTexture(top, bottom), roughness: 0.32 });
    faceMats.set(key, m);
  }
  return m;
}

/** A domino lying flat, face up, `top` value toward -z. */
export function makeTile(top: number, bottom: number, faceUp = true): THREE.Group {
  const g = new THREE.Group();
  backMat ??= new THREE.MeshStandardMaterial({ map: tileBackTexture(), roughness: 0.32 });
  if (brick) {
    g.add(mesh(brick, [tileSideMat, faceMaterial(top, bottom), backMat]));
  } else {
    g.add(mesh(tileBox, tileSideMat));
    const face = new THREE.Mesh(facePlane, faceMaterial(top, bottom));
    face.rotation.x = -Math.PI / 2;
    face.position.y = TILE_T / 2 + 0.002;
    const back = new THREE.Mesh(facePlane, backMat);
    back.rotation.x = Math.PI / 2;
    back.position.y = -TILE_T / 2 - 0.002;
    g.add(face, back);
  }
  if (!faceUp) g.rotation.z = Math.PI;
  return g;
}

// ---------- table ----------

/** Simple stand-in shown until the modelled table has loaded. */
function placeholderTable(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#ffffff', { map: woodTexture('#7a3e1e', '#2a1206'), roughness: 0.55 });
  const felt = mesh(new THREE.BoxGeometry(TABLE_HALF * 2 - 3, 0.4, TABLE_HALF * 2 - 3), mat('#ffffff', { map: feltTexture(), roughness: 0.95 }));
  felt.position.y = -0.2;
  const frame = mesh(new THREE.BoxGeometry(TABLE_HALF * 2, 3, TABLE_HALF * 2), wood);
  frame.position.y = -1.9;
  g.add(felt, frame);
  return g;
}

/** A cold beer can (unbranded) for one of the cup holders. */
function beerCan(): THREE.Group {
  const g = new THREE.Group();
  const can = mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.6, 20), mat('#e8e8f0', { metalness: 0.8, roughness: 0.3 }));
  const label = mesh(new THREE.CylinderGeometry(1.22, 1.22, 2.4, 20, 1, true), mat('#41a8e6', { metalness: 0.5, roughness: 0.4 }));
  g.add(can, label);
  return g;
}

/**
 * The folding Puerto Rican domino table (Sketchfab model, see assets-src/table). It is scaled so the
 * board is TABLE_HALF*2 wide, the felt sits at y = 0 where tiles are laid, and the legs reach the floor.
 */
export function makeTable(): THREE.Group {
  const g = new THREE.Group();
  const placeholder = placeholderTable();
  g.add(placeholder);
  loadGlb('table').then(({ scene }) => {
    const model = scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    let feltTop = box.max.y;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      if (/tope/i.test((m.material as THREE.Material).name)) feltTop = new THREE.Box3().setFromObject(m).max.y;
    });
    const s = (TABLE_HALF * 2) / (box.max.x - box.min.x);
    const sy = -FLOOR_Y / (feltTop - box.min.y);
    model.scale.set(s, sy, s);
    model.position.y = -feltTop * sy;
    g.remove(placeholder);
    g.add(model);
    const can = beerCan();
    can.position.set(TABLE_HALF - 2.1, 1.4, TABLE_HALF - 2.1);
    g.add(can);
  }).catch((err) => console.error('Could not load the table', err));
  return g;
}

// ---------- revolver ----------

export interface Revolver {
  group: THREE.Group;
  /** Spins about local +x (the barrel axis). */
  drum: THREE.Object3D;
}

/** Simple stand-in shown until the modelled revolver has loaded. */
function placeholderRevolver(drum: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#3c3f45', { metalness: 0.9, roughness: 0.35 });
  const barrel = mesh(new THREE.CylinderGeometry(0.38, 0.38, 5.2, 16), steel);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(3.3, 0.4, 0);
  const frame = mesh(new THREE.BoxGeometry(3.2, 1.9, 0.9), steel);
  const drumBody = mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.9, 18), steel);
  drumBody.rotation.z = Math.PI / 2;
  drum.add(drumBody);
  const handle = mesh(new THREE.BoxGeometry(1.3, 3.6, 0.95), mat('#6b3519', { roughness: 0.6 }));
  handle.position.set(-1.7, -2, 0);
  handle.rotation.z = -0.35;
  g.add(barrel, frame, handle);
  return g;
}

/**
 * Revolver pointing along +x, grip down, about 9 units long (model in assets-src/revolver). The
 * cylinder's axis is the local origin.
 */
export function makeRevolver(): Revolver {
  const group = new THREE.Group();
  const drum = new THREE.Group();
  const placeholder = placeholderRevolver(drum);
  group.add(placeholder, drum);
  loadGlb('revolver').then(({ scene }) => {
    const model = scene.clone(true);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      // The scene has no environment map for full metal to reflect, which would render it black.
      (m.material as THREE.MeshStandardMaterial).metalness = 0.6;
    });
    group.remove(placeholder);
    drum.clear();
    for (const node of [...model.children]) {
      if (node.name === 'cylinder') drum.add(node);
      else group.add(node);
    }
  }).catch((err) => console.error('Could not load the revolver', err));
  return { group, drum };
}
