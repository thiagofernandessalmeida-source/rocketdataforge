import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Tarefa 2: Frontend Advanced Settings com Field Options e Validação DML", () => {
  const utilsPath = path.resolve(__dirname, "../src/features/designer/utils/fieldOptionsUtils.ts");
  const advancedTabPath = path.resolve(__dirname, "../src/features/designer/AdvancedSettingsTab.tsx");
  const propPanelPath = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
  const cellCardPath = path.resolve(__dirname, "../src/features/designer/cells/CanvasCellCard.tsx");
  const componentsPath = path.resolve(__dirname, "../src/catalog/components.ts");

  test("1: syncFieldOptionsWithSchema sincroniza colunas mantendo ordem, estado existente e padrões novos", async () => {
    const { syncFieldOptionsWithSchema } = await import("../src/features/designer/utils/fieldOptionsUtils.ts");

    const initialSchema = [
      { name: "id", isPrimaryKey: true },
      { name: "nome", isPrimaryKey: false },
      { name: "email", isPrimaryKey: false },
    ];

    // Primeira sincronização (sem field options prévias)
    const fo1 = syncFieldOptionsWithSchema(undefined, initialSchema);
    assert.equal(fo1.length, 3);
    assert.deepEqual(fo1.map((f) => f.column), ["id", "nome", "email"]);
    assert.equal(fo1[0].update_key, false);
    assert.equal(fo1[0].updatable, true);
    assert.equal(fo1[0].insertable, true);

    // Usuário personaliza algumas colunas
    fo1[0].update_key = true;
    fo1[0].updatable = false; // chave não entra no SET
    fo1[1].updatable = true;
    fo1[2].insertable = false;

    // Schema ganha nova coluna 'telefone', perde 'email' e inverte a ordem
    const updatedSchema = [
      { name: "nome", isPrimaryKey: false },
      { name: "telefone", isPrimaryKey: false },
      { name: "id", isPrimaryKey: true },
    ];

    const fo2 = syncFieldOptionsWithSchema(fo1, updatedSchema);
    assert.equal(fo2.length, 3);
    assert.deepEqual(fo2.map((f) => f.column), ["nome", "telefone", "id"]);

    // 'nome' preservou estado
    const nomeOpt = fo2.find((f) => f.column === "nome");
    assert.equal(nomeOpt.update_key, false);
    assert.equal(nomeOpt.updatable, true);

    // 'id' preservou update_key = true e updatable = false
    const idOpt = fo2.find((f) => f.column === "id");
    assert.equal(idOpt.update_key, true);
    assert.equal(idOpt.updatable, false);

    // 'telefone' (novo) recebeu padrões: update_key: false, updatable: true, insertable: true
    const telOpt = fo2.find((f) => f.column === "telefone");
    assert.equal(telOpt.update_key, false);
    assert.equal(telOpt.deletion_key, false);
    assert.equal(telOpt.updatable, true);
    assert.equal(telOpt.insertable, true);

    // 'email' foi removido
    assert.equal(fo2.some((f) => f.column === "email"), false);
  });

  test("2: validateSinkKeys valida regras de Update Key e Deletion Key corretamente", async () => {
    const { validateSinkKeys } = await import("../src/features/designer/utils/fieldOptionsUtils.ts");

    // Insert nunca exige chave
    const resInsert = validateSinkKeys("insert", false, [], [], []);
    assert.equal(resInsert.isValid, true);
    assert.equal(resInsert.missingKeyType, null);

    // Update sem use_field_options e sem PK no schema e sem keys -> inválido
    const resUpdateNoKey = validateSinkKeys("update", false, [], [{ name: "id" }], []);
    assert.equal(resUpdateNoKey.isValid, false);
    assert.equal(resUpdateNoKey.missingKeyType, "update");
    assert.ok(resUpdateNoKey.warningMessage);

    // Update sem use_field_options mas com PK no schema -> válido
    const resUpdatePk = validateSinkKeys("update", false, [], [{ name: "id", isPrimaryKey: true }], []);
    assert.equal(resUpdatePk.isValid, true);

    // Update com use_field_options: true mas sem update_key marcada -> inválido
    const foNoKey = [
      { column: "id", update_key: false, deletion_key: false, updatable: true, insertable: true },
    ];
    const resUpdateFoNoKey = validateSinkKeys("update", true, foNoKey, [{ name: "id", isPrimaryKey: true }], []);
    assert.equal(resUpdateFoNoKey.isValid, false);
    assert.equal(resUpdateFoNoKey.missingKeyType, "update");

    // Update com use_field_options: true e update_key marcada -> válido
    const foWithKey = [
      { column: "id", update_key: true, deletion_key: false, updatable: false, insertable: true },
    ];
    const resUpdateFoWithKey = validateSinkKeys("update", true, foWithKey, [], []);
    assert.equal(resUpdateFoWithKey.isValid, true);

    // Delete sem deletion_key -> inválido
    const resDeleteNoKey = validateSinkKeys("delete", true, foWithKey, [], []);
    assert.equal(resDeleteNoKey.isValid, false);
    assert.equal(resDeleteNoKey.missingKeyType, "delete");

    // Delete com deletion_key -> válido
    const foWithDelKey = [
      { column: "id", update_key: false, deletion_key: true, updatable: false, insertable: true },
    ];
    const resDeleteWithKey = validateSinkKeys("delete", true, foWithDelKey, [], []);
    assert.equal(resDeleteWithKey.isValid, true);
  });

  test("3: checkCellSinkKeys detecta nós de sink inválidos na célula", async () => {
    const { checkCellSinkKeys } = await import("../src/features/designer/utils/fieldOptionsUtils.ts");

    // Célula com sink update sem chave
    const cellInvalid = {
      nodes: [
        {
          id: "pg_sink_1",
          data: {
            label: "PostgreSQL Sink",
            componentType: "connector.db.postgresql.output",
            category: "target",
            config: { data_action: "update", use_field_options: false },
            schema: [{ name: "cd_pessoa", isPrimaryKey: false }],
          },
        },
      ],
    };
    const err = checkCellSinkKeys(cellInvalid);
    assert.ok(err);
    assert.match(err, /PostgreSQL Sink/);
    assert.match(err, /Update Key/);

    // Célula corrigida com PK no schema
    const cellValidSchemaPk = {
      nodes: [
        {
          id: "pg_sink_1",
          data: {
            label: "PostgreSQL Sink",
            componentType: "connector.db.postgresql.output",
            category: "target",
            config: { data_action: "update", use_field_options: false },
            schema: [{ name: "cd_pessoa", isPrimaryKey: true }],
          },
        },
      ],
    };
    assert.equal(checkCellSinkKeys(cellValidSchemaPk), null);

    // Célula corrigida com field_options
    const cellValidFieldOptions = {
      nodes: [
        {
          id: "pg_sink_1",
          data: {
            label: "PostgreSQL Sink",
            componentType: "connector.db.postgresql.output",
            category: "target",
            config: {
              data_action: "update",
              use_field_options: true,
              field_options: [{ column: "cd_pessoa", update_key: true, deletion_key: false, updatable: false, insertable: true }],
            },
            schema: [{ name: "cd_pessoa", isPrimaryKey: false }],
          },
        },
      ],
    };
    assert.equal(checkCellSinkKeys(cellValidFieldOptions), null);
  });

  test("4: Arquivos frontend existem e possuem os elementos da Tarefa 2", () => {
    assert.ok(fs.existsSync(utilsPath), "fieldOptionsUtils.ts deve existir");
    assert.ok(fs.existsSync(advancedTabPath), "AdvancedSettingsTab.tsx deve existir");

    const advancedSrc = fs.readFileSync(advancedTabPath, "utf-8");
    assert.ok(advancedSrc.includes("use_field_options"), "Deve conter switch use_field_options");
    assert.ok(advancedSrc.includes("Update Key"), "Deve conter cabeçalho Update Key");
    assert.ok(advancedSrc.includes("Deletion Key"), "Deve conter cabeçalho Deletion Key");
    assert.ok(advancedSrc.includes("Updatable"), "Deve conter cabeçalho Updatable");
    assert.ok(advancedSrc.includes("Insertable"), "Deve conter cabeçalho Insertable");
    assert.ok(advancedSrc.includes("use_batch_mode"), "Deve conter controle de batch mode movido");
    assert.ok(advancedSrc.includes("batch_size"), "Deve conter controle de batch size movido");
    assert.ok(advancedSrc.includes("fail_on_no_match"), "Deve conter fail_on_no_match");

    const propPanelSrc = fs.readFileSync(propPanelPath, "utf-8");
    assert.ok(propPanelSrc.includes("AdvancedSettingsTab"), "PropertyPanel deve importar e usar AdvancedSettingsTab");
    assert.ok(propPanelSrc.includes("Configurações avançadas"), "PropertyPanel deve conter aba Configurações avançadas");
    assert.ok(propPanelSrc.includes("Esta ação requer ao menos uma chave definida nas Configurações avançadas."), "PropertyPanel deve conter o aviso amarelo");
    assert.ok(propPanelSrc.includes("Marcar chave primária do schema como Update Key"), "PropertyPanel deve conter o botão de atalho");

    const cellCardSrc = fs.readFileSync(cellCardPath, "utf-8");
    assert.ok(cellCardSrc.includes("checkCellSinkKeys"), "CanvasCellCard deve importar checkCellSinkKeys");
    assert.ok(cellCardSrc.includes("sinkKeyValidationError"), "CanvasCellCard deve calcular sinkKeyValidationError");
    assert.ok(cellCardSrc.includes("isRunCellDisabled"), "CanvasCellCard deve desabilitar o botão com isRunCellDisabled");

    const compSrc = fs.readFileSync(componentsPath, "utf-8");
    assert.ok(compSrc.includes("use_field_options: \"boolean\""), "components.ts deve registrar use_field_options");
    assert.ok(compSrc.includes("field_options: \"array\""), "components.ts deve registrar field_options");
    assert.ok(compSrc.includes("fail_on_no_match: \"boolean\""), "components.ts deve registrar fail_on_no_match");
  });
});
