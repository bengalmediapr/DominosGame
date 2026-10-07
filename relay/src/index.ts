/**
 * Online relay for Capicú. A table code names a room (one Durable Object). The host and each guest
 * keep a WebSocket to it:
 *
 *   wss://<relay>/room/<CODE>?role=host|guest&id=<peer id>
 *
 * Guests' messages go to the host; the host's go to the guest named in `to` (or to every guest
 * with "*"). Arrivals are tagged with the sender's id, and the room tells the others when someone's
 * socket closes. The room never reads the game itself: the host stays the referee.
 *
 * Someone whose socket drops is only announced as gone if they don't reconnect (same id) within
 * LEAVE_GRACE_MS: phones lose signal and switch apps all the time.
 *
 * Wire format, both ways: JSON. Client → room: {to?, msg}. Room → client: {from, msg} or
 * {sys: 'left', id} / {sys: 'notFound'} / {sys: 'taken'}.
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

interface Tag {
  role: 'host' | 'guest';
  id: string;
  /** Turned away (code taken, or no table): never part of the room. */
  rejected?: boolean;
}

/** Big enough for any game snapshot, small enough to stop abuse. */
const MAX_MESSAGE = 64 * 1024;
/** A phone that loses signal or switches apps for a moment gets this long to come back. */
const LEAVE_GRACE_MS = 20_000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const room = /^\/room\/([A-Z0-9]{4,6})$/.exec(url.pathname)?.[1];
    if (!room) return new Response('capicu relay', { status: url.pathname === '/' ? 200 : 404 });
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket only', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
  },
};

export class Room extends DurableObject<Env> {
  private sockets(role?: 'host' | 'guest'): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((ws) => !(ws.deserializeAttachment() as Tag | null)?.rejected);
  }

  private reject(ws: WebSocket, tag: Tag, sys: 'taken' | 'notFound', code: number): void {
    ws.serializeAttachment({ ...tag, rejected: true } satisfies Tag);
    ws.send(JSON.stringify({ sys }));
    ws.close(code, sys);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = url.searchParams.get('role');
    const id = url.searchParams.get('id') ?? '';
    if ((role !== 'host' && role !== 'guest') || !/^[\w-]{4,64}$/.test(id)) return new Response('bad request', { status: 400 });

    const { 0: client, 1: server } = new WebSocketPair();
    const tag: Tag = { role, id };
    this.ctx.acceptWebSocket(server, [role, `id:${id}`]);
    server.serializeAttachment(tag);

    const others = this.sockets(role).filter((ws) => ws !== server);
    if (role === 'host' && others.some((ws) => (ws.deserializeAttachment() as Tag).id !== id)) {
      this.reject(server, tag, 'taken', 4009); // someone else already hosts this code
    } else if (role === 'host') {
      // The same host coming back (a phone that slept): the newest socket wins.
      for (const old of others) old.close(4000, 'replaced');
    } else if (this.sockets('host').length === 0) {
      this.reject(server, tag, 'notFound', 4004);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    let parsed: { to?: unknown; msg?: unknown };
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed.msg === undefined) return;
    const me = ws.deserializeAttachment() as Tag;
    if (me.rejected) return;
    const out = JSON.stringify({ from: me.id, msg: parsed.msg });
    if (me.role === 'guest') {
      for (const host of this.sockets('host')) host.send(out);
    } else {
      const to = typeof parsed.to === 'string' ? parsed.to : '*';
      for (const guest of to === '*' ? this.sockets('guest') : this.ctx.getWebSockets(`id:${to}`)) {
        const tag = guest.deserializeAttachment() as Tag;
        if (tag.role === 'guest' && !tag.rejected) guest.send(out);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.left(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  private isHere(id: string, except?: WebSocket): boolean {
    return this.ctx.getWebSockets(`id:${id}`).some((ws) => ws !== except && ws.readyState === WebSocket.OPEN
      && !(ws.deserializeAttachment() as Tag).rejected);
  }

  /** Someone's socket closed: announce it later, unless they're back by then. */
  private async left(ws: WebSocket): Promise<void> {
    const me = ws.deserializeAttachment() as Tag | null;
    if (!me || me.rejected || this.isHere(me.id, ws)) return;
    const due = Date.now() + LEAVE_GRACE_MS;
    await this.ctx.storage.put(`leaving:${me.id}`, { ...me, due });
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > due) await this.ctx.storage.setAlarm(due);
  }

  async alarm(): Promise<void> {
    const pending = await this.ctx.storage.list<Tag & { due: number }>({ prefix: 'leaving:' });
    let next: number | null = null;
    for (const [key, who] of pending) {
      if (this.isHere(who.id)) {
        await this.ctx.storage.delete(key); // came back in time
      } else if (who.due <= Date.now()) {
        await this.ctx.storage.delete(key);
        const note = JSON.stringify({ sys: 'left', id: who.id });
        for (const other of who.role === 'host' ? this.sockets('guest') : this.sockets('host')) {
          try {
            other.send(note);
          } catch {
            /* already closing */
          }
        }
      } else {
        next = Math.min(next ?? who.due, who.due);
      }
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}
