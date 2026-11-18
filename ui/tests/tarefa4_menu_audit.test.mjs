import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Tarefa 4: Auditoria e Padronização de Menus Flutuantes", () => {
  test("1. PropertyPanel.tsx: QuerySelect utiliza FloatingMenu", () => {
    const propPath = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
    assert.ok(fs.existsSync(propPath));
    const src = fs.readFileSync(propPath, "utf-8");

    assert.ok(
      src.includes('import { FloatingMenu } from "../../components/common/FloatingMenu"'),
      "PropertyPanel deve importar FloatingMenu"
    );
    const querySelectBlock = src.slice(src.indexOf("export const QuerySelect"), src.indexOf("export const DebouncedTextarea"));
    assert.ok(querySelectBlock.includes("<FloatingMenu"), "QuerySelect deve renderizar <FloatingMenu");
    assert.ok(querySelectBlock.includes("anchorRef={buttonRef}"), "Deve ancorar em buttonRef");
    assert.ok(!querySelectBlock.includes('position: "absolute"'), "NÃO deve usar position: absolute");
  });

  test("2. CanvasCellCard.tsx: menu de ações da célula utiliza FloatingMenu", () => {
    const cardPath = path.resolve(__dirname, "../src/features/designer/cells/CanvasCellCard.tsx");
    assert.ok(fs.existsSync(cardPath));
    const src = fs.readFileSync(cardPath, "utf-8");

    assert.ok(
      src.includes('import { FloatingMenu } from "../../../components/common/FloatingMenu"'),
      "CanvasCellCard deve importar FloatingMenu"
    );
    assert.ok(src.includes("<FloatingMenu"), "CanvasCellCard deve renderizar <FloatingMenu para ações");
    assert.ok(src.includes("anchorRef={cellActionsRef}"), "Deve ancorar em cellActionsRef");
  });

  test("3. FlowEdge.tsx: menu de contexto de exclusão utiliza FloatingMenu fora de transformações", () => {
    const edgePath = path.resolve(__dirname, "../src/features/designer/edges/FlowEdge.tsx");
    assert.ok(fs.existsSync(edgePath));
    const src = fs.readFileSync(edgePath, "utf-8");

    assert.ok(
      src.includes('import { FloatingMenu } from "../../../components/common/FloatingMenu"'),
      "FlowEdge deve importar FloatingMenu"
    );
    assert.ok(src.includes("<FloatingMenu"), "FlowEdge deve renderizar <FloatingMenu");
    assert.ok(src.includes("anchorRef={menuAnchor}"), "Deve usar menuAnchor virtual");
  });

  test("4. Canvas.tsx: menus de contexto de nós e do canvas utilizam FloatingMenu", () => {
    const canvasPath = path.resolve(__dirname, "../src/features/designer/Canvas.tsx");
    assert.ok(fs.existsSync(canvasPath));
    const src = fs.readFileSync(canvasPath, "utf-8");

    assert.ok(
      src.includes('import { FloatingMenu } from "../../components/common/FloatingMenu"'),
      "Canvas deve importar FloatingMenu"
    );
    assert.ok(src.includes("anchorRef={nodeAnchor}"), "Deve ancorar menu de nó em nodeAnchor");
    assert.ok(src.includes("anchorRef={paneAnchor}"), "Deve ancorar menu de fundo em paneAnchor");
  });

  test("5. ConnectionManager.tsx: dropdown de quick add utiliza FloatingMenu", () => {
    const connPath = path.resolve(__dirname, "../src/features/connections/ConnectionManager.tsx");
    assert.ok(fs.existsSync(connPath));
    const src = fs.readFileSync(connPath, "utf-8");

    assert.ok(
      src.includes('import { FloatingMenu } from "../../components/common/FloatingMenu"'),
      "ConnectionManager deve importar FloatingMenu"
    );
    assert.ok(src.includes("<FloatingMenu"), "ConnectionManager deve renderizar <FloatingMenu");
    assert.ok(src.includes("anchorRef={quickAddBtnRef}"), "Deve ancorar em quickAddBtnRef");
  });

  test("6. JobRepository.tsx: menu de contexto de pastas e jobs utiliza FloatingMenu", () => {
    const repoPath = path.resolve(__dirname, "../src/features/repository/JobRepository.tsx");
    assert.ok(fs.existsSync(repoPath));
    const src = fs.readFileSync(repoPath, "utf-8");

    assert.ok(
      src.includes('import { FloatingMenu } from "../../components/common/FloatingMenu"'),
      "JobRepository deve importar FloatingMenu"
    );
    assert.ok(src.includes("<FloatingMenu"), "JobRepository deve renderizar <FloatingMenu");
    assert.ok(src.includes("anchorRef={contextMenuAnchor}"), "Deve ancorar em contextMenuAnchor");
  });
});
