import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("TAREFA 1: Bug SqlAutocompleteTextarea - Foco e digitação na query DuckDB", () => {
  const filePath = path.resolve(__dirname, "../src/components/common/SqlAutocompleteTextarea.tsx");

  test("1.1: O arquivo SqlAutocompleteTextarea.tsx deve existir", () => {
    assert.ok(fs.existsSync(filePath), "SqlAutocompleteTextarea.tsx deve existir");
  });

  test("1.2: O wrapper do textarea NÃO deve ter height: '100%' e deve ter alignSelf: 'stretch' e minHeight: 0", () => {
    const content = fs.readFileSync(filePath, "utf-8");

    // Localiza o bloco do Canvas de Código
    const canvasMarker = "Canvas de Código com Destaque de Sintaxe e Textarea Transparente";
    assert.ok(content.includes(canvasMarker), "Deve conter o comentário do Canvas de Código");

    const markerIndex = content.indexOf(canvasMarker);
    const codeAfterMarker = content.slice(markerIndex, markerIndex + 300);

    // Falha se o wrapper tiver height: "100%" ou height: '100%'
    assert.ok(
      !codeAfterMarker.includes('height: "100%"') && !codeAfterMarker.includes("height: '100%'"),
      "O wrapper do textarea NÃO deve conter height: '100%'"
    );

    // Deve conter alignSelf: "stretch" e minHeight: 0
    assert.ok(
      codeAfterMarker.includes('alignSelf: "stretch"') || codeAfterMarker.includes("alignSelf: 'stretch'"),
      "O wrapper do textarea deve conter alignSelf: 'stretch'"
    );
    assert.ok(
      codeAfterMarker.includes("minHeight: 0"),
      "O wrapper do textarea deve conter minHeight: 0"
    );
  });

  test("1.3: A área de edição e o wrapper devem delegar clique para focar o textarea", () => {
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(
      content.includes("textareaRef.current?.focus()"),
      "Deve delegar clique para textareaRef.current?.focus() ao clicar em espaço vazio"
    );
  });

  test("1.4: A área central de edição deve respeitar style.minHeight", () => {
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(
      content.includes("style?.minHeight") || content.includes("style.minHeight"),
      "A área de edição deve utilizar style.minHeight quando fornecido"
    );
  });
});
