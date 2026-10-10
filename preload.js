const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', { get: () => ipcRenderer.invoke('get-cfg'), save: f => ipcRenderer.invoke('save-cfg', f) });
