/**
 * The name server: unique player names and their accumulated points, on Cloudflare Pages Functions
 * with a D1 database bound as `DB` (see docs/NOMBRES_Y_PUNTOS.md). Routes, all JSON:
 *
 *   POST  /api/players      {name, pin}             claim a name, with a secret code → {token, ...profile}
 *   POST  /api/login        {name, pin}             sign in to your name on another device → {token, ...profile}
 *   GET   /api/me                                   your profile (Authorization: Bearer <token>)
 *   PATCH /api/me           {name?, pin?}           change your name (keeping your points) or your code
 *   POST  /api/results      {matchId, points, won}  add a finished match to your totals (once per matchId)
 *   GET   /api/leaderboard                          top players by points
 *   GET   /api/ice                                  WebRTC relay (TURN) servers for online play
 *   GET   /api/tables                               open public tables, newest first
 *   POST  /api/tables       {code, host, mode, humans, secret}  list or refresh your public table
 *   POST  /api/tables/close {code, secret}          take it off the list
 *
 * Each device gets its own token; the server keeps only hashes of tokens and codes. Five wrong codes in
 * a row lock the name for 15 minutes. Results are reported by each player's own game, so the server
 * can only check that they are plausible.
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
export const PIN_MIN = 4;
export const PIN_MAX = 32;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;
/** Workers bill CPU time; with the lockout above, this is plenty against guessing. */
const PIN_ITERATIONS = 10_000;

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
  `CREATE TABLE IF NOT EXISTS public_tables (
    code TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    mode TEXT NOT NULL,
    humans INTEGER NOT NULL,
    secret_hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
];

/** Columns added after the first release; adding one that already exists fails harmlessly. */
const ADDED_COLUMNS = [
  'ALTER TABLE players ADD COLUMN pin_hash TEXT',
  'ALTER TABLE players ADD COLUMN pin_salt TEXT',
  'ALTER TABLE players ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE players ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0',
];

const schemaReady = new WeakMap<D1Database, Promise<void>>();

/** Tables are created on first use, so a fresh database needs no setup. */
function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = (async () => {
      for (const sql of SCHEMA) await db.prepare(sql).run();
      for (const sql of ADDED_COLUMNS) {
        try {
          await db.prepare(sql).run();
        } catch (err) {
          if (!/duplicate column/i.test(String(err))) throw err;
        }
      }
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
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pinHash(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PIN_ITERATIONS }, key, 256);
  return hex(new Uint8Array(bits));
}

/** Compares without stopping at the first difference. */
function sameHash(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const validPin = (pin: unknown): pin is string =>
  typeof pin === 'string' && [...pin].length >= PIN_MIN && [...pin].length <= PIN_MAX;

const PLAYER_COLUMNS = 'p.id, p.name, p.points, p.wins, p.played, p.pin_hash IS NOT NULL AS has_pin';

interface PlayerRow { id: number; name: string; points: number; wins: number; played: number; has_pin: number }

async function profile(db: D1Database, p: PlayerRow) {
  const above = await db.prepare('SELECT COUNT(*) AS n FROM players WHERE points > ?').bind(p.points).first<{ n: number }>();
  return { name: p.name, points: p.points, wins: p.wins, played: p.played, rank: (above?.n ?? 0) + 1, hasPin: !!p.has_pin };
}

const playerById = (db: D1Database, id: number): Promise<PlayerRow | null> =>
  db.prepare(`SELECT ${PLAYER_COLUMNS} FROM players p WHERE p.id = ?`).bind(id).first<PlayerRow>();

async function playerFor(db: D1Database, req: Request): Promise<PlayerRow | null> {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const hash = await sha256(token);
  // The device that claimed the name keeps its token in players; devices that signed in later, in tokens.
  return db.prepare(`SELECT ${PLAYER_COLUMNS} FROM players p WHERE p.token_hash = ?
    UNION SELECT ${PLAYER_COLUMNS} FROM tokens t JOIN players p ON p.id = t.player_id WHERE t.token_hash = ?`)
    .bind(hash, hash).first<PlayerRow>();
}

async function setPin(db: D1Database, playerId: number, pin: string): Promise<void> {
  const salt = newToken();
  await db.prepare('UPDATE players SET pin_hash = ?, pin_salt = ?, failed_logins = 0, locked_until = 0 WHERE id = ?')
    .bind(await pinHash(pin, salt), salt, playerId).run();
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
  const request = (path: string) => fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: ICE_TTL_S }),
  });
  let res = await request('generate-ice-servers');
  if (res.status === 404) res = await request('generate'); // the older endpoint, same credentials
  if (!res.ok) return fail(502, 'relayUnavailable');
  const data = await res.json() as { iceServers?: IceServer | IceServer[] };
  const list = ([] as IceServer[]).concat(data.iceServers ?? []);
  // Browsers refuse TURN on port 53, and trying it only slows the connection down.
  const servers = list
    .map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0);
  return json({ iceServers: servers });
}

/** A public table disappears from the list when its host stops refreshing it for this long. */
export const TABLE_STALE_MS = 45_000;
const TABLE_LIST_SIZE = 30;

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET' && new URL(req.url).pathname.replace(/\/+$/, '') === '/api/ice') return iceServers(env);
  const db = env.DB;
  if (!db) return fail(503, 'noDatabase');
  await ensureSchema(db);
  const route = `${req.method} ${new URL(req.url).pathname.replace(/\/+$/, '')}`;

  switch (route) {
    case 'POST /api/players': {
      const input = await body(req);
      const check = await nameProblem(db, input.name);
      if ('error' in check) return fail(check.error === 'taken' ? 409 : 400, check.error);
      if (!validPin(input.pin)) return fail(400, 'invalidPin');
      const token = newToken();
      try {
        await db.prepare('INSERT INTO players (name, name_key, token_hash, created_at) VALUES (?, ?, ?, ?)')
          .bind(check.name, nameKey(check.name), await sha256(token), Date.now()).run();
      } catch (err) {
        if (isUniqueViolation(err)) return fail(409, 'taken'); // someone claimed it a moment earlier
        throw err;
      }
      const { id } = (await db.prepare('SELECT id FROM players WHERE name_key = ?').bind(nameKey(check.name)).first<{ id: number }>())!;
      await setPin(db, id, input.pin);
      return json({ token, ...(await profile(db, (await playerById(db, id))!)) }, 201);
    }

    case 'POST /api/login': {
      const { name, pin } = await body(req);
      if (typeof name !== 'string' || typeof pin !== 'string') return fail(400, 'invalid');
      const row = await db.prepare('SELECT id, pin_hash, pin_salt, failed_logins, locked_until FROM players WHERE name_key = ?')
        .bind(nameKey(cleanName(name) ?? name)).first<{ id: number; pin_hash: string | null; pin_salt: string | null; failed_logins: number; locked_until: number }>();
      if (!row || !row.pin_hash || !row.pin_salt) return fail(404, 'unknownName');
      if (row.locked_until > Date.now()) return fail(429, 'locked');
      if (!sameHash(await pinHash(pin, row.pin_salt), row.pin_hash)) {
        const failed = row.failed_logins + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await db.prepare('UPDATE players SET failed_logins = ?, locked_until = ? WHERE id = ?')
          .bind(lock ? 0 : failed, lock ? Date.now() + LOCK_MS : 0, row.id).run();
        return fail(lock ? 429 : 401, lock ? 'locked' : 'wrongPin');
      }
      const token = newToken();
      await db.prepare('UPDATE players SET failed_logins = 0 WHERE id = ?').bind(row.id).run();
      await db.prepare('INSERT INTO tokens (token_hash, player_id, created_at) VALUES (?, ?, ?)')
        .bind(await sha256(token), row.id, Date.now()).run();
      return json({ token, ...(await profile(db, (await playerById(db, row.id))!)) });
    }

    case 'GET /api/me': {
      const me = await playerFor(db, req);
      return me ? json(await profile(db, me)) : fail(401, 'unknownPlayer');
    }

    case 'PATCH /api/me': {
      const me = await playerFor(db, req);
      if (!me) return fail(401, 'unknownPlayer');
      const input = await body(req);
      if (input.pin !== undefined) {
        if (!validPin(input.pin)) return fail(400, 'invalidPin');
        await setPin(db, me.id, input.pin);
      }
      if (input.name !== undefined) {
        const check = await nameProblem(db, input.name, me.id);
        if ('error' in check) return fail(check.error === 'taken' ? 409 : 400, check.error);
        try {
          await db.prepare('UPDATE players SET name = ?, name_key = ? WHERE id = ?').bind(check.name, nameKey(check.name), me.id).run();
        } catch (err) {
          if (isUniqueViolation(err)) return fail(409, 'taken');
          throw err;
        }
      }
      return json(await profile(db, (await playerById(db, me.id))!));
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
      return json(await profile(db, (await playerById(db, me.id))!));
    }

    case 'GET /api/tables': {
      const now = Date.now();
      await db.prepare('DELETE FROM public_tables WHERE updated_at < ?').bind(now - 10 * TABLE_STALE_MS).run();
      const { results } = await db.prepare(
        'SELECT code, host, mode, humans FROM public_tables WHERE updated_at > ? AND humans < 4 ORDER BY updated_at DESC LIMIT ?',
      ).bind(now - TABLE_STALE_MS, TABLE_LIST_SIZE).all<{ code: string; host: string; mode: string; humans: number }>();
      return json({ tables: results });
    }

    case 'POST /api/tables': {
      const { code, host, mode, humans, secret } = await body(req);
      if (typeof code !== 'string' || !/^[A-Z0-9]{4,6}$/.test(code) || typeof secret !== 'string' || !/^[0-9a-f]{32,64}$/.test(secret)
        || (mode !== 'ruleta' && mode !== 'parejas') || !Number.isInteger(humans) || (humans as number) < 1 || (humans as number) > 4) {
        return fail(400, 'invalid');
      }
      const hostName = [...String(host ?? '').replace(/\s+/g, ' ').trim()].slice(0, 24).join('') || '?';
      const hash = await sha256(secret);
      // Only whoever listed a code can refresh it.
      const listed = await db.prepare(
        `INSERT INTO public_tables (code, host, mode, humans, secret_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (code) DO UPDATE SET host = excluded.host, mode = excluded.mode, humans = excluded.humans,
           updated_at = excluded.updated_at WHERE public_tables.secret_hash = excluded.secret_hash`,
      ).bind(code, hostName, mode, humans, hash, Date.now()).run();
      return listed.meta.changes > 0 ? json({ ok: true }) : fail(409, 'taken');
    }

    case 'POST /api/tables/close': {
      const { code, secret } = await body(req);
      if (typeof code !== 'string' || typeof secret !== 'string') return fail(400, 'invalid');
      await db.prepare('DELETE FROM public_tables WHERE code = ? AND secret_hash = ?').bind(code, await sha256(secret)).run();
      return json({ ok: true });
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
