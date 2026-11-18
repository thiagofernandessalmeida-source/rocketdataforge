import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importa a lógica pura de posicionamento
import { computeFloatingPosition } from "../src/components/common/floatingPosition.ts";

describe("Tarefa 1: Utilitário de Posicionamento e FloatingMenu", () => {
  describe("computeFloatingPosition (Lógica Pura)", () => {
    test("1. Cabe abaixo da âncora", () => {
      const pos = computeFloatingPosition({
        anchor: { left: 100, top: 100, right: 200, bottom: 130, width: 100, height: 30 },
        menu: { width: 150, height: 100 },
        viewport: { width: 1000, height: 600 },
        gap: 2,
        margin: 8,
        preferred: "below",
      });

      assert.equal(pos.placement, "below");
      assert.equal(pos.top, 132); // bottom 130 + gap 2
      assert.equal(pos.left, 100);
      assert.ok(pos.maxHeight >= 100);
    });

    test("2. Não cabe abaixo mas cabe acima da âncora", () => {
      // Âncora perto do rodapé (top: 500, bottom: 530 de viewport height 600)
      // Espaço abaixo: 600 - 530 - 2 - 8 = 60px
      // Espaço acima: 500 - 2 - 8 = 490px
      const pos = computeFloatingPosition({
        anchor: { left: 100, top: 500, right: 200, bottom: 530, width: 100, height: 30 },
        menu: { width: 150, height: 200 },
        viewport: { width: 1000, height: 600 },
        gap: 2,
        margin: 8,
        preferred: "below",
      });

      assert.equal(pos.placement, "above");
      assert.equal(pos.top, 500 - 2 - 200); // 298
      assert.equal(pos.left, 100);
      assert.equal(pos.maxHeight, 490);
    });

    test("3. Não cabe em nenhum lado: escolhe o lado com mais espaço e limita maxHeight", () => {
      // Âncora no meio-baixo: top: 350, bottom: 380, viewport: 500
      // Espaço abaixo: 500 - 380 - 2 - 8 = 110px
      // Espaço acima: 350 - 2 - 8 = 340px
      // Menu gigante: height 600
      const pos = computeFloatingPosition({
        anchor: { left: 100, top: 350, right: 200, bottom: 380, width: 100, height: 30 },
        menu: { width: 150, height: 600 },
        viewport: { width: 1000, height: 500 },
        gap: 2,
        margin: 8,
        preferred: "below",
      });

      assert.equal(pos.placement, "above"); // 340 > 110
      assert.equal(pos.maxHeight, 340);
      assert.equal(pos.top, 350 - 2 - 340); // 8 (margin)
      assert.equal(pos.top, 8);
    });

    test("4. Estoura a borda direita da janela: desloca para a esquerda", () => {
      // Viewport width 500, margin 8. Max right permitido: 500 - 8 = 492
      // Âncora em left: 400, width: 50. Menu width: 150.
      // Se ficasse em 400, 400 + 150 = 550 (> 492).
      // Deslocado: 492 - 150 = 342.
      const pos = computeFloatingPosition({
        anchor: { left: 400, top: 100, right: 450, bottom: 130, width: 50, height: 30 },
        menu: { width: 150, height: 100 },
        viewport: { width: 500, height: 600 },
        gap: 2,
        margin: 8,
      });

      assert.equal(pos.left, 342);
      assert.equal(pos.left + 150, 492); // perfeitamente encostado na margem direita
    });

    test("5. Âncora colada na borda esquerda: nunca deixa left menor que margin", () => {
      const pos = computeFloatingPosition({
        anchor: { left: 2, top: 100, right: 52, bottom: 130, width: 50, height: 30 },
        menu: { width: 150, height: 100 },
        viewport: { width: 500, height: 600 },
        gap: 2,
        margin: 8,
      });

      assert.equal(pos.left, 8); // clamped to margin
    });

    test("6. Menu mais largo que a janela: respeita margin mínima", () => {
      const pos = computeFloatingPosition({
        anchor: { left: 100, top: 100, right: 150, bottom: 130, width: 50, height: 30 },
        menu: { width: 800, height: 100 },
        viewport: { width: 500, height: 600 },
        gap: 2,
        margin: 8,
      });

      assert.equal(pos.left, 8); // clamped to margin
    });
  });

  describe("FloatingMenu.tsx (Estrutura do Componente)", () => {
    const floatingMenuPath = path.resolve(__dirname, "../src/components/common/FloatingMenu.tsx");

    test("Arquivo FloatingMenu.tsx existe e possui os elementos mandatórios", () => {
      assert.ok(fs.existsSync(floatingMenuPath), "FloatingMenu.tsx deve existir");
      const src = fs.readFileSync(floatingMenuPath, "utf-8");

      assert.ok(src.includes("createPortal("), "Deve usar createPortal");
      assert.ok(src.includes("document.body"), "Deve renderizar em document.body");
      assert.ok(src.includes("position: \"fixed\""), "Deve ter position: fixed");
      assert.ok(src.includes("100001"), "Deve ter zIndex 100001 para sobrepor modais 99999");
      assert.ok(src.includes("nowheel"), "Deve ter a classe nowheel para prevenir zoom no React Flow");
      assert.ok(src.includes("e.stopPropagation()"), "Deve parar propagação do wheel");
      assert.ok(src.includes("menuRef.current.contains(target)"), "Clique dentro do menu deve ser considerado interno");
      assert.ok(src.includes("currentAnchorEl.contains(target)"), "Clique na âncora deve ser considerado interno");
      assert.ok(src.includes("Escape"), "Deve fechar ao pressionar Escape");
      assert.ok(src.includes("isOffscreen"), "Deve detectar se âncora saiu da tela visível");
    });
  });
});
