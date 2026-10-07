/**
 * The name server: unique player names and their accumulated points, on Cloudflare Pages Functions
 * with a D1 database bound as `DB` (see docs/NOMBRES_Y_PUNTOS.md). Routes, all JSON:
 *
 *   POST  /api/players      {name}                  claim a name → {token, ...profile}
 *   GET   /api/me                                   your profile (Authorization: Bearer <token>)
 *   PATCH /api/me           {name}                  change your name, keeping your points
 *   POST  /api/results      {matchId, points, won}  add a finished match to your totals (once per matchId)
 *   GET   /api/leaderboard                          top players by points
 *   GET   /api/ice                                  WebRTC relay (TURN) servers for online play
 *
 * A token is the only proof of owning a name; the server keeps just its SHA-256 hash. Results are
 * reported by each player's own game, so the server can only check that they are plausible.
 */
import { cleanName, isReserved, nameKey } from '../src/net/names';

/** The parts of Cloudflare's D1 binding used here. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
}
export interface Env {
  DB?: D1Database;
  /** Cloudflare Realtime TURN key, so players whose networks block direct connections still meet. */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

/** More than any real match can score (a match ends once a team passes 500). */
export const MAX_MATCH_POINTS = 1500;
const LEADERBOARD_SIZE = 20;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    points INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS players_points ON players (points DESC)',
  `CREATE TABLE IF NOT EXISTS results (
    player_id INTEGER NOT NULL,
    match_id TEXT NOT NULL,
    points INTEGER NOT NULL,
    won INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id)
  )`,
];

const schemaReady = new WeakMap<D1Database, Promise<void>>();

/** Tables are created on first use, so a fresh database needs no setup. */
function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = (async () => {
      for (const sql of SCHEMA) await db.prepare(sql).run();
    })();
    ready.catch(() => schemaReady.delete(db));
    schemaReady.set(db, ready);
  }
  return ready;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

const fail = (status: number, error: string): Response => json({ error }, status);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface PlayerRow { id: number; name: string; points: number; wins: number; played: number }

async function profile(db: D1Database, p: PlayerRow) {
  const above = await db.prepare('SELECT COUNT(*) AS n FROM players WHERE points > ?').bind(p.points).first<{ n: number }>();
  return { name: p.name, points: p.points, wins: p.wins, played: p.played, rank: (above?.n ?? 0) + 1 };
}

async function playerFor(db: D1Database, req: Request): Promise<PlayerRow | null> {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  return db.prepare('SELECT id, name, points, wins, played FROM players WHERE token_hash = ?')
    .bind(await sha256(token)).first<PlayerRow>();
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const value = await req.json();
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Why a name can't be taken, or null if it's free. */
async function nameProblem(db: D1Database, raw: unknown, selfId?: number): Promise<{ name: string } | { error: string }> {
  const name = typeof raw === 'string' ? cleanName(raw) : null;
  if (!name) return { error: 'invalid' };
  if (isReserved(name)) return { error: 'reserved' };
  const owner = await db.prepare('SELECT id FROM players WHERE name_key = ?').bind(nameKey(name)).first<{ id: number }>();
  if (owner && owner.id !== selfId) return { error: 'taken' };
  return { name };
}

const isUniqueViolation = (err: unknown): boolean => /UNIQUE/i.test(String(err));

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** How long relay credentials last: a long night of dominoes. */
const ICE_TTL_S = 6 * 3600;

/** Short-lived TURN credentials from Cloudflare Realtime. */
async function iceServers(env: Env): Promise<Response> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return fail(503, 'noRelay');
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: ICE_TTL_S }),
  });
  if (!res.ok) return fail(502, 'relayUnavailable');
  const data = await res.json() as { iceServers?: IceServer | IceServer[] };
  const list = ([] as IceServer[]).concat(data.iceServers ?? []);
  // Browsers refuse TURN on port 53, and trying it only slows the connection down.
  const servers = list
    .map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0);
  return json({ iceServers: servers });
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET' && new URL(req.url).pathname.replace(/\/+$/, '') === '/api/ice') return iceServers(env);
  const db = env.DB;
  if (!db) return fail(503, 'noDatabase');
  await ensureSchema(db);
  const route = `${req.method} ${new URL(req.url).pathname.replace(/\/+$/, '')}`;

  switch (route) {
    case 'POST /api/players': {
      const check = await nameProblem(db, (await body(req)).name);
      if ('error' in check) return fail(check.error === 'taken' ? 409 : 400, check.error);
      const token = newToken();
      try {
        await db.prepare('INSERT INTO players (name, name_key, token_hash, created_at) VALUES (?, ?, ?, ?)')
          .bind(check.name, nameKey(check.name), await sha256(token), Date.now()).run();
      } catch (err) {
        if (isUniqueViolation(err)) return fail(409, 'taken'); // someone claimed it a moment earlier
        throw err;
      }
      const row = await db.prepare('SELECT id, name, points, wins, played FROM players WHERE name_key = ?')
        .bind(nameKey(check.name)).first<PlayerRow>();
      return json({ token, ...(await profile(db, row!)) }, 201);
    }

    case 'GET /api/me': {
      const me = await playerFor(db, req);
      return me ? json(await profile(db, me)) : fail(401, 'unknownPlayer');
    }

    case 'PATCH /api/me': {
      const me = await playerFor(db, req);
      if (!me) return fail(401, 'unknownPlayer');
      const check = await nameProblem(db, (await body(req)).name, me.id);
      if ('error' in check) return fail(check.error === 'taken' ? 409 : 400, check.error);
      try {
        await db.prepare('UPDATE players SET name = ?, name_key = ? WHERE id = ?').bind(check.name, nameKey(check.name), me.id).run();
      } catch (err) {
        if (isUniqueViolation(err)) return fail(409, 'taken');
        throw err;
      }
      return json(await profile(db, { ...me, name: check.name }));
    }

    case 'POST /api/results': {
      const me = await playerFor(db, req);
      if (!me) return fail(401, 'unknownPlayer');
      const { matchId, points, won } = await body(req);
      if (typeof matchId !== 'string' || !/^[\w-]{8,64}$/.test(matchId)
        || !Number.isInteger(points) || (points as number) < 0 || (points as number) > MAX_MATCH_POINTS
        || typeof won !== 'boolean') {
        return fail(400, 'invalid');
      }
      // The same match reported twice (a retry) counts once.
      const added = await db.prepare('INSERT OR IGNORE INTO results (player_id, match_id, points, won, at) VALUES (?, ?, ?, ?, ?)')
        .bind(me.id, matchId, points, won ? 1 : 0, Date.now()).run();
      if (added.meta.changes > 0) {
        await db.prepare('UPDATE players SET points = points + ?, wins = wins + ?, played = played + 1 WHERE id = ?')
          .bind(points, won ? 1 : 0, me.id).run();
      }
      const row = await db.prepare('SELECT id, name, points, wins, played FROM players WHERE id = ?').bind(me.id).first<PlayerRow>();
      return json(await profile(db, row!));
    }

    case 'GET /api/leaderboard': {
      const { results } = await db.prepare(
        'SELECT name, points, wins, played FROM players WHERE played > 0 ORDER BY points DESC, wins DESC, id ASC LIMIT ?',
      ).bind(LEADERBOARD_SIZE).all<Omit<PlayerRow, 'id'>>();
      return json({ players: results });
    }
  }
  return fail(404, 'notFound');
}
