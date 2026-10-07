# Capicú relay

The online tables' message relay: a Cloudflare Worker with one Durable Object per table code.
Every player keeps a WebSocket to `wss://<worker>/room/<CODE>`; the room passes messages between
the host (who runs the rules) and the guests. This works on any network, phones included, unlike
direct browser-to-browser (WebRTC) connections.

## Publish it (once)

Cloudflare dashboard → **Workers & Pages → Create → Workers → Import a repository** →
`bengalmediapr/DominosGame` → project name `capicu-relay` → **Advanced settings → Root directory:
`relay`** → Deploy. After that, every push to `main` that changes `relay/` redeploys it.

Each push to `main` that touches `relay/` redeploys it (Workers Builds, root directory `relay`).

The game finds it through `DEFAULT_RELAY` in `src/net/api.ts` (its `wss://…workers.dev` address).

## Try it locally

```
cd relay && npx wrangler dev --port 8787
node relay/test/relay.test.mjs
```

In the game, `localStorage.setItem('capicu.relay', 'ws://127.0.0.1:8787')` makes online play use it.
