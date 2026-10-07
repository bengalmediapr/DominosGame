/** Where the game's server routes live (server/api.ts). The desktop app has none of its own: it uses the web version's. */
/**
 * Our online relay (relay/, a Cloudflare Worker). Every player keeps a WebSocket to it and it passes
 * the game's messages along, which works on any network (phones included). Empty would mean no relay,
 * so online play falls back to direct browser-to-browser connections. Tests can point it elsewhere
 * with localStorage "capicu.relay".
 */
const DEFAULT_RELAY = 'wss://capicu-relay.bengalmediapr.workers.dev';

export function relayUrl(): string {
  try {
    return localStorage.getItem('capicu.relay') ?? DEFAULT_RELAY;
  } catch {
    return DEFAULT_RELAY;
  }
}

export const API_BASE = typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
  ? '/api' : 'https://dominosgame.pages.dev/api';
