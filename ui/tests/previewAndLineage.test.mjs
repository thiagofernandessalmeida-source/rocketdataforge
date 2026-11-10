import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Fase 4: Live Preview & Column Lineage Visual (UI)", () => {
  test("T-4.1: Canvas.tsx deve possuir menu de contexto com 'Executar até este nó' (Run to this node)", () => {
    const canvasFile = path.resolve(__dirname, "../src/features/designer/Canvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");

    assert.ok(content.includes("onNodeContextMenu"), "ReactFlow deve tratar onNodeContextMenu");
    assert.ok(content.includes("rdf-node-context-menu"), "Deve conter container rdf-node-context-menu");
    assert.ok(content.includes("Executar até este nó"), "Menu deve ter opção 'Executar até este nó'");
    assert.ok(content.includes("executePartial"), "Deve chamar api.executePartial ao acionar execução parcial");
  });

  test("T-4.2: Componente DataPreviewDrawer.tsx deve existir com paginação, portas e busca", () => {
    const drawerFile = path.resolve(__dirname, "../src/features/designer/preview/DataPreviewDrawer.tsx");
    assert.ok(fs.existsSync(drawerFile), "DataPreviewDrawer.tsx deve existir");

    const content = fs.readFileSync(drawerFile, "utf-8");
    assert.ok(content.includes("rdf-preview-drawer"), "Deve conter classe rdf-preview-drawer");
    assert.ok(content.includes("availablePorts") || content.includes("btn-port-tab"), "Deve ter seletor de portas");
    assert.ok(content.includes("pageSize"), "Deve permitir seleção de page size");
    assert.ok(content.includes("searchTerm") || content.includes("Filtrar"), "Deve ter busca rápida");
    assert.ok(content.includes("handleSort"), "Deve suportar ordenação por coluna");
    assert.ok(content.includes("api.getNodePreview"), "Deve consultar api.getNodePreview");
  });

  test("T-4.3: Destaque visual de arestas/nós no Canvas e botão de linhagem no SchemaEditor", () => {
    const canvasFile = path.resolve(__dirname, "../src/features/designer/Canvas.tsx");
    const canvasContent = fs.readFileSync(canvasFile, "utf-8");

    assert.ok(canvasContent.includes("highlightedLineage"), "Canvas deve gerenciar estado de linhagem destacada");
    assert.ok(canvasContent.includes("lineage-highlight-badge"), "Deve exibir badge de linhagem ativa");
    assert.ok(canvasContent.includes("renderedNodes"), "Nós devem receber destaque condicional");
    assert.ok(canvasContent.includes("renderedEdges"), "Arestas devem receber destaque condicional");

    const schemaEditorFile = path.resolve(__dirname, "../src/features/designer/SchemaEditor.tsx");
    const schemaContent = fs.readFileSync(schemaEditorFile, "utf-8");
    assert.ok(schemaContent.includes("schema-lineage-btn"), "SchemaEditor deve ter botão para inspecionar linhagem");
  });

  test("T-4.3: api/client.ts e types/index.ts devem expor interfaces e endpoints de Preview e Lineage", () => {
    const typesFile = path.resolve(__dirname, "../src/types/index.ts");
    const typesContent = fs.readFileSync(typesFile, "utf-8");
    assert.ok(typesContent.includes("export interface NodePreviewData"), "types deve conter NodePreviewData");
    assert.ok(typesContent.includes("export interface ColumnLineageReport"), "types deve conter ColumnLineageReport");
    assert.ok(typesContent.includes("export interface LineageTransformationEdge"), "types deve conter LineageTransformationEdge");

    const apiFile = path.resolve(__dirname, "../src/api/client.ts");
    const apiContent = fs.readFileSync(apiFile, "utf-8");
    assert.ok(apiContent.includes("executePartial:"), "api deve exportar executePartial");
    assert.ok(apiContent.includes("getNodePreview:"), "api deve exportar getNodePreview");
    assert.ok(apiContent.includes("getColumnLineage:"), "api deve exportar getColumnLineage");
  });
});
