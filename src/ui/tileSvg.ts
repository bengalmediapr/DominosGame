/** Pip positions within a unit square half, for a vertical tile (two columns of three for 6). */
const PIPS: Record<number, [number, number][]> = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.28, 0.24], [0.28, 0.5], [0.28, 0.76], [0.72, 0.24], [0.72, 0.5], [0.72, 0.76]],
};

function half(value: number, ox: number, oy: number, size: number, horizontal: boolean): string {
  return PIPS[value]
    .map(([px, py]) => {
      const [x, y] = horizontal ? [py, px] : [px, py];
      return `<circle class="pip pip-${value}" cx="${ox + x * size}" cy="${oy + y * size}" r="${size * 0.09}"/>`;
    })
    .join('');
}

/** SVG markup for a tile. (x, y, w, h) in user units; `first` is the top or left half. */
export function tileMarkup(x: number, y: number, w: number, h: number, first: number, second: number, extraClass = ''): string {
  const horizontal = w > h;
  const s = Math.min(w, h);
  const r = s * 0.12;
  const inset = s * 0.03;
  const [x2, y2] = horizontal ? [x + s, y] : [x, y + s];
  const divider = horizontal
    ? `<line class="divider" x1="${x + s}" y1="${y + s * 0.12}" x2="${x + s}" y2="${y + s * 0.88}"/>`
    : `<line class="divider" x1="${x + s * 0.12}" y1="${y + s}" x2="${x + s * 0.88}" y2="${y + s}"/>`;
  return `<g class="tile ${extraClass}">
    <rect class="tile-shadow" x="${x + inset + s * 0.04}" y="${y + inset + s * 0.06}" width="${w - inset * 2}" height="${h - inset * 2}" rx="${r}"/>
    <rect class="tile-face" x="${x + inset}" y="${y + inset}" width="${w - inset * 2}" height="${h - inset * 2}" rx="${r}"/>
    ${divider}
    <circle class="spinner" cx="${horizontal ? x + s : x + s / 2}" cy="${horizontal ? y + s / 2 : y + s}" r="${s * 0.05}"/>
    ${half(first, x, y, s, horizontal)}${half(second, x2, y2, s, horizontal)}
  </g>`;
}

export function tileBackMarkup(x: number, y: number, w: number, h: number): string {
  const r = Math.min(w, h) * 0.12;
  return `<g class="tile back"><rect class="tile-backface" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>
    <path class="star" d="${star(x + w / 2, y + h / 2, Math.min(w, h) * 0.28)}"/></g>`;
}

/** Five-pointed star (as on the Puerto Rican flag). */
export function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(3)},${(cy + rad * Math.sin(a)).toFixed(3)}`);
  }
  return `M${pts.join('L')}Z`;
}
