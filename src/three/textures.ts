import * as THREE from 'three';

/** Every texture is painted on a canvas at runtime: no image assets to license. */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  return tex;
}

const PIPS: Record<number, [number, number][]> = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.28, 0.24], [0.28, 0.5], [0.28, 0.76], [0.72, 0.24], [0.72, 0.5], [0.72, 0.76]],
};

const faceCache = new Map<string, THREE.CanvasTexture>();

/** Ivory with a faint grain, like the Domino_Generator.blend material. */
function ivory(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#ece6d6';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(120,105,80,0.05)' : 'rgba(255,255,255,0.06)';
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 10);
  }
}

/** Tile face, `top` value on the upper half: concave dark pips, black bar, brass pin. */
export function tileFaceTexture(top: number, bottom: number): THREE.CanvasTexture {
  const key = `${top}-${bottom}`;
  const cached = faceCache.get(key);
  if (cached) return cached;
  const S = 256;
  const [c, g] = canvas(S, S * 2);
  ivory(g, S, S * 2);
  // Pips sit a little inside the half so they clear the rounded edges.
  const inset = 0.08;
  const r = S * 0.085;
  [top, bottom].forEach((v, half) => {
    for (const [x, y] of PIPS[v]) {
      const px = (inset + x * (1 - inset * 2)) * S;
      const py = (half + inset + y * (1 - inset * 2)) * S;
      const grad = g.createRadialGradient(px - r * 0.25, py - r * 0.3, r * 0.1, px, py, r);
      grad.addColorStop(0, '#3a3a3e');
      grad.addColorStop(0.55, '#141416');
      grad.addColorStop(0.9, '#0a0a0b');
      grad.addColorStop(1, '#6b6558');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    }
  });
  g.fillStyle = '#1a1a1c';
  g.fillRect(S * 0.16, S - S * 0.022, S * 0.68, S * 0.044);
  const pin = g.createRadialGradient(S / 2 - 4, S - 4, 2, S / 2, S, S * 0.065);
  pin.addColorStop(0, '#f6d27a');
  pin.addColorStop(0.6, '#b7862c');
  pin.addColorStop(1, '#5e4210');
  g.fillStyle = pin;
  g.beginPath();
  g.arc(S / 2, S, S * 0.065, 0, Math.PI * 2);
  g.fill();
  const tex = toTexture(c);
  faceCache.set(key, tex);
  return tex;
}

let backTex: THREE.CanvasTexture | null = null;
/** Tile back: plain ivory with a small embossed star, as on the Puerto Rican flag. */
export function tileBackTexture(): THREE.CanvasTexture {
  if (backTex) return backTex;
  const [c, g] = canvas(256, 512);
  ivory(g, 256, 512);
  g.fillStyle = 'rgba(140,120,90,0.35)';
  starPath(g, 128, 256, 44);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  starPath(g, 126, 253, 40);
  g.fill();
  backTex = toTexture(c);
  return backTex;
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
  }
  g.closePath();
}

export function woodTexture(base: string, dark: string, repeat = 1): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 512;
    g.strokeStyle = dark;
    g.globalAlpha = 0.08 + Math.random() * 0.18;
    g.lineWidth = 1 + Math.random() * 4;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 6);
    g.stroke();
  }
  g.globalAlpha = 1;
  return toTexture(c, repeat);
}




export function feltTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#0f6b5f';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, 4);
}
