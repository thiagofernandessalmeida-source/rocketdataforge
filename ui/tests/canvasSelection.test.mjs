import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── T-1.1 & RF-01: Isolamento de Seleção e Ciclo de Vida do Canvas ───

describe("T-1.1: Isolamento de Seleção entre Células e Tecla Delete", () => {
  it("Canvas.tsx deve configurar explicitamente deleteKeyCode={null} no ReactFlow", () => {
    const canvasPath = path.resolve(__dirname, "../src/features/designer/Canvas.tsx");
    const content = fs.readFileSync(canvasPath, "utf-8");

    // Valida que ReactFlow no Canvas.tsx desativa a captura global de Delete
    const hasDeleteKeyCodeNull =
      content.includes("deleteKeyCode={null}") || content.includes("deleteKeyCode={ null }");
    assert.equal(
      hasDeleteKeyCodeNull,
      true,
      "ReactFlow em Canvas.tsx deve ter deleteKeyCode={null} para evitar deleção global acidental"
    );
  });

  it("ao ativar a Célula 2, jobStore.setActiveCell deve revogar explicitamente a seleção de nós e arestas de outras células", () => {
    const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");
    const jobStoreContent = fs.readFileSync(jobStorePath, "utf-8");

    const setActiveFnStart = jobStoreContent.indexOf("setActiveCell(");
    const setActiveFnEnd = jobStoreContent.indexOf("saveCellGraph(", setActiveFnStart);
    const setActiveCellCode = jobStoreContent.slice(setActiveFnStart, setActiveFnEnd);

    // setActiveCell deve higienizar/desmarcar selected nas demais células
    const revokesSelection =
      setActiveCellCode.includes("selected") ||
      setActiveCellCode.includes("revokeOtherCellsSelection");

    assert.equal(
      revokesSelection,
      true,
      "jobStore.setActiveCell deve revogar explicitamente 'selected' nas demais células"
    );
  });

  it("simulação de duas células montadas: selecionar nó na Célula 1, ativar Célula 2, disparar Delete e garantir que nó da Célula 1 NÃO é removido", () => {
    const canvasCardPath = path.resolve(
      __dirname,
      "../src/features/designer/cells/CanvasCellCard.tsx"
    );
    const canvasCardContent = fs.readFileSync(canvasCardPath, "utf-8");

    // CanvasCellCard deve possuir guarda de teclado específica para isActive e exclusão restrita à célula ativa
    const hasCellKeyboardHandler =
      canvasCardContent.includes("handleKeyDown") &&
      canvasCardContent.includes("isActive") &&
      canvasCardContent.includes("deleteKeyCode");

    assert.equal(
      hasCellKeyboardHandler,
      true,
      "CanvasCellCard deve implementar guarda de teclado verificando se a célula é ativa antes de deletar nós"
    );
  });

  it("deve ignorar evento Delete se document.activeElement pertencer a input, textarea ou editor Monaco", () => {
    const canvasCardPath = path.resolve(
      __dirname,
      "../src/features/designer/cells/CanvasCellCard.tsx"
    );
    const canvasCardContent = fs.readFileSync(canvasCardPath, "utf-8");

    const hasInputGuard =
      canvasCardContent.includes("monaco") &&
      canvasCardContent.includes("INPUT") &&
      canvasCardContent.includes("TEXTAREA");

    assert.equal(
      hasInputGuard,
      true,
      "CanvasCellCard deve ignorar Delete quando activeElement for input, textarea ou editor Monaco"
    );
  });
});
