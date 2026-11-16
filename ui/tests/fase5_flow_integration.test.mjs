import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getViewModePreference,
  setViewModePreference,
} from "../src/features/flow/flowStorageUtils.ts";

// Mock de localStorage
class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

describe("FASE 5: Integração no App e Persistência do Seletor de View", () => {
  beforeEach(() => {
    global.window = global.window || {};
    global.window.localStorage = new LocalStorageMock();
  });

  test("5.1: Seletor 'Canvas | Fluxo' inicia como 'canvas' e persiste por jobId", () => {
    const jobA = "job_alpha";
    const jobB = "job_beta";

    // Padrão 'canvas'
    assert.strictEqual(getViewModePreference(jobA), "canvas");
    assert.strictEqual(getViewModePreference(jobB), "canvas");

    // Altera jobA para 'flow'
    setViewModePreference(jobA, "flow");
    assert.strictEqual(getViewModePreference(jobA), "flow");
    assert.strictEqual(global.window.localStorage.getItem("cellflow_view_mode_job_alpha"), "flow");

    // jobB permanece inalterado em 'canvas'
    assert.strictEqual(getViewModePreference(jobB), "canvas");
  });

  test("5.1: Fallback seguro quando localStorage falha", () => {
    const originalStorage = global.window.localStorage;
    global.window.localStorage = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };

    assert.doesNotThrow(() => {
      const mode = getViewModePreference("job_1");
      assert.strictEqual(mode, "canvas");
    });

    assert.doesNotThrow(() => {
      setViewModePreference("job_1", "flow");
    });

    global.window.localStorage = originalStorage;
  });

  test("5.6: Alternância de view não altera a estrutura de dados do job", () => {
    const sampleJob = {
      id: "job_test",
      name: "Job de Teste",
      cells: [
        { id: "c1", name: "Célula 1", order: 1, cellType: "CANVAS" },
        { id: "c2", name: "Célula 2", order: 2, cellType: "PYTHON" },
      ],
      activeCellId: "c1",
    };

    const serializedBefore = JSON.stringify(sampleJob);

    // Simula troca de view para "flow" e depois "canvas"
    setViewModePreference(sampleJob.id, "flow");
    const mode1 = getViewModePreference(sampleJob.id);
    assert.strictEqual(mode1, "flow");

    setViewModePreference(sampleJob.id, "canvas");
    const mode2 = getViewModePreference(sampleJob.id);
    assert.strictEqual(mode2, "canvas");

    const serializedAfter = JSON.stringify(sampleJob);
    assert.strictEqual(
      serializedBefore,
      serializedAfter,
      "A estrutura de dados salva do job não deve sofrer mutação pela alternância de visualização"
    );
  });
});
