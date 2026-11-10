// ============================================================
// RocketDataForge — Telemetry Store (In-Memory High Performance)
// ============================================================
// Gerencia métricas de execução em tempo real nó a nó.
// Projetado para alta frequência (350ms / WebSocket) com zero re-renders
// no React Flow Canvas geral através de assinaturas isoladas por nó.

import { useCallback, useSyncExternalStore, useEffect } from "react";

export type NodeTelemetryStatus =
  | "idle"
  | "queued"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface NodeTelemetry {
  nodeId: string;
  status: NodeTelemetryStatus;
  rowCount: number;       // Quantidade de linhas processadas (max de rows_out e rows_in)
  rowsIn: number;
  rowsOut: number;
  throughput: number;     // Velocidade de processamento (linhas/segundo)
  durationMs: number;     // Duração decorrida ou total em ms
  errorMessage?: string;
  startedAt?: number;     // Timestamp do início da execução do nó
  lastUpdated: number;    // Timestamp da última atualização
}

export interface TaskMetricInput {
  node_id: string;
  status: string;
  rows_in?: number;
  rows_out?: number;
  duration_ms?: number;
  error_message?: string;
}

type Listener = () => void;

class TelemetryStoreManager {
  private telemetryMap: Map<string, NodeTelemetry> = new Map();
  private globalListeners: Set<Listener> = new Set();
  private nodeListeners: Map<string, Set<Listener>> = new Map();
  private previousSnapshots: Map<string, { timestamp: number; rowCount: number }> = new Map();

  /**
   * Assina atualizações globais da store de telemetria
   */
  public subscribe(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  /**
   * Assina atualizações de um único nó específico (Zero-impact nos demais nós do Canvas)
   */
  public subscribeNode(nodeId: string, listener: Listener): () => void {
    if (!this.nodeListeners.has(nodeId)) {
      this.nodeListeners.set(nodeId, new Set());
    }
    const set = this.nodeListeners.get(nodeId)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.nodeListeners.delete(nodeId);
      }
    };
  }

  private notifyNode(nodeId: string): void {
    const listeners = this.nodeListeners.get(nodeId);
    if (listeners) {
      listeners.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error(`[TelemetryStore] Erro ao notificar listener do nó ${nodeId}:`, e);
        }
      });
    }
  }

  private notifyGlobal(): void {
    this.globalListeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error("[TelemetryStore] Erro ao notificar global listener:", e);
      }
    });
  }

  /**
   * Retorna a telemetria atual de um nó
   */
  public getNodeTelemetry(nodeId: string): NodeTelemetry | undefined {
    return this.telemetryMap.get(nodeId);
  }

  /**
   * Retorna snapshot de todos os nós
   */
  public getAllTelemetry(): Record<string, NodeTelemetry> {
    const res: Record<string, NodeTelemetry> = {};
    this.telemetryMap.forEach((v, k) => {
      res[k] = v;
    });
    return res;
  }

  /**
   * Marca nós como "queued" no início do disparo do job/célula
   */
  public setNodesQueued(nodeIds: string[]): void {
    const now = Date.now();
    for (const id of nodeIds) {
      const current = this.telemetryMap.get(id);
      this.telemetryMap.set(id, {
        nodeId: id,
        status: "queued",
        rowCount: 0,
        rowsIn: 0,
        rowsOut: 0,
        throughput: 0,
        durationMs: 0,
        lastUpdated: now,
      });
      this.previousSnapshots.delete(id);
      this.notifyNode(id);
    }
    this.notifyGlobal();
  }

  /**
   * Atualiza as métricas recebidas do backend (via Polling ou WebSocket)
   */
  public batchUpdate(tasks: TaskMetricInput[]): void {
    if (!tasks || tasks.length === 0) return;

    const now = Date.now();
    let changed = false;

    for (const t of tasks) {
      const nodeId = t.node_id;
      if (!nodeId) continue;

      const prev = this.telemetryMap.get(nodeId);
      const rowsIn = t.rows_in ?? 0;
      const rowsOut = t.rows_out ?? 0;
      const rowCount = Math.max(rowsIn, rowsOut);
      const rawStatus = (t.status || "").toLowerCase();

      // Determina status com detecção explícita de "starting":
      // Se o backend diz "running", mas ainda não há linhas trafegando (0 in e 0 out),
      // a query está sendo processada no banco/motor -> estado "starting"
      let status: NodeTelemetryStatus = "idle";
      if (rawStatus === "queued" || rawStatus === "pending") {
        status = "queued";
      } else if (rawStatus === "running") {
        if (rowCount === 0) {
          status = "starting";
        } else {
          status = "running";
        }
      } else if (rawStatus === "succeeded" || rawStatus === "success") {
        status = "succeeded";
      } else if (rawStatus === "failed" || rawStatus === "error") {
        status = "failed";
      } else if (rawStatus === "cancelled" || rawStatus === "skipped") {
        status = "cancelled";
      }

      // Início da execução
      let startedAt = prev?.startedAt;
      if (!startedAt && (status === "starting" || status === "running")) {
        startedAt = now;
      }

      // Cálculo de Throughput (rows/sec):
      let throughput = 0;
      if (status === "running") {
        const prevSnap = this.previousSnapshots.get(nodeId);
        if (prevSnap && now - prevSnap.timestamp >= 400) {
          const deltaSec = Math.max((now - prevSnap.timestamp) / 1000, 0.1);
          const deltaRows = Math.max(rowCount - prevSnap.rowCount, 0);
          throughput = Math.round(deltaRows / deltaSec);
          // Se delta foi zero momentâneo (ex: batch em buffering), calcula média desde início
          if (throughput === 0 && startedAt && rowCount > 0) {
            const totalSec = Math.max((now - startedAt) / 1000, 0.1);
            throughput = Math.round(rowCount / totalSec);
          }
          this.previousSnapshots.set(nodeId, { timestamp: now, rowCount });
        } else if (!prevSnap) {
          this.previousSnapshots.set(nodeId, { timestamp: now, rowCount });
          if (startedAt && rowCount > 0) {
            const totalSec = Math.max((now - startedAt) / 1000, 0.1);
            throughput = Math.round(rowCount / totalSec);
          }
        } else {
          throughput = prev?.throughput ?? 0;
        }
      } else if (status === "succeeded") {
        // Velocidade média final do nó
        const durMs = t.duration_ms || (startedAt ? now - startedAt : 0);
        const totalSec = Math.max(durMs / 1000, 0.05);
        throughput = Math.round(rowCount / totalSec);
        this.previousSnapshots.delete(nodeId);
      } else {
        this.previousSnapshots.delete(nodeId);
      }

      const durationMs = t.duration_ms ?? (startedAt ? Math.max(now - startedAt, 0) : 0);

      const nextTelemetry: NodeTelemetry = {
        nodeId,
        status,
        rowCount,
        rowsIn,
        rowsOut,
        throughput,
        durationMs,
        errorMessage: t.error_message,
        startedAt,
        lastUpdated: now,
      };

      this.telemetryMap.set(nodeId, nextTelemetry);
      this.notifyNode(nodeId);
      changed = true;
    }

    if (changed) {
      this.notifyGlobal();
    }
  }

  /**
   * Reseta as métricas de todos os nós (ex: ao limpar canvas ou novo job)
   */
  public reset(): void {
    const nodeIds = Array.from(this.telemetryMap.keys());
    this.telemetryMap.clear();
    this.previousSnapshots.clear();
    for (const id of nodeIds) {
      this.notifyNode(id);
    }
    this.notifyGlobal();
  }

  /**
   * Limpa a telemetria de nós específicos
   */
  public clearNodes(nodeIds: string[]): void {
    for (const id of nodeIds) {
      this.telemetryMap.delete(id);
      this.previousSnapshots.delete(id);
      this.notifyNode(id);
    }
    this.notifyGlobal();
  }

  /**
   * Finaliza nós inacabados (ex: que ficaram em "queued", "starting" ou "running")
   * ao término de uma execução que falhou, foi cancelada ou abortada.
   */
  public finalizeUnfinishedNodes(
    nodeIds: string[],
    finalStatus: "failed" | "cancelled" | "succeeded" | "idle",
    errorMessage?: string
  ): void {
    if (!nodeIds || nodeIds.length === 0) return;
    const now = Date.now();
    let changed = false;

    for (const id of nodeIds) {
      const prev = this.telemetryMap.get(id);
      if (!prev) {
        if (finalStatus === "failed" || finalStatus === "cancelled") {
          this.telemetryMap.set(id, {
            nodeId: id,
            status: finalStatus,
            rowCount: 0,
            rowsIn: 0,
            rowsOut: 0,
            throughput: 0,
            durationMs: 0,
            errorMessage,
            lastUpdated: now,
          });
          this.notifyNode(id);
          changed = true;
        }
        continue;
      }

      // Se o nó já teve sucesso definitivo, preserva seu sucesso
      if (prev.status === "succeeded") {
        continue;
      }

      // Se o status for idle, limpa da telemetria
      if (finalStatus === "idle") {
        this.telemetryMap.delete(id);
        this.previousSnapshots.delete(id);
        this.notifyNode(id);
        changed = true;
        continue;
      }

      const startedAt = prev.startedAt;
      const durationMs = startedAt ? Math.max(now - startedAt, 0) : prev.durationMs;

      this.telemetryMap.set(id, {
        ...prev,
        status: finalStatus,
        durationMs,
        errorMessage: errorMessage || prev.errorMessage,
        lastUpdated: now,
      });
      this.previousSnapshots.delete(id);
      this.notifyNode(id);
      changed = true;
    }

    if (changed) {
      this.notifyGlobal();
    }
  }
}

// Instância Singleton do TelemetryStore
export const telemetryStore = new TelemetryStoreManager();

/**
 * Hook React padrão para assinar telemetria de um nó específico.
 * Usa `useSyncExternalStore` (React 18) para garantir que APENAS o componente do nó
 * em questão re-renderize quando novas linhas/status chegarem.
 */
export function useNodeTelemetry(nodeId: string): NodeTelemetry | undefined {
  const subscribe = useCallback(
    (onStoreChange: () => void) => telemetryStore.subscribeNode(nodeId, onStoreChange),
    [nodeId]
  );

  const getSnapshot = useCallback(
    () => telemetryStore.getNodeTelemetry(nodeId),
    [nodeId]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook alternativo para injeção via `useEffect` puro.
 * Útil para manipulação imperativa de refs no DOM ou callbacks customizados,
 * garantindo ZERO re-renderizações React mesmo sob vazão massiva de dados.
 */
export function useNodeTelemetryEffect(
  nodeId: string,
  onMetricUpdate: (metric: NodeTelemetry) => void
): void {
  useEffect(() => {
    const unsub = telemetryStore.subscribeNode(nodeId, () => {
      const metric = telemetryStore.getNodeTelemetry(nodeId);
      if (metric) {
        onMetricUpdate(metric);
      }
    });
    // Dispara estado inicial se já existir
    const current = telemetryStore.getNodeTelemetry(nodeId);
    if (current) {
      onMetricUpdate(current);
    }
    return unsub;
  }, [nodeId, onMetricUpdate]);
}
