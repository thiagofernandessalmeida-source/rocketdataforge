const { contextBridge, ipcRenderer } = require("electron");

// Obtém síncronamente as credenciais do backend (apiBase e token) geradas pelo processo principal
let backendConfig = { apiBase: "http://127.0.0.1:8000/api/v1", token: "" };
try {
  const syncConfig = ipcRenderer.sendSync("cellflow:getBackendConfig");
  if (syncConfig && typeof syncConfig === "object") {
    backendConfig = syncConfig;
  }
} catch (_) {}

contextBridge.exposeInMainWorld("cellflow", {
  apiBase: backendConfig.apiBase,
  token: backendConfig.token,
  getConfig: () => ipcRenderer.invoke("cellflow:getConfig"),
});

contextBridge.exposeInMainWorld("electronAPI", {
  openDirectory: (defaultPath) => ipcRenderer.invoke("dialog:openDirectory", defaultPath),
});

contextBridge.exposeInMainWorld("cellflowLogs", {
  detach: () => ipcRenderer.invoke("logs:detach"),
  focus: () => ipcRenderer.send("logs:focus-window"),
  reattach: () => ipcRenderer.send("logs:reattach"),
  sendSnapshotChunk: (chunk) => ipcRenderer.send("logs:send-snapshot-chunk", chunk),
  broadcastAppend: (items) => ipcRenderer.send("logs:broadcast-append", items),
  broadcastClear: () => ipcRenderer.send("logs:broadcast-clear"),
  onRequestSnapshot: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("logs:main-request-snapshot", handler);
    return () => ipcRenderer.removeListener("logs:main-request-snapshot", handler);
  },
  onFocusNode: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("logs:main-focus-node", handler);
    return () => ipcRenderer.removeListener("logs:main-focus-node", handler);
  },
  onWindowStatusChange: (callback) => {
    const handler = (_event, isOpen) => callback(isOpen);
    ipcRenderer.on("logs:window-status", handler);
    return () => ipcRenderer.removeListener("logs:window-status", handler);
  },
  isWindowOpen: () => ipcRenderer.invoke("logs:is-detached"),
});
