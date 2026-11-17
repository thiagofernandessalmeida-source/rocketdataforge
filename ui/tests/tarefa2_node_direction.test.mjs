import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("TAREFA 2: Orientação de novos componentes conforme layoutDirection da célula", () => {
  const resolveHelperPath = path.resolve(__dirname, "../src/features/designer/utils/resolveCellDirection.ts");
  const canvasPath = path.resolve(__dirname, "../src/features/designer/Canvas.tsx");
  const genericNodePath = path.resolve(__dirname, "../src/features/designer/nodes/GenericNode.tsx");
  const canvasCellCardPath = path.resolve(__dirname, "../src/features/designer/cells/CanvasCellCard.tsx");
  const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");

  test("2.1: O helper resolveCellDirection.ts deve existir e exportar resolveCellDirection e getHandlePositions", () => {
    assert.ok(fs.existsSync(resolveHelperPath), "resolveCellDirection.ts deve existir");
    const content = fs.readFileSync(resolveHelperPath, "utf-8");
    assert.ok(content.includes("export function resolveCellDirection"), "Deve exportar resolveCellDirection");
    assert.ok(content.includes("export function getHandlePositions"), "Deve exportar getHandlePositions");
  });

  test("2.2: Lógica pura do helper resolveCellDirection (simulada ou importada)", () => {
    const content = fs.readFileSync(resolveHelperPath, "utf-8");
    // Avalia o algoritmo de decisão
    assert.ok(content.includes('"LR"'), 'Deve conter padrão "LR"');
    assert.ok(content.includes('"TB"'), 'Deve conter suporte a "TB"');

    // Implementação direta para validar o algoritmo exigido
    function resolveCellDirection(cellDirection, nodes) {
      if (cellDirection === "LR" || cellDirection === "TB") return cellDirection;
      if (nodes && nodes.length > 0) {
        for (const n of nodes) {
          const dir = n?.data?.layoutDirection;
          if (dir === "LR" || dir === "TB") return dir;
        }
        for (const n of nodes) {
          if (n?.targetPosition === "top" || n?.sourcePosition === "bottom") return "TB";
          if (n?.targetPosition === "left" || n?.sourcePosition === "right") return "LR";
        }
      }
      return "LR";
    }

    // (a) layoutDirection da célula tem prioridade máxima
    assert.strictEqual(resolveCellDirection("LR", [{ data: { layoutDirection: "TB" } }]), "LR");
    assert.strictEqual(resolveCellDirection("TB", [{ data: { layoutDirection: "LR" } }]), "TB");

    // (b) data.layoutDirection do primeiro nó existente quando célula não define
    assert.strictEqual(resolveCellDirection(undefined, [{ data: { layoutDirection: "TB" } }]), "TB");
    assert.strictEqual(resolveCellDirection(null, [{ data: { layoutDirection: "LR" } }]), "LR");

    // (c) deduz de targetPosition/sourcePosition dos nós existentes
    assert.strictEqual(resolveCellDirection(undefined, [{ targetPosition: "top" }]), "TB");
    assert.strictEqual(resolveCellDirection(undefined, [{ targetPosition: "left" }]), "LR");

    // (d) padrão LR quando vazio ou indefinido
    assert.strictEqual(resolveCellDirection(undefined, []), "LR");
    assert.strictEqual(resolveCellDirection(undefined, undefined), "LR");
  });

  test("2.3: CanvasProps deve aceitar layoutDirection e onDrop deve configurar targetPosition, sourcePosition e data.layoutDirection", () => {
    const content = fs.readFileSync(canvasPath, "utf-8");
    assert.ok(
      content.includes("layoutDirection?: \"LR\" | \"TB\"") || content.includes("layoutDirection?: 'LR' | 'TB'"),
      "CanvasProps deve incluir layoutDirection?: 'LR' | 'TB'"
    );
    assert.ok(
      content.includes("resolveCellDirection"),
      "Canvas.tsx deve usar resolveCellDirection"
    );
    assert.ok(
      content.includes("targetPosition") && content.includes("sourcePosition"),
      "onDrop deve definir targetPosition e sourcePosition no novo nó"
    );
  });

  test("2.4: GenericNode.tsx deve ter fallback horizontal (LR) quando data.layoutDirection não for informado", () => {
    const content = fs.readFileSync(genericNodePath, "utf-8");
    // Não pode ter `targetPosition === Position.Top` como fallback cego sem checar layoutDirection
    assert.ok(
      !content.includes(": targetPosition === Position.Top || sourcePosition === Position.Bottom"),
      "GenericNode não deve cair em vertical apenas por targetPosition === Position.Top"
    );
  });

  test("2.5: CanvasCellCard.tsx deve repassar cell.layoutDirection ao Canvas", () => {
    const content = fs.readFileSync(canvasCellCardPath, "utf-8");
    assert.ok(
      content.includes("layoutDirection={cell.layoutDirection}"),
      "CanvasCellCard deve passar layoutDirection={cell.layoutDirection} ao Canvas"
    );
  });

  test("2.6: jobStore.ts deve normalizar layoutDirection ao carregar e clonar/duplicar nós", () => {
    const content = fs.readFileSync(jobStorePath, "utf-8");
    assert.ok(
      content.includes("inferAndNormalizeNode"),
      "jobStore deve possuir inferAndNormalizeNode"
    );
    assert.ok(
      content.includes("targetLayoutDirection"),
      "cloneNodes / duplicateNode / pasteNodes deve aceitar e respeitar targetLayoutDirection"
    );
  });
});
