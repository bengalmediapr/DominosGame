import type { Difficulty } from '../engine/ai';
import type { MatchState, Mode, Rules } from '../engine/game';
import { Intent, SeatInfo, Snapshot, Table, TableEvent, defaultSeats } from './table';
import { NetMessage, PROTOCOL_VERSION, Transport } from './transport';
import { View, rotateEvent, rotateSnapshot } from './view';

export interface TableConfig {
  rules(mode: Mode): Rules;
  difficulty: Difficulty;
  aiDelayMs: number;
}

/** Revolver animation length on screen (see TableScene.roulette). */
export const PULL_MS = 4400;

export interface Lobby {
  mode: Mode;
  /** Engine seats; yours is `me`. */
  seats: SeatInfo[];
  me: number;
  isHost: boolean;
  /** Code to share for tab-to-tab play (development); null on Steam. */
  code: string | null;
  canInvite: boolean;
}

type Listener = (events: TableEvent[]) => void;

/** What the UI talks to, whether the table runs here or on a friend's computer. */
export abstract class Session {
  abstract readonly kind: 'local' | 'host' | 'guest';
  protected snap: Snapshot | null = null;
  protected listeners: Listener[] = [];
  me = 0;

  /** The table as you see it (you at seat 0), or null while waiting in the lobby. */
  view(): View | null {
    return this.snap && rotateSnapshot(this.snap, this.me);
  }

  lobby(): Lobby | null {
    return null;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
  }

  protected publish(snapshot: Snapshot | null, events: TableEvent[]): void {
    if (snapshot) this.snap = snapshot;
    const rotated = events.map((e) => rotateEvent(e, this.me));
    for (const l of [...this.listeners]) l(rotated);
  }

  abstract send(intent: Intent): void;
  /** Start a fresh match (controller only). */
  abstract newMatch(mode?: Mode): void;
  abstract leave(): void;
}

// ---------- single player ----------

export class LocalSession extends Session {
  readonly kind = 'local';
  private table: Table;

  constructor(private readonly config: TableConfig, mode: Mode, saved?: MatchState, private readonly save?: (m: MatchState) => void) {
    super();
    this.table = this.makeTable(mode, saved);
  }

  private makeTable(mode: Mode, saved?: MatchState): Table {
    const table = new Table({
      rules: this.config.rules(mode), seats: defaultSeats(), difficulty: this.config.difficulty, rng: Math.random,
      controller: 0, aiDelayMs: this.config.aiDelayMs, pullMs: PULL_MS, triggerTimeoutMs: null, autoContinueMs: null,
      match: saved,
    });
    table.on((events) => {
      this.save?.(table.state);
      this.publish(table.snapshot(0), events);
    });
    table.start();
    return table;
  }

  get mode(): Mode {
    return this.table.state.rules.mode;
  }

  send(intent: Intent): void {
    this.table.intent(0, intent);
  }

  newMatch(mode: Mode = this.mode): void {
    this.table.dispose();
    this.table = this.makeTable(mode);
  }

  leave(): void {
    this.table.dispose();
    this.listeners = [];
  }
}

// ---------- online host ----------

/** How long a guest waits for the host to answer before giving up. */
export const GUEST_TIMEOUT_MS = 8000;

/** Friends fill the partner's seat first, so two friends play as a team in parejas. */
const JOIN_ORDER = [2, 1, 3];

export class HostSession extends Session {
  readonly kind = 'host';
  private seats: SeatInfo[];
  private mode: Mode = 'ruleta';
  private table: Table | null = null;
  private offs: (() => void)[] = [];

  constructor(private readonly config: TableConfig, private readonly transport: Transport & { code?: string }, name: string) {
    super();
    this.seats = defaultSeats();
    this.seats[0] = { kind: 'human', name, peer: transport.selfId };
    this.offs.push(transport.onMessage((from, msg) => this.onMessage(from, msg)));
    this.offs.push(transport.onPeerLeft((peer) => this.onLeft(peer)));
  }

  lobby(): Lobby | null {
    return this.table ? null : {
      mode: this.mode, seats: this.seats.map((s) => ({ ...s })), me: 0, isHost: true,
      code: this.transport.code ?? null, canInvite: !!this.transport.invite,
    };
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.broadcastLobby();
  }

  invite(): void {
    this.transport.invite?.();
  }

  private seatOf(peer: string): number {
    return this.seats.findIndex((s) => s.kind === 'human' && s.peer === peer);
  }

  private onMessage(from: string, msg: NetMessage): void {
    if (msg.t === 'hello') {
      if (msg.version !== PROTOCOL_VERSION) return;
      let seat = this.seatOf(from);
      if (seat < 0) {
        seat = this.table ? -1 : JOIN_ORDER.find((p) => this.seats[p].kind === 'ai') ?? -1;
        if (seat < 0) return this.transport.send(from, { t: 'full' });
        this.seats[seat] = { kind: 'human', name: msg.name.slice(0, 24), peer: from };
      }
      this.broadcastLobby();
      if (this.table) this.sendSnapshot(seat, []);
    } else if (msg.t === 'intent') {
      const seat = this.seatOf(from);
      if (seat >= 0) this.table?.intent(seat, msg.intent);
    }
  }

  private onLeft(peer: string): void {
    const seat = this.seatOf(peer);
    if (seat <= 0) return;
    const ai: SeatInfo = { kind: 'ai', name: null, peer: null };
    this.seats[seat] = ai;
    if (this.table) this.table.setSeat(seat, ai);
    else this.broadcastLobby();
  }

  private remoteSeats(): number[] {
    return this.seats.map((s, p) => (p > 0 && s.kind === 'human' ? p : -1)).filter((p) => p > 0);
  }

  private broadcastLobby(): void {
    for (const p of this.remoteSeats()) {
      this.transport.send(this.seats[p].peer!, { t: 'lobby', seats: this.seats, mode: this.mode, you: p });
    }
    this.publish(null, []);
  }

  private sendSnapshot(seat: number, events: TableEvent[]): void {
    if (!this.table) return;
    this.transport.send(this.seats[seat].peer!, { t: 'snapshot', snapshot: this.table.snapshot(seat), events });
  }

  /** Deal the first hand for everyone in the lobby. */
  start(): void {
    this.table?.dispose();
    const table = new Table({
      rules: this.config.rules(this.mode), seats: this.seats, difficulty: this.config.difficulty, rng: Math.random,
      controller: 0, aiDelayMs: this.config.aiDelayMs, pullMs: PULL_MS, triggerTimeoutMs: 25_000, autoContinueMs: 12_000,
    });
    this.table = table;
    table.on((events) => {
      for (const p of this.remoteSeats()) this.sendSnapshot(p, events);
      this.publish(table.snapshot(0), events);
    });
    table.start();
  }

  send(intent: Intent): void {
    this.table?.intent(0, intent);
  }

  newMatch(mode: Mode = this.mode): void {
    this.mode = mode;
    this.start();
  }

  leave(): void {
    this.table?.dispose();
    for (const p of this.remoteSeats()) this.transport.send(this.seats[p].peer!, { t: 'bye' });
    this.offs.forEach((off) => off());
    this.transport.close();
    this.listeners = [];
  }
}

// ---------- online guest ----------

export class GuestSession extends Session {
  readonly kind = 'guest';
  private host: string;
  private lobbyState: { seats: SeatInfo[]; mode: Mode } | null = null;
  private offs: (() => void)[] = [];
  /** Set when the host closes the table, the table is full, or no table answers the code. */
  ended: 'full' | 'hostLeft' | 'notFound' | null = null;

  constructor(private readonly transport: Transport, name: string) {
    super();
    this.host = transport.hostId;
    this.offs.push(transport.onMessage((from, msg) => this.onMessage(from, msg)));
    this.offs.push(transport.onPeerLeft((peer) => {
      if (peer === this.host) this.end('hostLeft');
    }));
    const hello: NetMessage = { t: 'hello', name, version: PROTOCOL_VERSION };
    transport.send(this.host, hello);
    // In case the host wasn't listening yet, say hello again until it answers.
    const retry = setInterval(() => {
      if (this.lobbyState || this.ended) clearInterval(retry);
      else transport.send(this.host, hello);
    }, 1000);
    // Nobody answered: wrong code, or the table is somewhere this transport can't reach.
    const giveUp = setTimeout(() => {
      if (!this.lobbyState && !this.snap && !this.ended) this.end('notFound');
    }, GUEST_TIMEOUT_MS);
    this.offs.push(() => clearInterval(retry), () => clearTimeout(giveUp));
  }

  private onMessage(from: string, msg: NetMessage): void {
    if (this.host !== '*' && from !== this.host) return;
    if (msg.t === 'lobby') {
      this.host = from;
      this.me = msg.you;
      this.lobbyState = { seats: msg.seats, mode: msg.mode };
      this.publish(null, []);
    } else if (msg.t === 'snapshot') {
      this.host = from;
      this.publish(msg.snapshot, msg.events);
    } else if (msg.t === 'full') {
      this.end('full');
    } else if (msg.t === 'bye') {
      this.end('hostLeft');
    }
  }

  private end(reason: 'full' | 'hostLeft' | 'notFound'): void {
    this.ended = reason;
    this.publish(null, []);
  }

  lobby(): Lobby | null {
    if (this.snap || !this.lobbyState) return null;
    return { ...this.lobbyState, me: this.me, isHost: false, code: null, canInvite: false };
  }

  send(intent: Intent): void {
    this.transport.send(this.host, { t: 'intent', intent });
  }

  newMatch(): void {
    /* only the host starts matches */
  }

  leave(): void {
    this.offs.forEach((off) => off());
    this.transport.close();
    this.listeners = [];
  }
}
