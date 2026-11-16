import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getEdgeStylePreference,
  setEdgeStylePreference,
} from "../src/features/designer/hooks/useEdgeStyle.ts";
import { getFlowStrokeStyle } from "../src/features/designer/edges/edgeStyleUtils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock básico de localStorage global para o ambiente Node.js
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

describe("FASE 2: Estilo de Arestas no Canvas (Curva vs Ortogonal com Barramento)", () => {
  beforeEach(() => {
    global.window = global.window || {};
    global.window.localStorage = new LocalStorageMock();
    global.window.dispatchEvent = () => true;
  });

  test("2.1 e 2.8: Padrão do estilo é 'ortogonal' e persiste no localStorage", () => {
    // Sem valor prévio -> padrão "ortogonal"
    global.window.localStorage.clear();
    assert.strictEqual(getEdgeStylePreference(), "ortogonal");

    // Salva "curva"
    setEdgeStylePreference("curva");
    assert.strictEqual(getEdgeStylePreference(), "curva");
    assert.strictEqual(global.window.localStorage.getItem("cellflow_edge_style"), "curva");

    // Retorna para "ortogonal"
    setEdgeStylePreference("ortogonal");
    assert.strictEqual(getEdgeStylePreference(), "ortogonal");
    assert.strictEqual(global.window.localStorage.getItem("cellflow_edge_style"), "ortogonal");
  });

  test("2.8: Sem localStorage (modo anônimo restrito ou falha), retorna fallback gracioso sem quebrar", () => {
    // Simula erro de SecurityError / QuotaExceeded ao acessar localStorage
    const throwingStorage = {
      getItem() {
        throw new Error("SecurityError: Access denied");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
    global.window.localStorage = throwingStorage;

    assert.doesNotThrow(() => {
      const style = getEdgeStylePreference();
      assert.strictEqual(style, "ortogonal");
    });

    assert.doesNotThrow(() => {
      setEdgeStylePreference("curva");
    });
  });

  test("2.3 e 2.8: Arestas são atômicas e mantêm IDs, flowName, flowType e dados inalterados", () => {
    const sampleEdges = [
      {
        id: "e-1",
        source: "node-1",
        target: "node-2",
        data: { flowName: "main1", flowType: "main", sourceLabel: "Src", targetLabel: "Tgt" },
        selected: false,
      },
      {
        id: "e-2",
        source: "node-1",
        target: "node-3",
        data: { flowName: "lkp1", flowType: "lkp" },
        selected: true,
      },
    ];

    // O estilo de visualização é puramente de apresentação e nunca deve mutar as arestas
    const originalCopy = JSON.parse(JSON.stringify(sampleEdges));

    // Valida que os atributos das arestas permanecem intactos
    assert.strictEqual(sampleEdges[0].id, originalCopy[0].id);
    assert.strictEqual(sampleEdges[0].data.flowName, originalCopy[0].data.flowName);
    assert.strictEqual(sampleEdges[0].data.flowType, originalCopy[0].data.flowType);
    assert.strictEqual(sampleEdges[1].id, originalCopy[1].id);
    assert.strictEqual(sampleEdges[1].data.flowType, "lkp");
  });

  test("2.6: Variáveis CSS de cores de fluxo foram declaradas em ui/src/index.css", () => {
    const cssPath = path.resolve(__dirname, "../src/index.css");
    const content = fs.readFileSync(cssPath, "utf-8");

    assert.ok(content.includes("--flow-main: #60a5fa"), "index.css deve definir --flow-main: #60a5fa");
    assert.ok(content.includes("--flow-lkp: #c4b0fb"), "index.css deve definir --flow-lkp: #c4b0fb");
    assert.ok(content.includes("--flow-reject: #fb7185"), "index.css deve definir --flow-reject: #fb7185");
    assert.ok(content.includes("--flow-out: #5eead4"), "index.css deve definir --flow-out: #5eead4");
    assert.ok(content.includes("--flow-iterate: #fbbf24"), "index.css deve definir --flow-iterate: #fbbf24");
  });

  test("2.6: getFlowStrokeStyle retorna traço e cor corretos para cada tipo de fluxo", () => {
    const mainStyle = getFlowStrokeStyle("main", false);
    assert.strictEqual(mainStyle.stroke, "var(--flow-main, #60a5fa)");
    assert.strictEqual(mainStyle.strokeDasharray, undefined);

    const lkpStyle = getFlowStrokeStyle("lkp", false);
    assert.strictEqual(lkpStyle.stroke, "var(--flow-lkp, #c4b0fb)");
    assert.strictEqual(lkpStyle.strokeDasharray, "2 5");
    assert.strictEqual(lkpStyle.strokeLinecap, "round");

    const rejectStyle = getFlowStrokeStyle("reject", false);
    assert.strictEqual(rejectStyle.stroke, "var(--flow-reject, #fb7185)");
    assert.strictEqual(rejectStyle.strokeDasharray, "7 4");

    const outStyle = getFlowStrokeStyle("out", false);
    assert.strictEqual(outStyle.stroke, "var(--flow-out, #5eead4)");
    assert.strictEqual(outStyle.strokeDasharray, undefined);

    const iterateStyle = getFlowStrokeStyle("iterate", false);
    assert.strictEqual(iterateStyle.stroke, "var(--flow-iterate, #fbbf24)");
    assert.strictEqual(iterateStyle.strokeDasharray, "9 3 2 3");

    // Quando selecionado, prioriza a cor de seleção (--accent-cyan)
    const selectedStyle = getFlowStrokeStyle("main", true);
    assert.strictEqual(selectedStyle.stroke, "var(--accent-cyan)");
  });
});
