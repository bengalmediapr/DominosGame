import { Difficulty, chooseMove } from '../engine/ai';
import {
  HandResult, MatchState, Move, PLAYERS, Rules, applyMove, isMatchOver, isMoveLegal, legalMoves, newMatch, pass,
  pullTrigger, scoreFinishedHand, startNextHand,
} from '../engine/game';
import { Rng, Tile } from '../engine/tiles';

/**
 * The authoritative game flow. In single-player it runs on your machine; online it runs only on the
 * host, which sends each player a redacted snapshot (no one else's tiles, no bullet positions) and
 * accepts their intents. The UI never changes the match itself.
 */

export type SeatKind = 'human' | 'ai';

export interface SeatInfo {
  kind: SeatKind;
  /** Display name for humans online (e.g. their Steam name); AI and local players use the defaults. */
  name: string | null;
  /** Network peer id for remote humans; 'local' for whoever runs the table. */
  peer: string | null;
  /** The character a human chose to appear as (see ui/cast.ts). */
  look?: string | null;
}

export type Phase =
  | { name: 'playing' }
  | { name: 'handOver' }
  | { name: 'roulette'; shooter: number; awaitingTrigger: boolean }
  | { name: 'matchOver' };

export type Status = { kind: 'opens' | 'mustShoot' | 'out' | 'empty'; seat: number } | null;

export interface Snapshot {
  seq: number;
  match: MatchState;
  phase: Phase;
  status: Status;
  seats: SeatInfo[];
  /** Seat allowed to press "next hand" / start a new match. */
  controller: number;
}

export type TableEvent =
  | { kind: 'played'; seat: number; move: Move }
  | { kind: 'passed'; seat: number }
  | { kind: 'handEnded'; result: HandResult }
  | { kind: 'pull'; seat: number; fired: boolean }
  | { kind: 'matchEnded' };

export type Intent =
  | { kind: 'move'; move: Move }
  | { kind: 'continue' }
  | { kind: 'trigger' };

export interface TableOptions {
  rules: Rules;
  seats: SeatInfo[];
  difficulty: Difficulty;
  rng: Rng;
  controller: number;
  /** Pause before an AI plays, so humans can follow. */
  aiDelayMs: number;
  /** How long the revolver animation takes on screen. */
  pullMs: number;
  /** Online: pull the trigger for a human who doesn't (null = wait forever). */
  triggerTimeoutMs: number | null;
  /** Online: move on from the hand result on its own (null = wait for the controller). */
  autoContinueMs: number | null;
  /** Resume a saved match instead of dealing a new one. */
  match?: MatchState;
}

const HIDDEN: Tile = [-1, -1];

export class Table {
  private match: MatchState;
  private phase: Phase = { name: 'playing' };
  private status: Status = null;
  private seq = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private listeners: ((events: TableEvent[]) => void)[] = [];
  private seats: SeatInfo[];

  constructor(private readonly opts: TableOptions) {
    this.seats = opts.seats.map((s) => ({ ...s }));
    this.match = opts.match ?? newMatch(opts.rng, opts.rules);
    if (this.match.hand.result) {
      this.phase = isMatchOver(this.match) || this.humansAllDead() ? { name: 'matchOver' } : { name: 'handOver' };
    } else if (this.match.hand.placements.length === 0) {
      this.status = { kind: 'opens', seat: this.match.hand.current };
    }
  }

  on(listener: (events: TableEvent[]) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  start(): void {
    this.emit([]);
    this.schedule(this.opts.aiDelayMs * 1.5, () => this.step());
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listeners = [];
  }

  /** Full state, for saving a single-player match. */
  get state(): MatchState {
    return this.match;
  }

  /** What `seat` is allowed to see. */
  snapshot(seat: number): Snapshot {
    const m = this.match;
    const reveal = m.hand.result !== null;
    const hands = m.hand.hands.map((h, p) => (reveal || p === seat ? h : h.map(() => HIDDEN)));
    return {
      seq: this.seq,
      match: {
        ...m,
        hand: { ...m.hand, hands },
        revolvers: m.revolvers.map((r) => ({ pulls: r.pulls, bullet: -1 })),
      },
      phase: this.phase,
      status: this.status,
      seats: this.seats.map((s) => ({ ...s })),
      controller: this.opts.controller,
    };
  }

  seatInfo(seat: number): SeatInfo {
    return { ...this.seats[seat] };
  }

  /** A human left (or joined mid-match): their seat is played by the AI from now on. */
  setSeat(seat: number, info: SeatInfo): void {
    this.seats[seat] = { ...info };
    if (this.phase.name === 'roulette' && this.phase.shooter === seat && info.kind === 'ai') {
      this.phase = { ...this.phase, awaitingTrigger: false };
      this.schedule(800, () => this.pull(seat));
    }
    this.emit([]);
    this.step();
  }

  /** A player asks to do something; anything not allowed right now is ignored. */
  intent(seat: number, intent: Intent): boolean {
    const m = this.match;
    switch (intent.kind) {
      case 'move': {
        if (this.phase.name !== 'playing' || m.hand.result || m.hand.current !== seat) return false;
        if (this.seats[seat].kind !== 'human' || !isMoveLegal(m.hand, intent.move)) return false;
        this.play(intent.move);
        return true;
      }
      case 'trigger': {
        if (this.phase.name !== 'roulette' || this.phase.shooter !== seat || !this.phase.awaitingTrigger) return false;
        this.pull(seat);
        return true;
      }
      case 'continue': {
        if (this.phase.name !== 'handOver' || seat !== this.opts.controller) return false;
        this.continueAfterHand();
        return true;
      }
    }
  }

  // ---------- flow ----------

  private isHuman(seat: number): boolean {
    return this.seats[seat].kind === 'human';
  }

  private humansAllDead(): boolean {
    if (this.match.rules.mode !== 'ruleta') return false;
    const humans = this.seats.map((s, p) => (s.kind === 'human' ? p : -1)).filter((p) => p >= 0);
    return humans.length > 0 && humans.every((p) => !this.match.alive[p]);
  }

  private step(): void {
    const h = this.match.hand;
    if (this.phase.name !== 'playing' || h.result) return;
    const seat = h.current;
    const moves = legalMoves(h);
    if (this.isHuman(seat) && moves.length > 0) return; // wait for their intent
    this.schedule(moves.length === 0 && this.isHuman(seat) ? this.opts.aiDelayMs * 0.8 : this.opts.aiDelayMs, () => {
      if (this.phase.name !== 'playing' || this.match.hand !== h) return;
      const move = this.isHuman(seat) ? null : chooseMove(h, this.match.rules, this.opts.difficulty, this.opts.rng);
      if (move) this.play(move);
      else {
        this.match = { ...this.match, hand: pass(h) };
        this.status = null;
        this.emit([{ kind: 'passed', seat }]);
        this.step();
      }
    });
  }

  private play(move: Move): void {
    const seat = this.match.hand.current;
    this.match = { ...this.match, hand: applyMove(this.match.hand, move, this.match.rules) };
    this.status = null;
    const events: TableEvent[] = [{ kind: 'played', seat, move }];
    const result = this.match.hand.result;
    if (result) {
      this.match = scoreFinishedHand(this.match);
      events.push({ kind: 'handEnded', result });
      if (isMatchOver(this.match) && this.match.rules.mode === 'parejas') {
        this.phase = { name: 'matchOver' };
        events.push({ kind: 'matchEnded' });
      } else {
        this.phase = { name: 'handOver' };
        if (this.opts.autoContinueMs !== null) {
          const hand = this.match.hand;
          this.schedule(this.opts.autoContinueMs, () => {
            if (this.phase.name === 'handOver' && this.match.hand === hand) this.continueAfterHand();
          });
        }
      }
    }
    this.emit(events);
    this.step();
  }

  private continueAfterHand(): void {
    if (this.match.rules.mode === 'ruleta' && this.match.pendingShooters.length > 0) this.nextShooter();
    else this.nextHand();
  }

  private nextShooter(): void {
    const shooter = this.match.pendingShooters[0];
    const human = this.isHuman(shooter);
    this.phase = { name: 'roulette', shooter, awaitingTrigger: human };
    this.status = { kind: 'mustShoot', seat: shooter };
    this.emit([]);
    if (!human) this.schedule(1100, () => this.pull(shooter));
    else if (this.opts.triggerTimeoutMs !== null) {
      this.schedule(this.opts.triggerTimeoutMs, () => {
        if (this.phase.name === 'roulette' && this.phase.shooter === shooter && this.phase.awaitingTrigger) this.pull(shooter);
      });
    }
  }

  private pull(shooter: number): void {
    if (this.phase.name !== 'roulette' || this.phase.shooter !== shooter) return;
    const { match, fired } = pullTrigger(this.match, shooter);
    this.match = match;
    this.phase = { name: 'roulette', shooter, awaitingTrigger: false };
    this.status = null;
    this.emit([{ kind: 'pull', seat: shooter, fired }]);
    this.schedule(this.opts.pullMs, () => {
      this.status = { kind: fired ? 'out' : 'empty', seat: shooter };
      this.emit([]);
      this.schedule(1500, () => {
        this.status = null;
        if (isMatchOver(this.match) || this.humansAllDead()) {
          this.phase = { name: 'matchOver' };
          this.emit([{ kind: 'matchEnded' }]);
        } else if (this.match.pendingShooters.length > 0) this.nextShooter();
        else this.nextHand();
      });
    });
  }

  private nextHand(): void {
    this.match = startNextHand(this.match, this.opts.rng);
    this.phase = { name: 'playing' };
    this.status = null;
    this.emit([]);
    this.step();
  }

  private schedule(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private emit(events: TableEvent[]): void {
    this.seq++;
    for (const l of [...this.listeners]) {
      // A display bug must never stall the match for everyone at the table.
      try {
        l(events);
      } catch (err) {
        console.error('Table listener failed', err);
      }
    }
  }
}

export const defaultSeats = (): SeatInfo[] =>
  Array.from({ length: PLAYERS }, (_, p) => ({ kind: p === 0 ? 'human' : 'ai', name: null, peer: p === 0 ? 'local' : null }));
