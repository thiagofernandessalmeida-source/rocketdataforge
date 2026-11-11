import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("FASE 1: Lookups do tMap (ui/src/features/designer/TMapModal.tsx)", () => {
  const tmapModalPath = path.resolve(__dirname, "../src/features/designer/TMapModal.tsx");
  const appPath = path.resolve(__dirname, "../src/App.tsx");
  const propPanelPath = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
  const lookupUtilsPath = path.resolve(__dirname, "../src/features/designer/utils/tmapLookupUtils.ts");

  test("1.4: App.tsx e PropertyPanel.tsx devem usar main_input_id explicitamente", () => {
    const appContent = fs.readFileSync(appPath, "utf-8");
    const propContent = fs.readFileSync(propPanelPath, "utf-8");

    assert.ok(
      appContent.includes("main_input_id"),
      "App.tsx deve ler main_input_id da configuração do tMap"
    );
    assert.ok(
      propContent.includes("main_input_id"),
      "PropertyPanel.tsx deve ler main_input_id da configuração do tMap"
    );
  });

  test("1.1 e 1.5(a): config com 1 lookup salvo + 2º nó conectado => 2 cards derivados", async () => {
    assert.ok(fs.existsSync(lookupUtilsPath), "tmapLookupUtils.ts deve existir");
    const { deriveTMapLookups } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const availableUpstreamNodes = [
      { id: "node_main", label: "Clientes", alias: "row1", schema: [{ name: "id", type: "Integer" }] },
      { id: "node_lkp1", label: "Cidades", alias: "row2", schema: [{ name: "city_id", type: "Integer" }] },
      { id: "node_lkp2", label: "Estados", alias: "row3", schema: [{ name: "state_id", type: "Integer" }] },
    ];

    const savedLookups = [
      {
        node_id: "node_lkp1",
        label: "Cidades",
        alias: "lkp_cidades",
        join_type: "inner",
        join_keys: [{ expr_key: "row1.city_id", column: "city_id" }],
      },
    ];

    const result = deriveTMapLookups(availableUpstreamNodes, savedLookups, {}, "node_main");

    // Deve resultar em 2 lookups (node_lkp1 e node_lkp2), pois node_main é o main
    assert.equal(result.lookups.length, 2, "Deve retornar exatamente 2 lookups");

    // Preserva configurações salvas do node_lkp1
    const lkp1 = result.lookups.find((l) => l.node_id === "node_lkp1");
    assert.ok(lkp1, "node_lkp1 deve estar presente");
    assert.equal(lkp1.alias, "lkp_cidades");
    assert.equal(lkp1.join_type, "inner");
    assert.equal(lkp1.join_keys[0].expr_key, "row1.city_id");

    // Cria card para o novo nó conectado node_lkp2
    const lkp2 = result.lookups.find((l) => l.node_id === "node_lkp2");
    assert.ok(lkp2, "node_lkp2 deve ser derivado da nova conexão");
    assert.equal(lkp2.node_id, "node_lkp2");
  });

  test("1.3 e 1.5(b): schema salvo vazio + schema ao vivo preenchido => colunas aparecem", async () => {
    const { getLookupEffectiveSchema } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const liveSchema = [
      { name: "id", type: "Integer", nullable: false },
      { name: "nome", type: "String", nullable: true },
    ];

    const lookupWithEmptySchema = {
      node_id: "node_lkp1",
      schema: [], // Salvo vazio (cache vazio)
    };

    const connectedNode = {
      id: "node_lkp1",
      label: "Fornecedores",
      schema: liveSchema,
    };

    const effective = getLookupEffectiveSchema(lookupWithEmptySchema, connectedNode, {});
    assert.equal(effective.length, 2, "Schema efetivo deve ter as 2 colunas do nó conectado");
    assert.equal(effective[0].name, "id");
    assert.equal(effective[1].name, "nome");
  });

  test("1.2 e 1.5(c): lookup removido da conexão => gera aviso de nó ausente sem card sem dados", async () => {
    const { deriveTMapLookups } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    // Apenas o main está conectado agora (o nó do lookup foi deletado do canvas)
    const availableUpstreamNodes = [
      { id: "node_main", label: "Clientes", alias: "row1", schema: [] },
    ];

    const savedLookups = [
      {
        node_id: "node_deleted",
        alias: "lkp_antigo",
        label: "Antigo",
      },
    ];

    const result = deriveTMapLookups(availableUpstreamNodes, savedLookups, {}, "node_main");

    // Não deve criar card ativo sem dados para nó desconectado
    assert.equal(result.lookups.length, 0, "Lookups ativos devem ser 0 pois não há nós conectados além do main");
    // Deve reportar aviso visível sobre a desconexão
    assert.ok(result.disconnectedWarnings.length > 0, "Deve conter aviso sobre lookup desconectado");
    assert.ok(
      result.disconnectedWarnings[0].includes("lkp_antigo") ||
      result.disconnectedWarnings[0].includes("node_deleted"),
      "Aviso deve mencionar o lookup ausente"
    );
  });

  test("1.2 e 1.5(d): dois lookups nunca compartilham node_id falso", async () => {
    const { deriveTMapLookups } = await import("../src/features/designer/utils/tmapLookupUtils.ts");

    const availableUpstreamNodes = [
      { id: "main_id", label: "Main" },
      { id: "lkp_a", label: "LKP A" },
      { id: "lkp_b", label: "LKP B" },
    ];

    const result = deriveTMapLookups(availableUpstreamNodes, [], {}, "main_id");
    const nodeIds = result.lookups.map((l) => l.node_id);
    const uniqueIds = new Set(nodeIds);

    assert.equal(nodeIds.length, uniqueIds.size, "Todos os lookups devem ter node_id único");
    assert.ok(!nodeIds.includes("row2"), "node_id deve ser o ID real do nó conectado, não 'row2'");
    assert.ok(!nodeIds.includes("row3"), "node_id deve ser o ID real do nó conectado, não 'row3'");
  });

  test("1.2: TMapModal.tsx não deve gerar node_id falso 'row'+N em handleAddLookup", () => {
    const content = fs.readFileSync(tmapModalPath, "utf-8");
    assert.ok(
      !content.includes('node_id: `row${count'),
      "TMapModal não deve gerar node_id no formato fake row${count+1}"
    );
  });
});

