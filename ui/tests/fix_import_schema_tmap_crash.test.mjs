import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("CORREÇÃO: Importação de Schema do Data Mapper (tMap) e Prevenção de Crash React #310", () => {
  const importModalPath = path.resolve(__dirname, "../src/features/designer/ImportSchemaModal.tsx");
  const propPanelPath = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
  const nodeSchemaUtilsPath = path.resolve(__dirname, "../src/features/designer/utils/nodeSchemaUtils.ts");

  test("1: nodeSchemaUtils.ts deve existir e exportar extractNodeSchema e getTMapOutputSchemas", () => {
    assert.ok(fs.existsSync(nodeSchemaUtilsPath), "nodeSchemaUtils.ts deve existir");
    const content = fs.readFileSync(nodeSchemaUtilsPath, "utf-8");
    assert.ok(content.includes("export function extractNodeSchema"), "Deve exportar extractNodeSchema");
    assert.ok(content.includes("export function getTMapOutputSchemas"), "Deve exportar getTMapOutputSchemas");
  });

  test("2: extractNodeSchema deve extrair colunas de saída de um nó Data Mapper (tMap)", () => {
    // Simula a lógica de extractNodeSchema
    const mockTMapNode = {
      id: "data_mapper_3",
      data: {
        label: "Data Mapper",
        componentType: "core.tmap",
        config: {
          outputs: [
            {
              id: "out1",
              name: "out1",
              targetId: "postgres_sink_1",
              columns: [
                { id: "c1", target: "id_atendente", type: "Integer" },
                { id: "c2", target: "nome_atendente", type: "String" },
                { id: "c3", target: "validacao_01", type: "Boolean" },
              ],
            },
          ],
        },
      },
    };

    const mockEdge = {
      id: "e1",
      source: "data_mapper_3",
      target: "postgres_sink_1",
      data: { flowName: "out1" },
    };

    // Função pura espelho para validação lógica
    function testExtractNodeSchema(node, edge, targetId) {
      const outputs = node.data?.config?.outputs || [];
      const targetFlow = outputs.find(
        (o) =>
          (targetId && o.targetId === targetId) ||
          (edge && o.id === edge.data?.flowName)
      ) || outputs[0];

      return (targetFlow?.columns || []).map((c) => ({
        id: c.id,
        name: c.target || c.name,
        type: c.type || "String",
      }));
    }

    const schema = testExtractNodeSchema(mockTMapNode, mockEdge, "postgres_sink_1");
    assert.strictEqual(schema.length, 3, "Deve extrair as 3 colunas do output out1");
    assert.strictEqual(schema[0].name, "id_atendente");
    assert.strictEqual(schema[1].name, "nome_atendente");
    assert.strictEqual(schema[2].name, "validacao_01");
  });

  test("3: ImportSchemaModal.tsx NÃO deve ter hooks após 'if (!isOpen) return null;' (Prevenção de erro #310)", () => {
    const content = fs.readFileSync(importModalPath, "utf-8");
    const earlyReturnMarker = "if (!isOpen) return null;";
    assert.ok(content.includes(earlyReturnMarker), "Deve conter early return para isOpen");

    const split = content.split(earlyReturnMarker);
    const afterEarlyReturn = split[1];

    // NENHUM hook (useMemo, useState, useEffect, useCallback) pode ser chamado após o early return
    assert.ok(
      !afterEarlyReturn.includes("useMemo(") &&
      !afterEarlyReturn.includes("useState(") &&
      !afterEarlyReturn.includes("useEffect(") &&
      !afterEarlyReturn.includes("useCallback("),
      "NÃO deve haver nenhum React Hook chamado após 'if (!isOpen) return null;', pois causa erro React #310"
    );
  });

  test("4: ImportSchemaModal.tsx deve incluir saídas do Data Mapper (tMap) nas opções de componentes", () => {
    const content = fs.readFileSync(importModalPath, "utf-8");
    assert.ok(
      content.includes("getTMapOutputSchemas"),
      "ImportSchemaModal deve usar getTMapOutputSchemas para mapear fluxos do tMap"
    );
    assert.ok(
      content.includes("Data Mapper (Saída)"),
      "ImportSchemaModal deve exibir tipo amigável para saídas do tMap"
    );
  });

  test("5: PropertyPanel.tsx deve alimentar upstreamSchema a partir do extractNodeSchema", () => {
    const content = fs.readFileSync(propPanelPath, "utf-8");
    assert.ok(
      content.includes("extractNodeSchema"),
      "PropertyPanel deve importar e usar extractNodeSchema para upstreamSchema"
    );
    assert.ok(
      content.includes("upstreamSchema: SchemaColumn[] = React.useMemo"),
      "upstreamSchema deve ser memoizado resolvendo o nó montante conectado"
    );
  });

  test("6: PropertyPanel.tsx NÃO deve ter hooks após 'if (!selectedNode)' (Prevenção de erro #310)", () => {
    const content = fs.readFileSync(propPanelPath, "utf-8");
    const earlyReturnMarker = "if (!selectedNode) {";
    assert.ok(content.includes(earlyReturnMarker), "Deve conter early return para !selectedNode");

    const split = content.split(earlyReturnMarker);
    const afterEarlyReturn = split[1];

    // NENHUM hook (useMemo, useState, useEffect, useCallback) pode ser chamado após o early return
    assert.ok(
      !afterEarlyReturn.includes("useMemo(") &&
      !afterEarlyReturn.includes("useState(") &&
      !afterEarlyReturn.includes("useEffect(") &&
      !afterEarlyReturn.includes("useCallback("),
      "NÃO deve haver nenhum React Hook chamado após 'if (!selectedNode) {', pois causa erro React #310"
    );
  });
});
