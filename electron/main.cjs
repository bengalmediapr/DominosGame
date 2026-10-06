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
function initSteam() {
  const appId = readAppId();
  if (!appId) return;
  try {
    const steamworks = require('steamworks.js');
    steam = steamworks.init(appId);
    steamworks.electronEnableSteamOverlay();
    console.log(`[steam] initialised for app ${appId} as ${steam.localplayer.getName()}`);
  } catch (err) {
    console.warn('[steam] not available:', err.message);
    steam = null;
  }
}

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
  initSteam();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
