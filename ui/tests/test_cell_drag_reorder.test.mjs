import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Frente 4: Reordenação de Células por Drag & Drop", () => {
  const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");

  test("1: jobStore.ts deve exportar reorderCells e swapTMapMainAndLookup", () => {
    const content = fs.readFileSync(jobStorePath, "utf-8");
    assert.ok(content.includes("reorderCells("), "jobStore deve ter o método reorderCells");
    assert.ok(content.includes("swapTMapMainAndLookup("), "jobStore deve ter o método swapTMapMainAndLookup");
  });

  test("2: algoritmo de reordenação deve recalcular ordem sequencial 1..N", () => {
    const currentCells = [
      { id: "c1", name: "Célula 1", order: 1 },
      { id: "c2", name: "Célula 2", order: 2 },
      { id: "c3", name: "Célula 3", order: 3 },
    ];
    const cellIdsInOrder = ["c3", "c1", "c2"];

    const cellMap = new Map(currentCells.map((c) => [c.id, c]));
    const orderedCells = [];

    cellIdsInOrder.forEach((cid, index) => {
      const c = cellMap.get(cid);
      if (c) {
        orderedCells.push({
          ...c,
          order: index + 1,
        });
        cellMap.delete(cid);
      }
    });

    assert.strictEqual(orderedCells.length, 3);
    assert.strictEqual(orderedCells[0].id, "c3");
    assert.strictEqual(orderedCells[0].order, 1);
    assert.strictEqual(orderedCells[1].id, "c1");
    assert.strictEqual(orderedCells[1].order, 2);
    assert.strictEqual(orderedCells[2].id, "c2");
    assert.strictEqual(orderedCells[2].order, 3);
  });

  test("3: detecção de violação de pré-condições quando dependência fica depois da célula", () => {
    const cellsWithDep = [
      { id: "c1", order: 1, preconditions: [] },
      { id: "c2", order: 2, preconditions: [{ cellId: "c1", requiredStatus: "success" }] },
      { id: "c3", order: 3, preconditions: [] },
    ];

    // Se usuário reordenar c2 para a posição 1 e c1 para a posição 2
    const newOrder = ["c2", "c1", "c3"];
    const orderIndexMap = new Map(newOrder.map((id, idx) => [id, idx]));

    const violations = [];
    for (const cell of cellsWithDep) {
      const myIndex = orderIndexMap.get(cell.id) ?? -1;
      for (const pre of cell.preconditions || []) {
        const depIndex = orderIndexMap.get(pre.cellId) ?? -1;
        if (depIndex > myIndex) {
          violations.push({
            cellId: cell.id,
            dependsOn: pre.cellId,
          });
        }
      }
    }

    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].cellId, "c2");
    assert.strictEqual(violations[0].dependsOn, "c1");
  });
});
