import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Tarefa 5: Resolução robusta da Entrada Principal (main_input_id)", () => {
  test("1: getMainInputNode retorna o nó correto quando mainInputId é válido e conectado", async () => {
    const { getMainInputNode } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const upstreamNodes = [
      { id: "postgres_source_3", label: "Postgres", alias: "row1" },
      { id: "oracle_source_1", label: "Oracle", alias: "row2" },
    ];

    const result = getMainInputNode(upstreamNodes, "postgres_source_3", [], ["oracle_source_1"]);
    assert.equal(result?.id, "postgres_source_3");
  });

  test("2: getMainInputNode ignora nó inexistente e seleciona o nó ligado à porta 'main'", async () => {
    const { getMainInputNode } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const upstreamNodes = [
      { id: "postgres_source_3", label: "Postgres", alias: "row1" },
      { id: "oracle_source_1", label: "Oracle", alias: "row2" },
    ];

    const incomingEdges = [
      { source: "oracle_source_1", targetHandle: "lookup" },
      { source: "postgres_source_3", targetHandle: "main" },
    ];

    // mainInputId aponta para nó inexistente "csv_source_1"
    const result = getMainInputNode(upstreamNodes, "csv_source_1", incomingEdges, ["oracle_source_1"]);
    assert.equal(result?.id, "postgres_source_3", "Deve resolver para postgres_source_3 que está na porta main");
  });

  test("3: getMainInputNode ignora nó configurado como lookup e seleciona o fluxo principal", async () => {
    const { getMainInputNode } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const upstreamNodes = [
      { id: "oracle_source_1", label: "Oracle", alias: "row2" },
      { id: "postgres_source_3", label: "Postgres", alias: "row1" },
    ];

    // mainInputId aponta erroneamente para o lookup oracle_source_1
    const result = getMainInputNode(upstreamNodes, "oracle_source_1", [], ["oracle_source_1"]);
    assert.equal(result?.id, "postgres_source_3", "Deve selecionar postgres_source_3 que não é lookup");
  });

  test("4: getMainInputNode fallback para primeiro não-lookup quando não há mainInputId", async () => {
    const { getMainInputNode } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const upstreamNodes = [
      { id: "lkp_source_1", label: "Lookup 1", alias: "row2" },
      { id: "main_source_1", label: "Main Real", alias: "row1" },
    ];

    const result = getMainInputNode(upstreamNodes, undefined, [], ["lkp_source_1"]);
    assert.equal(result?.id, "main_source_1", "Deve ignorar lkp_source_1 e escolher main_source_1");
  });
});
