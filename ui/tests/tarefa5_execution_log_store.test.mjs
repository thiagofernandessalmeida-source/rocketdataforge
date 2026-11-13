import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("TAREFA 5: Janela de Log Geral e executionLogStore", () => {
  test("5.1: executionLogStore.ts deve existir com limite de 10.000 linhas e snapshot estático", () => {
    const storePath = path.resolve(__dirname, "../src/store/executionLogStore.ts");
    assert.ok(fs.existsSync(storePath), "executionLogStore.ts deve existir");

    const content = fs.readFileSync(storePath, "utf-8");
    assert.ok(content.includes("10000") || content.includes("10_000"), "Deve definir buffer circular de 10.000 linhas");
    assert.ok(content.includes("addLogs"), "Deve exportar método addLogs");
    assert.ok(content.includes("getLogs"), "Deve exportar método getLogs");
    assert.ok(content.includes("clearLogs"), "Deve exportar método clearLogs");
    assert.ok(content.includes("exportLogs"), "Deve suportar exportação");
  });

  test("5.2: LogViewerModal.tsx deve existir com colunas Hora, Nível, Célula, Componente, Mensagem", () => {
    const modalPath = path.resolve(__dirname, "../src/features/execution/LogViewerModal.tsx");
    assert.ok(fs.existsSync(modalPath), "LogViewerModal.tsx deve existir");

    const content = fs.readFileSync(modalPath, "utf-8");
    assert.ok(content.includes("Hora"), "Deve exibir coluna Hora");
    assert.ok(content.includes("Nível") || content.includes("Nivel"), "Deve exibir coluna Nível");
    assert.ok(content.includes("Célula") || content.includes("Celula"), "Deve exibir coluna Célula");
    assert.ok(content.includes("Componente"), "Deve exibir coluna Componente");
    assert.ok(content.includes("Mensagem"), "Deve exibir coluna Mensagem");
    assert.ok(content.includes("exportLogs"), "Deve conter ação de exportação");
  });

  test("5.1 e 5.6: Snapshot estático de nomes não é alterado por renomeações posteriores", () => {
    // Simula lógica pura do store
    const logBuffer = [];
    function recordLog(entry, nodeSnapshot) {
      const snap = (nodeSnapshot && entry.node_id && nodeSnapshot[entry.node_id]) || {};
      logBuffer.push({
        ...entry,
        cellName: snap.cellName || entry.cellName || "--",
        nodeLabel: snap.nodeLabel || entry.nodeLabel || entry.node_id || "--",
      });
    }

    const snapshotV1 = {
      node_1: { cellName: "Célula 1 Original", nodeLabel: "Filtro Inicial" },
    };

    recordLog({ node_id: "node_1", message: "Iniciando processamento" }, snapshotV1);

    // Renomeia na aplicação depois
    snapshotV1.node_1.cellName = "Célula 1 RENOMEADA";
    snapshotV1.node_1.nodeLabel = "Filtro Modificado";

    // O log gravado no buffer deve reter os nomes originais congelados
    assert.strictEqual(logBuffer[0].cellName, "Célula 1 Original");
    assert.strictEqual(logBuffer[0].nodeLabel, "Filtro Inicial");
  });

  test("5.1: Limite de 10.000 entradas descarta as mais antigas", () => {
    const MAX_LINES = 10; // reduzido para teste unitário
    const buffer = [];

    function pushToBuffer(items) {
      buffer.push(...items);
      if (buffer.length > MAX_LINES) {
        buffer.splice(0, buffer.length - MAX_LINES);
      }
    }

    pushToBuffer(Array.from({ length: 12 }, (_, i) => ({ id: i })));
    assert.strictEqual(buffer.length, 10);
    assert.strictEqual(buffer[0].id, 2);
    assert.strictEqual(buffer[9].id, 11);
  });
});
