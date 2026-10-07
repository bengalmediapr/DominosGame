import * as THREE from 'three';
import { loadGlb } from './assets';
import { FLOOR_Y } from './models';

/**
 * Night patio in San Juan: tiled deck, a lit pool, a pergola with string lights over the domino
 * table, palms, and the house (SanJuanModernHouse2) at the back with its glass doors facing the pool.
 * World units: 1 = 2.5 cm (a domino's width). The table is at the origin; you sit at +z.
 */

export interface Patio {
  group: THREE.Group;
  bulbs: THREE.Mesh[];
  update(time: number): void;
}

const POOL = { x: 0, z: -150, w: 300, d: 130, depth: 48 };
const DECK = { minX: -260, maxX: 260, minZ: -260, maxZ: 120 };
const HOUSE_SCALE = 0.4; // the model is in centimetres
const HOUSE_BACK_Z = -255;

const mat = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.anisotropy = 8;
  return tex;
}

/** Large travertine-like deck tiles with grout lines. */
function deckTexture(w: number, d: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#7a6a55';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const shade = 150 + Math.random() * 30;
        g.fillStyle = `rgb(${shade + 40},${shade + 25},${shade})`;
        g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
        for (let i = 0; i < 180; i++) {
          g.fillStyle = `rgba(80,60,40,${Math.random() * 0.12})`;
          g.fillRect(x * 128 + Math.random() * 122, y * 128 + Math.random() * 122, 2 + Math.random() * 6, 1 + Math.random() * 2);
        }
      }
    }
  }, [w / 64, d / 64]);
}

/** Small blue pool mosaic. */
function poolTileTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#d8f4ff';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const l = 52 + Math.random() * 14;
        g.fillStyle = `hsl(${192 + Math.random() * 10}, 70%, ${l}%)`;
        g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
      }
    }
  }, [repeatX, repeatY]);
}

function makePool(): THREE.Group {
  const g = new THREE.Group();
  const { x, z, w, d, depth } = POOL;
  const top = FLOOR_Y;
  const tiles = (rx: number, ry: number) => mat('#ffffff', { map: poolTileTexture(rx, ry), roughness: 0.3 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tiles(w / 16, d / 16));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, top - depth, z);
  g.add(floor);
  const walls: [number, number, number, number, number][] = [
    // width, px, pz, rotationY, repeat
    [w, x, z - d / 2, 0, w / 16],
    [w, x, z + d / 2, Math.PI, w / 16],
    [d, x - w / 2, z, Math.PI / 2, d / 16],
    [d, x + w / 2, z, -Math.PI / 2, d / 16],
  ];
  for (const [width, px, pz, ry, rep] of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), tiles(rep, depth / 16));
    wall.position.set(px, top - depth / 2, pz);
    wall.rotation.y = ry;
    g.add(wall);
  }
  // White stone coping around the rim.
  const coping = mat('#e9e4d8', { roughness: 0.6 });
  const rim = 8;
  for (const [cw, cd, px, pz] of [
    [w + rim * 2, rim, x, z - d / 2 - rim / 2], [w + rim * 2, rim, x, z + d / 2 + rim / 2],
    [rim, d, x - w / 2 - rim / 2, z], [rim, d, x + w / 2 + rim / 2, z],
  ]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(cw, 2, cd), coping);
    c.position.set(px, top + 0.8, pz);
    c.receiveShadow = true;
    g.add(c);
  }
  // Water: animated ripples, lit from below.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d, 1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec2 vUv; uniform float time;
        float wave(vec2 p, float t){ return sin(p.x*9.0+t)*sin(p.y*7.0-t*1.3)+sin((p.x+p.y)*13.0+t*1.7)*0.5; }
        void main(){
          vec2 p = vUv*vec2(4.0,1.8);
          float c = wave(p, time) + wave(p*1.7+3.1, time*0.8);
          float caustic = smoothstep(0.9, 1.6, c);
          vec3 deep = vec3(0.02, 0.38, 0.55);
          vec3 glow = vec3(0.25, 0.92, 1.0);
          vec3 col = mix(deep, glow, 0.35 + caustic*0.65);
          gl_FragColor = vec4(col, 0.82);
        }`,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, top - 5, z);
  water.name = 'water';
  g.add(water);
  // Underwater light: the pool glows and tints the patio.
  const light = new THREE.PointLight('#3fe0ff', 1.6, 420, 1);
  light.position.set(x, top - 20, z);
  g.add(light);
  return g;
}

function makeDeck(): THREE.Group {
  const g = new THREE.Group();
  const { x, z, w, d } = POOL;
  const rim = 8;
  // Four slabs around the pool opening.
  const slabs: [number, number, number, number][] = [
    [DECK.minX, DECK.maxX, z + d / 2 + rim, DECK.maxZ],
    [DECK.minX, DECK.maxX, DECK.minZ, z - d / 2 - rim],
    [DECK.minX, x - w / 2 - rim, z - d / 2 - rim, z + d / 2 + rim],
    [x + w / 2 + rim, DECK.maxX, z - d / 2 - rim, z + d / 2 + rim],
  ];
  for (const [x0, x1, z0, z1] of slabs) {
    const sw = x1 - x0;
    const sd = z1 - z0;
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), mat('#ffffff', { map: deckTexture(sw, sd), roughness: 0.75 }));
    slab.rotation.x = -Math.PI / 2;
    slab.position.set((x0 + x1) / 2, FLOOR_Y + 0.05, (z0 + z1) / 2);
    slab.receiveShadow = true;
    g.add(slab);
  }
  // Grass around the deck (not under it: the pool must stay open).
  const grassMat = mat('#14301a', { roughness: 1 });
  const FAR = 2000;
  for (const [x0, x1, z0, z1] of [
    [-FAR, FAR, DECK.maxZ, FAR], [-FAR, FAR, -FAR, DECK.minZ],
    [-FAR, DECK.minX, DECK.minZ, DECK.maxZ], [DECK.maxX, FAR, DECK.minZ, DECK.maxZ],
  ]) {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set((x0 + x1) / 2, FLOOR_Y - 0.2, (z0 + z1) / 2);
    grass.receiveShadow = true;
    g.add(grass);
  }
  return g;
}

/** Wooden pergola over the table: the lamp and string lights hang from it. */
function makePergola(bulbs: THREE.Mesh[]): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#4a2c18', { roughness: 0.85 });
  const H = 78; // beam height above the table top
  const S = 52;
  for (const [px, pz] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(3.5, H - FLOOR_Y, 3.5), wood);
    post.position.set(px, (H + FLOOR_Y) / 2, pz);
    post.castShadow = true;
    g.add(post);
  }
  for (const pz of [-S, S]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(S * 2 + 12, 4, 3), wood);
    beam.position.set(0, H, pz);
    g.add(beam);
  }
  for (let i = -3; i <= 3; i++) {
    const rafter = new THREE.Mesh(new THREE.BoxGeometry(2, 3, S * 2 + 12), wood);
    rafter.position.set(i * (S / 3), H + 3, 0);
    g.add(rafter);
  }
  // String lights draped between the posts.
  const colors = ['#ffd27a', '#ffb347', '#fff1c1'];
  const wire = new THREE.LineBasicMaterial({ color: '#111111' });
  const strands: [THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(-S, H - 2, -S), new THREE.Vector3(S, H - 2, S)],
    [new THREE.Vector3(S, H - 2, -S), new THREE.Vector3(-S, H - 2, S)],
    [new THREE.Vector3(-S, H - 2, S), new THREE.Vector3(-S - 70, 40, S + 80)],
    [new THREE.Vector3(S, H - 2, -S), new THREE.Vector3(POOL.x + 160, 60, POOL.z - 60)],
    [new THREE.Vector3(-S, H - 2, -S), new THREE.Vector3(POOL.x - 160, 60, POOL.z - 60)],
  ];
  for (const [a, b] of strands) {
    const pts: THREE.Vector3[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * 14;
      pts.push(p);
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
    pts.forEach((p, i) => {
      if (i === 0 || i === n) return;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
      bulb.position.copy(p).add(new THREE.Vector3(0, -1.5, 0));
      bulbs.push(bulb);
      g.add(bulb);
    });
  }
  // The table lamp hangs from the middle of the pergola.
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, H - 36), mat('#111111'));
  cord.position.set(0, (H + 36) / 2, 0);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(7, 5, 24, 1, true), mat('#1f5c3a', { side: THREE.DoubleSide, metalness: 0.4, roughness: 0.4 }));
  shade.position.set(0, 34, 0);
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff3d0' }));
  lampBulb.position.set(0, 32, 0);
  g.add(cord, shade, lampBulb);
  return g;
}

function makePalm(height: number, lean: number): THREE.Group {
  const g = new THREE.Group();
  const bark = mat('#5a4632', { roughness: 1 });
  const segs = 10;
  let top = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const r = 4.2 - t * 1.6;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, height / segs + 1, 8), bark);
    const y = (i + 0.5) * (height / segs);
    const x = Math.pow(t, 1.8) * lean;
    seg.position.set(x, y, 0);
    seg.rotation.z = -Math.atan2(lean * 1.8 * Math.pow(t, 0.8) / segs, height / segs) * 0.9;
    seg.castShadow = true;
    g.add(seg);
    top = new THREE.Vector3(Math.pow(1, 1.8) * lean, height, 0);
  }
  const leaf = mat('#1f5a2a', { side: THREE.DoubleSide, roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(22, 8, 52, 0);
    shape.quadraticCurveTo(22, -3, 0, 0);
    const frond = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), leaf);
    frond.position.copy(top);
    frond.rotation.set(Math.PI / 2 + 0.5, 0, (i / 9) * Math.PI * 2);
    frond.rotateX(-0.5 - Math.random() * 0.4);
    g.add(frond);
  }
  return g;
}

function makeSky(): THREE.Group {
  const g = new THREE.Group();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vPos; void main(){
        float h = normalize(vPos).y;
        vec3 top = vec3(0.02,0.03,0.09); vec3 horizon = vec3(0.12,0.10,0.22);
        gl_FragColor = vec4(mix(horizon, top, smoothstep(-0.05, 0.5, h)), 1.0); }`,
    }),
  );
  g.add(sky);
  const starPos: number[] = [];
  for (let i = 0; i < 900; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = 0.08 + Math.random() * 0.9;
    starPos.push(Math.cos(u) * Math.cos(v) * 1700, Math.sin(v) * 1700, Math.sin(u) * Math.cos(v) * 1700);
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false }),
  );
  const moon = new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ color: '#fff6dc', fog: false }));
  moon.position.set(-700, 900, -1200);
  g.add(stars, moon);
  return g;
}

/** Loads the house and places it with its glass doors facing the pool. */
async function loadHouse(): Promise<THREE.Object3D> {
  const house = (await loadGlb('house')).scene;
  house.scale.setScalar(HOUSE_SCALE);
  house.rotation.y = Math.PI; // the back of the house (sliding glass doors) faces the patio
  house.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = true;
    const material = m.material as THREE.MeshStandardMaterial;
    if (/Glass/i.test(material.name)) {
      // Lights on inside: warm glow behind the glass.
      material.color.set('#2a1a08');
      material.emissive = new THREE.Color('#ffb85c');
      material.emissiveIntensity = 0.75;
    } else if (/Roof|Ceill/i.test(material.name)) {
      material.color.set('#2b2b30');
    }
    material.roughness = Math.max(material.roughness ?? 0.8, 0.7);
  });
  const box = new THREE.Box3().setFromObject(house);
  const center = box.getCenter(new THREE.Vector3());
  house.position.x -= center.x;
  house.position.z += HOUSE_BACK_Z - box.max.z;
  house.position.y += FLOOR_Y - box.min.y;
  return house;
}

export function makePatio(): Patio {
  const group = new THREE.Group();
  const bulbs: THREE.Mesh[] = [];
  group.add(makeSky(), makeDeck(), makePool(), makePergola(bulbs));
  for (const [px, pz, h, lean, ry] of [
    [-230, -200, 260, 40, 0.4], [210, -215, 230, -35, -0.3], [250, 40, 280, -50, 1.2], [-250, 60, 240, 45, 2.4],
  ]) {
    const palm = makePalm(h, lean);
    palm.position.set(px, FLOOR_Y, pz);
    palm.rotation.y = ry;
    group.add(palm);
  }
  // Moonlight.
  const moon = new THREE.DirectionalLight('#8aa4ff', 0.35);
  moon.position.set(-300, 500, -400);
  group.add(moon);
  // Warm light spilling out of the house onto the deck.
  const spill = new THREE.PointLight('#ffb85c', 0.9, 380, 1);
  spill.position.set(0, 40, HOUSE_BACK_Z + 30);
  group.add(spill);

  loadHouse().then((house) => group.add(house)).catch((err) => console.error('Could not load the house', err));

  let water: THREE.ShaderMaterial | null = null;
  group.traverse((o) => {
    if (o.name === 'water') water = (o as THREE.Mesh).material as THREE.ShaderMaterial;
  });
  return {
    group,
    bulbs,
    update(time) {
      if (water) water.uniforms.time.value = time;
    },
  };
}
