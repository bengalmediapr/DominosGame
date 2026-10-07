import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, HandResult, MatchState, newMatch } from '../engine/game';
import { mulberry32 } from '../engine/tiles';
import { matchPoints } from './profile';

const result = (winnerPlayer: number | null, pipCounts: number[]): HandResult => ({
  reason: 'domino', winnerPlayer, winnerTeam: null, capicu: false, points: 0, pipCounts, losers: [],
});

describe('match points', () => {
  it('partners: your team’s score, and whether your team won', () => {
    const m: MatchState = { ...newMatch(mulberry32(1), DEFAULT_RULES), scores: [512, 230], winnerTeam: 0 };
    expect(matchPoints(m)).toEqual({ points: 512, won: true });
    expect(matchPoints({ ...m, scores: [230, 512], winnerTeam: 1 })).toEqual({ points: 230, won: false });
  });

  it('ruleta: the pips left to the others in the hands you won', () => {
    const base = newMatch(mulberry32(1), { ...DEFAULT_RULES, mode: 'ruleta' });
    const m: MatchState = {
      ...base,
      history: [result(0, [0, 12, 30, 7]), result(2, [15, 9, 0, 22]), result(0, [0, 0, 18, 4])],
      winnerPlayer: 0,
    };
    expect(matchPoints(m)).toEqual({ points: 49 + 22, won: true });
  });
});
