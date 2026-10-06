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

/** Tile face, `top` value on the upper half of the image. */
export function tileFaceTexture(top: number, bottom: number): THREE.CanvasTexture {
  const key = `${top}-${bottom}`;
  const cached = faceCache.get(key);
  if (cached) return cached;
  const S = 128;
  const [c, g] = canvas(S, S * 2);
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, S, S * 2);
  g.strokeStyle = '#b9ad92';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(S * 0.12, S);
  g.lineTo(S * 0.88, S);
  g.stroke();
  g.fillStyle = '#c9a24a';
  g.beginPath();
  g.arc(S / 2, S, 6, 0, Math.PI * 2);
  g.fill();
  [top, bottom].forEach((v, half) => {
    for (const [x, y] of PIPS[v]) {
      g.fillStyle = '#16161a';
      g.beginPath();
      g.arc(x * S, (y + half) * S, S * 0.085, 0, Math.PI * 2);
      g.fill();
    }
  });
  const tex = toTexture(c);
  faceCache.set(key, tex);
  return tex;
}

let backTex: THREE.CanvasTexture | null = null;
/** Tile back: a white five-pointed star, as on the Puerto Rican flag. */
export function tileBackTexture(): THREE.CanvasTexture {
  if (backTex) return backTex;
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#0050f0';
  g.beginPath();
  g.arc(64, 128, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  starPath(g, 64, 128, 24);
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

/** Neon sign for the bar. */
export function neonTexture(text: string, sub: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 384);
  g.clearRect(0, 0, 1024, 384);
  g.textAlign = 'center';
  g.font = 'bold 150px "Lilita One", "Trebuchet MS", sans-serif';
  g.shadowColor = '#ff2fa0';
  g.shadowBlur = 40;
  g.fillStyle = '#ffd1ee';
  g.fillText(text, 512, 190);
  g.fillText(text, 512, 190);
  g.font = 'bold 70px "Nunito", sans-serif';
  g.shadowColor = '#29d8ff';
  g.fillStyle = '#d4f7ff';
  g.fillText(sub, 512, 300);
  return toTexture(c);
}

export function flagTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(300, 200);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#e4002b';
    g.fillRect(0, i * 40, 300, 40);
  }
  g.fillStyle = '#0050f0';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(170, 100);
  g.lineTo(0, 200);
  g.fill();
  g.fillStyle = '#fff';
  starPath(g, 55, 100, 34);
  g.fill();
  return toTexture(c);
}

/** Painted "mural" strip of Old San Juan houses for the bar wall. */
export function muralTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  const colors = ['#f4a261', '#2a9d8f', '#e9c46a', '#e76f51', '#8ecae6', '#f28482', '#84a59d', '#f6bd60', '#9b5de5', '#00bbf9', '#f15bb5'];
  g.fillStyle = '#2b1640';
  g.fillRect(0, 0, 1024, 256);
  let x = 0;
  let i = 0;
  while (x < 1024) {
    const w = 80 + ((i * 37) % 40);
    const h = 150 + ((i * 53) % 70);
    g.fillStyle = colors[i % colors.length];
    g.fillRect(x, 256 - h, w - 4, h);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (let wy = 256 - h + 20; wy < 230; wy += 46) {
      for (let wx = x + 12; wx < x + w - 24; wx += 28) g.fillRect(wx, wy, 14, 26);
    }
    x += w;
    i++;
  }
  return toTexture(c);
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
