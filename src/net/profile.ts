/**
 * Your player name and points, kept by the name server (server/api.ts). The name and its secret
 * token are remembered on this computer; finished matches are queued here until the server has them.
 */
import type { MatchState } from '../engine/game';
import { API_BASE } from './api';

export interface Profile {
  name: string;
  points: number;
  wins: number;
  played: number;
  rank: number;
  /** Older names may have no code yet: they can't be signed in to from another device until they get one. */
  hasPin: boolean;
}

export interface LeaderRow {
  name: string;
  points: number;
  wins: number;
  played: number;
}

export type ProfileError =
  | 'taken' | 'invalid' | 'reserved' | 'offline' | 'noServer' | 'unknownPlayer'
  | 'invalidPin' | 'wrongPin' | 'locked' | 'unknownName';

const KNOWN_ERRORS: ProfileError[] = ['taken', 'invalid', 'reserved', 'unknownPlayer', 'invalidPin', 'wrongPin', 'locked', 'unknownName'];

export class ProfileFailure extends Error {
  constructor(readonly reason: ProfileError) {
    super(reason);
  }
}


const KEY = 'capicu.profile.v1';
const PENDING_KEY = 'capicu.pendingResults.v1';

interface Stored {
  token: string;
  profile: Profile;
}

interface MatchResult {
  matchId: string;
  points: number;
  won: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ProfileFailure('offline');
  }
  const data = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (res.ok && data) return data;
  const error = data?.error;
  if (KNOWN_ERRORS.includes(error as ProfileError)) throw new ProfileFailure(error as ProfileError);
  // No JSON answer: a host with no name server (local development, or the database isn't bound yet).
  throw new ProfileFailure(res.status === 503 || !data ? 'noServer' : 'offline');
}

/** Your name and last known points, without asking the server. */
export const savedProfile = (): Profile | null => read<Stored>(KEY)?.profile ?? null;

const token = (): string | null => read<Stored>(KEY)?.token ?? null;

function remember(tok: string, profile: Profile): Profile {
  write(KEY, { token: tok, profile } satisfies Stored);
  return profile;
}

/** Take a new name, protected by a secret code. */
export async function createName(name: string, pin: string): Promise<Profile> {
  const { token: fresh, ...profile } = await call<Profile & { token: string }>('POST', '/players', { name, pin });
  return remember(fresh, profile);
}

/** Use your name on this device too: your points come with it. */
export async function signIn(name: string, pin: string): Promise<Profile> {
  const { token: fresh, ...profile } = await call<Profile & { token: string }>('POST', '/login', { name, pin });
  write(PENDING_KEY, null); // results queued here belonged to whoever was signed in before
  return remember(fresh, profile);
}

/** Change your name (your points stay with you) and/or your code. */
export async function updateProfile(change: { name?: string; pin?: string }): Promise<Profile> {
  const tok = token();
  if (!tok) throw new ProfileFailure('unknownPlayer');
  return remember(tok, await call<Profile>('PATCH', '/me', change, tok));
}

/** Forget your name on this device; your code brings it back. */
export function signOut(): void {
  write(KEY, null);
  write(PENDING_KEY, null);
}

/** Fresh points and rank from the server, sending any results it hasn't got yet first. */
export async function refreshProfile(): Promise<Profile | null> {
  const tok = token();
  if (!tok) return null;
  await flushResults();
  try {
    return remember(tok, await call<Profile>('GET', '/me', undefined, tok));
  } catch (err) {
    if (err instanceof ProfileFailure && err.reason === 'unknownPlayer') write(KEY, null);
    throw err;
  }
}

export const leaderboard = (): Promise<LeaderRow[]> =>
  call<{ players: LeaderRow[] }>('GET', '/leaderboard').then((r) => r.players);

/** Count a finished match. It is queued first, so a lost connection only delays it. */
export async function reportResult(result: MatchResult): Promise<void> {
  if (!token()) return;
  write(PENDING_KEY, [...(read<MatchResult[]>(PENDING_KEY) ?? []), result].slice(-50));
  await flushResults();
}

async function flushResults(): Promise<void> {
  const tok = token();
  let next: MatchResult | undefined;
  while (tok && (next = read<MatchResult[]>(PENDING_KEY)?.[0])) {
    const sent = next;
    try {
      remember(tok, await call<Profile>('POST', '/results', sent, tok));
    } catch (err) {
      // A result the server refuses would block the queue forever; anything else is retried later.
      if (!(err instanceof ProfileFailure && err.reason === 'invalid')) return;
    }
    // Re-read: another result may have been queued while this one was in flight.
    write(PENDING_KEY, (read<MatchResult[]>(PENDING_KEY) ?? []).filter((r) => r.matchId !== sent.matchId));
  }
}

export function newMatchId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Most a match can add (the server refuses more). */
const MAX_MATCH_POINTS = 1500;

/**
 * What a match (as you see it: you at seat 0) adds to your totals. Partners: your team's score.
 * Ruleta: for each hand you won, the pips left in everyone else's hands.
 */
export function matchPoints(m: MatchState): { points: number; won: boolean } {
  if (m.rules.mode === 'parejas') {
    return { points: Math.min(m.scores[0], MAX_MATCH_POINTS), won: m.winnerTeam === 0 };
  }
  const points = m.history
    .filter((r) => r.winnerPlayer === 0)
    .reduce((sum, r) => sum + r.pipCounts.reduce((s, c, p) => (p === 0 ? s : s + c), 0), 0);
  return { points: Math.min(points, MAX_MATCH_POINTS), won: m.winnerPlayer === 0 };
}
