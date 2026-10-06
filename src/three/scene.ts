import * as THREE from 'three';
import type { HandState, Side } from '../engine/game';
import { Tile, sameTile } from '../engine/tiles';
import { layoutBoard } from '../ui/layout';
import {
  Character, Room, SEAT_DIST, TABLE_HALF, TILE_T, makeCharacter, makeRevolver, makeRoom, makeTable, makeTile,
} from './models';

export interface SceneView {
  hand: HandState;
  alive: boolean[];
  ruleta: boolean;
  reveal: boolean;
  /** Human's playable tiles this turn. */
  playable: Tile[];
  selected: Tile | null;
  targets: Side[];
}

export type Pick = { kind: 'tile'; tile: Tile } | { kind: 'side'; side: Side };

type Ease = (t: number) => number;
const easeInOut: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack: Ease = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

interface Tween { elapsed: number; duration: number; update(t: number): void; done(): void }

const HUMAN = 0;
const GAME_CAMERA = { pos: new THREE.Vector3(0, 24, 34), look: new THREE.Vector3(0, -2, -1) };
const glowMat = new THREE.MeshBasicMaterial({ color: '#ffc93c', transparent: true, opacity: 0.55 });
const glowGeo = new THREE.BoxGeometry(1.25, TILE_T * 0.6, 2.25);
const ringMat = new THREE.MeshBasicMaterial({ color: '#ffc93c', transparent: true, opacity: 0.8, side: THREE.DoubleSide });

export class TableScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 600);
  private readonly clock = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-10, -10);
  private readonly seats: THREE.Group[] = [];
  private readonly characters: (Character | null)[] = [];
  private readonly revolvers: { group: THREE.Group; drum: THREE.Object3D; rest: THREE.Matrix4 }[] = [];
  private readonly hands: THREE.Group[] = [];
  private readonly board = new THREE.Group();
  private readonly room: Room;
  private readonly lamp: THREE.SpotLight;
  private readonly flash: THREE.PointLight;
  private readonly faceLight: THREE.PointLight;
  private tweens: Tween[] = [];
  private mode: 'menu' | 'game' = 'menu';
  private boardCount = 0;
  private hovered: THREE.Object3D | null = null;
  private pickables: THREE.Object3D[] = [];
  private dead = [false, false, false, false];
  private shake = 0;
  private roll = 0;
  /** 0..1: tightens the field of view during the first-person roulette. */
  private zoom = 0;
  private baseFov = 52;
  /** Camera turns toward whoever holds the revolver: point to look at, and 0..1 blend. */
  private focusPoint = new THREE.Vector3();
  private focus = 0;
  /** Slow-motion factor (tests only). */
  timeScale = 1;
  private time = 0;
  onPick?: (pick: Pick) => void;
  onFrame?: () => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene.background = new THREE.Color('#120a18');
    this.scene.fog = new THREE.Fog('#120a18', 90, 190);
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight('#9a7bd6', '#2a1408', 0.9));
    this.lamp = new THREE.SpotLight('#ffe2b0', 5, 0, 0.75, 0.55, 0);
    this.lamp.position.set(0, 32, 0);
    this.lamp.target.position.set(0, 0, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.bias = -0.0004;
    this.scene.add(this.lamp, this.lamp.target);
    const neonLight = new THREE.PointLight('#ff3fa8', 1.3, 0, 0);
    neonLight.position.set(0, 25, -60);
    const fill = new THREE.PointLight('#3fb8ff', 0.5, 0, 0);
    fill.position.set(-50, 30, 40);
    this.flash = new THREE.PointLight('#ffd27a', 0, 0, 0);
    // Lights your own revolver when you hold it up to your head.
    this.faceLight = new THREE.PointLight('#ffe2b0', 0, 4, 0);
    this.faceLight.position.set(0.2, 0.4, 0.3);
    this.camera.add(this.faceLight);
    this.scene.add(neonLight, fill, this.flash);

    this.room = makeRoom();
    this.scene.add(this.room.group, makeTable(), this.board);

    for (let p = 0; p < 4; p++) {
      const seat = new THREE.Group();
      seat.rotation.y = (p * Math.PI) / 2;
      this.scene.add(seat);
      this.seats.push(seat);
      const character = p === HUMAN ? null : makeCharacter(p - 1);
      if (character) {
        character.group.position.z = SEAT_DIST;
        seat.add(character.group);
      }
      this.characters.push(character);
      const hand = new THREE.Group();
      seat.add(hand);
      this.hands.push(hand);
      const gun = makeRevolver();
      gun.group.position.set(10.5, 0.5, TABLE_HALF - 7);
      gun.group.rotation.set(Math.PI / 2, Math.PI / 2 + 0.4, 0, 'YXZ');
      seat.add(gun.group);
      gun.group.updateMatrix();
      this.revolvers.push({ ...gun, rest: gun.group.matrix.clone() });
    }

    canvas.addEventListener('pointermove', (e) => this.setPointer(e));
    canvas.addEventListener('pointerleave', () => this.pointer.set(-10, -10));
    canvas.addEventListener('click', (e) => {
      this.setPointer(e);
      const hit = this.pick();
      if (hit) this.onPick?.(hit.userData.pick as Pick);
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- public API ----------

  setMode(mode: 'menu' | 'game'): void {
    this.mode = mode;
    if (mode === 'game') {
      this.camera.position.copy(GAME_CAMERA.pos);
      this.camera.lookAt(GAME_CAMERA.look);
    }
  }

  /** Bring everyone back to life and clear the table for a new match. */
  resetMatch(): void {
    for (let p = 0; p < 4; p++) {
      this.dead[p] = false;
      const c = this.characters[p];
      if (c) {
        c.torso.rotation.set(0, 0, 0);
        c.head.rotation.set(0, 0, 0);
        c.gunArm.rotation.set(1.1, 0, 0);
        for (const m of c.tint) m.color.copy((m.userData.base as THREE.Color | undefined) ?? m.color);
      }
      const gun = this.revolvers[p];
      this.seats[p].attach(gun.group);
      gun.group.matrix.copy(gun.rest);
      gun.group.matrix.decompose(gun.group.position, gun.group.quaternion, gun.group.scale);
    }
    this.boardCount = 0;
  }

  sync(view: SceneView): void {
    const { hand } = view;
    this.revolvers.forEach((r, p) => {
      if (!this.dead[p] && r.group.parent === this.seats[p]) r.group.visible = view.ruleta && view.alive[p];
    });
    this.characters.forEach((c, p) => {
      if (c && !view.alive[p] && !this.dead[p]) this.applyDeath(p, false);
    });
    this.syncBoard(hand, view);
    for (let p = 0; p < 4; p++) this.syncHand(p, view);
  }

  /** Screen position (CSS px) above a player's head, for name tags and speech bubbles. */
  headScreenPos(seat: number): { x: number; y: number } | null {
    const c = this.characters[seat];
    if (!c) return null;
    const v = c.tagAnchor.clone();
    c.group.localToWorld(v);
    v.project(this.camera);
    if (v.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  /** The revolver scene: raise it to the head, wait, then click... or bang. */
  async roulette(seat: number, fired: boolean, onBang?: () => void): Promise<void> {
    const gun = this.revolvers[seat];
    gun.group.visible = true;
    if (seat === HUMAN) {
      await this.humanRoulette(gun.group, gun.drum, fired, onBang);
      return;
    }
    const c = this.characters[seat]!;
    c.torso.attach(gun.group);
    const from = { p: gun.group.position.clone(), q: gun.group.quaternion.clone() };
    // The muzzle is ~6 units ahead of the frame: this puts it against the right temple.
    const toP = new THREE.Vector3(10, 13.6, -0.4);
    const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0.08));
    const armFrom = c.gunArm.rotation.clone();
    c.head.getWorldPosition(this.focusPoint);
    this.focusPoint.y -= 2;
    void this.tween(700, (t) => { this.focus = t; this.zoom = 0.6 * t; });
    await this.tween(900, (t) => {
      gun.group.position.lerpVectors(from.p, toP, t);
      gun.group.quaternion.slerpQuaternions(from.q, toQ, t);
      c.gunArm.rotation.set(armFrom.x * (1 - t) + 0.25 * t, 0, armFrom.z * (1 - t) + 2.55 * t);
      c.head.rotation.z = -0.15 * t;
    });
    await this.tween(500, (t) => { gun.drum.rotation.y = t * Math.PI * 4; });
    await this.tween(1100, (t) => { gun.group.position.x = toP.x + Math.sin(t * 60) * 0.06; });
    if (fired) {
      onBang?.();
      this.muzzleFlash(gun.group);
      this.applyDeath(seat, true);
      this.seats[seat].attach(gun.group);
      const dropFrom = gun.group.position.clone();
      const dropTo = new THREE.Vector3(9, 0.5, TABLE_HALF + 2);
      await this.tween(500, (t) => gun.group.position.lerpVectors(dropFrom, dropTo, t));
      await this.wait(700);
      await this.tween(600, (t) => { this.focus = 1 - t; this.zoom = 0.6 * (1 - t); });
    } else {
      await this.tween(160, (t) => { c.head.rotation.x = -0.25 * Math.sin(t * Math.PI); });
      await this.wait(500);
      await this.tween(700, (t) => {
        gun.group.position.lerpVectors(toP, from.p, t);
        gun.group.quaternion.slerpQuaternions(toQ, from.q, t);
        c.gunArm.rotation.set(0.25 * (1 - t) + armFrom.x * t, 0, 2.55 * (1 - t) + armFrom.z * t);
        c.head.rotation.z = -0.15 * (1 - t);
        this.focus = 1 - t;
        this.zoom = 0.6 * (1 - t);
      });
      this.seats[seat].attach(gun.group);
    }
  }

  // ---------- internals ----------

  private async humanRoulette(gun: THREE.Group, drum: THREE.Object3D, fired: boolean, onBang?: () => void): Promise<void> {
    this.camera.attach(gun);
    const from = { p: gun.position.clone(), q: gun.quaternion.clone(), s: gun.scale.clone() };
    // Lower right of your view, barrel (local +x) aimed up at your right temple; camera is the origin.
    // Seen side-on: barrel (local +x) toward the temple, grip down, flat side facing you.
    const toP = new THREE.Vector3(0.27, -0.2, -0.72);
    const barrel = new THREE.Vector3(-0.05, 0.08, -0.12).sub(toP).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const yAxis = up.sub(barrel.clone().multiplyScalar(up.dot(barrel))).normalize();
    const toQ = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(barrel, yAxis, new THREE.Vector3().crossVectors(barrel, yAxis)));
    const toS = new THREE.Vector3(0.06, 0.06, 0.06);
    this.faceLight.intensity = 2.5;
    await this.tween(900, (t) => {
      gun.position.lerpVectors(from.p, toP, t);
      gun.quaternion.slerpQuaternions(from.q, toQ, t);
      gun.scale.lerpVectors(from.s, toS, t);
      this.roll = 0.08 * t;
      this.zoom = t;
    }, easeInOut);
    await this.tween(500, (t) => { drum.rotation.y = t * Math.PI * 4; });
    await this.tween(900, (t) => { gun.position.x = toP.x + Math.sin(t * 70) * 0.008; });
    if (fired) {
      onBang?.();
      this.flash.position.copy(this.camera.position);
      this.flash.intensity = 30;
      this.shake = 1.2;
      gun.visible = false;
      this.dead[HUMAN] = true;
      await this.wait(400);
      gun.visible = true;
      gun.position.copy(from.p);
      gun.quaternion.copy(from.q);
      gun.scale.copy(from.s);
    } else {
      this.shake = 0.15;
      await this.wait(600);
      await this.tween(700, (t) => {
        gun.position.lerpVectors(toP, from.p, t);
        gun.quaternion.slerpQuaternions(toQ, from.q, t);
        gun.scale.lerpVectors(toS, from.s, t);
        this.roll = 0.08 * (1 - t);
        this.zoom = 1 - t;
      });
    }
    this.roll = 0;
    this.zoom = 0;
    this.faceLight.intensity = 0;
    this.seats[HUMAN].attach(gun);
  }

  private muzzleFlash(gun: THREE.Object3D): void {
    gun.getWorldPosition(this.flash.position);
    this.flash.intensity = 40;
    this.shake = 0.8;
  }

  private applyDeath(seat: number, animate: boolean): void {
    this.dead[seat] = true;
    const c = this.characters[seat];
    if (!c) return;
    for (const m of c.tint) {
      m.userData.base ??= m.color.clone();
      m.color.lerp(new THREE.Color('#4a4a52'), 0.75);
    }
    const pose = (t: number) => {
      c.torso.rotation.set(0.45 * t, 0, 0.55 * t);
      c.head.rotation.set(0.5 * t, 0, 0.6 * t);
      c.gunArm.rotation.set(1.1 * (1 - t) - 0.2 * t, 0, 0.4 * t);
    };
    if (animate) void this.tween(450, pose, easeOutBack);
    else pose(1);
  }

  private syncBoard(hand: HandState, view: SceneView): void {
    const { placements } = hand;
    const animateFrom = placements.length > this.boardCount && this.boardCount > 0 ? this.boardCount : placements.length === 1 ? 0 : -1;
    this.board.clear();
    const layout = layoutBoard(placements);
    const b = layout.tiles.reduce(
      (acc, t) => ({ minX: Math.min(acc.minX, t.x), minY: Math.min(acc.minY, t.y), maxX: Math.max(acc.maxX, t.x + t.w), maxY: Math.max(acc.maxY, t.y + t.h) }),
      { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    );
    const w = b.maxX - b.minX + 2;
    const h = b.maxY - b.minY + 2;
    // Must stay clear of the tile racks in front of each player.
    const scale = Math.min(1.7, 21 / w, 18 / h);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minY + b.maxY) / 2;
    this.board.scale.setScalar(scale);
    this.board.position.set(-cx * scale, 0, -cz * scale);
    for (const lt of layout.tiles) {
      const tile = makeTile(lt.first, lt.second);
      tile.position.set(lt.x + lt.w / 2, TILE_T / 2, lt.y + lt.h / 2);
      if (lt.w > lt.h) tile.rotation.y = Math.PI / 2;
      this.board.add(tile);
      if (animateFrom >= 0 && lt.index >= animateFrom) {
        const player = placements[lt.index].player;
        const start = new THREE.Vector3(Math.sin((player * Math.PI) / 2) * 12, 6, Math.cos((player * Math.PI) / 2) * 12)
          .divideScalar(scale).add(new THREE.Vector3(cx, 0, cz));
        const end = tile.position.clone();
        tile.position.copy(start);
        void this.tween(320, (t) => tile.position.lerpVectors(start, end, t), easeInOut);
      }
    }
    this.boardCount = placements.length;

    this.pickables = [];
    if (layout.ends) {
      for (const side of view.targets) {
        const p = layout.ends[side];
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.05, 32), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p.x, 0.1, p.y);
        const hit = new THREE.Mesh(new THREE.CircleGeometry(1.4, 16), new THREE.MeshBasicMaterial({ visible: false }));
        hit.rotation.x = -Math.PI / 2;
        hit.position.set(p.x, 0.12, p.y);
        hit.userData.pick = { kind: 'side', side } satisfies Pick;
        ring.userData.pulse = true;
        this.board.add(ring, hit);
        this.pickables.push(hit);
      }
    }
  }

  private syncHand(p: number, view: SceneView): void {
    const group = this.hands[p];
    group.clear();
    const tiles = view.hand.hands[p];
    const human = p === HUMAN;
    const spacing = human ? 1.5 : 1.2;
    const scale = human ? 1.65 : 1;
    const z = TABLE_HALF - (human ? 3.6 : 4.5);
    tiles.forEach((t, i) => {
      const x = (i - (tiles.length - 1) / 2) * spacing * scale;
      const holder = new THREE.Group();
      holder.position.set(x, 0, z);
      holder.scale.setScalar(scale);
      if (view.reveal) {
        const tile = makeTile(t[0], t[1]);
        tile.position.y = TILE_T / 2;
        tile.rotation.y = Math.PI;
        holder.add(tile);
      } else if (human) {
        const tile = makeTile(t[0], t[1]);
        const playable = view.playable.some((pt) => sameTile(pt, t));
        const selected = view.selected !== null && sameTile(view.selected, t);
        tile.rotation.x = 0.95;
        tile.position.y = 1 + (selected ? 0.8 : 0);
        if (playable) {
          const glow = new THREE.Mesh(glowGeo, glowMat);
          glow.position.y = -TILE_T * 0.45;
          tile.add(glow);
        } else if (view.playable.length > 0) {
          tile.position.y -= 0.35;
          tile.rotation.x = 1.15;
        }
        tile.userData.pick = { kind: 'tile', tile: t } satisfies Pick;
        tile.userData.baseY = tile.position.y;
        holder.add(tile);
        this.pickables.push(tile);
      } else {
        const tile = makeTile(t[0], t[1]);
        tile.rotation.x = Math.PI / 2;
        tile.position.y = 1;
        holder.add(tile);
      }
      group.add(holder);
    });
  }

  private setPointer(e: PointerEvent | MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private pick(): THREE.Object3D | null {
    if (this.mode !== 'game' || this.pickables.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o) return o;
    }
    return null;
  }

  private tween(ms: number, update: (t: number) => void, ease: Ease = easeInOut): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ elapsed: 0, duration: ms / 1000, update: (t) => update(ease(t)), done: resolve });
    });
  }

  private wait(ms: number): Promise<void> {
    return this.tween(ms, () => {});
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole table in view on narrow windows.
    this.baseFov = w / h < 1.5 ? 58 : 52;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    // Tweens run on real time so they finish on schedule even at low frame rates;
    // ambient motion uses a clamped step so it never jumps.
    this.clock.update();
    const realDt = Math.min(this.clock.getDelta(), 0.5) * this.timeScale;
    const dt = Math.min(realDt, 0.05);
    this.time += dt;
    const t = this.time;

    this.tweens = this.tweens.filter((tw) => {
      tw.elapsed += realDt;
      const k = Math.min(1, tw.elapsed / tw.duration);
      tw.update(k);
      if (k >= 1) tw.done();
      return k < 1;
    });

    if (this.mode === 'menu') {
      const a = t * 0.08;
      this.camera.position.set(Math.sin(a) * 58, 26 + Math.sin(t * 0.3) * 3, Math.cos(a) * 58);
      this.camera.lookAt(0, 2, 0);
    } else {
      this.camera.position.copy(GAME_CAMERA.pos);
      if (this.focus > 0) {
        this.camera.position.lerp(this.focusPoint, this.focus * 0.25);
        this.camera.lookAt(GAME_CAMERA.look.clone().lerp(this.focusPoint, this.focus));
      } else {
        this.camera.lookAt(GAME_CAMERA.look);
      }
      this.camera.rotateZ(this.roll);
      const fov = this.baseFov - this.zoom * 10;
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      if (this.shake > 0.001) {
        this.camera.position.x += (Math.random() - 0.5) * this.shake;
        this.camera.position.y += (Math.random() - 0.5) * this.shake;
        this.shake *= 0.9;
      }
    }

    this.flash.intensity *= 0.82;
    this.room.fan.rotation.y += dt * 2.2;
    (this.room.neon.material as THREE.MeshBasicMaterial).opacity = Math.random() < 0.015 ? 0.55 : 1;
    this.room.bulbs.forEach((b, i) => b.scale.setScalar(0.85 + 0.25 * Math.sin(t * 2 + i)));
    this.characters.forEach((c, p) => {
      if (!c || this.dead[p]) return;
      c.torso.scale.y = 1 + Math.sin(t * 1.6 + p) * 0.012;
      c.head.rotation.y = Math.sin(t * 0.5 + p * 2) * 0.12;
    });
    this.board.children.forEach((o) => {
      if (o.userData.pulse) o.scale.setScalar(1 + Math.sin(t * 6) * 0.12);
    });

    // Hover: lift the tile under the cursor.
    const hit = this.pick();
    const hovered = hit?.userData.pick?.kind === 'tile' ? hit : null;
    if (hovered !== this.hovered) {
      if (this.hovered) this.hovered.position.y = this.hovered.userData.baseY;
      if (hovered) hovered.position.y = hovered.userData.baseY + 0.6;
      this.hovered = hovered;
    }
    this.canvas.style.cursor = hit ? 'pointer' : 'default';

    this.lamp.intensity = 5 + Math.sin(t * 13) * 0.04;
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }
}
