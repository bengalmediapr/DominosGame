/** A domino tile, always stored with the smaller value first. */
export type Tile = readonly [number, number];

export const MAX_PIP = 6;

export function makeTile(a: number, b: number): Tile {
  return a <= b ? [a, b] : [b, a];
}

export function createDeck(maxPip = MAX_PIP): Tile[] {
  const deck: Tile[] = [];
  for (let a = 0; a <= maxPip; a++) {
    for (let b = a; b <= maxPip; b++) deck.push([a, b]);
  }
  return deck;
}

export const tileKey = (t: Tile): string => `${t[0]}-${t[1]}`;
export const isDouble = (t: Tile): boolean => t[0] === t[1];
export const pipCount = (t: Tile): number => t[0] + t[1];
export const sameTile = (x: Tile, y: Tile): boolean => x[0] === y[0] && x[1] === y[1];
export const hasValue = (t: Tile, v: number): boolean => t[0] === v || t[1] === v;
export const handPips = (hand: readonly Tile[]): number => hand.reduce((s, t) => s + pipCount(t), 0);

export type Rng = () => number;

/** Small deterministic PRNG so hands can be replayed from a seed. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
