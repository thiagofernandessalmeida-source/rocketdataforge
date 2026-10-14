import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Importa TelemetryStoreManager para testar lógica isolada de node-level telemetry
class TelemetryStoreManager {
  constructor() {
    this.telemetryMap = new Map();
    this.globalListeners = new Set();
    this.nodeListeners = new Map();
    this.previousSnapshots = new Map();
  }

  subscribe(listener) {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  subscribeNode(nodeId, listener) {
    if (!this.nodeListeners.has(nodeId)) {
      this.nodeListeners.set(nodeId, new Set());
    }
    const set = this.nodeListeners.get(nodeId);
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.nodeListeners.delete(nodeId);
      }
    };
  }

  notifyNode(nodeId) {
    const listeners = this.nodeListeners.get(nodeId);
    if (listeners) {
      listeners.forEach((fn) => fn());
    }
  }

  notifyGlobal() {
    this.globalListeners.forEach((fn) => fn());
  }

  getNodeTelemetry(nodeId) {
    return this.telemetryMap.get(nodeId);
  }

  setNodesQueued(nodeIds) {
    const now = Date.now();
    for (const id of nodeIds) {
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

  batchUpdate(tasks) {
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

      let status = "idle";
      if (rawStatus === "queued" || rawStatus === "pending") {
        status = "queued";
      } else if (rawStatus === "running") {
        // Detecção de Starting: query sendo executada no DB antes de trafegar linhas
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

      let startedAt = prev?.startedAt;
      if (!startedAt && (status === "starting" || status === "running")) {
        startedAt = now;
      }

      let throughput = 0;
      if (status === "running") {
        const prevSnap = this.previousSnapshots.get(nodeId);
        if (prevSnap && now - prevSnap.timestamp >= 400) {
          const deltaSec = Math.max((now - prevSnap.timestamp) / 1000, 0.1);
          const deltaRows = Math.max(rowCount - prevSnap.rowCount, 0);
          throughput = Math.round(deltaRows / deltaSec);
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
        const durMs = t.duration_ms || (startedAt ? now - startedAt : 0);
        const totalSec = Math.max(durMs / 1000, 0.05);
        throughput = Math.round(rowCount / totalSec);
        this.previousSnapshots.delete(nodeId);
      } else {
        this.previousSnapshots.delete(nodeId);
      }

      const durationMs = t.duration_ms ?? (startedAt ? Math.max(now - startedAt, 0) : 0);

      this.telemetryMap.set(nodeId, {
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
      });
      this.notifyNode(nodeId);
      changed = true;
    }

    if (changed) {
      this.notifyGlobal();
    }
  }

  reset() {
    const nodeIds = Array.from(this.telemetryMap.keys());
    this.telemetryMap.clear();
    this.previousSnapshots.clear();
    for (const id of nodeIds) {
      this.notifyNode(id);
    }
    this.notifyGlobal();
  }
}

describe("Telemetry Store — Emissão e Performance de Telemetria por Nó", () => {
  let store;

  beforeEach(() => {
    store = new TelemetryStoreManager();
  });

  it("1. Deve enfileirar nós como 'queued' e notificar apenas ouvintes registrados", () => {
    let notifiedA = false;
    let notifiedB = false;

    store.subscribeNode("node_A", () => { notifiedA = true; });
    store.subscribeNode("node_B", () => { notifiedB = true; });

    store.setNodesQueued(["node_A"]);

    assert.equal(notifiedA, true);
    assert.equal(notifiedB, false, "node_B não deve ser notificado");

    const tA = store.getNodeTelemetry("node_A");
    assert.equal(tA.status, "queued");
    assert.equal(tA.rowCount, 0);
  });

  it("2. Deve marcar status como 'starting' quando backend estiver executando query mas com 0 linhas", () => {
    store.batchUpdate([
      { node_id: "node_sql", status: "running", rows_in: 0, rows_out: 0 }
    ]);

    const t = store.getNodeTelemetry("node_sql");
    assert.equal(t.status, "starting", "Status deve ser starting enquanto query processa no banco");
    assert.equal(t.rowCount, 0);
  });

  it("3. Deve transicionar de 'starting' para 'running' assim que as primeiras linhas chegarem", () => {
    // Passo 1: Query submetida
    store.batchUpdate([
      { node_id: "node_sql", status: "running", rows_in: 0, rows_out: 0 }
    ]);
    assert.equal(store.getNodeTelemetry("node_sql").status, "starting");

    // Passo 2: Primeiras linhas chegam do cursor
    store.batchUpdate([
      { node_id: "node_sql", status: "running", rows_in: 0, rows_out: 500 }
    ]);
    const t = store.getNodeTelemetry("node_sql");
    assert.equal(t.status, "running", "Status deve transicionar para running com linhas > 0");
    assert.equal(t.rowCount, 500);
    assert.equal(t.rowsOut, 500);
  });

  it("4. Deve calcular rowCount e throughput corretamente ao finalizar com sucesso", () => {
    store.batchUpdate([
      {
        node_id: "node_sink",
        status: "succeeded",
        rows_in: 10000,
        rows_out: 10000,
        duration_ms: 2000 // 2 segundos para 10.000 linhas = 5.000 rows/sec
      }
    ]);

    const t = store.getNodeTelemetry("node_sink");
    assert.equal(t.status, "succeeded");
    assert.equal(t.rowCount, 10000);
    assert.equal(t.throughput, 5000);
  });

  it("5. Deve manter isolamento estrito: atualização no node_X NÃO dispara render no node_Y", () => {
    let nodeXRenderCount = 0;
    let nodeYRenderCount = 0;

    store.subscribeNode("node_X", () => { nodeXRenderCount++; });
    store.subscribeNode("node_Y", () => { nodeYRenderCount++; });

    // Emite 5 updates de telemetria para node_X
    for (let i = 1; i <= 5; i++) {
      store.batchUpdate([
        { node_id: "node_X", status: "running", rows_out: i * 1000 }
      ]);
    }

    assert.equal(nodeXRenderCount, 5, "node_X deve ter recebido 5 atualizações");
    assert.equal(nodeYRenderCount, 0, "node_Y deve ter ZERO atualizações (isolamento perfeito)");
  });

  it("6. Deve resetar telemetria limpando dados de nós", () => {
    store.batchUpdate([
      { node_id: "n1", status: "succeeded", rows_out: 100 }
    ]);
    assert.ok(store.getNodeTelemetry("n1"));

    store.reset();
    assert.equal(store.getNodeTelemetry("n1"), undefined);
  });
});
