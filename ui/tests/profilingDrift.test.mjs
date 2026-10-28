import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Fase 4: Profiling Estatístico e Schema Drift (UI)", () => {
  test("T-4.3: types/index.ts deve definir interfaces para ColumnProfile, DatasetProfile e SchemaDriftReport", () => {
    const typesFile = path.resolve(__dirname, "../src/types/index.ts");
    const content = fs.readFileSync(typesFile, "utf-8");

    assert.ok(content.includes("export interface ColumnProfile"), "Deve conter ColumnProfile");
    assert.ok(content.includes("null_percentage: number"), "ColumnProfile deve ter null_percentage");
    assert.ok(content.includes("distinct_count: number"), "ColumnProfile deve ter distinct_count");
    assert.ok(content.includes("min_value: any"), "ColumnProfile deve ter min_value");
    assert.ok(content.includes("max_value: any"), "ColumnProfile deve ter max_value");
    assert.ok(content.includes("export interface DatasetProfile"), "Deve conter DatasetProfile");
    assert.ok(content.includes("export interface SchemaDriftReport"), "Deve conter SchemaDriftReport");
    assert.ok(content.includes("has_drift: boolean"), "SchemaDriftReport deve conter has_drift");
  });

  test("T-4.3: api/client.ts deve exportar profileDataset e detectSchemaDrift", () => {
    const apiFile = path.resolve(__dirname, "../src/api/client.ts");
    const content = fs.readFileSync(apiFile, "utf-8");

    assert.ok(content.includes("profileDataset:"), "Deve exportar profileDataset");
    assert.ok(content.includes("/schemas/profile"), "Deve chamar endpoint /schemas/profile");
    assert.ok(content.includes("detectSchemaDrift:"), "Deve exportar detectSchemaDrift");
    assert.ok(content.includes("/schemas/drift"), "Deve chamar endpoint /schemas/drift");
  });

  test("T-4.3: PropertyPanel deve incluir painel de Profiling e Alerta Visual de Schema Drift", () => {
    const panelFile = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
    const content = fs.readFileSync(panelFile, "utf-8");

    // Alerta de drift
    assert.ok(
      content.includes("Schema Drift Detectado") || content.includes("schema-drift-alert"),
      "Deve renderizar alerta visual quando schema drift for detectado"
    );
    assert.ok(
      content.includes("added_columns") || content.includes("Colunas Adicionadas"),
      "Deve exibir colunas adicionadas no diff"
    );
    assert.ok(
      content.includes("removed_columns") || content.includes("Colunas Removidas"),
      "Deve exibir colunas removidas no diff"
    );
    assert.ok(
      content.includes("type_mismatches") || content.includes("Tipos Incompatíveis"),
      "Deve exibir tipos alterados no diff"
    );

    // Profiling estatístico
    assert.ok(
      content.includes("Profiling Estatístico") || content.includes("Perfil Estatístico") || content.includes("data-profiling-panel"),
      "Deve conter seção ou painel de Profiling Estatístico"
    );
    assert.ok(content.includes("distinct_count") || content.includes("Cardinalidade"), "Deve exibir cardinalidade / distintos");
    assert.ok(content.includes("null_percentage") || content.includes("Nulos"), "Deve exibir % de nulos");
    assert.ok(content.includes("min_value") || content.includes("min") || content.includes("Mín"), "Deve exibir valores mínimos/máximos");
  });
});
