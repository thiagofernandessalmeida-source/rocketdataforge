import { test, describe } from "node:test";
import assert from "node:assert";
import { reorderItems, moveItemsDirection } from "../src/features/designer/utils/reorderUtils.ts";

describe("Frente 3: Reordenação de Colunas com Drag & Drop e Teclado (reorderUtils)", () => {
  const sampleColumns = [
    { id: "col1", name: "id" },
    { id: "col2", name: "nome" },
    { id: "col3", name: "email" },
    { id: "col4", name: "criado_em" },
    { id: "col5", name: "ativo" },
  ];

  test("1: reorderItems deve mover uma coluna para baixo (position: 'below')", () => {
    // Move col1 para baixo de col3
    const result = reorderItems(sampleColumns, ["col1"], "col3", "below");
    const names = result.map((c) => c.name);
    assert.deepStrictEqual(names, ["nome", "email", "id", "criado_em", "ativo"]);
  });

  test("2: reorderItems deve mover uma coluna para cima (position: 'above')", () => {
    // Move col4 para antes de col2
    const result = reorderItems(sampleColumns, ["col4"], "col2", "above");
    const names = result.map((c) => c.name);
    assert.deepStrictEqual(names, ["id", "criado_em", "nome", "email", "ativo"]);
  });

  test("3: reorderItems com multi-seleção deve preservar a ordem relativa das colunas movidas", () => {
    // Seleciona col1 e col3 e move para baixo de col4
    const result = reorderItems(sampleColumns, ["col1", "col3"], "col4", "below");
    const names = result.map((c) => c.name);
    assert.deepStrictEqual(names, ["nome", "criado_em", "id", "email", "ativo"]);
  });

  test("4: moveItemsDirection('up') deve mover colunas selecionadas para cima", () => {
    // Seleciona col2 e col3, move para cima
    const selected = new Set(["col2", "col3"]);
    const result = moveItemsDirection(sampleColumns, selected, "up");
    const names = result.map((c) => c.name);
    assert.deepStrictEqual(names, ["nome", "email", "id", "criado_em", "ativo"]);
  });

  test("5: moveItemsDirection('down') deve mover colunas selecionadas para baixo", () => {
    // Seleciona col2 e col3, move para baixo
    const selected = new Set(["col2", "col3"]);
    const result = moveItemsDirection(sampleColumns, selected, "down");
    const names = result.map((c) => c.name);
    assert.deepStrictEqual(names, ["id", "criado_em", "nome", "email", "ativo"]);
  });

  test("6: moveItemsDirection não deve alterar lista se item no limite for movido", () => {
    // Tenta mover col1 para cima
    const selectedUp = new Set(["col1"]);
    const resUp = moveItemsDirection(sampleColumns, selectedUp, "up");
    assert.deepStrictEqual(resUp.map((c) => c.name), sampleColumns.map((c) => c.name));

    // Tenta mover col5 para baixo
    const selectedDown = new Set(["col5"]);
    const resDown = moveItemsDirection(sampleColumns, selectedDown, "down");
    assert.deepStrictEqual(resDown.map((c) => c.name), sampleColumns.map((c) => c.name));
  });
});
