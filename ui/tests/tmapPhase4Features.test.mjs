import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Fase 4: TMap Interface & Schema Management Features", () => {
  const tmapModalPath = path.resolve(__dirname, "../src/features/designer/TMapModal.tsx");
  const schemaEditorPath = path.resolve(__dirname, "../src/features/designer/SchemaEditor.tsx");
  const propertyPanelPath = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
  const importSchemaModalPath = path.resolve(__dirname, "../src/features/designer/ImportSchemaModal.tsx");

  test("T-4.3: ImportSchemaModal deve existir com fluxo em 3 passos", () => {
    assert.strictEqual(fs.existsSync(importSchemaModalPath), true);
    const content = fs.readFileSync(importSchemaModalPath, "utf-8");
    assert.match(content, /step === 1/);
    assert.match(content, /step === 2/);
    assert.match(content, /step === 3/);
    assert.match(content, /resolveSchemaCollisions/);
    assert.match(content, /overwrite/);
    assert.match(content, /skip/);
    assert.match(content, /rename/);
  });

  test("T-4.2 & T-4.4: SchemaEditor e TMapModal devem integrar ImportSchemaModal e Clipboard", () => {
    const tmapContent = fs.readFileSync(tmapModalPath, "utf-8");
    const schemaContent = fs.readFileSync(schemaEditorPath, "utf-8");
    const propContent = fs.readFileSync(propertyPanelPath, "utf-8");

    // SchemaEditor
    assert.match(schemaContent, /ImportSchemaModal/);
    assert.match(schemaContent, /copyColumnsToClipboard/);
    assert.match(schemaContent, /readColumnsFromClipboard/);

    // TMapModal
    assert.match(tmapContent, /ImportSchemaModal/);
    assert.match(tmapContent, /copyColumnsToClipboard/);
    assert.match(tmapContent, /readColumnsFromClipboard/);

    // PropertyPanel
    assert.match(propContent, /ImportSchemaModal/);
  });

  test("T-4.5: TMapModal deve possuir pilha de Undo/Redo local isolada com stopPropagation", () => {
    const tmapContent = fs.readFileSync(tmapModalPath, "utf-8");
    assert.match(tmapContent, /undoStack|historyStack|localHistory|undo/i);
    assert.match(tmapContent, /stopPropagation/);
    // Verifica captura de ctrl+z ou meta+z
    assert.match(tmapContent, /key.*z/i);
  });

  test("T-4.6: TMapModal deve chamar POST /api/v1/tmap/validate-expression e exibir badges de erro", () => {
    const tmapContent = fs.readFileSync(tmapModalPath, "utf-8");
    assert.match(tmapContent, /\/api\/v1\/tmap\/validate-expression/);
    assert.match(tmapContent, /validationErrors|exprErrors|errors/i);
  });
});
