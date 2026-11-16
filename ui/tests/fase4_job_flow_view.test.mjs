import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getExpandedCellsPreference,
  setExpandedCellsPreference,
} from "../src/features/flow/flowStorageUtils.ts";
import { buildJobFlowModel } from "../src/features/flow/jobFlowModel.ts";
import { computeJobFlowLayout } from "../src/features/flow/jobFlowLayout.ts";

// Mock de localStorage para ambiente Node.js
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

describe("FASE 4: Componentes e Estado da View de Fluxo (JobFlowView)", () => {
  beforeEach(() => {
    global.window = global.window || {};
    global.window.localStorage = new LocalStorageMock();
  });

  test("4.3: Persistência de células expandidas em localStorage por JobId", () => {
    const jobId = "job_test_123";

    // Inicialmente vazio
    const initial = getExpandedCellsPreference(jobId);
    assert.strictEqual(initial.size, 0);

    // Salva conjunto com 2 células expandidas
    const toSave = new Set(["c1", "c3"]);
    setExpandedCellsPreference(jobId, toSave);

    const reloaded = getExpandedCellsPreference(jobId);
    assert.strictEqual(reloaded.size, 2);
    assert.ok(reloaded.has("c1"));
    assert.ok(reloaded.has("c3"));
    assert.ok(!reloaded.has("c2"));

    // Isolamento entre jobs distintos
    const otherJob = getExpandedCellsPreference("job_outro_456");
    assert.strictEqual(otherJob.size, 0);
  });

  test("4.3: Fallback gracioso quando localStorage indisponível ou falha", () => {
    const originalStorage = global.window.localStorage;
    // Simula erro de SecurityError / QuotaExceeded
    global.window.localStorage = {
      getItem() {
        throw new Error("SecurityError: Access is denied");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };

    assert.doesNotThrow(() => {
      const result = getExpandedCellsPreference("any_job");
      assert.strictEqual(result.size, 0);
    });

    assert.doesNotThrow(() => {
      setExpandedCellsPreference("any_job", new Set(["c1"]));
    });

    global.window.localStorage = originalStorage;
  });

  test("4.1 e 4.2: Estrutura semântica e atributos de acessibilidade nos nós", () => {
    const cells = [
      {
        id: "cell_canvas",
        name: "Célula de Transformação",
        cellType: "CANVAS",
        order: 1,
        status: "running",
        preconditions: [
          { id: "p1", targetCellId: "prev1", expectedStatus: "OK" },
          { id: "p2", targetCellId: "prev2", expectedStatus: "ERROR" },
        ],
        preconditionOperator: "AND",
        nodes: [
          { id: "comp_1", data: { label: "Input CSV", componentType: "core.csv_input", category: "source" } },
          { id: "comp_2", data: { label: "Filter Rows", componentType: "core.filter", category: "transform" } },
        ],
      },
      {
        id: "cell_python",
        name: "Script de Treino",
        cellType: "PYTHON",
        order: 2,
        status: "success",
        codeSnippet: "for i in range(10):\n    print(i)",
      },
    ];

    const model = buildJobFlowModel(cells);
    const layout = computeJobFlowLayout(model, new Set(["cell_canvas"]));

    const canvasNode = layout.nodes.find((n) => n.id === "cell_canvas");
    assert.ok(canvasNode);
    assert.strictEqual(canvasNode.isExpanded, true);
    assert.strictEqual(canvasNode.w, 540);
    assert.ok(canvasNode.h > 120, "Célula expandida deve ter altura maior que 120");

    const pythonNode = layout.nodes.find((n) => n.id === "cell_python");
    assert.ok(pythonNode);
    assert.strictEqual(pythonNode.isExpanded, false);
    assert.strictEqual(pythonNode.w, 200);
    assert.strictEqual(pythonNode.h, 120);
  });

  test("4.4: Links overlay geram rotas com halo e parâmetros de traço esperados", () => {
    const cells = [
      { id: "c1", name: "Célula 1", cellType: "CANVAS", order: 1 },
      {
        id: "c2",
        name: "Célula 2",
        cellType: "CANVAS",
        order: 2,
        preconditions: [{ id: "p1", targetCellId: "c1", expectedStatus: "OK" }],
      },
      {
        id: "c3",
        name: "Célula 3",
        cellType: "CANVAS",
        order: 2,
        preconditions: [{ id: "p2", targetCellId: "c1", expectedStatus: "ERROR" }],
      },
    ];

    const model = buildJobFlowModel(cells);
    const layout = computeJobFlowLayout(model, new Set());

    assert.strictEqual(layout.routes.length, 2);
    // Cada rota possui polyline válida e svgPath
    for (const route of layout.routes) {
      assert.ok(route.svgPath.startsWith("M"), "Rota SVG deve iniciar com comando M");
      assert.ok(route.polyline.length >= 2, "Polilinha deve ter pelo menos 2 pontos");
    }
  });
});
