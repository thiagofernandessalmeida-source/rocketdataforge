import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { cloneNodes } from "../src/features/designer/utils/nodeCloneUtils.ts";

describe("TAREFA 3: Clonagem Profunda, Menu de Contexto e Integridade de IDs", () => {
  const originalNodes = [
    {
      id: "postgres_source_1",
      position: { x: 100, y: 100 },
      data: {
        label: "Clientes BRM",
        componentType: "core.database.source.postgres",
        config: { host: "db.local", query: "SELECT * FROM users", deepObj: { nested: "original" } },
      },
    },
    {
      id: "data_mapper_1",
      position: { x: 300, y: 100 },
      data: {
        label: "Mapeamento tMap",
        componentType: "core.data_mapper",
        config: {
          main_input_id: "postgres_source_1",
          lookups: [
            { node_id: "postgres_source_1", alias: "row1" },
            { node_id: "external_node_999", alias: "dangling" }, // Deve ser limpo!
          ],
        },
      },
    },
  ];

  const originalEdges = [
    {
      id: "edge_1_to_2",
      source: "postgres_source_1",
      target: "data_mapper_1",
      data: { flowName: "main" },
    },
    {
      id: "edge_external",
      source: "postgres_source_1",
      target: "external_sink_999", // Não deve ser copiada
      data: { flowName: "out" },
    },
  ];

  const originalSchemas = {
    postgres_source_1: [{ name: "id", type: "Integer" }, { name: "nome", type: "String" }],
    data_mapper_1: [{ name: "id", type: "Integer" }],
  };

  test("1. Alterar campo aninhado do clone não altera o original nem o objeto de origem", () => {
    const existingNodes = [...originalNodes];
    const clone1 = cloneNodes(originalNodes, originalEdges, {
      targetCellId: "canvas-cell-01",
      existingNodes,
      sourceNodeSchemas: originalSchemas,
    });

    // Modifica o campo aninhado no clone
    clone1.clonedNodes[0].data.config.deepObj.nested = "MODIFICADO";
    clone1.clonedNodes[0].data.label = "Novo Label";

    // O original deve permanecer intacto
    assert.equal(originalNodes[0].data.config.deepObj.nested, "original");
    assert.equal(originalNodes[0].data.label, "Clientes BRM");
  });

  test("2. Colar/Clonar duas vezes gera objetos e IDs totalmente independentes", () => {
    const existingNodes = [...originalNodes];
    const clone1 = cloneNodes(originalNodes, originalEdges, {
      targetCellId: "canvas-cell-01",
      existingNodes,
      sourceNodeSchemas: originalSchemas,
    });

    const existingPlusClone1 = [...existingNodes, ...clone1.clonedNodes];
    const clone2 = cloneNodes(originalNodes, originalEdges, {
      targetCellId: "canvas-cell-01",
      existingNodes: existingPlusClone1,
      sourceNodeSchemas: originalSchemas,
    });

    const idClone1 = clone1.clonedNodes[0].id;
    const idClone2 = clone2.clonedNodes[0].id;

    assert.notEqual(idClone1, idClone2, "Clone 1 e Clone 2 devem possuir IDs distintos");
    assert.notEqual(idClone1, originalNodes[0].id);
    assert.notEqual(idClone2, originalNodes[0].id);

    // Modificação em clone1 não afeta clone2
    clone1.clonedNodes[0].data.config.host = "host1.local";
    clone2.clonedNodes[0].data.config.host = "host2.local";
    assert.equal(clone1.clonedNodes[0].data.config.host, "host1.local");
    assert.equal(clone2.clonedNodes[0].data.config.host, "host2.local");
  });

  test("3. Arestas copiadas ligam apenas os nós novos correspondentes", () => {
    const existingNodes = [...originalNodes];
    const clone = cloneNodes(originalNodes, originalEdges, {
      targetCellId: "canvas-cell-01",
      existingNodes,
      sourceNodeSchemas: originalSchemas,
    });

    // Apenas a aresta interna edge_1_to_2 deve ter sido clonada (edge_external excluída)
    assert.equal(clone.clonedEdges.length, 1);
    const clonedEdge = clone.clonedEdges[0];

    const newSourceId = clone.idMap["postgres_source_1"];
    const newTargetId = clone.idMap["data_mapper_1"];

    assert.equal(clonedEdge.source, newSourceId);
    assert.equal(clonedEdge.target, newTargetId);
  });

  test("4. tMap colado limpa referências a nós que não estão no conjunto copiado", () => {
    const existingNodes = [...originalNodes];
    const clone = cloneNodes(originalNodes, originalEdges, {
      targetCellId: "canvas-cell-01",
      existingNodes,
      sourceNodeSchemas: originalSchemas,
    });

    const clonedTMap = clone.clonedNodes.find((n) => n.data.componentType === "core.data_mapper");
    assert.ok(clonedTMap, "tMap deve estar presente nos nós clonados");

    // main_input_id foi remapeado para o novo ID do postgres_source
    const newSourceId = clone.idMap["postgres_source_1"];
    assert.equal(clonedTMap.data.config.main_input_id, newSourceId);

    // O lookup dangling (external_node_999) foi removido
    assert.equal(clonedTMap.data.config.lookups.length, 1);
    assert.equal(clonedTMap.data.config.lookups[0].node_id, newSourceId);
  });

  test("5. Schemas das colunas são profundamente copiados para os novos IDs de nó", () => {
    const existingNodes = [...originalNodes];
    const clone = cloneNodes(originalNodes, originalEdges, {
      targetCellId: "canvas-cell-01",
      existingNodes,
      sourceNodeSchemas: originalSchemas,
    });

    const newSourceId = clone.idMap["postgres_source_1"];
    assert.ok(clone.clonedSchemas[newSourceId], "Schema deve existir para o novo nó");
    assert.equal(clone.clonedSchemas[newSourceId].length, 2);

    // Modificação no schema clonado não altera o schema original
    clone.clonedSchemas[newSourceId][0].name = "coluna_alterada";
    assert.equal(originalSchemas.postgres_source_1[0].name, "id");
  });
});
