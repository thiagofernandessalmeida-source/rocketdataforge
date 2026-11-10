import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── T-4.1: Teste de Cópia e Colagem de Schemas (Clipboard) ───

describe("T-4.1: Clipboard de Schemas (application/x-rdf-schema+json & TSV Fallback)", () => {
  it("serializeSchemaColumns deve gerar payload com MIME application/x-rdf-schema+json e TSV fallback", async () => {
    const { serializeSchemaColumns } = await import("../src/utils/schemaClipboard.mjs").catch(async () => {
      return await import("../src/utils/schemaClipboard.ts");
    });

    const columns = [
      { id: "col-1", name: "id", type: "Integer", nullable: false, isPrimaryKey: true },
      { id: "col-2", name: "customer_name", type: "String", nullable: true, comment: "Nome do cliente" }
    ];

    const serialized = serializeSchemaColumns(columns);

    assert.ok(serialized.json, "Deve conter representação JSON");
    assert.ok(serialized.tsv, "Deve conter representação TSV");

    const parsedJson = JSON.parse(serialized.json);
    assert.equal(parsedJson.mime, "application/x-rdf-schema+json");
    assert.equal(parsedJson.columns.length, 2);
    assert.equal(parsedJson.columns[0].name, "id");
    assert.equal(parsedJson.columns[1].name, "customer_name");

    assert.ok(serialized.tsv.includes("id\tInteger"), "TSV deve conter linha para id");
    assert.ok(serialized.tsv.includes("customer_name\tString"), "TSV deve conter linha para customer_name");
  });

  it("deserializeSchemaColumns deve gerar novos UUIDs para as colunas coladas", async () => {
    const { deserializeSchemaColumns } = await import("../src/utils/schemaClipboard.mjs").catch(async () => {
      return await import("../src/utils/schemaClipboard.ts");
    });

    const originalColumns = [
      { id: "orig-111", name: "code", type: "String", nullable: false },
      { id: "orig-222", name: "balance", type: "Decimal", nullable: true }
    ];

    const jsonPayload = JSON.stringify({
      mime: "application/x-rdf-schema+json",
      columns: originalColumns
    });

    const pasted = deserializeSchemaColumns(jsonPayload, "application/x-rdf-schema+json");

    assert.equal(pasted.length, 2);
    assert.equal(pasted[0].name, "code");
    assert.equal(pasted[1].name, "balance");

    // IDs devem ser novos (diferentes dos IDs de origem)
    assert.notEqual(pasted[0].id, "orig-111", "ID da primeira coluna colada deve ser novo");
    assert.notEqual(pasted[1].id, "orig-222", "ID da segunda coluna colada deve ser novo");
    assert.notEqual(pasted[0].id, pasted[1].id, "IDs das colunas coladas devem ser distintos entre si");
  });

  it("deserializeSchemaColumns deve suportar parsing de fallback de texto TSV", async () => {
    const { deserializeSchemaColumns } = await import("../src/utils/schemaClipboard.mjs").catch(async () => {
      return await import("../src/utils/schemaClipboard.ts");
    });

    const tsvData = "name\ttype\tnullable\tisPrimaryKey\nproduct_id\tInteger\tfalse\ttrue\nproduct_title\tString\ttrue\tfalse";

    const pasted = deserializeSchemaColumns(tsvData, "text/plain");

    assert.equal(pasted.length, 2);
    assert.equal(pasted[0].name, "product_id");
    assert.equal(pasted[0].type, "Integer");
    assert.equal(pasted[0].nullable, false);
    assert.equal(pasted[0].isPrimaryKey, true);
    assert.ok(pasted[0].id, "Coluna criada via TSV deve ter id gerado");

    assert.equal(pasted[1].name, "product_title");
    assert.equal(pasted[1].type, "String");
  });

  it("resolveSchemaCollisions deve suportar estratégias overwrite, skip e rename", async () => {
    const { resolveSchemaCollisions } = await import("../src/utils/schemaClipboard.mjs").catch(async () => {
      return await import("../src/utils/schemaClipboard.ts");
    });

    const existing = [
      { id: "e1", name: "id", type: "Integer", nullable: false },
      { id: "e2", name: "status", type: "String", nullable: true }
    ];

    const incoming = [
      { id: "i1", name: "status", type: "String", nullable: false, comment: "Updated" },
      { id: "i2", name: "email", type: "String", nullable: true }
    ];

    // 1. Overwrite: substitui existente 'status' e adiciona 'email'
    const overwritten = resolveSchemaCollisions(existing, incoming, "overwrite");
    assert.equal(overwritten.length, 3);
    const statusCol = overwritten.find(c => c.name === "status");
    assert.equal(statusCol.comment, "Updated");

    // 2. Skip: mantém 'status' existente e apenas adiciona 'email'
    const skipped = resolveSchemaCollisions(existing, incoming, "skip");
    assert.equal(skipped.length, 3);
    const skippedStatus = skipped.find(c => c.name === "status");
    assert.equal(skippedStatus.comment, undefined);

    // 3. Rename: renomeia o incoming 'status' para 'status_1'
    const renamed = resolveSchemaCollisions(existing, incoming, "rename");
    assert.equal(renamed.length, 4);
    assert.ok(renamed.some(c => c.name === "status"));
    assert.ok(renamed.some(c => c.name === "status_1"));
    assert.ok(renamed.some(c => c.name === "email"));
  });

  it("SchemaEditor.tsx e TMapModal.tsx devem possuir suporte e listeners para cópia e colagem de colunas", () => {
    const schemaEditorPath = path.resolve(__dirname, "../src/features/designer/SchemaEditor.tsx");
    const tmapModalPath = path.resolve(__dirname, "../src/features/designer/TMapModal.tsx");

    const schemaEditorContent = fs.readFileSync(schemaEditorPath, "utf-8");
    const tmapModalContent = fs.readFileSync(tmapModalPath, "utf-8");

    assert.ok(
      schemaEditorContent.includes("application/x-rdf-schema+json") ||
      schemaEditorContent.includes("handleCopyColumns") ||
      schemaEditorContent.includes("serializeSchemaColumns"),
      "SchemaEditor.tsx deve ter suporte a clipboard de schemas"
    );

    assert.ok(
      tmapModalContent.includes("application/x-rdf-schema+json") ||
      tmapModalContent.includes("handleCopyColumns") ||
      tmapModalContent.includes("serializeSchemaColumns"),
      "TMapModal.tsx deve ter suporte a clipboard de schemas"
    );
  });
});
