import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmapModalPath = path.resolve(__dirname, "../src/features/designer/TMapModal.tsx");

test("TMapModal - Não deve utilizar target como fallback para expressões vazias (evita Binder Error e garante NULL)", () => {
  const content = fs.readFileSync(tmapModalPath, "utf-8");

  // Garante que a linha antiga 'const expr = (c.expression || target).trim();' foi removida
  assert.ok(
    !content.includes("(c.expression || target).trim()"),
    "Não deve haver fallback de c.expression para target, pois causa erro Binder no DuckDB quando o campo de saída é vazio"
  );

  // Garante que expressões vazias são explicitamente tratadas como NULL
  assert.ok(
    content.includes('(c.expression != null && c.expression.trim() !== "") ? c.expression.trim() : "NULL"'),
    "Deve converter c.expression vazia para 'NULL' explicitamente na geração de preview SQL"
  );
});

test("TMapModal - Placeholder do input de expressão deve indicar suporte a NULL quando vazio", () => {
  const content = fs.readFileSync(tmapModalPath, "utf-8");
  assert.ok(
    content.includes('placeholder="row1.coluna (ou vazio para NULL)"'),
    "Input da expressão deve ter placeholder explicativo para coluna vazia como NULL"
  );
});

test("TMapModal - FUNCTION_CATALOG deve incluir funções nativas de cast do Python (int, str, float, bool, len)", () => {
  const content = fs.readFileSync(tmapModalPath, "utf-8");

  // Categoria de conversões
  assert.ok(
    content.includes('"Conversões / Cast"'),
    "FUNCTION_CATALOG deve incluir a categoria 'Conversões / Cast'"
  );

  // int, str, float, bool, len
  assert.ok(content.includes('syntax: "int(expr)"'), "Deve incluir int(expr)");
  assert.ok(content.includes('syntax: "str(expr)"'), "Deve incluir str(expr)");
  assert.ok(content.includes('syntax: "float(expr)"'), "Deve incluir float(expr)");
  assert.ok(content.includes('syntax: "bool(expr)"'), "Deve incluir bool(expr)");
  assert.ok(content.includes('syntax: "len(str)"'), "Deve incluir len(str)");
});
