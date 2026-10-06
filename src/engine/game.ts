import {
  Rng, Tile, createDeck, handPips, hasValue, isDouble, pipCount, sameTile, shuffle,
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
 *
 * "Ruleta" mode (Liar's Bar style): every player for themselves. Whoever ends a hand holding the most
 * pips must pull the trigger of their own revolver (see roulette.ts). The dead leave the table; the
 * hands keep being dealt (7 tiles each, the rest sit out) until one player is left alive.
 */
export type Mode = 'parejas' | 'ruleta';

export interface Rules {
  mode: Mode;
  targetScore: number;
  capicuBonus: number;
  /** true: winners collect pips from all four hands; false: only from the losing team. */
  countAllHands: boolean;
}

export const DEFAULT_RULES: Rules = { mode: 'parejas', targetScore: 500, capicuBonus: 100, countAllHands: true };

export const PLAYERS = 4;
export type Team = 0 | 1;
export type Side = 'left' | 'right';

export const teamOf = (player: number): Team => (player % 2) as Team;
export const partnerOf = (player: number): number => (player + 2) % PLAYERS;
/** Who a player plays for: their team in parejas, themselves in ruleta. */
export const sideOf = (rules: Rules, player: number): number => (rules.mode === 'parejas' ? teamOf(player) : player);
const ALL_SEATED = [true, true, true, true];

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
  /** Parejas only (null in ruleta). */
  winnerTeam: Team | null;
  /** Ruleta: players left holding the most pips, who must face the revolver. */
  losers: number[];
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
  /** Players dealt into this hand (everyone in parejas; the living in ruleta). */
  seated: boolean[];
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
  /** Ruleta: who is still alive, their revolvers, and the last one standing. */
  alive: boolean[];
  revolvers: Revolver[];
  winnerPlayer: number | null;
  /** Ruleta: players who still have to pull the trigger for the last hand. */
  pendingShooters: number[];
}

export interface Revolver {
  /** Chamber holding the bullet (0-5), fixed for the whole match: the cylinder is never re-spun. */
  bullet: number;
  pulls: number;
}

export const CHAMBERS = 6;

export function nextSeated(seated: readonly boolean[], player: number): number {
  for (let i = 1; i <= PLAYERS; i++) {
    const p = (player + i) % PLAYERS;
    if (seated[p]) return p;
  }
  return player;
}

/**
 * Deals 7 tiles to each seated player. With `starter` null the hand is opened with the highest
 * double dealt (the double six when everyone is seated), or the heaviest tile if nobody has a double.
 */
export function dealHand(rng: Rng, starter: number | null, seated: readonly boolean[] = ALL_SEATED): HandState {
  const deck = shuffle(createDeck(), rng);
  let next = 0;
  const hands = seated.map((s) => (s ? deck.slice(next * 7, ++next * 7) : []));
  let mustOpenWith: Tile | null = null;
  if (starter === null) {
    const dealt = hands.flat();
    const doubles = dealt.filter(isDouble);
    const pool = doubles.length ? doubles : dealt;
    mustOpenWith = pool.reduce((best, t) => (pipCount(t) > pipCount(best) ? t : best));
    starter = hands.findIndex((h) => h.some((t) => sameTile(t, mustOpenWith!)));
  }
  return {
    hands, placements: [], leftEnd: null, rightEnd: null, current: starter, starter,
    seated: [...seated], mustOpenWith, passes: [], result: null,
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

/** Ruleta: the seated players (other than the winner) holding the most pips. */
function losersOf(hands: Tile[][], seated: readonly boolean[], winner: number | null): number[] {
  const counts = hands.map((h, p) => (seated[p] && p !== winner ? handPips(h) : -1));
  const high = Math.max(...counts);
  return counts.map((c, p) => (c === high && c >= 0 ? p : -1)).filter((p) => p >= 0);
}

export function resolveTranque(hands: Tile[][], rules: Rules, seated: readonly boolean[] = ALL_SEATED): HandResult {
  const pipCounts = hands.map(handPips);
  const low = Math.min(...pipCounts.filter((_, p) => seated[p]));
  const lowest = pipCounts.map((c, p) => (seated[p] && c === low ? p : -1)).filter((p) => p >= 0);
  const sides = new Set(lowest.map((p) => sideOf(rules, p)));
  const winnerPlayer = sides.size > 1 ? null : lowest[0];
  const base = { reason: 'tranque' as const, winnerPlayer, capicu: false, pipCounts };
  if (rules.mode === 'ruleta') {
    return { ...base, winnerTeam: null, points: 0, losers: losersOf(hands, seated, winnerPlayer) };
  }
  if (winnerPlayer === null) return { ...base, winnerTeam: null, points: 0, losers: [] };
  const winnerTeam = teamOf(winnerPlayer);
  return { ...base, winnerTeam, points: scoreHand(hands, winnerTeam, rules), losers: [] };
}

/** Nobody at the table can play: the hand is locked ("tranque"). */
export function isBlocked(state: HandState): boolean {
  if (state.placements.length === 0) return false;
  return state.hands.every((_, p) => !state.seated[p] || movesFor(state, p).length === 0);
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
    current: nextSeated(state.seated, player),
  };

  if (hands[player].length === 0) {
    const capicu = isCapicu(move.tile, state.leftEnd ?? -1, state.rightEnd ?? -1, state.placements.length);
    const pipCounts = hands.map(handPips);
    next.current = player;
    if (rules.mode === 'ruleta') {
      next.result = {
        reason: 'domino', winnerPlayer: player, winnerTeam: null, capicu, points: 0, pipCounts,
        losers: losersOf(hands, state.seated, player),
      };
    } else {
      const winnerTeam = teamOf(player);
      next.result = {
        reason: 'domino', winnerPlayer: player, winnerTeam, capicu, pipCounts, losers: [],
        points: scoreHand(hands, winnerTeam, rules) + (capicu ? rules.capicuBonus : 0),
      };
    }
  } else if (isBlocked(next)) {
    next.current = player;
    next.result = resolveTranque(hands, rules, state.seated);
  }
  return next;
}

export function pass(state: HandState): HandState {
  if (state.result) throw new Error('Hand is over');
  if (legalMoves(state).length > 0) throw new Error('Cannot pass with a playable tile');
  return {
    ...state,
    passes: [...state.passes, { player: state.current, leftEnd: state.leftEnd!, rightEnd: state.rightEnd! }],
    current: nextSeated(state.seated, state.current),
  };
}

export function newMatch(rng: Rng, rules: Rules = DEFAULT_RULES): MatchState {
  return {
    rules, scores: [0, 0], handNumber: 1, hand: dealHand(rng, null),
    history: [], winnerTeam: null, pollona: false,
    alive: [...ALL_SEATED],
    revolvers: ALL_SEATED.map(() => ({ bullet: Math.floor(rng() * CHAMBERS), pulls: 0 })),
    winnerPlayer: null,
    pendingShooters: [],
  };
}

export const isMatchOver = (m: MatchState): boolean => m.winnerTeam !== null || m.winnerPlayer !== null;

/** Records the finished hand; in parejas adds its points and checks for a match winner. */
export function scoreFinishedHand(match: MatchState): MatchState {
  const result = match.hand.result;
  if (!result) throw new Error('Hand not finished');
  const history = [...match.history, result];
  if (match.rules.mode === 'ruleta') return { ...match, history, pendingShooters: result.losers.filter((p) => match.alive[p]) };
  const scores: [number, number] = [...match.scores];
  if (result.winnerTeam !== null) scores[result.winnerTeam] += result.points;
  let winnerTeam: Team | null = null;
  if (scores[0] >= match.rules.targetScore || scores[1] >= match.rules.targetScore) {
    winnerTeam = scores[0] >= scores[1] ? 0 : 1;
  }
  const pollona = winnerTeam !== null && scores[1 - winnerTeam] === 0;
  return { ...match, scores, history, winnerTeam, pollona };
}

/** Chance the next pull of this player's revolver fires. */
export const fireChance = (r: Revolver): number => 1 / (CHAMBERS - r.pulls);

/** Ruleta: the player puts the revolver to their head and pulls. */
export function pullTrigger(match: MatchState, player: number): { match: MatchState; fired: boolean } {
  if (!match.alive[player]) throw new Error('Player is already out');
  const gun = match.revolvers[player];
  const fired = gun.pulls === gun.bullet;
  const revolvers = match.revolvers.map((r, p) => (p === player ? { ...r, pulls: r.pulls + 1 } : r));
  const alive = match.alive.map((a, p) => (p === player ? !fired : a));
  const living = alive.map((a, p) => (a ? p : -1)).filter((p) => p >= 0);
  const winnerPlayer = living.length === 1 ? living[0] : match.winnerPlayer;
  const pendingShooters = match.pendingShooters.filter((p) => p !== player);
  return { match: { ...match, revolvers, alive, winnerPlayer, pendingShooters }, fired };
}

export function startNextHand(match: MatchState, rng: Rng): MatchState {
  const last = match.history[match.history.length - 1];
  const seated = match.rules.mode === 'ruleta' ? match.alive : ALL_SEATED;
  let starter: number | null;
  if (last?.winnerPlayer != null && seated[last.winnerPlayer]) starter = last.winnerPlayer;
  else starter = nextSeated(seated, match.hand.starter);
  return { ...match, handNumber: match.handNumber + 1, hand: dealHand(rng, starter, seated) };
}
