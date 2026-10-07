// Checks a running relay end to end: start it with `npx wrangler dev --port 8787` in relay/, then
// run `node relay/test/relay.test.mjs` (Node 22+). Takes about a minute: it waits out the grace periods.
const B = 'ws://127.0.0.1:8787/room';
const open = (path) => new Promise((res, rej) => { const ws = new WebSocket(`${B}/${path}`); const got = []; ws.onmessage = (e) => got.push(JSON.parse(e.data)); ws.onopen = () => res({ ws, got }); ws.onerror = rej; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, what) => { console.log(cond ? 'PASS' : 'FAIL', what); if (!cond) process.exitCode = 1; };
const h = await open('ABCDE?role=host&id=host-1111');
let g1 = await open('ABCDE?role=guest&id=guest-aaaa');
const g2 = await open('ABCDE?role=guest&id=guest-bbbb');
g1.ws.send(JSON.stringify({ msg: { t: 'hello', name: 'Ana' } }));
await wait(300);
ok(h.got.some((m) => m.from === 'guest-aaaa' && m.msg.name === 'Ana'), 'guest -> host, tagged with sender');
h.ws.send(JSON.stringify({ to: 'guest-aaaa', msg: { t: 'lobby' } }));
h.ws.send(JSON.stringify({ to: '*', msg: { t: 'all' } }));
await wait(300);
ok(g1.got.some((m) => m.msg.t === 'lobby' && m.from === 'host-1111') && !g2.got.some((m) => m.msg.t === 'lobby'), 'host -> one guest only');
ok(g1.got.some((m) => m.msg.t === 'all') && g2.got.some((m) => m.msg.t === 'all'), 'host -> everyone');
const lost = await open('ZZZZZ?role=guest&id=guest-cccc');
await wait(300);
ok(lost.got.some((m) => m.sys === 'notFound'), 'no host: notFound');
const thief = await open('ABCDE?role=host&id=host-9999');
await wait(300);
ok(thief.got.some((m) => m.sys === 'taken'), 'code in use by another host: taken');
// A guest whose signal drops and comes back within the grace period never "left".
g1.ws.close();
await wait(2000);
const g1b = await open('ABCDE?role=guest&id=guest-aaaa');
g2.ws.close();
await wait(1000);
ok(!h.got.some((m) => m.sys === 'left'), 'nobody announced during the grace period');
await wait(21_000);
ok(h.got.some((m) => m.sys === 'left' && m.id === 'guest-bbbb'), 'guest gone for good: host told after the grace');
ok(!h.got.some((m) => m.sys === 'left' && m.id === 'guest-aaaa'), 'guest who came back: never announced');
g1 = g1b;
const h2 = await open('ABCDE?role=host&id=host-1111'); // same host reconnects (phone woke up)
await wait(400);
ok(!g1.got.some((m) => m.sys === 'left'), 'host reconnecting is not "left"');
g1.ws.send(JSON.stringify({ msg: { t: 'intent' } }));
await wait(300);
ok(h2.got.some((m) => m.msg?.t === 'intent'), 'messages reach the reconnected host');
h2.ws.close();
await wait(21_500);
ok(g1.got.some((m) => m.sys === 'left' && m.id === 'host-1111'), 'host leaves: guests told');
process.exit();
