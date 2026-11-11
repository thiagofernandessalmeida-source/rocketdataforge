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
