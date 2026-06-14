const { contextBridge, ipcRenderer } = require('electron');

// Minimal, isolated bridge for the splash window: it only ever receives
// status updates from the main process.
contextBridge.exposeInMainWorld('splashAPI', {
  onUpdate: (callback) =>
    ipcRenderer.on('splash-update', (_event, payload) => callback(payload)),
});
