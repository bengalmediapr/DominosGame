import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { D1Database, handle } from './api';
import { fakeD1 } from './fakeD1';

let env: { DB: D1Database };
const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await handle(new Request(`https://capicu.test${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }), env);
  return { status: res.status, body: await res.json() as Record<string, any> };
};

describe('name server', () => {
  beforeEach(() => { env = { DB: fakeD1() }; });

  it('gives each name to one player only, ignoring accents, capitals and separators', async () => {
    const first = await call('POST', '/api/players', { name: ' José_PR ', pin: '1234' });
    expect(first.status).toBe(201);
    expect(first.body.name).toBe('José_PR');
    expect(first.body.token).toMatch(/^[0-9a-f]{64}$/);
    for (const name of ['jose pr', 'JOSE-PR', 'José_PR']) {
      expect((await call('POST', '/api/players', { name, pin: '1234' })).body.error).toBe('taken');
    }
    expect((await call('POST', '/api/players', { name: 'Doña Lola', pin: '1234' })).body.error).toBe('reserved');
    expect((await call('POST', '/api/players', { name: 'a', pin: '1234' })).body.error).toBe('invalid');
    expect((await call('POST', '/api/players', { name: '<script>', pin: '1234' })).body.error).toBe('invalid');
  });

  it('adds up points and wins, counting each match once', async () => {
    const { token } = (await call('POST', '/api/players', { name: 'Wichi', pin: '1234' })).body;
    await call('POST', '/api/results', { matchId: 'match-0001', points: 320, won: false }, token);
    await call('POST', '/api/results', { matchId: 'match-0002', points: 515, won: true }, token);
    const retry = await call('POST', '/api/results', { matchId: 'match-0002', points: 515, won: true }, token);
    expect(retry.body).toMatchObject({ name: 'Wichi', points: 835, wins: 1, played: 2, rank: 1 });
    expect((await call('POST', '/api/results', { matchId: 'match-0003', points: 99999, won: true }, token)).status).toBe(400);
    expect((await call('POST', '/api/results', { matchId: 'match-0004', points: 10, won: true })).status).toBe(401);
  });

  it('keeps your points when you change your name, and frees the old one', async () => {
    const { token } = (await call('POST', '/api/players', { name: 'Tito', pin: '1234' })).body;
    await call('POST', '/api/results', { matchId: 'match-0001', points: 100, won: true }, token);
    await call('POST', '/api/players', { name: 'Nena', pin: '1234' });
    expect((await call('PATCH', '/api/me', { name: 'nena' }, token)).body.error).toBe('taken');
    expect((await call('PATCH', '/api/me', { name: 'Tito Boricua' }, token)).body).toMatchObject({ name: 'Tito Boricua', points: 100 });
    expect((await call('POST', '/api/players', { name: 'Tito', pin: '1234' })).status).toBe(201);
    expect((await call('GET', '/api/me', undefined, token)).body.name).toBe('Tito Boricua');
  });

  it('ranks the leaderboard by points', async () => {
    for (const [name, points] of [['Uno', 50], ['Dos', 900], ['Tres', 300]] as const) {
      const { token } = (await call('POST', '/api/players', { name, pin: '1234' })).body;
      await call('POST', '/api/results', { matchId: `m-${name}-0001`, points, won: points > 100 }, token);
    }
    await call('POST', '/api/players', { name: 'Nuevo', pin: '1234' }); // no matches yet: not listed
    const board = await call('GET', '/api/leaderboard');
    expect(board.body.players.map((p: { name: string }) => p.name)).toEqual(['Dos', 'Tres', 'Uno']);
  });

  it('signs in on another device with the name and its code, and locks out guessing', async () => {
    const first = await call('POST', '/api/players', { name: 'Cuqui', pin: 'coqui-77' });
    expect(first.body.hasPin).toBe(true);
    await call('POST', '/api/results', { matchId: 'match-0001', points: 250, won: true }, first.body.token);
    expect((await call('POST', '/api/players', { name: 'Otro', pin: '12' })).body.error).toBe('invalidPin');

    const phone = await call('POST', '/api/login', { name: 'cuqui', pin: 'coqui-77' });
    expect(phone.status).toBe(200);
    expect(phone.body).toMatchObject({ name: 'Cuqui', points: 250 });
    expect(phone.body.token).not.toBe(first.body.token);
    // Both devices stay signed in and add to the same totals.
    await call('POST', '/api/results', { matchId: 'match-0002', points: 100, won: false }, phone.body.token);
    expect((await call('GET', '/api/me', undefined, first.body.token)).body.points).toBe(350);

    expect((await call('POST', '/api/login', { name: 'Nadie', pin: '1234' })).body.error).toBe('unknownName');
    for (let i = 0; i < 4; i++) expect((await call('POST', '/api/login', { name: 'Cuqui', pin: 'wrong' })).body.error).toBe('wrongPin');
    expect((await call('POST', '/api/login', { name: 'Cuqui', pin: 'wrong' })).body.error).toBe('locked');
    expect((await call('POST', '/api/login', { name: 'Cuqui', pin: 'coqui-77' })).body.error).toBe('locked'); // even the right code, for now
  });

  it('changes the code: the old one stops working', async () => {
    const { token } = (await call('POST', '/api/players', { name: 'Pepo', pin: '1111' })).body;
    expect((await call('PATCH', '/api/me', { pin: '2222' }, token)).status).toBe(200);
    expect((await call('POST', '/api/login', { name: 'Pepo', pin: '1111' })).body.error).toBe('wrongPin');
    expect((await call('POST', '/api/login', { name: 'Pepo', pin: '2222' })).status).toBe(200);
  });

  it('lists public tables while their host keeps them fresh, and only the host can change them', async () => {
    const secret = 'a'.repeat(32);
    expect((await call('POST', '/api/tables', { code: 'ABCDE', host: 'Tito', mode: 'parejas', humans: 1, secret })).status).toBe(200);
    await call('POST', '/api/tables', { code: 'FGHJK', host: 'Nena', mode: 'ruleta', humans: 4, secret: 'b'.repeat(32) }); // full: hidden
    expect((await call('GET', '/api/tables')).body.tables).toEqual([{ code: 'ABCDE', host: 'Tito', mode: 'parejas', humans: 1 }]);
    // Someone else can't take over the code, or close it.
    expect((await call('POST', '/api/tables', { code: 'ABCDE', host: 'Pillo', mode: 'ruleta', humans: 1, secret: 'c'.repeat(32) })).status).toBe(409);
    await call('POST', '/api/tables/close', { code: 'ABCDE', secret: 'c'.repeat(32) });
    expect((await call('GET', '/api/tables')).body.tables).toHaveLength(1);
    await call('POST', '/api/tables', { code: 'ABCDE', host: 'Tito', mode: 'parejas', humans: 2, secret });
    expect((await call('GET', '/api/tables')).body.tables[0].humans).toBe(2);
    await call('POST', '/api/tables/close', { code: 'ABCDE', secret });
    expect((await call('GET', '/api/tables')).body.tables).toEqual([]);
  });

  it('drops tables whose host stopped refreshing them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await call('POST', '/api/tables', { code: 'ABCDE', host: 'Tito', mode: 'parejas', humans: 1, secret: 'a'.repeat(32) });
      vi.setSystemTime(Date.now() + 60_000);
      expect((await call('GET', '/api/tables')).body.tables).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when no database is bound', async () => {
    const res = await handle(new Request('https://capicu.test/api/leaderboard'), {});
    expect(res.status).toBe(503);
  });
});

describe('relay servers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('hands out Cloudflare TURN credentials without the port-53 addresses browsers refuse', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'u', credential: 'c' },
    ] })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await handle(new Request('https://capicu.test/api/ice'), { TURN_KEY_ID: 'key', TURN_KEY_API_TOKEN: 'secret' });
    expect(res.status).toBe(200);
    expect((await res.json()).iceServers).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers');
  });

  it('says so when no relay is configured', async () => {
    expect((await handle(new Request('https://capicu.test/api/ice'), {})).status).toBe(503);
  });
});
