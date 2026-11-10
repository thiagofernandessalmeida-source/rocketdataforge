import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Fase 2: Data Masking & Proteção de Dados (UI)", () => {
  test("T-2.4: jobStore.ts deve definir campos de mascaramento na interface SchemaColumn", () => {
    const jobStoreFile = path.resolve(__dirname, "../src/store/jobStore.ts");
    const content = fs.readFileSync(jobStoreFile, "utf-8");

    assert.ok(content.includes("masking?: string;"), "SchemaColumn deve ter campo masking opcional");
    assert.ok(content.includes("maskingSalt?: string;"), "SchemaColumn deve ter campo maskingSalt opcional");
  });

  test("T-2.4: SchemaEditor.tsx deve exportar MASKING_OPTIONS com regras de Hash, Email, CPF/CNPJ, Null e Redact", () => {
    const schemaFile = path.resolve(__dirname, "../src/features/designer/SchemaEditor.tsx");
    const content = fs.readFileSync(schemaFile, "utf-8");

    assert.ok(content.includes("MASKING_OPTIONS"), "SchemaEditor deve definir MASKING_OPTIONS");
    assert.ok(content.includes("MASK_HASH"), "Deve suportar MASK_HASH");
    assert.ok(content.includes("MASK_EMAIL"), "Deve suportar MASK_EMAIL");
    assert.ok(content.includes("MASK_CPF_CNPJ"), "Deve suportar MASK_CPF_CNPJ");
    assert.ok(content.includes("MASK_NULL"), "Deve suportar MASK_NULL");
    assert.ok(content.includes("MASK_REDACT"), "Deve suportar MASK_REDACT");
  });

  test("T-2.4: SchemaEditor.tsx deve renderizar seletor de máscara, salt e badge visual de proteção", () => {
    const schemaFile = path.resolve(__dirname, "../src/features/designer/SchemaEditor.tsx");
    const content = fs.readFileSync(schemaFile, "utf-8");

    assert.ok(content.includes("masking-select"), "Deve conter select com classe masking-select");
    assert.ok(content.includes("masking-salt-input"), "Deve conter input com classe masking-salt-input");
    assert.ok(content.includes("schema-mask-badge"), "Deve conter badge visual schema-mask-badge");
    assert.ok(content.includes("Proteção LGPD"), "Deve exibir rótulo de Proteção LGPD");
  });

  test("T-2.4: schemaClipboard.ts deve persistir masking e maskingSalt na serialização", () => {
    const clipboardFile = path.resolve(__dirname, "../src/utils/schemaClipboard.ts");
    const content = fs.readFileSync(clipboardFile, "utf-8");

    assert.ok(content.includes("masking: c.masking"), "serializeSchemaColumns deve serializar masking");
    assert.ok(content.includes("maskingSalt: c.maskingSalt"), "serializeSchemaColumns deve serializar maskingSalt");
  });
});
