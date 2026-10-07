import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, Mode, legalMoves } from '../engine/game';
import { GUEST_TIMEOUT_MS, GuestSession, HostSession, TableConfig } from './session';
import { NetMessage, Transport } from './transport';

/** An in-memory network: every transport sees messages addressed to it, delivered asynchronously. */
class Hub {
  private nodes = new Map<string, MemoryTransport>();
  add(t: MemoryTransport) { this.nodes.set(t.selfId, t); }
  deliver(from: string, to: string, msg: NetMessage) {
    const copy = JSON.parse(JSON.stringify(msg)) as NetMessage; // like the wire: no shared objects
    setTimeout(() => this.nodes.get(to)?.receive(from, copy), 1);
  }
  disconnect(id: string) {
    this.nodes.delete(id);
    for (const n of this.nodes.values()) n.peerLeft(id);
  }
}

class MemoryTransport implements Transport {
  private msgCbs: ((from: string, msg: NetMessage) => void)[] = [];
  private leftCbs: ((peer: string) => void)[] = [];
  constructor(private hub: Hub, readonly selfId: string, readonly hostId: string) { hub.add(this); }
  send(to: string, msg: NetMessage) { this.hub.deliver(this.selfId, to, msg); }
  receive(from: string, msg: NetMessage) { this.msgCbs.forEach((cb) => cb(from, msg)); }
  peerLeft(peer: string) { this.leftCbs.forEach((cb) => cb(peer)); }
  onMessage(cb: (from: string, msg: NetMessage) => void) { this.msgCbs.push(cb); return () => {}; }
  onPeerLeft(cb: (peer: string) => void) { this.leftCbs.push(cb); return () => {}; }
  close() {}
}

const config: TableConfig = { rules: (mode: Mode) => ({ ...DEFAULT_RULES, mode }), difficulty: 'normal', aiDelayMs: 20 };

function setup() {
  const hub = new Hub();
  const host = new HostSession(config, new MemoryTransport(hub, 'H', 'H'), 'Ana');
  const g1 = new GuestSession(new MemoryTransport(hub, 'G1', 'H'), 'Beto');
  const g2 = new GuestSession(new MemoryTransport(hub, 'G2', 'H'), 'Carla');
  vi.advanceTimersByTime(20);
  return { hub, host, g1, g2 };
}

describe('online sessions', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('seats friends (partner seat first) and shows everyone the same lobby', () => {
    const { host, g1, g2 } = setup();
    expect(host.lobby()!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'human', 'ai']);
    expect(g1.lobby()!.me).toBe(2);
    expect(g2.lobby()!.me).toBe(1);
    expect(g2.lobby()!.seats[2].name).toBe('Beto');
  });

  it('each player sees themselves at the bottom with only their own tiles', () => {
    const { host, g1 } = setup();
    host.start();
    vi.advanceTimersByTime(20);
    const v = g1.view()!;
    expect(v.me).toBe(2);
    expect(v.match.hand.hands[0].every(([a]) => a >= 0)).toBe(true);
    for (const p of [1, 2, 3]) expect(v.match.hand.hands[p].every(([a]) => a === -1)).toBe(true);
    // g1 sits across from the host: in g1's view the host is at seat 2, named Ana.
    expect(v.seats[2].name).toBe('Ana');
  });

  it('plays a whole ruleta match over the network with intents from every human', () => {
    const { host, g1, g2 } = setup();
    host.setMode('ruleta');
    host.start();
    const players = [host, g1, g2];
    for (let i = 0; i < 40_000; i++) {
      vi.advanceTimersByTime(25);
      const hv = host.view()!;
      if (hv.phase.name === 'matchOver') break;
      for (const s of players) {
        const v = s.view();
        if (!v) continue;
        const h = v.match.hand;
        if (v.phase.name === 'playing' && h.current === 0 && !h.result) {
          const moves = legalMoves(h);
          if (moves.length) s.send({ kind: 'move', move: moves[0] });
        } else if (v.phase.name === 'roulette' && v.phase.awaitingTrigger && v.phase.shooter === 0) {
          s.send({ kind: 'trigger' });
        } else if (v.phase.name === 'handOver' && v.isController) {
          s.send({ kind: 'continue' });
        }
      }
    }
    const final = host.view()!;
    expect(final.phase.name).toBe('matchOver');
    // Guests end up with the same match (rotated to their seat).
    expect(g1.view()!.match.handNumber).toBe(final.match.handNumber);
    expect(g1.view()!.match.alive).toEqual([final.match.alive[2], final.match.alive[3], final.match.alive[0], final.match.alive[1]]);
  });

  it('hands a disconnected friend’s seat to the AI', () => {
    const { hub, host } = setup();
    host.start();
    vi.advanceTimersByTime(20);
    hub.disconnect('G1');
    expect(host.view()!.seats[2].kind).toBe('ai');
  });

  it('turns away a fifth player', () => {
    const { hub } = setup();
    const g3 = new GuestSession(new MemoryTransport(hub, 'G3', 'H'), 'Dani');
    const g4 = new GuestSession(new MemoryTransport(hub, 'G4', 'H'), 'Eva');
    vi.advanceTimersByTime(20);
    expect(g3.lobby()!.me).toBe(3);
    expect(g4.ended).toBe('full');
  });
});

describe('joining a table that does not answer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gives up after a few seconds instead of connecting forever', () => {
    const hub = new Hub();
    const lost = new GuestSession(new MemoryTransport(hub, 'G1', 'NOBODY'), 'Beto');
    vi.advanceTimersByTime(GUEST_TIMEOUT_MS - 100);
    expect(lost.ended).toBeNull();
    vi.advanceTimersByTime(200);
    expect(lost.ended).toBe('noAnswer');
  });

  it('keeps names unique at the table', () => {
    const hub = new Hub();
    const host = new HostSession(config, new MemoryTransport(hub, 'H', 'H'), 'Tito');
    new GuestSession(new MemoryTransport(hub, 'G1', 'H'), 'tito');
    new GuestSession(new MemoryTransport(hub, 'G2', 'H'), 'Tito');
    vi.advanceTimersByTime(20);
    expect(host.lobby()!.seats.map((s) => s.name)).toEqual(['Tito', 'Tito 3', 'tito 2', null]);
  });

  it('relays chat to everyone, cleaned up and with the speaker\'s seat and name', () => {
    const { host, g1, g2 } = setup();
    const heard: string[] = [];
    for (const [who, session] of [['host', host], ['g1', g1], ['g2', g2]] as const) {
      session.onChat((l) => heard.push(`${who}<${l.seat}:${l.name}> ${l.text}`));
    }
    g1.chat('  ¡Wepa!\n  dale  ');
    vi.advanceTimersByTime(20);
    expect(heard.sort()).toEqual(['g1<2:Beto> ¡Wepa! dale', 'g2<2:Beto> ¡Wepa! dale', 'host<2:Beto> ¡Wepa! dale']);
  });

  it('stops a player who floods the chat', () => {
    const { host, g1 } = setup();
    let count = 0;
    host.onChat(() => count++);
    for (let i = 0; i < 12; i++) g1.chat(`hola ${i}`);
    vi.advanceTimersByTime(20);
    expect(count).toBe(5);
    vi.advanceTimersByTime(10_000);
    g1.chat('ya');
    vi.advanceTimersByTime(20);
    expect(count).toBe(6);
  });

  it('lets the host move players to other chairs, including their own', () => {
    const { host, g1, g2 } = setup();
    host.swapSeats(0, 3); // the host moves to chair 3
    vi.advanceTimersByTime(20);
    expect(host.lobby()!.me).toBe(3);
    host.swapSeats(1, 2); // Carla and Beto trade chairs
    vi.advanceTimersByTime(20);
    expect(host.lobby()!.seats.map((s) => s.name)).toEqual([null, 'Beto', 'Carla', 'Ana']);
    expect(g1.lobby()!.me).toBe(1);
    expect(g2.lobby()!.me).toBe(2);
    host.start();
    vi.advanceTimersByTime(20);
    expect(host.view()!.me).toBe(3);
    expect(host.view()!.isController).toBe(true);
    expect(g1.view()!.isController).toBe(false);
    host.swapSeats(0, 1); // not once the match has started
    expect(host.view()!.seats.map((s) => s.name)).toEqual(['Ana', null, 'Beto', 'Carla']); // rotated: you first
  });
});
