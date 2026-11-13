/**
 * executionLogStore - Store unificado e desacoplado para a Janela Geral de Logs (Tarefa 5).
 *
 * Características:
 * 1. Buffer circular com limite estrito de 10.000 entradas (descarta as mais antigas ao exceder).
 * 2. Congelamento estático de metadados: registra o nome da célula e do componente no momento
 *    da execução (snapshot imutável), evitando que renomeações posteriores alterem o histórico.
 * 3. Mascaramento rigoroso de segredos (isSecret) em todas as mensagens.
 * 4. Arquitetura pronta para janela Electron desacoplada via BroadcastChannel ("cellflow-logs").
 */

export interface ExecutionLogItem {
  id: string;
  seq: number;
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  executionId: string;
  jobId?: string;
  jobName?: string;
  cellId?: string;
  cellName?: string;
  cellOrder?: number;
  nodeId?: string;
  nodeLabel?: string;
  nodeType?: string;
  message: string;
}

export interface NodeMetaSnapshot {
  cellId?: string;
  cellName?: string;
  cellOrder?: number;
  nodeLabel?: string;
  nodeType?: string;
}

export interface LogFilterOptions {
  level?: string;
  cellId?: string;
  nodeId?: string;
  search?: string;
}

const MAX_LOG_BUFFER_SIZE = 10000;
let logItems: ExecutionLogItem[] = [];
let nextLogId = 1;
const listeners = new Set<() => void>();

// Canal broadcast para comunicação transparente com janelas externas (Electron / Multi-Window)
let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    broadcastChannel = new BroadcastChannel("cellflow-logs");
  }
} catch (_) {
  // Ambientes sem suporte a BroadcastChannel ignoram silenciosamente
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("[executionLogStore] Erro no listener:", err);
    }
  }
}

export const executionLogStore = {
  /**
   * Adiciona uma ou mais entradas de log com congelamento estático de metadados.
   */
  addLogs(
    entries: Array<{
      seq?: number;
      timestamp?: string;
      level?: string;
      execution_id?: string;
      node_id?: string;
      cell_id?: string;
      message: string;
    }>,
    nodeSnapshot: Record<string, NodeMetaSnapshot> = {},
    jobInfo?: { jobId?: string; jobName?: string },
    secretValues: string[] = []
  ): void {
    if (!entries || entries.length === 0) return;

    const newItems: ExecutionLogItem[] = [];

    for (const e of entries) {
      let msg = e.message || "";
      // Mascaramento de segredos com ***
      if (secretValues && secretValues.length > 0) {
        for (const sec of secretValues) {
          if (sec && sec.length >= 3 && msg.includes(sec)) {
            msg = msg.split(sec).join("***");
          }
        }
      }

      const snap = (e.node_id && nodeSnapshot[e.node_id]) || {};
      const resolvedCellId = e.cell_id || snap.cellId || undefined;
      const resolvedCellName = snap.cellName || undefined;
      const resolvedNodeLabel = snap.nodeLabel || e.node_id || undefined;

      const item: ExecutionLogItem = {
        id: `log-${nextLogId++}`,
        seq: e.seq ?? nextLogId,
        timestamp: e.timestamp || new Date().toISOString(),
        level: (e.level?.toUpperCase() as any) || "INFO",
        executionId: e.execution_id || "exec-unknown",
        jobId: jobInfo?.jobId,
        jobName: jobInfo?.jobName,
        cellId: resolvedCellId,
        cellName: resolvedCellName,
        cellOrder: snap.cellOrder,
        nodeId: e.node_id,
        nodeLabel: resolvedNodeLabel,
        nodeType: snap.nodeType,
        message: msg,
      };

      newItems.push(item);
    }

    logItems.push(...newItems);

    // Garante o buffer circular de no máximo 10.000 linhas
    if (logItems.length > MAX_LOG_BUFFER_SIZE) {
      logItems.splice(0, logItems.length - MAX_LOG_BUFFER_SIZE);
    }

    // Emite para BroadcastChannel se ativo
    if (broadcastChannel && newItems.length > 0) {
      try {
        broadcastChannel.postMessage({ type: "APPEND_LOGS", items: newItems });
      } catch (_) {}
    }

    notify();
  },

  /**
   * Retorna todas as entradas ou filtradas conforme opções informadas.
   */
  getLogs(filters?: LogFilterOptions): ExecutionLogItem[] {
    if (!filters) return [...logItems];

    const { level, cellId, nodeId, search } = filters;
    const term = search?.toLowerCase().trim();

    return logItems.filter((item) => {
      if (level && level !== "ALL" && item.level !== level) return false;
      if (cellId && cellId !== "ALL" && item.cellId !== cellId) return false;
      if (nodeId && nodeId !== "ALL" && item.nodeId !== nodeId) return false;
      if (term) {
        const matchesMsg = item.message.toLowerCase().includes(term);
        const matchesComp = item.nodeLabel?.toLowerCase().includes(term) || item.nodeId?.toLowerCase().includes(term);
        const matchesCell = item.cellName?.toLowerCase().includes(term) || item.cellId?.toLowerCase().includes(term);
        if (!matchesMsg && !matchesComp && !matchesCell) return false;
      }
      return true;
    });
  },

  /**
   * Retorna lista de células distintas presentes nos logs para popular dropdowns de filtro.
   */
  getDistinctCells(): Array<{ id: string; name: string; order?: number }> {
    const map = new Map<string, { id: string; name: string; order?: number }>();
    for (const item of logItems) {
      if (item.cellId && !map.has(item.cellId)) {
        map.set(item.cellId, {
          id: item.cellId,
          name: item.cellName || item.cellId,
          order: item.cellOrder,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  },

  /**
   * Limpa todo o histórico de logs da sessão.
   */
  clearLogs(): void {
    logItems = [];
    if (broadcastChannel) {
      try {
        broadcastChannel.postMessage({ type: "CLEAR_LOGS" });
      } catch (_) {}
    }
    notify();
  },

  /**
   * Exporta os logs filtrados em formato texto plano (.log) ou JSON (.json).
   */
  exportLogs(format: "log" | "json", filters?: LogFilterOptions): string {
    const items = this.getLogs(filters);
    if (format === "json") {
      return JSON.stringify(items, null, 2);
    }
    return items
      .map((i) => {
        const time = new Date(i.timestamp).toLocaleTimeString();
        const cell = i.cellName ? `[${i.cellName}]` : "";
        const node = i.nodeLabel ? `[${i.nodeLabel}]` : "";
        return `${time} [${i.level}] ${cell}${node} ${i.message}`;
      })
      .join("\n");
  },

  /**
   * Inscreve um ouvinte para re-renderização em tempo real.
   */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
