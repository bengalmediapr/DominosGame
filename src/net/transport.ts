import type { Mode } from '../engine/game';
import { API_BASE, relayUrl } from './api';
import type { Intent, SeatInfo, Snapshot, TableEvent } from './table';

/** Everything that travels between players. The host is the only one who runs the rules. */
export type NetMessage =
  | { t: 'hello'; name: string; version: number; look?: string }
  | { t: 'lobby'; seats: SeatInfo[]; mode: Mode; you: number }
  | { t: 'full' }
  | { t: 'snapshot'; snapshot: Snapshot; events: TableEvent[] }
  | { t: 'intent'; intent: Intent }
  | { t: 'bye' }
  | { t: 'ping' }
  /** A guest says something; the host checks it and passes it on to everyone as a chatLine. */
  | { t: 'chat'; text: string }
  | { t: 'chatLine'; seat: number; name: string; text: string };

/**
 * Bump only for changes old pages can't live with: a mismatch locks players out of each other's
 * tables. New message types (like chat) are fine without a bump, since older pages ignore them.
 */
export const PROTOCOL_VERSION = 1;

export interface Transport {
  readonly selfId: string;
  /** The host's id (equal to selfId on the host). */
  readonly hostId: string;
  send(to: string, msg: NetMessage): void;
  onMessage(cb: (from: string, msg: NetMessage) => void): () => void;
  /** A peer left or stopped answering. */
  onPeerLeft(cb: (peer: string) => void): () => void;
  /** Open the platform's invite dialog, if it has one. */
  invite?(): void;
  /** Called after the connection came back from a drop (to catch up on what was missed). */
  onReconnected?(cb: () => void): () => void;
  close(): void;
}

// ---------- Steam (desktop) ----------

export interface SteamBridge {
  info(): Promise<{ available: boolean; selfId?: string; name?: string }>;
  takePendingJoin(): Promise<string | null>;
  createLobby(): Promise<{ lobbyId: string; selfId: string }>;
  joinLobby(id: string): Promise<{ lobbyId: string; selfId: string; hostId: string }>;
  leaveLobby(): void;
  invite(): void;
  send(to: string, data: string): void;
  onMessage(cb: (from: string, data: string) => void): () => void;
  onLeft(cb: (steamId: string) => void): () => void;
  onJoinRequested(cb: (lobbyId: string) => void): () => void;
}

class SteamTransport implements Transport {
  private offs: (() => void)[] = [];
  constructor(private readonly steam: SteamBridge, readonly selfId: string, readonly hostId: string) {}

  send(to: string, msg: NetMessage): void {
    this.steam.send(to, JSON.stringify(msg));
  }

  onMessage(cb: (from: string, msg: NetMessage) => void): () => void {
    const off = this.steam.onMessage((from, data) => {
      try {
        cb(from, JSON.parse(data) as NetMessage);
      } catch {
        /* ignore malformed packets */
      }
    });
    this.offs.push(off);
    return off;
  }

  onPeerLeft(cb: (peer: string) => void): () => void {
    const off = this.steam.onLeft(cb);
    this.offs.push(off);
    return off;
  }

  invite(): void {
    this.steam.invite();
  }

  close(): void {
    this.offs.forEach((off) => off());
    this.steam.leaveLobby();
  }
}

export async function hostOnSteam(steam: SteamBridge): Promise<Transport> {
  const { selfId } = await steam.createLobby();
  return new SteamTransport(steam, selfId, selfId);
}

export async function joinOnSteam(steam: SteamBridge, lobbyId: string): Promise<Transport> {
  const { selfId, hostId } = await steam.joinLobby(lobbyId);
  return new SteamTransport(steam, selfId, hostId);
}

// ---------- BroadcastChannel (two tabs on one computer: development and tests) ----------

interface Envelope { from: string; to: string; msg: NetMessage }

const TAB_SILENCE_MS = 20_000;

class TabTransport implements Transport {
  private readonly channel: BroadcastChannel;
  private readonly lastSeen = new Map<string, number>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private messageCbs: ((from: string, msg: NetMessage) => void)[] = [];
  private leftCbs: ((peer: string) => void)[] = [];

  constructor(readonly code: string, readonly selfId: string, readonly hostId: string) {
    this.channel = new BroadcastChannel(`capicu:${code}`);
    this.channel.onmessage = (e: MessageEvent<Envelope>) => {
      const { from, to, msg } = e.data;
      if (to !== this.selfId && to !== '*') return;
      this.lastSeen.set(from, Date.now());
      if (msg.t === 'ping') return;
      if (msg.t === 'bye') return this.dropPeer(from);
      for (const cb of this.messageCbs) cb(from, msg);
    };
    // Tabs can close without saying goodbye: ping, and drop peers that go quiet. Generous, because a
    // tab loading the 3D scene on a slow machine can stall for several seconds.
    let lastTick = Date.now();
    this.heartbeat = setInterval(() => {
      this.post('*', { t: 'ping' });
      const now = Date.now();
      // If this tab was the one frozen, its peers' messages are still queued: they weren't silent.
      const frozen = now - lastTick > 5000;
      lastTick = now;
      if (frozen) return;
      for (const [peer, seen] of this.lastSeen) if (now - seen > TAB_SILENCE_MS) this.dropPeer(peer);
    }, 1500);
  }

  private post(to: string, msg: NetMessage): void {
    this.channel.postMessage({ from: this.selfId, to, msg } satisfies Envelope);
  }

  private dropPeer(peer: string): void {
    if (!this.lastSeen.delete(peer)) return;
    for (const cb of this.leftCbs) cb(peer);
  }

  send(to: string, msg: NetMessage): void {
    this.post(to, msg);
  }

  onMessage(cb: (from: string, msg: NetMessage) => void): () => void {
    this.messageCbs.push(cb);
    return () => { this.messageCbs = this.messageCbs.filter((c) => c !== cb); };
  }

  onPeerLeft(cb: (peer: string) => void): () => void {
    this.leftCbs.push(cb);
    return () => { this.leftCbs = this.leftCbs.filter((c) => c !== cb); };
  }

  close(): void {
    this.post('*', { t: 'bye' });
    clearInterval(this.heartbeat);
    this.channel.close();
  }
}

const randomId = () => Math.random().toString(36).slice(2, 10);

export function hostInTabs(): Transport & { code: string } {
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  const id = `host-${randomId()}`;
  return new TabTransport(code, id, id);
}

export function joinInTabs(code: string): Transport {
  // The host's id isn't known yet: tab hosts answer to the conventional prefix via '*'.
  return new TabTransport(code.toUpperCase(), `guest-${randomId()}`, '*');
}

// ---------- Internet, browser to browser (WebRTC via PeerJS) ----------

/**
 * Lets the web build play across the internet without a server of our own: PeerJS's free public
 * broker only introduces the browsers (table code -> peer id); game messages then flow directly
 * between them over WebRTC. Many home routers block that direct path, so both sides also get relay
 * (TURN) servers from our own /api/ice (Cloudflare), falling back to PeerJS's public ones.
 */
const PEER_PREFIX = 'capicu-table-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

function tableCode(): string {
  return Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
}

type PeerLib = typeof import('peerjs');
type PeerInstance = import('peerjs').Peer;
type DataConnection = import('peerjs').DataConnection;

export class NetError extends Error {
  /** unreachable: no broker; notFound: no table with that code; blocked: the table is there, but no network path to it. */
  constructor(readonly reason: 'unreachable' | 'notFound' | 'blocked') {
    super(reason);
  }
}

class PeerTransport implements Transport {
  private readonly conns = new Map<string, DataConnection>();
  private messageCbs: ((from: string, msg: NetMessage) => void)[] = [];
  private leftCbs: ((peer: string) => void)[] = [];

  private closed = false;

  constructor(private readonly peer: PeerInstance, readonly selfId: string, readonly hostId: string) {
    peer.on('connection', (conn) => {
      netLog(`guest ${conn.peer.slice(0, 8)} is knocking`);
      watchIce(conn, `guest ${conn.peer.slice(0, 8)}`);
      this.adopt(conn);
    });
    peer.on('error', (err) => netLog(`peer error: ${err.type} ${err.message}`.slice(0, 160)));
    peer.on('disconnected', () => netLog('broker: disconnected, reconnecting'));
    // The broker forgets a peer whose tab went to sleep (switching to WhatsApp to send the code is
    // enough on a heavy page). Register again, under the same id, so the table code keeps working.
    peer.on('disconnected', () => this.reconnect());
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private reconnect(): void {
    if (this.closed || this.peer.destroyed || !this.peer.disconnected) return;
    try {
      this.peer.reconnect();
    } catch {
      /* broker still unreachable */
    }
    setTimeout(() => this.reconnect(), 3000);
  }

  private readonly onVisible = (): void => {
    if (!document.hidden) this.reconnect();
  };

  adopt(conn: DataConnection): void {
    const ready = () => { netLog(`channel open with ${conn.peer.slice(0, 8)}`); this.conns.set(conn.peer, conn); };
    if (conn.open) ready();
    else conn.on('open', ready);
    conn.on('data', (data) => {
      for (const cb of this.messageCbs) cb(conn.peer, data as NetMessage);
    });
    conn.on('error', (err) => netLog(`channel error: ${String((err as Error)?.message ?? err)}`.slice(0, 160)));
    const gone = () => {
      if (this.conns.get(conn.peer) !== conn) return;
      this.conns.delete(conn.peer);
      for (const cb of this.leftCbs) cb(conn.peer);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  send(to: string, msg: NetMessage): void {
    this.conns.get(to)?.send(msg);
  }

  onMessage(cb: (from: string, msg: NetMessage) => void): () => void {
    this.messageCbs.push(cb);
    return () => { this.messageCbs = this.messageCbs.filter((c) => c !== cb); };
  }

  onPeerLeft(cb: (peer: string) => void): () => void {
    this.leftCbs.push(cb);
    return () => { this.leftCbs = this.leftCbs.filter((c) => c !== cb); };
  }

  close(): void {
    this.closed = true;
    document.removeEventListener('visibilitychange', this.onVisible);
    for (const conn of this.conns.values()) conn.close();
    this.peer.destroy();
  }
}

const loadPeer = (): Promise<PeerLib> => import('peerjs');

/**
 * What happened while connecting, step by step: shown (and copyable) when joining fails, so a
 * failure on someone's phone can be diagnosed from a message.
 */
const netLogLines: string[] = [];
let netLogStart = Date.now();
/** Called after each new line (the UI redraws the log). */
export const netLogWatch: { onLine: (() => void) | null } = { onLine: null };
export function netLog(line?: string): string[] {
  if (line) {
    netLogLines.push(`${((Date.now() - netLogStart) / 1000).toFixed(1)}s ${line}`);
    netLogWatch.onLine?.();
  }
  return netLogLines.slice(-60);
}
export function resetNetLog(): void {
  netLogLines.length = 0;
  netLogStart = Date.now();
  netLog(`${navigator.userAgent.replace(/\s+/g, ' ').slice(0, 140)}`);
}

/** Follow a connection's WebRTC negotiation: which kinds of routes it finds, and how it ends up. */
function watchIce(conn: DataConnection, who: string): void {
  let tries = 0;
  const attach = () => {
    const pc = conn.peerConnection as RTCPeerConnection | undefined;
    if (!pc) {
      if (tries++ < 50) setTimeout(attach, 100);
      return;
    }
    const kinds = new Set<string>();
    pc.addEventListener('icecandidate', (e) => {
      const type = e.candidate?.type ?? (e.candidate ? /typ (\w+)/.exec(e.candidate.candidate)?.[1] : null);
      if (type && !kinds.has(type)) { kinds.add(type); netLog(`${who}: route found (${type})`); }
      if (!e.candidate) netLog(`${who}: routes gathered [${[...kinds].join(', ') || 'none'}]`);
    });
    pc.addEventListener('iceconnectionstatechange', () => netLog(`${who}: ice ${pc.iceConnectionState}`));
    pc.addEventListener('connectionstatechange', () => netLog(`${who}: connection ${pc.connectionState}`));
  };
  attach();
}

/** Relay servers from our server, or null to use PeerJS's defaults. */
async function iceServers(): Promise<RTCIceServer[] | null> {
  try {
    const res = await fetch(`${API_BASE}/ice`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const { iceServers: servers } = await res.json() as { iceServers?: RTCIceServer[] };
    return servers?.length ? [...servers, { urls: 'stun:stun.l.google.com:19302' }] : null;
  } catch {
    return null;
  }
}

/** Tests can point PeerJS at a local broker ("localhost:9000") instead of the public one. */
function brokerOverride(): { host: string; port: number; path: string; secure: boolean } | null {
  try {
    const [host, port] = (localStorage.getItem('capicu.peerServer') ?? '').split(':');
    return host && port ? { host, port: Number(port), path: '/', secure: false } : null;
  } catch {
    return null;
  }
}

async function newPeer(id?: string): Promise<PeerInstance> {
  const [{ Peer }, ice] = await Promise.all([loadPeer(), iceServers()]);
  netLog(ice ? `relay servers: ${ice.length} (${ice.some((s) => String(s.urls).includes('turn')) ? 'with TURN' : 'no TURN'})` : 'relay servers: none (PeerJS defaults)');
  const options = { debug: 0 as const, ...brokerOverride(), ...(ice ? { config: { iceServers: ice } } : {}) };
  return id ? new Peer(id, options) : new Peer(options);
}

/** Resolves once the broker has registered us, or fails after `ms`. */
function opened(peer: PeerInstance, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new NetError('unreachable')), ms);
    peer.once('open', (id) => { clearTimeout(timer); netLog(`broker: registered as ${id}`); resolve(id); });
    peer.once('error', (err) => {
      netLog(`broker error: ${err.type} ${err.message}`.slice(0, 160));
      clearTimeout(timer);
      reject(err.type === 'unavailable-id' ? err : new NetError('unreachable'));
    });
  });
}

// ---------- Internet through our relay (relay/, WebSockets to a Cloudflare Worker) ----------

type RelayFrame = { from: string; msg: NetMessage } | { sys: 'left'; id: string } | { sys: 'notFound' | 'taken' };

/** How often each side says it's still there, so idle connections aren't cut by the network. */
const RELAY_PING_MS = 25_000;
/** Give up reconnecting after this long without the relay. */
const RELAY_RETRY_MS = 60_000;

class RelayTransport implements Transport {
  private ws: WebSocket | null = null;
  private closed = false;
  private outbox: string[] = [];
  private messageCbs: ((from: string, msg: NetMessage) => void)[] = [];
  private leftCbs: ((peer: string) => void)[] = [];
  private lostSince: number | null = null;
  private ping: ReturnType<typeof setInterval>;
  private reconnectedCbs: (() => void)[] = [];
  private everOpen = false;
  /** Last peer heard from: for a guest, the host. */
  private lastFrom = '*';

  constructor(private readonly url: string, private readonly role: 'host' | 'guest', readonly selfId: string, readonly hostId: string) {
    this.ping = setInterval(() => this.post({ to: '*', msg: { t: 'ping' } }), RELAY_PING_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Resolves once the room has us; rejects if the room turns us away. */
  connect(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { this.close(); reject(err); } else resolve();
      };
      const timer = setTimeout(() => { netLog('relay: no answer'); settle(new NetError('unreachable')); }, timeoutMs);
      this.open((frame) => {
        if ('sys' in frame && frame.sys === 'notFound') settle(new NetError('notFound'));
        if ('sys' in frame && frame.sys === 'taken') settle(new RelayTaken());
      }, () => settle());
    });
  }

  private open(onSys?: (frame: RelayFrame) => void, onOpen?: () => void): void {
    const ws = new WebSocket(`${this.url}?role=${this.role}&id=${encodeURIComponent(this.selfId)}`);
    this.ws = ws;
    ws.onopen = () => {
      netLog(`relay: connected as ${this.role}`);
      this.lostSince = null;
      // Rejections arrive right after opening; give them a moment before trusting the room.
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        onOpen?.();
        for (const line of this.outbox.splice(0)) ws.send(line);
        if (this.everOpen) for (const cb of this.reconnectedCbs) cb();
        this.everOpen = true;
      }, 150);
    };
    ws.onmessage = (e) => {
      let frame: RelayFrame;
      try {
        frame = JSON.parse(String(e.data)) as RelayFrame;
      } catch {
        return;
      }
      if ('sys' in frame) {
        if (frame.sys === 'left') for (const cb of this.leftCbs) cb(frame.id);
        else { netLog(`relay: ${frame.sys}`); onSys?.(frame); }
        return;
      }
      if (frame.msg?.t === 'ping') return;
      this.lastFrom = frame.from;
      for (const cb of this.messageCbs) cb(frame.from, frame.msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.closed) return;
      if (e.code === 4004 || e.code === 4009) return; // turned away: connect() already said why
      netLog(`relay: connection lost (${e.code}), reconnecting`);
      this.lostSince ??= Date.now();
      if (Date.now() - this.lostSince > RELAY_RETRY_MS) {
        netLog('relay: gave up reconnecting');
        this.close();
        for (const cb of this.leftCbs) cb(this.role === 'guest' ? this.lastFrom : this.selfId);
        return;
      }
      setTimeout(() => { if (!this.closed && this.ws === ws) this.open(); }, document.hidden ? 5000 : 1000);
    };
  }

  private readonly onVisible = (): void => {
    // A phone coming back from another app: reconnect right away instead of waiting.
    if (!document.hidden && !this.closed && this.ws && this.ws.readyState > WebSocket.OPEN) this.open();
  };

  private post(frame: { to?: string; msg: NetMessage }): void {
    const line = JSON.stringify(this.role === 'host' ? frame : { msg: frame.msg });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(line);
    else if (this.outbox.length < 200) this.outbox.push(line);
  }

  send(to: string, msg: NetMessage): void {
    this.post({ to, msg });
  }

  onMessage(cb: (from: string, msg: NetMessage) => void): () => void {
    this.messageCbs.push(cb);
    return () => { this.messageCbs = this.messageCbs.filter((c) => c !== cb); };
  }

  onPeerLeft(cb: (peer: string) => void): () => void {
    this.leftCbs.push(cb);
    return () => { this.leftCbs = this.leftCbs.filter((c) => c !== cb); };
  }

  onReconnected(cb: () => void): () => void {
    this.reconnectedCbs.push(cb);
    return () => { this.reconnectedCbs = this.reconnectedCbs.filter((c) => c !== cb); };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ping);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ws?.close(1000, 'bye');
  }
}

class RelayTaken extends Error {}

const relayPeerId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 12)}`;

async function hostOnRelay(base: string): Promise<Transport & { code: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = tableCode();
    const id = relayPeerId('host');
    const transport = new RelayTransport(`${base}/room/${code}`, 'host', id, id);
    try {
      await transport.connect(15_000);
      netLog(`table ${code} open on the relay`);
      return Object.assign(transport, { code });
    } catch (err) {
      if (!(err instanceof RelayTaken)) throw err; // a code in use: pick another
    }
  }
  throw new NetError('unreachable');
}

async function joinOnRelay(base: string, code: string): Promise<Transport> {
  const transport = new RelayTransport(`${base}/room/${code}`, 'guest', relayPeerId('guest'), '*');
  await transport.connect(15_000);
  return transport;
}

export async function hostOnInternet(): Promise<Transport & { code: string }> {
  resetNetLog();
  netLog('creating a table');
  const relay = relayUrl();
  if (relay) return hostOnRelay(relay);
  // A code already in use on the broker is rare; just pick another.
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = tableCode();
    const peer = await newPeer(PEER_PREFIX + code);
    try {
      const id = await opened(peer, 12_000);
      return Object.assign(new PeerTransport(peer, id, id), { code });
    } catch (err) {
      peer.destroy();
      if (!(err instanceof Error && 'type' in err && err.type === 'unavailable-id')) throw err;
    }
  }
  throw new NetError('unreachable');
}

const JOIN_TIMEOUT_MS = 45_000;

export async function joinOnInternet(code: string): Promise<Transport> {
  resetNetLog();
  netLog(`joining table ${code.trim().toUpperCase()}`);
  const relay = relayUrl();
  if (relay) return joinOnRelay(relay, code.trim().toUpperCase());
  const peer = await newPeer();
  const selfId = await opened(peer, 12_000).catch((err) => {
    peer.destroy();
    throw err;
  });
  const hostId = PEER_PREFIX + code.trim().toUpperCase();
  const transport = new PeerTransport(peer, selfId, hostId);
  const conn = peer.connect(hostId, { reliable: true, serialization: 'json' });
  watchIce(conn, 'to table');
  transport.adopt(conn);
  return new Promise((resolve, reject) => {
    // The broker answers at once when no table has this code; silence means the table exists but the
    // two networks couldn't open a path to each other, even through the relays.
    // Generous: a phone busy loading the 3D table, connecting through a relay, can take a while.
    const timer = setTimeout(() => { netLog('gave up after 45 s'); transport.close(); reject(new NetError('blocked')); }, JOIN_TIMEOUT_MS);
    conn.once('open', () => { clearTimeout(timer); resolve(transport); });
    peer.on('error', (err) => {
      if (err.type !== 'peer-unavailable') return;
      clearTimeout(timer);
      transport.close();
      reject(new NetError('notFound'));
    });
  });
}
