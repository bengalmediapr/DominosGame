// Desktop shell for Dominó Boricua (Windows / macOS / Linux, incl. Steam Deck).
const { app, BrowserWindow, ipcMain, Menu, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};

// Serve the game from app://game/ instead of file:// so fetch() can load the 3D models.
const DIST = path.join(__dirname, '..', 'dist');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * Steam: active only when steamworks.js is installed AND an App ID is available
 * (STEAM_APP_ID env var, or a steam_appid.txt next to the executable / project root).
 * Without Steam the game runs normally, so the same build works for itch.io, GOG, etc.
 */
function readAppId() {
  if (process.env.STEAM_APP_ID) return Number(process.env.STEAM_APP_ID);
  const candidates = [
    path.join(path.dirname(app.getPath('exe')), 'steam_appid.txt'),
    path.join(__dirname, '..', 'steam_appid.txt'),
  ];
  for (const file of candidates) {
    try { return Number(fs.readFileSync(file, 'utf8').trim()); } catch { /* not found */ }
  }
  return null;
}

// The product name ("Dominó") ends up in the User-Agent; HTTP headers must be ASCII.
app.userAgentFallback = app.userAgentFallback.normalize('NFD').replace(/[^\x20-\x7e]/g, '');

// Many older or laptop GPUs are on Chromium's blocklist; the 3D table still runs fine on them.
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let steam = null;
let steamworks = null;
// Must run before the app is ready: the Steam overlay needs extra Chromium switches.
(function initSteam() {
  const appId = readAppId();
  if (!appId) return;
  try {
    steamworks = require('steamworks.js');
    steam = steamworks.init(appId);
    steamworks.electronEnableSteamOverlay();
    console.log(`[steam] initialised for app ${appId} as ${steam.localplayer.getName()}`);
  } catch (err) {
    console.warn('[steam] not available:', err.message);
    steam = null;
  }
})();

// ---------- online play over Steam: friends-only lobbies + P2P messages ----------

const CB = { LobbyChatUpdate: 5, P2PSessionRequest: 6, GameLobbyJoinRequested: 8 }; // steamworks.js SteamCallback
const MEMBER_ENTERED = 0;
const RELIABLE = 2;
let lobby = null;
let pendingJoin = null;

// Launched by accepting an invite while the game was closed: "+connect_lobby <id>".
const connectArg = process.argv.indexOf('+connect_lobby');
if (connectArg >= 0 && process.argv[connectArg + 1]) pendingJoin = process.argv[connectArg + 1];

const selfId = () => steam.localplayer.getSteamId().steamId64.toString();
const toRenderer = (channel, ...args) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args);
};
const lobbyMembers = () => (lobby ? lobby.getMembers().map((m) => m.steamId64.toString()) : []);

function setupSteamNetworking() {
  if (!steam) return;
  steam.callback.register(CB.P2PSessionRequest, ({ remote }) => {
    // Only talk to people in our lobby.
    if (lobbyMembers().includes(remote.toString())) steam.networking.acceptP2PSession(remote);
  });
  steam.callback.register(CB.LobbyChatUpdate, (e) => {
    if (!lobby || e.lobby !== lobby.id) return;
    if (e.member_state_change !== MEMBER_ENTERED) toRenderer('steam:left', e.user_changed.toString());
  });
  steam.callback.register(CB.GameLobbyJoinRequested, (e) => toRenderer('steam:join-requested', e.lobby_steam_id.toString()));
  setInterval(() => {
    for (let size = steam.networking.isP2PPacketAvailable(); size > 0; size = steam.networking.isP2PPacketAvailable()) {
      const packet = steam.networking.readP2PPacket(size);
      toRenderer('steam:message', packet.steamId.steamId64.toString(), packet.data.toString('utf8'));
    }
  }, 16);
}

ipcMain.handle('steam:info', () => (steam ? { available: true, selfId: selfId(), name: steam.localplayer.getName() } : { available: false }));
ipcMain.handle('steam:take-pending-join', () => {
  const id = pendingJoin;
  pendingJoin = null;
  return id;
});
ipcMain.handle('steam:create-lobby', async () => {
  lobby?.leave();
  lobby = await steam.matchmaking.createLobby(1 /* FriendsOnly */, 4);
  lobby.setData('game', 'domino-boricua');
  return { lobbyId: lobby.id.toString(), selfId: selfId() };
});
ipcMain.handle('steam:join-lobby', async (_e, id) => {
  lobby?.leave();
  lobby = await steam.matchmaking.joinLobby(BigInt(id));
  return { lobbyId: lobby.id.toString(), selfId: selfId(), hostId: lobby.getOwner().steamId64.toString() };
});
ipcMain.on('steam:leave-lobby', () => {
  lobby?.leave();
  lobby = null;
});
ipcMain.on('steam:invite', () => {
  if (lobby) steam.overlay.activateInviteDialog(lobby.id);
});
ipcMain.on('steam:send', (_e, to, data) => {
  if (steam && typeof data === 'string' && data.length < 1_000_000) {
    steam.networking.sendP2PPacket(BigInt(to), RELIABLE, Buffer.from(data, 'utf8'));
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#241018',
    title: 'Dominó Boricua',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://game/index.html');
  // Steam Deck / Big Picture launch in fullscreen.
  if (process.env.SteamDeck === '1' || process.argv.includes('--fullscreen')) win.setFullScreen(true);
  return win;
}

ipcMain.on('quit', () => app.quit());
ipcMain.on('toggle-fullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});
ipcMain.on('achievement', (_e, id) => {
  if (!steam || typeof id !== 'string') return;
  try {
    if (!steam.achievement.isActivated(id)) steam.achievement.activate(id);
  } catch (err) {
    console.warn('[steam] achievement failed', id, err.message);
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new Response(fs.readFileSync(file), { headers: { 'content-type': type } });
  });
  Menu.setApplicationMenu(null);
  setupSteamNetworking();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
