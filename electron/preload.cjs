const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('dominoPlatform', {
  isDesktop: true,
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  unlockAchievement: (id) => ipcRenderer.send('achievement', id),
  steam: {
    info: () => ipcRenderer.invoke('steam:info'),
    takePendingJoin: () => ipcRenderer.invoke('steam:take-pending-join'),
    createLobby: () => ipcRenderer.invoke('steam:create-lobby'),
    joinLobby: (id) => ipcRenderer.invoke('steam:join-lobby', String(id)),
    leaveLobby: () => ipcRenderer.send('steam:leave-lobby'),
    invite: () => ipcRenderer.send('steam:invite'),
    send: (to, data) => ipcRenderer.send('steam:send', String(to), String(data)),
    onMessage: (cb) => listen('steam:message', cb),
    onLeft: (cb) => listen('steam:left', cb),
    onJoinRequested: (cb) => listen('steam:join-requested', cb),
  },
});
