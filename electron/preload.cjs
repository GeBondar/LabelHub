const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  selectImageFile: () => ipcRenderer.invoke('select-image-file'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectSaveLocation: (defaultName) => ipcRenderer.invoke('select-save-location', defaultName),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  platform: () => ipcRenderer.invoke('get-platform'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onBackendError: (callback) => {
    ipcRenderer.on('backend-error', (_event, message) => callback(message));
  },
  removeBackendErrorListener: () => {
    ipcRenderer.removeAllListeners('backend-error');
  },
});
