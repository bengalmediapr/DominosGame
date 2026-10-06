import {
  Rng, Tile, createDeck, handPips, hasValue, isDouble, sameTile, shuffle,
} from './tiles';

/**
 * Puerto Rican dominoes ("dominó boricua"):
 *  - 4 players in 2 teams of partners sitting across (seats 0+2 vs 1+3).
 *  - Double-six set, all 28 tiles dealt (7 each), no boneyard.
 *  - Play goes counter-clockwise (seat 0 -> 1 -> 2 -> 3, i.e. to your right).
 *  - First hand is opened with the double six; afterwards the previous winner opens with any tile.
 *  - The team that goes out ("¡Dominó!") scores the pips left in every hand (configurable).
 *  - Capicú: winning with a tile that fits both (different) ends earns a bonus.
 *  - Tranque (blocked game): lowest individual count wins for their team; a cross-team tie scores nothing.
 */
export interface Rules {
  targetScore: number;
  capicuBonus: number;
  /** true: winners collect pips from all four hands; false: only from the losing team. */
  countAllHands: boolean;
}

export const DEFAULT_RULES: Rules = { targetScore: 500, capicuBonus: 100, countAllHands: true };

export const PLAYERS = 4;
export type Team = 0 | 1;
export type Side = 'left' | 'right';

export const teamOf = (player: number): Team => (player % 2) as Team;
export const partnerOf = (player: number): number => (player + 2) % PLAYERS;

export interface Move {
  tile: Tile;
  side: Side;
}

export interface Placement {
  tile: Tile;
  player: number;
  /** 'start' for the opening tile. */
  side: Side | 'start';
  /** Value touching the chain (for 'start': the left value). */
  inner: number;
  /** Value left open at the end of the chain (for 'start': the right value). */
  outer: number;
}

export interface PassEvent {
  player: number;
  leftEnd: number;
  rightEnd: number;
}

export interface HandResult {
  reason: 'domino' | 'tranque';
  /** Player who went out, or the lowest count in a tranque; null on a tied tranque. */
  winnerPlayer: number | null;
  winnerTeam: Team | null;
  points: number;
  capicu: boolean;
  pipCounts: number[];
}

export interface HandState {
  hands: Tile[][];
  placements: Placement[];
  leftEnd: number | null;
  rightEnd: number | null;
  current: number;
  starter: number;
  /** Tile the opening move must use (double six on the first hand). */
  mustOpenWith: Tile | null;
  passes: PassEvent[];
  result: HandResult | null;
}

export interface MatchState {
  rules: Rules;
  scores: [number, number];
  handNumber: number;
  hand: HandState;
  history: HandResult[];
  winnerTeam: Team | null;
  /** Winner reached the target while the losers scored nothing. */
  pollona: boolean;
}

export function dealHand(rng: Rng, starter: number | null): HandState {
  const deck = shuffle(createDeck(), rng);
  const hands = Array.from({ length: PLAYERS }, (_, p) => deck.slice(p * 7, p * 7 + 7));
  let mustOpenWith: Tile | null = null;
  if (starter === null) {
    mustOpenWith = [6, 6];
    starter = hands.findIndex((h) => h.some((t) => sameTile(t, [6, 6])));
  }
  return {
    hands, placements: [], leftEnd: null, rightEnd: null,
    current: starter, starter, mustOpenWith, passes: [], result: null,
  };
}

export function movesFor(state: HandState, player: number): Move[] {
  const hand = state.hands[player];
  if (state.placements.length === 0) {
    const open = state.mustOpenWith;
    return hand.filter((t) => !open || sameTile(t, open)).map((tile) => ({ tile, side: 'left' as Side }));
  }
  const moves: Move[] = [];
  for (const tile of hand) {
    if (hasValue(tile, state.leftEnd!)) moves.push({ tile, side: 'left' });
    if (hasValue(tile, state.rightEnd!)) moves.push({ tile, side: 'right' });
  }
  return moves;
}

export const legalMoves = (state: HandState): Move[] => movesFor(state, state.current);

export function isMoveLegal(state: HandState, move: Move): boolean {
  return legalMoves(state).some((m) => m.side === move.side && sameTile(m.tile, move.tile));
}

/** Capicú: the winning tile could have gone on either end, and the ends were different. */
function isCapicu(tile: Tile, leftEnd: number, rightEnd: number, placementsBefore: number): boolean {
  return placementsBefore > 0 && !isDouble(tile) && leftEnd !== rightEnd
    && hasValue(tile, leftEnd) && hasValue(tile, rightEnd);
}

function scoreHand(hands: Tile[][], winnerTeam: Team, rules: Rules): number {
  return hands.reduce((sum, h, p) => (rules.countAllHands || teamOf(p) !== winnerTeam ? sum + handPips(h) : sum), 0);
}

export function resolveTranque(hands: Tile[][], rules: Rules): HandResult {
  const pipCounts = hands.map(handPips);
  const low = Math.min(...pipCounts);
  const lowest = pipCounts.map((c, p) => (c === low ? p : -1)).filter((p) => p >= 0);
  const teams = new Set(lowest.map(teamOf));
  if (teams.size > 1) {
    return { reason: 'tranque', winnerPlayer: null, winnerTeam: null, points: 0, capicu: false, pipCounts };
  }
  const winnerPlayer = lowest[0];
  const winnerTeam = teamOf(winnerPlayer);
  return {
    reason: 'tranque', winnerPlayer, winnerTeam,
    points: scoreHand(hands, winnerTeam, rules), capicu: false, pipCounts,
  };
}

/** Nobody at the table can play: the hand is locked ("tranque"). */
export function isBlocked(state: HandState): boolean {
  if (state.placements.length === 0) return false;
  return state.hands.every((_, p) => movesFor(state, p).length === 0);
}

export function applyMove(state: HandState, move: Move, rules: Rules): HandState {
  if (state.result) throw new Error('Hand is over');
  if (!isMoveLegal(state, move)) throw new Error(`Illegal move ${move.tile.join('|')} on ${move.side}`);
  const player = state.current;
  const hands = state.hands.map((h, p) => (p === player ? h.filter((t) => !sameTile(t, move.tile)) : h));
  const [a, b] = move.tile;
  let placement: Placement;
  let { leftEnd, rightEnd } = state;
  if (state.placements.length === 0) {
    placement = { tile: move.tile, player, side: 'start', inner: a, outer: b };
    leftEnd = a;
    rightEnd = b;
  } else {
    const end = move.side === 'left' ? leftEnd! : rightEnd!;
    const outer = a === end ? b : a;
    placement = { tile: move.tile, player, side: move.side, inner: end, outer };
    if (move.side === 'left') leftEnd = outer; else rightEnd = outer;
  }

  const next: HandState = {
    ...state, hands, leftEnd, rightEnd,
    placements: [...state.placements, placement],
    current: (player + 1) % PLAYERS,
  };

  if (hands[player].length === 0) {
    const winnerTeam = teamOf(player);
    const capicu = isCapicu(move.tile, state.leftEnd ?? -1, state.rightEnd ?? -1, state.placements.length);
    next.current = player;
    next.result = {
      reason: 'domino', winnerPlayer: player, winnerTeam, capicu,
      points: scoreHand(hands, winnerTeam, rules) + (capicu ? rules.capicuBonus : 0),
      pipCounts: hands.map(handPips),
    };
  } else if (isBlocked(next)) {
    next.current = player;
    next.result = resolveTranque(hands, rules);
  }
  return next;
}

export function pass(state: HandState): HandState {
  if (state.result) throw new Error('Hand is over');
  if (legalMoves(state).length > 0) throw new Error('Cannot pass with a playable tile');
  return {
    ...state,
    passes: [...state.passes, { player: state.current, leftEnd: state.leftEnd!, rightEnd: state.rightEnd! }],
    current: (state.current + 1) % PLAYERS,
  };
}

export function newMatch(rng: Rng, rules: Rules = DEFAULT_RULES): MatchState {
  return {
    rules, scores: [0, 0], handNumber: 1, hand: dealHand(rng, null),
    history: [], winnerTeam: null, pollona: false,
  };
}

/** Adds the finished hand's points to the score and checks for a match winner. */
export function scoreFinishedHand(match: MatchState): MatchState {
  const result = match.hand.result;
  if (!result) throw new Error('Hand not finished');
  const scores: [number, number] = [...match.scores];
  if (result.winnerTeam !== null) scores[result.winnerTeam] += result.points;
  let winnerTeam: Team | null = null;
  if (scores[0] >= match.rules.targetScore || scores[1] >= match.rules.targetScore) {
    winnerTeam = scores[0] >= scores[1] ? 0 : 1;
  }
  const pollona = winnerTeam !== null && scores[1 - winnerTeam] === 0;
  return { ...match, scores, history: [...match.history, result], winnerTeam, pollona };
}

export function startNextHand(match: MatchState, rng: Rng): MatchState {
  const last = match.history[match.history.length - 1];
  const starter = last?.winnerPlayer ?? (match.hand.starter + 1) % PLAYERS;
  return { ...match, handNumber: match.handNumber + 1, hand: dealHand(rng, starter) };
}
