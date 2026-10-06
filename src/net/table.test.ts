import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, Rules, isMatchOver, legalMoves } from '../engine/game';
import { mulberry32 } from '../engine/tiles';
import { SeatInfo, Table, TableOptions, defaultSeats } from './table';

const RULETA: Rules = { ...DEFAULT_RULES, mode: 'ruleta' };
const human = (peer: string): SeatInfo => ({ kind: 'human', name: peer, peer });

function makeTable(over: Partial<TableOptions> = {}): Table {
  return new Table({
    rules: DEFAULT_RULES, seats: defaultSeats(), difficulty: 'normal', rng: mulberry32(7), controller: 0,
    aiDelayMs: 10, pullMs: 10, triggerTimeoutMs: null, autoContinueMs: null, ...over,
  });
}

/** Plays every human seat by intent (first legal move, press continue, pull trigger) until the match ends. */
function playOut(table: Table, humans: number[]): void {
  for (let i = 0; i < 20_000; i++) {
    const snap = table.snapshot(0);
    if (snap.phase.name === 'matchOver') return;
    const h = table.state.hand;
    if (snap.phase.name === 'playing' && humans.includes(h.current) && legalMoves(h).length) {
      table.intent(h.current, { kind: 'move', move: legalMoves(h)[0] });
    } else if (snap.phase.name === 'handOver') {
      table.intent(snap.controller, { kind: 'continue' });
    } else if (snap.phase.name === 'roulette' && snap.phase.awaitingTrigger) {
      table.intent(snap.phase.shooter, { kind: 'trigger' });
    }
    vi.advanceTimersByTime(50);
  }
  throw new Error('match did not finish');
}

describe('Table (authoritative game flow)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('plays a full parejas match with one human to a winner', () => {
    const t = makeTable();
    t.start();
    playOut(t, [0]);
    expect(t.state.winnerTeam).not.toBeNull();
  });

  it('plays a full ruleta match with two humans until it is over for them', () => {
    const seats = defaultSeats();
    seats[2] = human('friend');
    const t = makeTable({ rules: RULETA, seats, rng: mulberry32(3) });
    t.start();
    playOut(t, [0, 2]);
    const m = t.state;
    expect(isMatchOver(m) || (!m.alive[0] && !m.alive[2])).toBe(true);
  });

  it('never shows a player anyone else’s tiles or where the bullets are', () => {
    const t = makeTable({ rules: RULETA });
    const snap = t.snapshot(1);
    expect(snap.match.hand.hands[1].every(([a]) => a >= 0)).toBe(true);
    for (const p of [0, 2, 3]) expect(snap.match.hand.hands[p].every(([a, b]) => a === -1 && b === -1)).toBe(true);
    expect(snap.match.revolvers.every((r) => r.bullet === -1)).toBe(true);
    expect(snap.match.hand.hands[0]).toHaveLength(7);
  });

  it('ignores moves out of turn, illegal moves and continues from non-controllers', () => {
    const seats = defaultSeats().map((): SeatInfo => human('x'));
    const t = makeTable({ seats });
    const h = t.state.hand;
    const other = (h.current + 1) % 4;
    expect(t.intent(other, { kind: 'move', move: { tile: t.state.hand.hands[other][0], side: 'left' } })).toBe(false);
    expect(t.intent(h.current, { kind: 'move', move: { tile: [0, 0], side: 'left' } })).toBe(
      legalMoves(h).some((m) => m.tile[0] === 0 && m.tile[1] === 0),
    );
    expect(t.intent(1, { kind: 'continue' })).toBe(false);
  });

  it('pulls the trigger for a human who takes too long online', () => {
    const seats = defaultSeats();
    seats[0] = human('host');
    const t = makeTable({ rules: RULETA, seats, triggerTimeoutMs: 1000, autoContinueMs: 500, rng: mulberry32(11) });
    t.start();
    const pulls: number[] = [];
    t.on((events) => events.forEach((e) => e.kind === 'pull' && pulls.push(e.seat)));
    for (let i = 0; i < 20_000 && pulls.length === 0; i++) {
      const h = t.state.hand;
      if (t.snapshot(0).phase.name === 'playing' && h.current === 0 && legalMoves(h).length) {
        t.intent(0, { kind: 'move', move: legalMoves(h)[0] });
      }
      vi.advanceTimersByTime(50);
    }
    expect(pulls.length).toBeGreaterThan(0);
  });

  it('lets the AI take over the seat of a player who leaves', () => {
    const seats = defaultSeats();
    seats[1] = human('friend');
    const t = makeTable({ seats, rng: mulberry32(5) });
    t.start();
    for (let i = 0; i < 2000 && t.state.hand.current !== 1; i++) {
      const h = t.state.hand;
      if (h.current === 0 && legalMoves(h).length) t.intent(0, { kind: 'move', move: legalMoves(h)[0] });
      vi.advanceTimersByTime(50);
    }
    const before = t.state.hand.placements.length;
    vi.advanceTimersByTime(5000);
    expect(t.state.hand.placements.length).toBe(before); // waiting for the human
    t.setSeat(1, { kind: 'ai', name: null, peer: null });
    vi.advanceTimersByTime(100);
    expect(t.state.hand.placements.length > before || t.state.hand.passes.length > 0).toBe(true);
  });
});
