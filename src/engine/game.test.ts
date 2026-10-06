import { describe, expect, it } from 'vitest';
import { chooseMove } from './ai';
import {
  DEFAULT_RULES, HandState, MatchState, applyMove, dealHand, isBlocked, legalMoves, newMatch,
  pass, resolveTranque, scoreFinishedHand, startNextHand,
} from './game';
import { createDeck, mulberry32 } from './tiles';

const hand = (overrides: Partial<HandState>): HandState => ({
  hands: [[], [], [], []], placements: [], leftEnd: null, rightEnd: null,
  current: 0, starter: 0, mustOpenWith: null, passes: [], result: null, ...overrides,
});

describe('deck and deal', () => {
  it('has 28 unique tiles and deals 7 to each player', () => {
    expect(createDeck()).toHaveLength(28);
    const h = dealHand(mulberry32(1), null);
    expect(h.hands.map((x) => x.length)).toEqual([7, 7, 7, 7]);
    expect(new Set(h.hands.flat().map((t) => t.join()))).toHaveProperty('size', 28);
  });

  it('first hand must be opened with the double six by its holder', () => {
    const h = dealHand(mulberry32(7), null);
    expect(h.hands[h.current].some((t) => t[0] === 6 && t[1] === 6)).toBe(true);
    expect(legalMoves(h)).toEqual([{ tile: [6, 6], side: 'left' }]);
  });

  it('later hands may open with any tile', () => {
    const h = dealHand(mulberry32(3), 2);
    expect(h.current).toBe(2);
    expect(legalMoves(h)).toHaveLength(7);
  });
});

describe('moves', () => {
  it('places tiles on both ends and tracks open values', () => {
    let s = hand({ hands: [[[6, 6]], [[3, 6], [0, 0]], [[1, 2]], [[4, 4]]], mustOpenWith: [6, 6] });
    s = applyMove(s, { tile: [6, 6], side: 'left' }, DEFAULT_RULES);
    expect(s.result).toMatchObject({ reason: 'domino', winnerPlayer: 0 });
  });

  it('flips the tile so the matching value touches the chain', () => {
    let s = hand({ hands: [[[2, 5], [0, 0]], [[1, 5], [0, 1]], [[3, 3]], [[4, 4]]] });
    s = applyMove(s, { tile: [2, 5], side: 'left' }, DEFAULT_RULES);
    s = applyMove(s, { tile: [1, 5], side: 'right' }, DEFAULT_RULES);
    expect([s.leftEnd, s.rightEnd]).toEqual([2, 1]);
    expect(s.placements[1]).toMatchObject({ inner: 5, outer: 1 });
  });

  it('rejects illegal moves and illegal passes', () => {
    const s = hand({ hands: [[[1, 1], [2, 3]], [], [], []], leftEnd: 1, rightEnd: 4, placements: [
      { tile: [1, 4], player: 3, side: 'start', inner: 1, outer: 4 },
    ] });
    expect(() => applyMove(s, { tile: [2, 3], side: 'left' }, DEFAULT_RULES)).toThrow();
    expect(() => pass(s)).toThrow();
  });
});

describe('scoring', () => {
  it('domino scores every pip left at the table and adds the capicú bonus', () => {
    const s = hand({
      hands: [[[2, 5]], [[6, 6]], [[1, 0]], [[3, 4]]],
      leftEnd: 2, rightEnd: 5,
      placements: [
        { tile: [2, 4], player: 2, side: 'start', inner: 2, outer: 4 },
        { tile: [4, 5], player: 3, side: 'right', inner: 4, outer: 5 },
      ],
    });
    const done = applyMove(s, { tile: [2, 5], side: 'left' }, DEFAULT_RULES);
    expect(done.result).toMatchObject({ reason: 'domino', winnerTeam: 0, capicu: true, points: 12 + 1 + 7 + 100 });
  });

  it('can count only the losing team', () => {
    const rules = { ...DEFAULT_RULES, countAllHands: false, capicuBonus: 0 };
    const s = hand({
      hands: [[[2, 3]], [[6, 6]], [[1, 0]], [[3, 4]]], leftEnd: 3, rightEnd: 3,
      placements: [{ tile: [3, 3], player: 3, side: 'start', inner: 3, outer: 3 }],
    });
    expect(applyMove(s, { tile: [2, 3], side: 'left' }, rules).result!.points).toBe(19);
  });

  it('tranque goes to the lowest individual count', () => {
    const r = resolveTranque([[[6, 6]], [[0, 1]], [[5, 5]], [[3, 3]]], DEFAULT_RULES);
    expect(r).toMatchObject({ winnerPlayer: 1, winnerTeam: 1, points: 12 + 1 + 10 + 6 });
  });

  it('a cross-team tie in a tranque scores nothing', () => {
    const r = resolveTranque([[[0, 2]], [[1, 1]], [[5, 5]], [[3, 3]]], DEFAULT_RULES);
    expect(r).toMatchObject({ winnerTeam: null, points: 0 });
  });

  it('detects a blocked board', () => {
    const s = hand({
      hands: [[[1, 2]], [[2, 3]], [[3, 4]], [[1, 4]]], leftEnd: 0, rightEnd: 0,
      placements: [{ tile: [0, 0], player: 0, side: 'start', inner: 0, outer: 0 }],
    });
    expect(isBlocked(s)).toBe(true);
  });
});

function playMatch(seed: number): MatchState {
  const rng = mulberry32(seed);
  let m = newMatch(rng);
  for (let guard = 0; guard < 10_000 && m.winnerTeam === null; guard++) {
    const h = m.hand;
    if (h.result) {
      m = scoreFinishedHand(m);
      if (m.winnerTeam === null) m = startNextHand(m, rng);
      continue;
    }
    const diff = h.current % 2 === 0 ? 'hard' : 'normal';
    const move = chooseMove(h, m.rules, diff, rng);
    m = { ...m, hand: move ? applyMove(h, move, m.rules) : pass(h) };
  }
  return m;
}

describe('full matches', () => {
  it('AI-only matches always finish with a winner past the target', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = playMatch(seed);
      expect(m.winnerTeam).not.toBeNull();
      expect(m.scores[m.winnerTeam!]).toBeGreaterThanOrEqual(500);
    }
  });

  it('hard AI beats normal AI more often than not', () => {
    let hardWins = 0;
    const n = 120;
    for (let seed = 1000; seed < 1000 + n; seed++) if (playMatch(seed).winnerTeam === 0) hardWins++;
    expect(hardWins / n).toBeGreaterThan(0.5);
  });
});
