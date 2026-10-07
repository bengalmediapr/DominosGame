import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGlb } from './assets';

/**
 * The four Boricuas at the table (assets-src/boricuas, shrunk by scripts/prepare-boricuas.mjs): rigged
 * models with no animation clips, so their poses are built here from the skeleton. Each pose aims a
 * bone at a direction in model space (the model faces +z, y up), which works whatever way the rig's
 * bones are oriented internally.
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

/** Who sits where (by engine seat): you, the opponent on your right, your partner, the opponent on your left. */
export const SEAT_LOOKS = ['nico', 'tito', 'don_rafa', 'yadiel'] as const;
type Look = (typeof SEAT_LOOKS)[number];

/** Chairs and the scene were laid out for this root scale (world units per root unit). */
const ROOT_SCALE = 10.8;
/** World units per model unit (the models are about 1.75 tall standing). */
const MODEL_SCALE = 20;
/** Seated pelvis joint height above the seat, in model units. */
const PELVIS_ABOVE_SEAT = 0.12;

const textureLoader = new THREE.TextureLoader();

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
const SEATED: [bone: string, child: string, dir: THREE.Vector3][] = [
  ['Base_HumanSpine1', 'Base_HumanSpine2', v(0, 1, 0.14)],
  ['Base_HumanLThigh', 'Base_HumanLCalf', v(0.12, -0.06, 1)],
  ['Base_HumanRThigh', 'Base_HumanRCalf', v(-0.12, -0.06, 1)],
  ['Base_HumanLCalf', 'Base_HumanLFoot', v(0.02, -1, 0.1)],
  ['Base_HumanRCalf', 'Base_HumanRFoot', v(-0.02, -1, 0.1)],
  ['Base_HumanLFoot', 'wiseparmak1', v(0.1, -0.2, 1)],
  ['Base_HumanRFoot', 'wiseparmak2', v(-0.1, -0.2, 1)],
  ['Base_HumanLUpperarm', 'Base_HumanLForearm1', v(0.22, -0.8, 0.55)],
  ['Base_HumanRUpperarm', 'Base_HumanRForearm1', v(-0.22, -0.8, 0.55)],
  ['Base_HumanLForearm1', 'Base_HumanLPalm', v(-0.3, 0.05, 1)],
  ['Base_HumanRForearm1', 'Base_HumanRPalm', v(0.3, 0.05, 1)],
];

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Turn `bone` so that its child lies along `dir` (model space; the model must be at the origin, unrotated). */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3): void {
  bone.updateWorldMatrix(true, true);
  const from = child.getWorldPosition(tmpA).sub(bone.getWorldPosition(tmpB)).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(from, dir);
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent));
}

/** A rotation about a model-space axis, as a local rotation for `bone` (relative to its seated parent). */
function localTurn(parentModelQ: THREE.Quaternion, axis: THREE.Vector3, angle: number): THREE.Quaternion {
  const r = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  return parentModelQ.clone().invert().multiply(r).multiply(parentModelQ);
}

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

export async function loadAvatar(look: Look): Promise<Avatar> {
  const gltf = await loadGlb(look);
  const model = cloneSkinned(gltf.scene) as THREE.Group;
  const materials: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // skinned bounds don't follow the seated pose
    const material = (m.material as THREE.MeshStandardMaterial).clone();
    m.material = material;
    materials.push(material);
  });
  const bone = (name: string) => {
    const b = model.getObjectByName(name);
    if (!b) throw new Error(`Bone ${name} not found in ${look}`);
    return b;
  };

  // Seated pose, built once with the model at the origin.
  for (const [b, c, dir] of SEATED) aimBone(bone(b), bone(c), dir);
  const posed = new Map<THREE.Object3D, THREE.Quaternion>();
  model.traverse((o) => { if ((o as THREE.Bone).isBone) posed.set(o, o.quaternion.clone()); });

  const head = bone('Base_HumanHead');
  const neck = bone('Base_HumanNeck');
  const spine1 = bone('Base_HumanSpine1');
  const spine2 = bone('Base_HumanSpine2');
  const upper = bone('Base_HumanRUpperarm');
  const fore = bone('Base_HumanRForearm1');
  const palm = bone('Base_HumanRPalm');
  const lUpper = bone('Base_HumanLUpperarm');
  model.updateWorldMatrix(true, true);
  const parentQ = (b: THREE.Object3D) => b.parent!.getWorldQuaternion(new THREE.Quaternion());
  const turns = {
    breathe: localTurn(parentQ(spine2), X, 1),
    nod: localTurn(parentQ(head), X, 1),
    tilt: localTurn(parentQ(head), Z, 1),
    slump: localTurn(parentQ(spine1), X, 1),
    lean: localTurn(parentQ(spine1), Z, 1),
    neckDrop: localTurn(parentQ(neck), X, 1),
    armDrop: localTurn(parentQ(lUpper), Z, 1),
  };
  const scaleTurn = (q: THREE.Quaternion, k: number) => new THREE.Quaternion().slerp(q, k);

  // Revolver pose: elbow out to the right and up, forearm folded so the hand is at the right temple.
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const temple = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.11, 0.04, 0.02));
  const upperLen = fore.getWorldPosition(new THREE.Vector3()).distanceTo(shoulder);
  const elbow = shoulder.clone().add(v(-0.8, 0.15, 0.25).multiplyScalar(upperLen));
  aimBone(upper, fore, elbow.clone().sub(shoulder).normalize());
  aimBone(fore, palm, temple.clone().sub(fore.getWorldPosition(new THREE.Vector3())).normalize());
  const aimQ = new Map([upper, fore].map((b) => [b, b.quaternion.clone()] as const));
  for (const b of [upper, fore]) b.quaternion.copy(posed.get(b)!);

  // The hand slot holds the revolver at the right palm.
  const handSlot = new THREE.Object3D();
  palm.add(handSlot);

  // Sit the pelvis on the seat (root origin) and face the table (-z).
  model.updateWorldMatrix(true, true);
  const pelvis = bone('Base_HumanPelvis').getWorldPosition(new THREE.Vector3());
  const k = MODEL_SCALE / ROOT_SCALE;
  model.scale.setScalar(k);
  model.rotation.y = Math.PI;
  model.position.set(pelvis.x * k, (PELVIS_ABOVE_SEAT - pelvis.y) * k, pelvis.z * k - 0.05);
  const root = new THREE.Group();
  root.scale.setScalar(ROOT_SCALE);
  root.add(model);
  const headTop = head.getWorldPosition(new THREE.Vector3());
  const tagAnchor = new THREE.Vector3(0, (headTop.y - pelvis.y + PELVIS_ABOVE_SEAT + 0.32) * k, -0.1);

  let t = Math.random() * 10;
  const avatar: Avatar = {
    root, head, handSlot, tagAnchor,
    aim: 0, dead: 0, flinch: 0,
    update(dt) {
      t += dt;
      for (const [b, rest] of posed) b.quaternion.copy(rest);
      if (avatar.aim > 0) for (const [b, aimed] of aimQ) b.quaternion.slerp(aimed, avatar.aim);
      const turn = (b: THREE.Object3D, base: THREE.Quaternion, angle: number) => {
        if (angle) b.quaternion.premultiply(scaleTurn(base, angle));
      };
      // Breathing and a slow look around the table.
      turn(spine2, turns.breathe, Math.sin(t * 1.7) * 0.025);
      turn(head, turns.tilt, Math.sin(t * 0.45) * 0.06 + (avatar.aim > 0 ? 0.18 * avatar.aim : 0));
      turn(head, turns.nod, 0.12 + Math.sin(t * 0.7) * 0.03 - 0.3 * Math.sin(avatar.flinch * Math.PI));
      if (avatar.dead > 0) {
        turn(spine1, turns.slump, 0.55 * avatar.dead);
        turn(spine1, turns.lean, -0.35 * avatar.dead);
        turn(neck, turns.neckDrop, 0.5 * avatar.dead);
        turn(lUpper, turns.armDrop, -0.4 * avatar.dead);
      }
    },
    aimAtHead() {
      const before = avatar.aim;
      avatar.aim = 1;
      avatar.update(0);
      root.updateMatrixWorld(true);
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
      for (const m of materials) {
        m.userData.base ??= m.color.clone();
        m.color.copy(m.userData.base as THREE.Color);
        if (on) m.color.lerp(new THREE.Color('#3a3a44'), 0.7);
      }
    },
  };
  avatar.update(0);
  return avatar;
}

const chairTexture = (): Promise<THREE.Texture> => textureLoader.loadAsync('./models/chair.png').then((tex) => {
  tex.flipY = false; // glTF UV convention
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
});

/** Height of the old seated models in their own units; the chair is still sized by it. */
const SEATED_HEIGHT = 2.5;

let chairModel: Promise<THREE.Group> | null = null;
/**
 * KayKit wooden chair (CC0), scaled to match the avatars. `legExtension` (model units) stretches it
 * down so a raised avatar's chair still reaches the floor.
 */
export async function loadChair(worldHeight: number, legExtension = 0): Promise<THREE.Group> {
  chairModel ??= Promise.all([loadGlb('chair'), chairTexture()]).then(([g, tex]) => {
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const material = (m.material as THREE.MeshStandardMaterial).clone();
      material.map = tex;
      material.color.set('#ffffff');
      m.material = material;
    });
    return g.scene;
  });
  const chair = (await chairModel).clone();
  chair.scale.setScalar(worldHeight / SEATED_HEIGHT);
  chair.rotation.y = Math.PI; // match the avatars, which face -z
  if (legExtension > 0) {
    const seatHeight = 0.95;
    chair.scale.y *= (seatHeight + legExtension) / seatHeight;
    chair.position.y = -legExtension;
  }
  return chair;
}
