import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { star } from '../ui/tileSvg';

/**
 * Seated characters built on KayKit's CC0 "Adventurers" rig (www.kaylousberg.com), stripped of their
 * fantasy gear by scripts/prepare-models.mjs and re-dressed here as people from a Puerto Rican chinchorro.
 */

export interface Avatar {
  root: THREE.Group;
  head: THREE.Object3D;
  handSlot: THREE.Object3D;
  /** Name-tag anchor in root space. */
  tagAnchor: THREE.Vector3;
  /** 0..1: arm raised with the revolver against the temple. */
  aim: number;
  /** 0..1: slumped over after losing at the roulette. */
  dead: number;
  /** 0..1: flinch right after an empty click. */
  flinch: number;
  update(dt: number): void;
  /** Rotation, in hand-slot space, that points an object's +x at the head with +y up (for the revolver). */
  aimAtHead(): THREE.Quaternion;
  setGreyed(on: boolean): void;
}

interface Look {
  file: string;
  /** Atlas swatch "col,row" -> new colour (keeps the swatch's shading). */
  recolor: Record<string, string>;
  dress(head: THREE.Object3D, add: (m: THREE.Mesh) => THREE.Mesh): void;
}

const mat = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });

/** Accessories are built in head-bone space, where the head is roughly 1.2 units wide and faces +z. */
const LOOKS: Record<string, Look> = {
  // Wiso: blue shirt, jeans and a Puerto Rico flag cap.
  wiso: {
    file: 'Knight',
    recolor: { '0,0': '#d6a57a', '1,0': '#1b1b1f', '3,0': '#3d7cc9', '7,0': '#2f66ad', '2,1': '#f4f4f4', '7,1': '#24324a', '4,0': '#24324a', '6,0': '#5b3a22' },
    dress(head, add) {
      const cap = add(new THREE.Mesh(new THREE.SphereGeometry(0.66, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e4002b')));
      cap.position.set(0, 0.62, -0.02);
      cap.scale.set(1, 0.62, 1.05);
      const visor = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 24, 1, false, -Math.PI / 2, Math.PI), mat('#0050f0')));
      visor.position.set(0, 0.62, 0.45);
      visor.rotation.x = 0.12;
      const shape = new THREE.Shape();
      const pts = star(0, 0, 0.13).slice(1, -1).split('L').map((p) => p.split(',').map(Number));
      pts.forEach(([x, y], i) => (i ? shape.lineTo(x, -y) : shape.moveTo(x, -y)));
      const badge = add(new THREE.Mesh(new THREE.ShapeGeometry(shape), mat('#ffffff')));
      badge.position.set(0, 0.86, 0.58);
      badge.rotation.x = -0.45;
      head.add(cap, visor, badge);
    },
  },
  // Papo: red and yellow, with a vejigante carnival mask pushed up on his head.
  papo: {
    file: 'Mage',
    recolor: { '0,0': '#9a6440', '0,1': '#c8102e', '7,1': '#1b1b1f', '3,0': '#f2c230', '4,0': '#f2c230', '2,2': '#f2c230', '3,2': '#2a2a35' },
    dress(head, add) {
      const mask = new THREE.Group();
      const shell = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.8), mat('#e4002b')));
      shell.scale.set(1.05, 0.85, 0.7);
      mask.add(shell);
      const colors = ['#f2c230', '#00a86b', '#ffffff', '#0050f0'];
      [[0, 0.62, 0], [-0.32, 0.52, 0.5], [0.32, 0.52, -0.5], [-0.5, 0.25, 1.1], [0.5, 0.25, -1.1]].forEach(([x, y, rz], i) => {
        const horn = add(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 10), mat(colors[i % colors.length])));
        horn.position.set(x, y, 0.05);
        horn.rotation.z = rz;
        mask.add(horn);
      });
      for (let i = 0; i < 10; i++) {
        const dot = add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(i % 2 ? '#f2c230' : '#111111')));
        const a = (i / 10) * Math.PI * 2;
        dot.position.set(Math.cos(a) * 0.4, 0.15 + Math.sin(a) * 0.18, 0.3);
        mask.add(dot);
      }
      mask.position.set(0, 0.85, -0.15);
      mask.rotation.x = -0.6;
      head.add(mask);
    },
  },
  // Doña Lola: purple and pink blouse, rolos in her hair under a scarf, round glasses.
  lola: {
    file: 'Rogue',
    recolor: { '0,0': '#c68642', '1,0': '#2e2420', '0,1': '#9b5de5', '1,1': '#f15bb5', '3,2': '#3d2b56', '7,1': '#4a2f5c' },
    dress(head, add) {
      const scarf = add(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 10, 28), mat('#f15bb5')));
      scarf.position.set(0, 0.55, 0);
      scarf.rotation.x = Math.PI / 2 - 0.25;
      head.add(scarf);
      for (let i = 0; i < 5; i++) {
        const rolo = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 12), mat(i % 2 ? '#ff8fd8' : '#7fd1ff')));
        rolo.rotation.z = Math.PI / 2;
        rolo.position.set(-0.4 + i * 0.2, 0.78 - Math.abs(i - 2) * 0.05, 0.12 - Math.abs(i - 2) * 0.06);
        head.add(rolo);
      }
      for (const x of [-0.24, 0.24]) {
        const lens = add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 20), mat('#222222', { metalness: 0.6 })));
        lens.position.set(x, 0.3, 0.6);
        head.add(lens);
      }
      const bridge = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.03), mat('#222222')));
      bridge.position.set(0, 0.32, 0.6);
      head.add(bridge);
    },
  },
  // Cheo: a jíbaro in a white guayabera with a pava straw hat and a cigar.
  cheo: {
    file: 'Barbarian',
    recolor: { '0,0': '#a0673f', '1,0': '#dcd6cc', '1,1': '#f4f1e6', '0,1': '#ece7da', '2,1': '#e8e2d0', '7,0': '#5b4636', '3,2': '#7a6a4f' },
    dress(head, add) {
      const straw = mat('#e6c46a', { roughness: 0.9 });
      const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.05, 32), straw));
      brim.position.y = 0.72;
      const crown = add(new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.62, 24), straw));
      crown.position.y = 1.02;
      const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.52, 0.1, 24, 1, true), mat('#1b1b1f')));
      band.position.y = 0.8;
      head.add(brim, crown, band);
      const cigar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), mat('#5d3a1a')));
      cigar.rotation.x = Math.PI / 2.3;
      cigar.position.set(0.18, -0.05, 0.75);
      const ember = add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a1f' }) as unknown as THREE.MeshStandardMaterial));
      ember.position.set(0.18, -0.12, 0.95);
      head.add(cigar, ember);
    },
  },
};

/** Which look sits in which seat. Seat 0 is the host (or you, offline). */
export const SEAT_LOOKS = ['wiso', 'papo', 'lola', 'cheo'] as const;

function recolorAtlas(material: THREE.MeshStandardMaterial, swatches: Record<string, string>): void {
  const src = material.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!src) return;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const cw = c.width / 8;
  const ch = c.height / 4;
  for (const [key, hex] of Object.entries(swatches)) {
    const [cx, cy] = key.split(',').map(Number);
    const img = g.getImageData(cx * cw, cy * ch, cw, ch);
    const d = img.data;
    let avg = 0;
    for (let i = 0; i < d.length; i += 4) avg += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    avg /= d.length / 4;
    // Work in sRGB, like the texture's pixels.
    const rgb = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
    for (let i = 0; i < d.length; i += 4) {
      const k = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / Math.max(avg, 1);
      d[i] = Math.min(255, rgb[0] * k);
      d[i + 1] = Math.min(255, rgb[1] * k);
      d[i + 2] = Math.min(255, rgb[2] * k);
    }
    g.putImageData(img, cx * cw, cy * ch);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = material.map!.magFilter;
  tex.minFilter = material.map!.minFilter;
  material.map = tex;
  material.needsUpdate = true;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();
const loadModel = (file: string) => {
  if (!cache.has(file)) cache.set(file, loader.loadAsync(`./models/${file}.glb`) as never);
  return cache.get(file)!;
};

/** Height of the seated model in its own units, used to scale it to the table. */
const SEATED_HEIGHT = 2.5;

// Arm pose for "revolver at the temple", as rotations added on top of the seated animation.
// Upper arm raised out to the side, forearm folded back so the hand is beside the head.
const AIM = {
  upper: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.4, 0)),
  lower: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.6, 0)),
};

export async function loadAvatar(look: (typeof SEAT_LOOKS)[number], worldHeight: number): Promise<Avatar> {
  const spec = LOOKS[look];
  const gltf = await loadModel(spec.file);
  const model = cloneSkinned(gltf.scene) as THREE.Group;
  const tint: THREE.MeshStandardMaterial[] = [];
  const recolored = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const original = m.material as THREE.MeshStandardMaterial;
    if (!recolored.has(original)) {
      const copy = original.clone();
      recolorAtlas(copy, spec.recolor);
      recolored.set(original, copy);
      tint.push(copy);
    }
    m.material = recolored.get(original)!;
  });

  // GLTFLoader strips '.' from node names: "handslot.r" becomes "handslotr".
  const bone = (name: string) => {
    const b = model.getObjectByName(name.replace(/\./g, ''));
    if (!b) throw new Error(`Bone ${name} not found in ${spec.file}`);
    return b;
  };
  const head = bone('head');
  const handSlot = bone('handslot.r');
  const upper = bone('upperarm.r');
  const lower = bone('lowerarm.r');
  const chest = bone('chest');
  const accessories: THREE.MeshStandardMaterial[] = [];
  spec.dress(head, (mesh) => {
    mesh.castShadow = true;
    if ((mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) accessories.push(mesh.material as THREE.MeshStandardMaterial);
    return mesh;
  });

  const root = new THREE.Group();
  root.add(model);
  model.rotation.y = Math.PI; // KayKit faces +z; seats face the table at -z.
  root.scale.setScalar(worldHeight / SEATED_HEIGHT);

  const mixer = new THREE.AnimationMixer(model);
  const clip = (n: string) => gltf.animations.find((a) => a.name === n)!;
  const idle = mixer.clipAction(clip('Sit_Chair_Idle'));
  idle.time = Math.random() * 2;
  idle.play();

  const q = new THREE.Quaternion();
  const avatar: Avatar = {
    root, head, handSlot,
    tagAnchor: new THREE.Vector3(0, 1.25, 0.35),
    aim: 0, dead: 0, flinch: 0,
    update(dt) {
      mixer.update(dt);
      if (avatar.aim > 0) {
        upper.quaternion.slerp(q.copy(upper.quaternion).multiply(AIM.upper), avatar.aim);
        lower.quaternion.slerp(q.copy(lower.quaternion).multiply(AIM.lower), avatar.aim);
        head.rotation.z -= 0.15 * avatar.aim;
      }
      if (avatar.flinch > 0) head.rotation.x -= 0.25 * Math.sin(avatar.flinch * Math.PI);
      if (avatar.dead > 0) {
        chest.rotation.x += 0.55 * avatar.dead;
        chest.rotation.z += 0.35 * avatar.dead;
        head.rotation.x += 0.6 * avatar.dead;
        head.rotation.z += 0.5 * avatar.dead;
        upper.rotation.z -= 0.6 * avatar.dead;
      }
    },
    aimAtHead() {
      const before = avatar.aim;
      avatar.aim = 1;
      avatar.update(0);
      model.updateMatrixWorld(true);
      const hand = handSlot.getWorldPosition(new THREE.Vector3());
      const target = head.getWorldPosition(new THREE.Vector3());
      const x = target.sub(hand).normalize();
      const z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      const local = handSlot.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world);
      avatar.aim = before;
      avatar.update(0);
      return local;
    },
    setGreyed(on) {
      for (const m of [...tint, ...accessories]) {
        m.userData.base ??= m.color.clone();
        m.color.copy(m.userData.base as THREE.Color);
        if (on) m.color.lerp(new THREE.Color('#3a3a44'), 0.7);
      }
    },
  };
  return avatar;
}

let chairModel: Promise<THREE.Group> | null = null;
/**
 * KayKit wooden chair (CC0), scaled to match the avatars. `legExtension` (model units) stretches it
 * down so a raised avatar's chair still reaches the floor.
 */
export async function loadChair(worldHeight: number, legExtension = 0): Promise<THREE.Group> {
  chairModel ??= loader.loadAsync('./models/chair.glb').then((g) => g.scene);
  const chair = (await chairModel).clone();
  chair.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = m.receiveShadow = true;
  });
  chair.scale.setScalar(worldHeight / SEATED_HEIGHT);
  chair.rotation.y = Math.PI; // match the avatars, which face -z
  if (legExtension > 0) {
    const seatHeight = 0.95;
    chair.scale.y *= (seatHeight + legExtension) / seatHeight;
    chair.position.y = -legExtension;
  }
  return chair;
}
