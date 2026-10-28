import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Fase 3: Componentes Canônicos tFilterRow e tAggregateRow (UI)", () => {
  test("T-3.3: Catálogo deve conter core.filter com portas de output e reject", () => {
    const compFile = path.resolve(__dirname, "../src/catalog/components.ts");
    const content = fs.readFileSync(compFile, "utf-8");

    assert.ok(content.includes('type_id: "core.filter"'), "Deve conter core.filter");
    assert.ok(content.includes('"reject"'), "Deve conter porta reject");
    assert.ok(content.includes('"dataset"'), "Deve conter porta dataset");
  });

  test("T-3.3: Catálogo deve conter core.aggregate com group_by e aggregations", () => {
    const compFile = path.resolve(__dirname, "../src/catalog/components.ts");
    const content = fs.readFileSync(compFile, "utf-8");

    assert.ok(content.includes('type_id: "core.aggregate"'), "Deve conter core.aggregate");
    assert.ok(content.includes('group_by: "array"'), "Deve conter campo group_by");
    assert.ok(content.includes('aggregations: "array"'), "Deve conter campo aggregations");
  });

  test("T-3.3: PropertyPanel deve incluir seções dedicadas para tFilterRow e tAggregateRow", () => {
    const panelFile = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
    const content = fs.readFileSync(panelFile, "utf-8");

    // Verifica lógica de detecção
    assert.ok(content.includes('const isFilter = ct.includes("filter")'), "Deve detectar isFilter");
    assert.ok(content.includes('const isAggregate = ct.includes("aggregate")'), "Deve detectar isAggregate");

    // Verifica formulário tFilterRow
    assert.ok(content.includes("Regras do Filtro (tFilterRow)"), "Deve renderizar cabeçalho tFilterRow");
    assert.ok(content.includes("logical_operator"), "Deve permitir configurar operador lógico");
    assert.ok(content.includes("conditions"), "Deve permitir gerenciar lista de condições");

    // Verifica formulário tAggregateRow
    assert.ok(content.includes("Agrupamento & Agregações (tAggregateRow)"), "Deve renderizar cabeçalho tAggregateRow");
    assert.ok(content.includes("group_by"), "Deve permitir configurar chaves de group_by");
    assert.ok(content.includes("aggregations"), "Deve permitir configurar funções de agregação");
  });
});
