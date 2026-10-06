import type { Mode } from '../engine/game';
import type { Intent, SeatInfo, Snapshot, TableEvent } from './table';

/** Everything that travels between players. The host is the only one who runs the rules. */
export type NetMessage =
  | { t: 'hello'; name: string; version: number }
  | { t: 'lobby'; seats: SeatInfo[]; mode: Mode; you: number }
  | { t: 'full' }
  | { t: 'snapshot'; snapshot: Snapshot; events: TableEvent[] }
  | { t: 'intent'; intent: Intent }
  | { t: 'bye' }
  | { t: 'ping' };

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

class TabTransport implements Transport {
  private readonly channel: BroadcastChannel;
  private readonly lastSeen = new Map<string, number>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private messageCbs: ((from: string, msg: NetMessage) => void)[] = [];
  private leftCbs: ((peer: string) => void)[] = [];

  constructor(readonly code: string, readonly selfId: string, readonly hostId: string) {
    this.channel = new BroadcastChannel(`domino-boricua:${code}`);
    this.channel.onmessage = (e: MessageEvent<Envelope>) => {
      const { from, to, msg } = e.data;
      if (to !== this.selfId && to !== '*') return;
      this.lastSeen.set(from, Date.now());
      if (msg.t === 'ping') return;
      if (msg.t === 'bye') return this.dropPeer(from);
      for (const cb of this.messageCbs) cb(from, msg);
    };
    // Tabs can close without saying goodbye: ping, and drop peers that go quiet.
    this.heartbeat = setInterval(() => {
      this.post('*', { t: 'ping' });
      const now = Date.now();
      for (const [peer, seen] of this.lastSeen) if (now - seen > 6000) this.dropPeer(peer);
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
