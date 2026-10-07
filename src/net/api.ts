/** Where the game's server routes live (server/api.ts). The desktop app has none of its own: it uses the web version's. */
export const API_BASE = typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
  ? '/api' : 'https://dominosgame.pages.dev/api';
