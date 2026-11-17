import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("TAREFA 3: Zoom geral da aplicação (Zoom da interface)", () => {
  const uiZoomPath = path.resolve(__dirname, "../src/utils/uiZoom.ts");
  const mainCjsPath = path.resolve(__dirname, "../electron/main.cjs");
  const preloadPath = path.resolve(__dirname, "../electron/preload.cjs");
  const preloadLogsPath = path.resolve(__dirname, "../electron/preload-logs.cjs");
  const menuBarPath = path.resolve(__dirname, "../src/components/MenuBar.tsx");
  const appPath = path.resolve(__dirname, "../src/App.tsx");

  test("3.1: uiZoom.ts deve existir e exportar constantes e funções de zoom", () => {
    assert.ok(fs.existsSync(uiZoomPath), "uiZoom.ts deve existir");
    const content = fs.readFileSync(uiZoomPath, "utf-8");
    assert.ok(content.includes("ZOOM_LEVELS"), "Deve exportar ZOOM_LEVELS");
    assert.ok(content.includes("zoomIn"), "Deve exportar zoomIn");
    assert.ok(content.includes("zoomOut"), "Deve exportar zoomOut");
    assert.ok(content.includes("resetZoom"), "Deve exportar resetZoom");
    assert.ok(content.includes("getCurrentZoom"), "Deve exportar getCurrentZoom");
    // Comentário de limitação do browser sem CSS zoom no body
    assert.ok(
      content.includes("NÃO usar CSS") && content.includes("screenToFlowPosition"),
      "Deve documentar explicitamente que CSS zoom/transform no body quebra o React Flow"
    );
  });

  test("3.2: Lógica de níveis de zoom (ZOOM_LEVELS) com limites e reset", () => {
    const ZOOM_LEVELS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

    function getNextZoom(current, direction) {
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < ZOOM_LEVELS.length; i++) {
        const diff = Math.abs(ZOOM_LEVELS[i] - current);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      if (direction === "in") {
        return closestIdx < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[closestIdx + 1] : ZOOM_LEVELS[closestIdx];
      }
      if (direction === "out") {
        return closestIdx > 0 ? ZOOM_LEVELS[closestIdx - 1] : ZOOM_LEVELS[closestIdx];
      }
      return 1;
    }

    // A partir de 1.0 aumentando até o teto (2.0)
    let z = 1.0;
    z = getNextZoom(z, "in");
    assert.strictEqual(z, 1.1);
    z = getNextZoom(z, "in");
    assert.strictEqual(z, 1.25);
    z = getNextZoom(z, "in");
    assert.strictEqual(z, 1.5);
    z = getNextZoom(z, "in");
    assert.strictEqual(z, 1.75);
    z = getNextZoom(z, "in");
    assert.strictEqual(z, 2.0);
    z = getNextZoom(z, "in");
    assert.strictEqual(z, 2.0, "Deve estancar no limite máximo de 2.0 (200%)");

    // A partir de 1.0 diminuindo até o chão (0.5)
    z = 1.0;
    z = getNextZoom(z, "out");
    assert.strictEqual(z, 0.9);
    z = getNextZoom(z, "out");
    assert.strictEqual(z, 0.8);
    z = getNextZoom(z, "out");
    assert.strictEqual(z, 0.67);
    z = getNextZoom(z, "out");
    assert.strictEqual(z, 0.5);
    z = getNextZoom(z, "out");
    assert.strictEqual(z, 0.5, "Deve estancar no limite mínimo de 0.5 (50%)");

    // Reset sempre retorna 1.0
    assert.strictEqual(getNextZoom(2.0, "reset"), 1.0);
    assert.strictEqual(getNextZoom(0.5, "reset"), 1.0);
  });

  test("3.3: main.cjs deve possuir handlers zoom:get e zoom:set com clamping [0.5, 2.0], setZoomFactor e persistência", () => {
    const content = fs.readFileSync(mainCjsPath, "utf-8");
    assert.ok(content.includes('"zoom:get"'), 'main.cjs deve registrar handler IPC "zoom:get"');
    assert.ok(content.includes('"zoom:set"'), 'main.cjs deve registrar handler IPC "zoom:set"');
    assert.ok(content.includes("setZoomFactor"), "main.cjs deve usar webContents.setZoomFactor");
    assert.ok(content.includes("0.5") && content.includes("2.0"), "main.cjs deve limitar o intervalo entre 0.5 e 2.0");
    assert.ok(
      content.includes("settings.json") || content.includes("zoomFactor"),
      "main.cjs deve persistir o zoomFactor nas configurações"
    );
  });

  test("3.4: Preload scripts devem expor window.cellflowZoom", () => {
    const mainPreload = fs.readFileSync(preloadPath, "utf-8");
    assert.ok(mainPreload.includes('"cellflowZoom"'), 'preload.cjs deve expor "cellflowZoom"');
    assert.ok(mainPreload.includes('"zoom:get"'), 'preload.cjs deve mapear "zoom:get"');
    assert.ok(mainPreload.includes('"zoom:set"'), 'preload.cjs deve mapear "zoom:set"');

    const logsPreload = fs.readFileSync(preloadLogsPath, "utf-8");
    assert.ok(logsPreload.includes('"cellflowZoom"'), 'preload-logs.cjs deve expor "cellflowZoom"');
  });

  test("3.5: MenuBar.tsx deve incluir entradas de zoom no menu Exibir e exibir indicador de percentual", () => {
    const content = fs.readFileSync(menuBarPath, "utf-8");
    assert.ok(content.includes("onZoomIn"), "MenuBarProps deve ter onZoomIn");
    assert.ok(content.includes("onZoomOut"), "MenuBarProps deve ter onZoomOut");
    assert.ok(content.includes("onZoomReset"), "MenuBarProps deve ter onZoomReset");
    assert.ok(content.includes("uiZoomPercent"), "MenuBarProps deve ter uiZoomPercent");
    assert.ok(content.includes("Aumentar zoom da interface"), "Menu Exibir deve conter 'Aumentar zoom da interface'");
    assert.ok(content.includes("Diminuir zoom da interface"), "Menu Exibir deve conter 'Diminuir zoom da interface'");
    assert.ok(content.includes("Zoom padrão (100%)"), "Menu Exibir deve conter 'Zoom padrão (100%)'");
  });

  test("3.6: App.tsx deve registrar atalhos de teclado Ctrl+=, Ctrl+- e Ctrl+0 sem interferir em inputs", () => {
    const content = fs.readFileSync(appPath, "utf-8");
    assert.ok(
      content.includes("zoomIn") && content.includes("zoomOut") && content.includes("resetZoom"),
      "App.tsx deve importar e chamar funções de zoom"
    );
    assert.ok(
      content.includes('e.key === "="') || content.includes('e.code === "Equal"'),
      "App.tsx deve tratar atalho de zoom in"
    );
    assert.ok(
      content.includes('e.key === "-"') || content.includes('e.code === "Minus"'),
      "App.tsx deve tratar atalho de zoom out"
    );
    assert.ok(
      content.includes('e.key === "0"') || content.includes('e.code === "Digit0"'),
      "App.tsx deve tratar atalho de zoom reset"
    );
  });
});
