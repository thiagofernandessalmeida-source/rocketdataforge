import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Tarefa 4: Preservação de chaves do lookup e prevenção de produto cartesiano", () => {
  const tmapModalPath = path.resolve(__dirname, "../src/features/designer/TMapModal.tsx");
  const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");

  test("1: deriveTMapLookups sincroniza e preserva join_keys, left_keys, right_keys e allow_cross_join", async () => {
    const { deriveTMapLookups } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const upstreamNodes = [
      { id: "main1", label: "Main Flow", alias: "row1", schema: [{ name: "cd_pessoa", type: "Integer" }] },
      { id: "lkp_node_1", label: "Oracle - O02", alias: "lkp1", schema: [{ name: "CD_PESSOA", type: "Integer" }] },
    ];

    // Simula lookup salvo com chaves configuradas
    const savedLookups = [
      {
        node_id: "lkp_node_1",
        label: "Oracle - O02",
        alias: "lkp1",
        match_model: "unique",
        left_keys: ["main1.cd_pessoa"],
        right_keys: ["CD_PESSOA"],
        join_keys: [{ expr_key: "main1.cd_pessoa", column: "CD_PESSOA" }],
        allow_cross_join: false,
      },
    ];

    const result = deriveTMapLookups(upstreamNodes, savedLookups, {}, "main1");
    assert.equal(result.lookups.length, 1);
    const lk = result.lookups[0];
    assert.equal(lk.node_id, "lkp_node_1");
    assert.equal(lk.match_model, "unique");
    assert.equal(lk.join_keys?.[0]?.expr_key, "main1.cd_pessoa");
    assert.equal(lk.join_keys?.[0]?.column, "CD_PESSOA");
    assert.equal(lk.left_keys?.[0], "main1.cd_pessoa");
    assert.equal(lk.right_keys?.[0], "CD_PESSOA");
    assert.equal(lk.allow_cross_join, false);
  });

  test("2: deriveTMapLookups recupera join_keys quando apenas left_keys/right_keys foram persistidos", async () => {
    const { deriveTMapLookups } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const upstreamNodes = [
      { id: "main1", label: "Main Flow", alias: "row1", schema: [{ name: "id", type: "Integer" }] },
      { id: "lkp_node_1", label: "Lookup", alias: "lkp1", schema: [{ name: "id", type: "Integer" }] },
    ];

    const savedLookups = [
      {
        node_id: "lkp_node_1",
        label: "Lookup",
        alias: "lkp1",
        left_keys: ["row1.id"],
        right_keys: ["id"],
        // join_keys com placeholder vazio não deve descartar left_keys/right_keys válidos
        join_keys: [{ expr_key: "", column: "" }],
      },
    ];

    const result = deriveTMapLookups(upstreamNodes, savedLookups, {}, "main1");
    const lk = result.lookups[0];
    assert.equal(lk.join_keys?.[0]?.expr_key, "row1.id");
    assert.equal(lk.join_keys?.[0]?.column, "id");
  });

  test("3: jobStore.ts remapeia node_id de lookups no cloneNodes ao duplicar células", () => {
    const content = fs.readFileSync(jobStorePath, "utf-8");

    // Verifica que cloneNodes remapeia node_id do lookup para o novo ID clonado
    assert.ok(
      content.includes("node_id: idMap[lk.node_id] || lk.node_id"),
      "cloneNodes deve remapear node_id dos lookups com idMap"
    );

    // Verifica que deleteEdge não apaga cfg.lookups
    assert.ok(
      !content.includes("cfg.lookups = cfg.lookups.filter((lk: any) => lk.node_id !== deletedEdge.source);"),
      "deleteEdge não deve deletar lookup de cfg.lookups"
    );
  });

  test("4: TMapModal.tsx exibe aviso de produto cartesiano e valida botão Aplicar", () => {
    const content = fs.readFileSync(tmapModalPath, "utf-8");

    assert.ok(
      content.includes("Sem chave de junção: todas as linhas do main serão combinadas com todas as linhas do lookup"),
      "Deve exibir mensagem de alerta para lookup sem chave"
    );
    assert.ok(
      content.includes("Permitir produto cartesiano"),
      "Deve conter checkbox 'Permitir produto cartesiano'"
    );
    assert.ok(
      content.includes("Aviso: Match Model está como") && content.includes("All matches"),
      "Deve conter aviso quando Match Model for All matches com chave não-única"
    );
  });
});
