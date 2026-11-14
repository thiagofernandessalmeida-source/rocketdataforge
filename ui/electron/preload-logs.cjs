const { contextBridge, ipcRenderer } = require("electron");

/**
 * preload-logs.cjs - Preload isolado e seguro para a Janela Nativa de Logs (Fase 3).
 *
 * Segurança:
 * - Não expõe token de API nem credenciais do backend.
 * - Expõe estritamente o namespace window.cellflowLogs com métodos auditados de IPC.
 */

contextBridge.exposeInMainWorld("cellflowLogs", {
  // Solicita snapshot histórico de logs ao app principal
  requestSnapshot: () => ipcRenderer.send("logs:request-snapshot"),

  // Ouve chunks do histórico de logs
  onSnapshotChunk: (callback) => {
    const handler = (_event, chunk) => callback(chunk);
    ipcRenderer.on("logs:snapshot-chunk", handler);
    return () => ipcRenderer.removeListener("logs:snapshot-chunk", handler);
  },

  // Ouve novas entradas em tempo real
  onAppend: (callback) => {
    const handler = (_event, items) => callback(items);
    ipcRenderer.on("logs:append", handler);
    return () => ipcRenderer.removeListener("logs:append", handler);
  },

  // Ouve notificação de limpeza de logs
  onClear: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("logs:clear", handler);
    return () => ipcRenderer.removeListener("logs:clear", handler);
  },

  // Solicita ao processo principal a limpeza de logs
  clearLogs: () => ipcRenderer.send("logs:clear-request"),

  // Dispara foco de nó no canvas do app principal
  focusNode: (nodeId, cellId) => ipcRenderer.send("logs:focus-node", { nodeId, cellId }),

  // Controle de "Manter por cima" (Always on Top)
  setAlwaysOnTop: (flag) => ipcRenderer.invoke("logs:set-always-on-top", flag),
  getAlwaysOnTop: () => ipcRenderer.invoke("logs:get-always-on-top"),

  // Reacopla os logs à barra lateral e fecha a janela nativa
  reattach: () => ipcRenderer.send("logs:reattach"),

  // Notifica que a janela carregou e está pronta para receber dados
  ready: () => ipcRenderer.send("logs:window-ready"),
});
