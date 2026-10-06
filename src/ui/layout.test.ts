import { describe, expect, it } from 'vitest';
import { chooseMove } from '../engine/ai';
import { applyMove, dealHand, pass, DEFAULT_RULES } from '../engine/game';
import { mulberry32 } from '../engine/tiles';
import { LaidTile, layoutBoard } from './layout';

const overlaps = (a: LaidTile, b: LaidTile) =>
  a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

describe('board layout', () => {
  it('never overlaps tiles over many full hands', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry32(seed);
      let h = dealHand(rng, seed % 4);
      while (!h.result) {
        const m = chooseMove(h, DEFAULT_RULES, 'easy', rng);
        h = m ? applyMove(h, m, DEFAULT_RULES) : pass(h);
      }
      const { tiles } = layoutBoard(h.placements);
      expect(tiles).toHaveLength(h.placements.length);
      for (let i = 0; i < tiles.length; i++)
        for (let j = i + 1; j < tiles.length; j++)
          expect(overlaps(tiles[i], tiles[j]), `seed ${seed} tiles ${i},${j}`).toBe(false);
    }
  });

  it('shows matching values where neighbouring tiles touch', () => {
    const placements = [
      { tile: [2, 5] as const, player: 0, side: 'start' as const, inner: 2, outer: 5 },
      { tile: [5, 6] as const, player: 1, side: 'right' as const, inner: 5, outer: 6 },
      { tile: [1, 2] as const, player: 2, side: 'left' as const, inner: 2, outer: 1 },
    ];
    const { tiles } = layoutBoard(placements);
    expect([tiles[1].first, tiles[1].second]).toEqual([5, 6]); // right arm: inner on the left
    expect([tiles[2].first, tiles[2].second]).toEqual([1, 2]); // left arm: inner on the right
  });
});
