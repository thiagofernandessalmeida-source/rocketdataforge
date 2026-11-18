import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Tarefa 2: Seletor de Tipo de Coluna (ColumnTypeSelect com FloatingMenu)", () => {
  const schemaEditorPath = path.resolve(__dirname, "../src/features/designer/SchemaEditor.tsx");

  test("SchemaEditor.tsx existe e integra FloatingMenu no ColumnTypeSelect", () => {
    assert.ok(fs.existsSync(schemaEditorPath), "SchemaEditor.tsx deve existir");
    const src = fs.readFileSync(schemaEditorPath, "utf-8");

    // Deve importar FloatingMenu
    assert.ok(
      src.includes('import { FloatingMenu } from "../../components/common/FloatingMenu"'),
      "Deve importar FloatingMenu de common"
    );

    // ColumnTypeSelect deve usar FloatingMenu
    assert.ok(src.includes("<FloatingMenu"), "ColumnTypeSelect deve renderizar <FloatingMenu");
    assert.ok(src.includes("anchorRef={buttonRef}"), "Deve passar buttonRef como âncora");
    assert.ok(src.includes("onRequestClose={() => setIsOpen(false)}"), "Deve registrar onRequestClose");

    // Acessibilidade
    assert.ok(src.includes('aria-haspopup="listbox"'), "Botão trigger deve ter aria-haspopup='listbox'");
    assert.ok(src.includes("aria-expanded={isOpen}"), "Botão trigger deve ter aria-expanded");
    assert.ok(src.includes('role="listbox"'), "FloatingMenu deve ter role='listbox'");
    assert.ok(src.includes('role="option"'), "Itens devem ter role='option'");
    assert.ok(src.includes("aria-selected={isSelected}"), "Itens devem ter aria-selected");

    // Navegação por teclado
    assert.ok(src.includes('e.key === "ArrowDown"'), "Deve suportar seta para baixo");
    assert.ok(src.includes('e.key === "ArrowUp"'), "Deve suportar seta para cima");
    assert.ok(src.includes('e.key === "Enter"'), "Deve suportar tecla Enter");
    assert.ok(src.includes('e.key === "Escape"'), "Deve suportar tecla Escape");
    assert.ok(src.includes('e.key === "Tab"'), "Deve suportar tecla Tab");

    // Não deve haver position: absolute cortando o menu
    const colTypeSelectCode = src.slice(src.indexOf("const ColumnTypeSelect"), src.indexOf("export const SchemaEditor"));
    assert.ok(
      !colTypeSelectCode.includes('position: "absolute"'),
      "ColumnTypeSelect NÃO deve usar position: absolute para o menu flutuante"
    );
  });
});
