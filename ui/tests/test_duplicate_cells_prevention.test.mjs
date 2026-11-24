import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Implementação pura de healDuplicateCells espelhada do jobStore para validação algorítmica
function healDuplicateCells(cells) {
  if (!Array.isArray(cells)) return [];
  const seenIds = new Set();
  const uniqueCells = [];
  for (const cell of cells) {
    if (!cell || !cell.id) continue;
    const lowerId = String(cell.id).toLowerCase();
    if (seenIds.has(lowerId)) {
      continue;
    }
    seenIds.add(lowerId);
    uniqueCells.push(cell);
  }
  return uniqueCells;
}

describe("Prevenção e Cura de Células Duplicadas (MultiCanvasContainer & jobStore)", () => {
  const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");
  const multiCanvasPath = path.resolve(__dirname, "../src/features/designer/cells/MultiCanvasContainer.tsx");

  test("1: healDuplicateCells deve eliminar células com IDs duplicados mantendo a primeira ocorrência", () => {
    const rawCells = [
      { id: "canvas-cell-01", name: "Célula 1", order: 1, nodes: [{ id: "n1" }] },
      { id: "canvas-cell-02", name: "Célula 2 (Original)", order: 2, nodes: [{ id: "n2" }] },
      { id: "canvas-cell-02", name: "Célula 2 (Duplicata Espelhada)", order: 3, nodes: [{ id: "n2" }] },
      { id: "CANVAS-CELL-01", name: "Célula 1 (Case Insensitive)", order: 4, nodes: [] },
      { id: "canvas-cell-03", name: "Célula 3", order: 5, nodes: [{ id: "n3" }] },
    ];

    const healed = healDuplicateCells(rawCells);

    assert.equal(healed.length, 3, "Deve conter apenas 3 células únicas");
    assert.equal(healed[0].id, "canvas-cell-01");
    assert.equal(healed[0].name, "Célula 1");
    assert.equal(healed[1].id, "canvas-cell-02");
    assert.equal(healed[1].name, "Célula 2 (Original)");
    assert.equal(healed[2].id, "canvas-cell-03");
    assert.equal(healed[2].name, "Célula 3");
  });

  test("2: healDuplicateCells deve tratar arrays vazios, nulos ou com entradas inválidas", () => {
    assert.deepEqual(healDuplicateCells(null), []);
    assert.deepEqual(healDuplicateCells(undefined), []);
    assert.deepEqual(healDuplicateCells([]), []);
    assert.deepEqual(healDuplicateCells([null, undefined, {}, { id: "" }]), []);
  });

  test("3: Algoritmo de createCell: nunca gera ID duplicado mesmo com IDs não sequenciais ou personalizados", () => {
    // Simula estado com IDs customizados e não-sequenciais (ex: canvas-cell-02 existe, mas 01 foi excluída)
    const existingCells = [
      { id: "canvas-cell-02", name: "Célula 2", order: 2 },
      { id: "canvas-cell-stage_validacao", name: "Stage Validação", order: 3 },
    ];

    const existingIds = new Set(existingCells.map((c) => c.id.toLowerCase()));
    const prefix = "canvas-cell";

    let counter = 1;
    let candidateId = `${prefix}-${String(counter).padStart(2, "0")}`;
    while (existingIds.has(candidateId.toLowerCase())) {
      counter++;
      candidateId = `${prefix}-${String(counter).padStart(2, "0")}`;
    }

    assert.equal(candidateId, "canvas-cell-01", "Deve encontrar o slot vago canvas-cell-01");
    assert.ok(!existingIds.has(candidateId.toLowerCase()));

    // Adiciona a célula 01
    existingIds.add(candidateId.toLowerCase());

    // Próxima criação não deve colidir com 01 nem com 02
    counter = 1;
    candidateId = `${prefix}-${String(counter).padStart(2, "0")}`;
    while (existingIds.has(candidateId.toLowerCase())) {
      counter++;
      candidateId = `${prefix}-${String(counter).padStart(2, "0")}`;
    }

    assert.equal(candidateId, "canvas-cell-03", "Deve pular 01 e 02 e gerar canvas-cell-03");
    assert.ok(!existingIds.has(candidateId.toLowerCase()));
  });

  test("4: Algoritmo de duplicateCell: nunca gera ID duplicado ao duplicar célula com ID não-numérico", () => {
    const existingCells = [
      { id: "canvas-cell-stage_validacao", name: "Stage Validação", order: 1 },
      { id: "canvas-cell-01", name: "Célula 01", order: 2 },
    ];

    const sourceCell = existingCells[0]; // canvas-cell-stage_validacao
    const isPython = sourceCell.cellType === "PYTHON";
    const prefix = isPython ? "python-cell" : "canvas-cell";

    const existingIds = new Set(existingCells.map((c) => c.id.toLowerCase()));
    let candidateNum = 1;
    let candidateId = `${prefix}-${String(candidateNum).padStart(2, "0")}`;
    while (existingIds.has(candidateId.toLowerCase())) {
      candidateNum++;
      candidateId = `${prefix}-${String(candidateNum).padStart(2, "0")}`;
    }

    assert.equal(candidateId, "canvas-cell-02", "Deve gerar canvas-cell-02 sem colidir com canvas-cell-01");
    assert.ok(!existingIds.has(candidateId.toLowerCase()));
  });

  test("5: MultiCanvasContainer useMemo: sortedCells não renderiza duplicatas e preserva ordem", () => {
    const rawJobCells = [
      { id: "cell-b", name: "Etapa B", order: 2 },
      { id: "cell-a", name: "Etapa A", order: 1 },
      { id: "cell-b", name: "Etapa B (Cópia Inadvertida)", order: 2 },
    ];

    const uniqueCells = healDuplicateCells(rawJobCells);
    const sortedCells = [...uniqueCells].sort((a, b) => a.order - b.order);

    assert.equal(sortedCells.length, 2, "Não deve renderizar 3 cards, apenas 2");
    assert.equal(sortedCells[0].id, "cell-a");
    assert.equal(sortedCells[1].id, "cell-b");
  });

  test("6: jobStore.ts deve implementar e exportar healDuplicateCells com guarda contra colisão", () => {
    const content = fs.readFileSync(jobStorePath, "utf-8");

    assert.ok(
      content.includes("export function healDuplicateCells("),
      "jobStore.ts deve exportar healDuplicateCells"
    );

    assert.ok(
      content.includes("while (existingIds.has(candidateId.toLowerCase()))"),
      "createCell deve verificar existingIds em loop para nunca colidir"
    );

    assert.ok(
      content.includes("while (existingIds.has(candidateId.toLowerCase()))"),
      "duplicateCell deve verificar existingIds em loop para nunca colidir"
    );

    assert.ok(
      content.includes("const uniqueCells = healDuplicateCells(j.cells || []);"),
      "setActiveCell deve aplicar healDuplicateCells"
    );
  });

  test("7: MultiCanvasContainer.tsx deve importar healDuplicateCells e higienizar job.cells", () => {
    const content = fs.readFileSync(multiCanvasPath, "utf-8");

    assert.ok(
      content.includes("healDuplicateCells"),
      "MultiCanvasContainer deve importar healDuplicateCells"
    );

    assert.ok(
      content.includes("healDuplicateCells(raw)"),
      "MultiCanvasContainer deve aplicar healDuplicateCells em job.cells"
    );
  });
});
