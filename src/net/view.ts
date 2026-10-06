import type { HandResult, HandState, MatchState, Team } from '../engine/game';
import type { Phase, SeatInfo, Snapshot, Status, TableEvent } from './table';

/**
 * Everyone sees themselves at the bottom of the table. These helpers rotate a snapshot so the viewer's
 * seat becomes seat 0 (and their team becomes team 0); the UI and the 3D scene only ever see that view.
 */
export const toView = (seat: number, me: number): number => (seat - me + 4) % 4;
export const toEngine = (viewSeat: number, me: number): number => (viewSeat + me) % 4;

function rot<T>(arr: readonly T[], me: number): T[] {
  return arr.map((_, v) => arr[toEngine(v, me)]);
}

const team = (t: Team | null, me: number): Team | null => (t === null || me % 2 === 0 ? t : ((1 - t) as Team));

function rotResult(r: HandResult, me: number): HandResult {
  return {
    ...r,
    winnerPlayer: r.winnerPlayer === null ? null : toView(r.winnerPlayer, me),
    winnerTeam: team(r.winnerTeam, me),
    losers: r.losers.map((p) => toView(p, me)),
    pipCounts: rot(r.pipCounts, me),
  };
}

function rotHand(h: HandState, me: number): HandState {
  return {
    ...h,
    hands: rot(h.hands, me),
    seated: rot(h.seated, me),
    current: toView(h.current, me),
    starter: toView(h.starter, me),
    placements: h.placements.map((p) => ({ ...p, player: toView(p.player, me) })),
    passes: h.passes.map((p) => ({ ...p, player: toView(p.player, me) })),
    result: h.result && rotResult(h.result, me),
  };
}

export function rotateMatch(m: MatchState, me: number): MatchState {
  if (me === 0) return m;
  return {
    ...m,
    scores: me % 2 ? [m.scores[1], m.scores[0]] : m.scores,
    hand: rotHand(m.hand, me),
    history: m.history.map((r) => rotResult(r, me)),
    winnerTeam: team(m.winnerTeam, me),
    alive: rot(m.alive, me),
    revolvers: rot(m.revolvers, me),
    winnerPlayer: m.winnerPlayer === null ? null : toView(m.winnerPlayer, me),
    pendingShooters: m.pendingShooters.map((p) => toView(p, me)),
  };
}

export interface View {
  match: MatchState;
  phase: Phase;
  status: Status;
  seats: SeatInfo[];
  /** Whether you may press "next hand" (the host online, always you offline). */
  isController: boolean;
  /** Your engine seat, to translate back when sending intents. */
  me: number;
}

export function rotateSnapshot(s: Snapshot, me: number): View {
  const phase: Phase = s.phase.name === 'roulette' ? { ...s.phase, shooter: toView(s.phase.shooter, me) } : s.phase;
  const status: Status = s.status && { ...s.status, seat: toView(s.status.seat, me) };
  return {
    match: rotateMatch(s.match, me),
    phase, status,
    seats: rot(s.seats, me),
    isController: s.controller === me,
    me,
  };
}

export function rotateEvent(e: TableEvent, me: number): TableEvent {
  switch (e.kind) {
    case 'played':
    case 'passed':
    case 'pull':
      return { ...e, seat: toView(e.seat, me) };
    case 'handEnded':
      return { ...e, result: rotResult(e.result, me) };
    default:
      return e;
  }
}
