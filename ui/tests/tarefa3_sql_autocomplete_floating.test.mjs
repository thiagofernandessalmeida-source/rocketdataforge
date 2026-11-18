import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Tarefa 3: Autocomplete do SqlAutocompleteTextarea com FloatingMenu", () => {
  const sqlTextareaPath = path.resolve(__dirname, "../src/components/common/SqlAutocompleteTextarea.tsx");

  test("SqlAutocompleteTextarea.tsx integra FloatingMenu com âncora virtual do cursor", () => {
    assert.ok(fs.existsSync(sqlTextareaPath), "SqlAutocompleteTextarea.tsx deve existir");
    const src = fs.readFileSync(sqlTextareaPath, "utf-8");

    // 1. Deve importar FloatingMenu
    assert.ok(
      src.includes('import { FloatingMenu } from "./FloatingMenu"'),
      "Deve importar FloatingMenu de ./FloatingMenu"
    );

    // 2. Deve renderizar FloatingMenu no lugar da div absolute anterior
    assert.ok(
      src.includes("<FloatingMenu"),
      "Deve renderizar <FloatingMenu"
    );
    assert.ok(
      src.includes("anchorRef={getCaretAnchor}"),
      "Deve passar getCaretAnchor como âncora virtual"
    );

    // 3. getCaretAnchor deve calcular coordenadas a partir de getCaretCoordinates e getBoundingClientRect
    assert.ok(
      src.includes("getCaretCoordinates(textarea, cursorPos)"),
      "getCaretAnchor deve usar getCaretCoordinates"
    );
    assert.ok(
      src.includes("rect.left + coords.left - textarea.scrollLeft"),
      "getCaretAnchor deve somar rect.left e subtrair scrollLeft"
    );
    assert.ok(
      src.includes("rect.top + coords.top - textarea.scrollTop"),
      "getCaretAnchor deve somar rect.top e subtrair scrollTop"
    );

    // 4. Limitações antigas de tamanho interno do textarea DEVEM ter sido removidas
    assert.ok(
      !src.includes("rect.height - 40"),
      "NÃO deve limitar top por rect.height - 40"
    );
    assert.ok(
      !src.includes("rect.width - 240"),
      "NÃO deve limitar left por rect.width - 240"
    );

    // 5. Preservação de foco e scrollIntoView
    assert.ok(
      src.includes("e.preventDefault()"),
      "Deve manter e.preventDefault() no onMouseDown dos itens para manter foco no textarea"
    );
    assert.ok(
      src.includes('scrollIntoView({ block: "nearest" })'),
      "Deve manter a rolagem do item selecionado para a área visível"
    );

    // 6. Navegação por teclado
    assert.ok(src.includes('e.key === "ArrowDown"'), "Deve manter tratamento da seta para baixo");
    assert.ok(src.includes('e.key === "ArrowUp"'), "Deve manter tratamento da seta para cima");
    assert.ok(src.includes('e.key === "Enter"'), "Deve manter tratamento da tecla Enter");
    assert.ok(src.includes('e.key === "Escape"'), "Deve manter tratamento da tecla Escape");
  });
});
