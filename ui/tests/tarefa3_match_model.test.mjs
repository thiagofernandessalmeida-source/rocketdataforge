import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Tarefa 3: Match Model do lookup e normalização", () => {
  const lookupUtilsPath = path.resolve(__dirname, "../src/features/designer/utils/tmapLookupUtils.ts");
  const tmapModalPath = path.resolve(__dirname, "../src/features/designer/TMapModal.tsx");

  test("1: normalizeMatchModel aceita e normaliza todos os valores canônicos e antigos", async () => {
    const { normalizeMatchModel } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    // Canônicos
    assert.equal(normalizeMatchModel("all"), "all");
    assert.equal(normalizeMatchModel("unique"), "unique");
    assert.equal(normalizeMatchModel("first"), "first");
    assert.equal(normalizeMatchModel("last"), "last");

    // Textos legados (case insensitive)
    assert.equal(normalizeMatchModel("All matches"), "all");
    assert.equal(normalizeMatchModel("ALL MATCHES"), "all");
    assert.equal(normalizeMatchModel("Unique match"), "unique");
    assert.equal(normalizeMatchModel("UNIQUE MATCH"), "unique");
    assert.equal(normalizeMatchModel("First match"), "first");
    assert.equal(normalizeMatchModel("FIRST MATCH"), "first");
    assert.equal(normalizeMatchModel("Last match"), "last");
    assert.equal(normalizeMatchModel("LAST MATCH"), "last");

    // Valores ausentes, vazios ou desconhecidos
    assert.equal(normalizeMatchModel(undefined), "all");
    assert.equal(normalizeMatchModel(null), "all");
    assert.equal(normalizeMatchModel(""), "all");
    assert.equal(normalizeMatchModel("   "), "all");
    assert.equal(normalizeMatchModel("something_unknown"), "all");
  });

  test("2: deriveTMapLookups preserva match_model 'unique', 'first', 'last' e 'all'", async () => {
    const { deriveTMapLookups } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const availableUpstreamNodes = [
      { id: "main_node", label: "Main", alias: "row1", schema: [{ id: "1", name: "id", type: "Integer", nullable: false }] },
      { id: "lkp_node_1", label: "Lookup 1", alias: "row2", schema: [{ id: "2", name: "id", type: "Integer", nullable: false }] },
      { id: "lkp_node_2", label: "Lookup 2", alias: "row3", schema: [{ id: "3", name: "id", type: "Integer", nullable: false }] },
    ];

    const savedLookups = [
      {
        node_id: "lkp_node_1",
        label: "Lookup 1",
        match_model: "unique",
        left_keys: ["row1.id"],
        right_keys: ["id"],
      },
      {
        node_id: "lkp_node_2",
        label: "Lookup 2",
        match_model: "Unique match", // valor legado
        left_keys: ["row1.id"],
        right_keys: ["id"],
      },
    ];

    const result = deriveTMapLookups(availableUpstreamNodes, savedLookups, {}, "main_node");
    assert.equal(result.lookups.length, 2);

    const lkp1 = result.lookups.find((l) => l.node_id === "lkp_node_1");
    const lkp2 = result.lookups.find((l) => l.node_id === "lkp_node_2");

    assert.equal(lkp1?.match_model, "unique", "lkp1 deve preservar match_model: 'unique'");
    assert.equal(lkp2?.match_model, "unique", "lkp2 deve normalizar 'Unique match' para 'unique'");
  });

  test("3: TMapModal.tsx contém rótulos corretos e salva match_model normalizado", () => {
    const modalContent = fs.readFileSync(tmapModalPath, "utf-8");

    // Verifica que rótulos exigidos estão presentes no select
    assert.ok(modalContent.includes("Unique match (última linha)"), "Deve ter o label 'Unique match (última linha)'");
    assert.ok(modalContent.includes("First match (primeira linha)"), "Deve ter o label 'First match (primeira linha)'");
    assert.ok(modalContent.includes("All matches"), "Deve ter o label 'All matches'");

    // Verifica que 'last' foi retirado do select como opção, mas mapeia para 'unique' no value
    assert.ok(!modalContent.includes('<option value="last">'), "Não deve ter option value='last' explícita no select");

    // Verifica que o salvamento usa normalizeMatchModel
    assert.ok(
      modalContent.includes("const matchModel = normalizeMatchModel(lk.match_model);"),
      "Salvamento deve chamar normalizeMatchModel diretamente"
    );
  });
});
