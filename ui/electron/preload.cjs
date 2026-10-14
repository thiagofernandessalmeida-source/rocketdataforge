const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openDirectory: (defaultPath) => ipcRenderer.invoke("dialog:openDirectory", defaultPath),
});
