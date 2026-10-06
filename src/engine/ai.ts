import {
  HandState, Move, PLAYERS, Rules, applyMove, legalMoves, movesFor, partnerOf, teamOf,
} from './game';
import { Rng, hasValue, isDouble, pipCount } from './tiles';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Numbers each player has shown they don't hold (they passed with that number on an end). */
export function knownVoids(state: HandState): Set<number>[] {
  const voids = Array.from({ length: PLAYERS }, () => new Set<number>());
  for (const p of state.passes) {
    voids[p.player].add(p.leftEnd);
    voids[p.player].add(p.rightEnd);
  }
  return voids;
}

function scoreMove(state: HandState, move: Move, rules: Rules, difficulty: Difficulty): number {
  const me = state.current;
  const after = applyMove(state, move, rules);
  const result = after.result;
  if (result) {
    if (result.winnerTeam === teamOf(me)) return 10_000 + result.points;
    if (result.winnerTeam === null) return difficulty === 'hard' ? -200 : 0;
    return difficulty === 'hard' ? -10_000 : 0;
  }

  let score = pipCount(move.tile);
  if (isDouble(move.tile)) score += 4;

  const myHand = after.hands[me];
  const ends = [after.leftEnd!, after.rightEnd!];
  // Keep options open for my next turn.
  score += 1.5 * myHand.filter((t) => ends.some((e) => hasValue(t, e))).length;

  if (difficulty === 'hard') {
    const voids = knownVoids(state);
    const nextOpponent = (me + 1) % PLAYERS;
    const otherOpponent = (me + 3) % PLAYERS;
    const partner = partnerOf(me);
    for (const e of ends) {
      if (voids[nextOpponent].has(e)) score += 6;
      if (voids[otherOpponent].has(e)) score += 3;
      if (voids[partner].has(e)) score -= 4;
    }
    // Lock a number I control: few tiles of it remain outside my hand.
    for (const e of new Set(ends)) {
      const mine = myHand.filter((t) => hasValue(t, e)).length;
      score += mine * 1.2;
    }
    // Don't leave the next opponent with an easy move if they are nearly out.
    if (after.hands[nextOpponent].length <= 2 && movesFor(after, nextOpponent).length === 0) score += 8;
  }
  return score;
}

export function chooseMove(state: HandState, rules: Rules, difficulty: Difficulty, rng: Rng): Move | null {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (difficulty === 'easy' && rng() < 0.45) return moves[Math.floor(rng() * moves.length)];
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = scoreMove(state, m, rules, difficulty) + rng() * 0.5;
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}
