const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dominoPlatform', {
  isDesktop: true,
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  unlockAchievement: (id) => ipcRenderer.send('achievement', id),
});
