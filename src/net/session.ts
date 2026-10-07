import type { Difficulty } from '../engine/ai';
import type { MatchState, Mode, Rules } from '../engine/game';
import { Intent, SeatInfo, Snapshot, Table, TableEvent, defaultSeats } from './table';
import { cleanChat, nameKey } from './names';
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
  /** The host's seat (they can move chairs). */
  hostSeat: number;
  isHost: boolean;
  /** Code to share for tab-to-tab play (development); null on Steam. */
  code: string | null;
  canInvite: boolean;
}

type Listener = (events: TableEvent[]) => void;

/** Something said at the table; `seat` is the speaker's engine seat. */
export interface ChatLine {
  seat: number;
  name: string;
  text: string;
}

/** What the UI talks to, whether the table runs here or on a friend's computer. */
export abstract class Session {
  abstract readonly kind: 'local' | 'host' | 'guest';
  protected snap: Snapshot | null = null;
  protected listeners: Listener[] = [];
  private chatListeners: ((line: ChatLine) => void)[] = [];
  me = 0;
  /** Chat is for online tables. */
  readonly canChat: boolean = false;

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

  onChat(cb: (line: ChatLine) => void): () => void {
    this.chatListeners.push(cb);
    return () => { this.chatListeners = this.chatListeners.filter((l) => l !== cb); };
  }

  protected emitChat(line: ChatLine): void {
    for (const l of [...this.chatListeners]) l(line);
  }

  /** Say something to the table (online only). */
  chat(_text: string): void {
    /* nobody to talk to offline */
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

/** Friends fill the host's partner's seat first, so two friends play as a team in parejas. */
const JOIN_ORDER = [2, 1, 3];

/** Chat flood guard: at most this many lines per player every 10 seconds. */
const CHAT_BURST = 5;

export class HostSession extends Session {
  readonly kind = 'host';
  override readonly canChat = true;
  private seats: SeatInfo[];
  private mode: Mode = 'ruleta';
  private table: Table | null = null;
  private offs: (() => void)[] = [];
  private chatTimes = new Map<number, number[]>();

  constructor(private readonly config: TableConfig, private readonly transport: Transport & { code?: string }, name: string) {
    super();
    this.seats = defaultSeats();
    this.seats[0] = { kind: 'human', name, peer: transport.selfId };
    this.offs.push(transport.onMessage((from, msg) => this.onMessage(from, msg)));
    this.offs.push(transport.onPeerLeft((peer) => this.onLeft(peer)));
  }

  lobby(): Lobby | null {
    return this.table ? null : {
      mode: this.mode, seats: this.seats.map((s) => ({ ...s })), me: this.me, hostSeat: this.me, isHost: true,
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

  /** Before the match: swap two chairs (and whoever sits in them), which changes turns and partners. */
  swapSeats(a: number, b: number): void {
    if (this.table || a === b || ![a, b].every((p) => p >= 0 && p < 4)) return;
    [this.seats[a], this.seats[b]] = [this.seats[b], this.seats[a]];
    if (this.me === a) this.me = b;
    else if (this.me === b) this.me = a;
    this.broadcastLobby();
  }

  private seatOf(peer: string): number {
    return this.seats.findIndex((s) => s.kind === 'human' && s.peer === peer);
  }

  private onMessage(from: string, msg: NetMessage): void {
    if (msg.t === 'hello') {
      if (msg.version !== PROTOCOL_VERSION) return;
      let seat = this.seatOf(from);
      if (seat < 0) {
        seat = this.table ? -1 : JOIN_ORDER.map((o) => (this.me + o) % 4).find((p) => this.seats[p].kind === 'ai') ?? -1;
        if (seat < 0) return this.transport.send(from, { t: 'full' });
        this.seats[seat] = { kind: 'human', name: this.tableName(msg.name), peer: from };
      }
      this.broadcastLobby();
      if (this.table) this.sendSnapshot(seat, []);
    } else if (msg.t === 'intent') {
      const seat = this.seatOf(from);
      if (seat >= 0) this.table?.intent(seat, msg.intent);
    } else if (msg.t === 'chat') {
      const seat = this.seatOf(from);
      if (seat >= 0 && typeof msg.text === 'string') this.relayChat(seat, msg.text);
    }
  }

  /** Names are unique at the table: a second "Tito" becomes "Tito 2". */
  private tableName(raw: unknown): string {
    const base = [...String(raw ?? '').replace(/\s+/g, ' ').trim()].slice(0, 24).join('') || '?';
    const taken = new Set(this.seats.filter((s) => s.kind === 'human').map((s) => nameKey(s.name ?? '')));
    let name = base;
    for (let n = 2; taken.has(nameKey(name)); n++) name = `${base} ${n}`;
    return name;
  }

  chat(text: string): void {
    this.relayChat(this.me, text);
  }

  private relayChat(seat: number, raw: string): void {
    const text = cleanChat(raw);
    if (!text) return;
    const now = Date.now();
    const recent = (this.chatTimes.get(seat) ?? []).filter((at) => now - at < 10_000);
    if (recent.length >= CHAT_BURST) return;
    this.chatTimes.set(seat, [...recent, now]);
    const line: ChatLine = { seat, name: this.seats[seat].name ?? '', text };
    for (const p of this.remoteSeats()) this.transport.send(this.seats[p].peer!, { t: 'chatLine', ...line });
    this.emitChat(line);
  }

  private onLeft(peer: string): void {
    const seat = this.seatOf(peer);
    if (seat < 0 || seat === this.me) return;
    const ai: SeatInfo = { kind: 'ai', name: null, peer: null };
    this.seats[seat] = ai;
    if (this.table) this.table.setSeat(seat, ai);
    else this.broadcastLobby();
  }

  private remoteSeats(): number[] {
    return this.seats.map((s, p) => (p !== this.me && s.kind === 'human' ? p : -1)).filter((p) => p >= 0);
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
      controller: this.me, aiDelayMs: this.config.aiDelayMs, pullMs: PULL_MS, triggerTimeoutMs: 25_000, autoContinueMs: 12_000,
    });
    this.table = table;
    table.on((events) => {
      for (const p of this.remoteSeats()) this.sendSnapshot(p, events);
      this.publish(table.snapshot(this.me), events);
    });
    table.start();
  }

  send(intent: Intent): void {
    this.table?.intent(this.me, intent);
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
  override readonly canChat = true;
  private host: string;
  private lobbyState: { seats: SeatInfo[]; mode: Mode } | null = null;
  private offs: (() => void)[] = [];
  /** Set when the host closes the table, the table is full, or the table doesn't answer. */
  ended: 'full' | 'hostLeft' | 'noAnswer' | null = null;

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
      if (!this.lobbyState && !this.snap && !this.ended) this.end('noAnswer');
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
    } else if (msg.t === 'chatLine') {
      const text = cleanChat(String(msg.text ?? ''));
      if (text && Number.isInteger(msg.seat)) this.emitChat({ seat: msg.seat, name: String(msg.name ?? ''), text });
    } else if (msg.t === 'full') {
      this.end('full');
    } else if (msg.t === 'bye') {
      this.end('hostLeft');
    }
  }

  private end(reason: 'full' | 'hostLeft' | 'noAnswer'): void {
    this.ended = reason;
    this.publish(null, []);
  }

  lobby(): Lobby | null {
    if (this.snap || !this.lobbyState) return null;
    const hostSeat = this.lobbyState.seats.findIndex((s) => s.kind === 'human' && s.peer === this.host);
    return { ...this.lobbyState, me: this.me, hostSeat, isHost: false, code: null, canInvite: false };
  }

  send(intent: Intent): void {
    this.transport.send(this.host, { t: 'intent', intent });
  }

  chat(text: string): void {
    const clean = cleanChat(text);
    if (clean) this.transport.send(this.host, { t: 'chat', text: clean });
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
