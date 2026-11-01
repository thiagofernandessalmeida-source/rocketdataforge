import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importa funções do parser de SQL
const parserFile = path.resolve(__dirname, "../src/components/common/sqlParser.ts");

describe("Editor SQL Avançado: Interpretador, Syntax Highlighting e Tab Indentation", () => {
  test("sqlParser.ts deve existir com tokenizeSql, lintSql e formatSql", () => {
    assert.ok(fs.existsSync(parserFile), "sqlParser.ts deve existir");
    const content = fs.readFileSync(parserFile, "utf-8");
    assert.ok(content.includes("export function tokenizeSql"), "Deve exportar tokenizeSql");
    assert.ok(content.includes("export function lintSql"), "Deve exportar lintSql");
    assert.ok(content.includes("export function formatSql"), "Deve exportar formatSql");
    assert.ok(content.includes("SQL_KEYWORDS"), "Deve conter catálogo de keywords");
  });

  test("SqlAutocompleteTextarea.tsx deve integrar régua de linhas, highlight layer, linter e Tab indentation", () => {
    const editorFile = path.resolve(__dirname, "../src/components/common/SqlAutocompleteTextarea.tsx");
    assert.ok(fs.existsSync(editorFile), "SqlAutocompleteTextarea.tsx deve existir");
    const content = fs.readFileSync(editorFile, "utf-8");

    // Verifica captura de Tab e Shift+Tab
    assert.ok(content.includes('e.key === "Tab"'), "Deve capturar a tecla Tab");
    assert.ok(content.includes("e.preventDefault()"), "Deve prevenir focus-loss no Tab");
    assert.ok(content.includes("e.shiftKey"), "Deve suportar Shift+Tab para desindentar");

    // Verifica integração do linter e highlight
    assert.ok(content.includes("tokenizeSql"), "Deve usar tokenizeSql");
    assert.ok(content.includes("lintSql"), "Deve usar lintSql");
    assert.ok(content.includes("formatSql"), "Deve usar formatSql");
    assert.ok(content.includes("sql-highlight-layer"), "Deve conter camada de highlight");
    assert.ok(content.includes("btn-format-sql"), "Deve conter botão Formatar");
    assert.ok(content.includes("btn-maximize-sql"), "Deve conter botão Maximizar / Expandir");

    // Verifica altura padrão ampliada
    assert.ok(content.includes("240"), "Deve possuir altura padrão ampliada (240px)");
  });

  test("PropertyPanel.tsx deve abrir os campos de query SQL com altura inicial ampliada (240px)", () => {
    const propPanelFile = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
    const content = fs.readFileSync(propPanelFile, "utf-8");

    // Confirma que não há mais minHeight de 70px ou 90px nos editores de SQL
    const duckMatches = content.match(/minHeight:\s*240/g) || [];
    assert.ok(duckMatches.length >= 3, `Esperado pelo menos 3 editores com minHeight: 240, encontrados ${duckMatches.length}`);
  });
});
