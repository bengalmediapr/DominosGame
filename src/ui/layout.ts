import type { Placement } from '../engine/game';
import { isDouble } from '../engine/tiles';

/** A tile drawn on the board, in tile-width units (a tile is 2 x 1). */
export interface LaidTile {
  x: number; // top-left
  y: number;
  w: number;
  h: number;
  /** Value on the top half (vertical) or left half (horizontal). */
  first: number;
  second: number;
  index: number;
}

export interface Point { x: number; y: number }

export interface BoardLayout {
  tiles: LaidTile[];
  /** Where the next tile on each end would go (for drop targets). */
  ends: { left: Point; right: Point } | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

type Vec = { x: number; y: number };

const HALF_RUN = 9; // horizontal half-width before an arm turns

function rectAlong(p: Vec, d: Vec, along: number, across: number): { x: number; y: number; w: number; h: number } {
  const cx = p.x + d.x * (along / 2);
  const cy = p.y + d.y * (along / 2);
  const w = d.x !== 0 ? along : across;
  const h = d.x !== 0 ? across : along;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Orders inner/outer values into top/left-first order for a tile laid along d. */
function halves(d: Vec, inner: number, outer: number): [number, number] {
  return d.x > 0 || d.y > 0 ? [inner, outer] : [outer, inner];
}

/**
 * One arm of the chain. Runs horizontally away from the centre, then turns with a
 * single vertical "corner" tile and comes back the other way (a snake).
 */
class Arm {
  private p: Vec;
  private d: Vec;
  /** Set right after a corner tile: horizontal direction the arm was travelling before turning. */
  private cornerFrom: number | null = null;
  /** How far the last tile reaches across the line (0.5, or 1 for a crosswise double). */
  private lastReach = 0.5;

  constructor(start: Vec, dir: Vec, private readonly vertical: 1 | -1) {
    this.p = start;
    this.d = dir;
  }

  place(pl: Placement, index: number): LaidTile {
    if (this.cornerFrom !== null) {
      // Coming out of a corner: lie flat, tucked against the end of the corner tile, heading back.
      const h = this.cornerFrom;
      const back = { x: -h, y: 0 };
      const rect = {
        x: h > 0 ? this.p.x + 0.5 - 2 : this.p.x - 0.5,
        y: this.vertical > 0 ? this.p.y : this.p.y - 1,
        w: 2, h: 1,
      };
      const [first, second] = halves(back, pl.inner, pl.outer);
      this.p = { x: this.p.x - 1.5 * h, y: this.p.y + this.vertical * 0.5 };
      this.d = back;
      this.cornerFrom = null;
      this.lastReach = 0.5;
      return { ...rect, first, second, index };
    }

    const dbl = isDouble(pl.tile);
    if (this.d.y === 0 && !dbl && Math.abs(this.p.x + this.d.x * 2) > HALF_RUN) {
      // Turn: the corner tile stands vertical, hanging off the outer half of the last tile.
      const v = { x: 0, y: this.vertical };
      const cx = this.p.x - this.d.x * 0.5;
      const reach = this.lastReach;
      const rect = { x: cx - 0.5, y: this.vertical > 0 ? this.p.y + reach : this.p.y - reach - 2, w: 1, h: 2 };
      const [first, second] = halves(v, pl.inner, pl.outer);
      this.cornerFrom = this.d.x;
      this.p = { x: cx, y: this.p.y + this.vertical * (reach + 2) };
      this.d = v;
      return { ...rect, first, second, index };
    }

    // Straight placement; doubles sit crosswise.
    const along = dbl ? 1 : 2;
    this.lastReach = dbl ? 1 : 0.5;
    const rect = rectAlong(this.p, this.d, along, dbl ? 2 : 1);
    const [first, second] = halves(this.d, pl.inner, pl.outer);
    this.p = { x: this.p.x + this.d.x * along, y: this.p.y + this.d.y * along };
    return { ...rect, first, second, index };
  }

  /** Centre of where the next tile would land. */
  nextPoint(): Point {
    if (this.cornerFrom !== null) {
      return { x: this.p.x - this.cornerFrom * 0.5, y: this.p.y + this.vertical * 0.5 };
    }
    return { x: this.p.x + this.d.x, y: this.p.y + this.d.y };
  }
}

export function layoutBoard(placements: readonly Placement[]): BoardLayout {
  const tiles: LaidTile[] = [];
  if (placements.length === 0) {
    return { tiles, ends: null, bounds: { minX: -HALF_RUN, minY: -3, maxX: HALF_RUN, maxY: 3 } };
  }
  const first = placements[0];
  const dbl = isDouble(first.tile);
  const halfLen = dbl ? 0.5 : 1;
  tiles.push(dbl
    ? { x: -0.5, y: -1, w: 1, h: 2, first: first.inner, second: first.outer, index: 0 }
    : { x: -1, y: -0.5, w: 2, h: 1, first: first.inner, second: first.outer, index: 0 });

  const right = new Arm({ x: halfLen, y: 0 }, { x: 1, y: 0 }, 1);
  const left = new Arm({ x: -halfLen, y: 0 }, { x: -1, y: 0 }, -1);
  placements.forEach((pl, i) => {
    if (i === 0) return;
    tiles.push((pl.side === 'left' ? left : right).place(pl, i));
  });

  const bounds = tiles.reduce(
    (b, t) => ({
      minX: Math.min(b.minX, t.x), minY: Math.min(b.minY, t.y),
      maxX: Math.max(b.maxX, t.x + t.w), maxY: Math.max(b.maxY, t.y + t.h),
    }),
    { minX: -HALF_RUN, minY: -3, maxX: HALF_RUN, maxY: 3 },
  );
  return { tiles, ends: { left: left.nextPoint(), right: right.nextPoint() }, bounds };
}
