import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("FASE 3.9: validateWindowBounds com 1 monitor, 2 monitores e monitor removido", async () => {
  const helperModule = await import("../electron/windowBoundsHelper.cjs");
  const { validateWindowBounds } = helperModule.default || helperModule;

  const displayPrimary = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  };
  const displaySecondary = {
    id: 2,
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  };

  // Cenário 1: 1 monitor primário, limites válidos
  const bounds1 = validateWindowBounds(
    { x: 100, y: 100, width: 800, height: 600 },
    [displayPrimary]
  );
  assert.strictEqual(bounds1.x, 100);
  assert.strictEqual(bounds1.y, 100);
  assert.strictEqual(bounds1.width, 800);
  assert.strictEqual(bounds1.height, 600);

  // Cenário 2: 2 monitores, limites válidos no segundo monitor (segunda tela)
  const bounds2 = validateWindowBounds(
    { x: 2050, y: 150, width: 900, height: 700 },
    [displayPrimary, displaySecondary]
  );
  assert.strictEqual(bounds2.x, 2050);
  assert.strictEqual(bounds2.y, 150);
  assert.strictEqual(bounds2.width, 900);
  assert.strictEqual(bounds2.height, 700);

  // Cenário 3: Segundo monitor foi desconectado (havia ficado em x: 2050)
  // Agora a lista de telas contém apenas displayPrimary
  const bounds3 = validateWindowBounds(
    { x: 2050, y: 150, width: 900, height: 700 },
    [displayPrimary]
  );
  assert.ok(
    bounds3.x >= 0 && bounds3.x < 1920,
    `Ao desconectar o segundo monitor, deve abrir no primário. x=${bounds3.x}`
  );
  assert.ok(
    bounds3.y >= 0 && bounds3.y < 1080,
    `Ao desconectar o segundo monitor, deve abrir no primário. y=${bounds3.y}`
  );
});

test("FASE 3.9: Protocolo de snapshot em lotes (batchArray)", async () => {
  const helperModule = await import("../electron/windowBoundsHelper.cjs");
  const { batchArray } = helperModule.default || helperModule;

  const items = Array.from({ length: 1250 }, (_, i) => ({ id: `log-${i}` }));
  const batches = batchArray(items, 500);

  assert.strictEqual(batches.length, 3);
  assert.strictEqual(batches[0].length, 500);
  assert.strictEqual(batches[1].length, 500);
  assert.strictEqual(batches[2].length, 250);

  assert.deepStrictEqual(batchArray([]), []);
  assert.deepStrictEqual(batchArray(null), []);
});

test("FASE 3.1 e 3.9: preload-logs.cjs deve expor somente window.cellflowLogs seguro sem token", () => {
  const preloadPath = path.resolve(__dirname, "../electron/preload-logs.cjs");
  assert.ok(fs.existsSync(preloadPath), "preload-logs.cjs deve existir");

  const content = fs.readFileSync(preloadPath, "utf-8");
  assert.ok(content.includes("cellflowLogs"), "Deve expor cellflowLogs");
  assert.ok(!content.includes("backendToken"), "NÃO deve conter ou expor backendToken");
  assert.ok(!content.includes("contextBridge.exposeInMainWorld(\"cellflow\","), "NÃO deve expor window.cellflow");
  assert.ok(content.includes("requestSnapshot"), "Deve conter requestSnapshot");
  assert.ok(content.includes("focusNode"), "Deve conter focusNode");
  assert.ok(content.includes("setAlwaysOnTop"), "Deve conter setAlwaysOnTop");
  assert.ok(content.includes("reattach"), "Deve conter reattach");
});

test("FASE 3.1 e 3.3: StandaloneLogWindow.tsx deve existir e gerenciar janela nativa em tela cheia", () => {
  const compPath = path.resolve(__dirname, "../src/features/execution/StandaloneLogWindow.tsx");
  assert.ok(fs.existsSync(compPath), "StandaloneLogWindow.tsx deve existir");

  const content = fs.readFileSync(compPath, "utf-8");
  assert.ok(content.includes("LogViewerContent"), "Deve renderizar LogViewerContent");
  assert.ok(content.includes("setAlwaysOnTop") || content.includes("alwaysOnTop"), "Deve conter controle de fixar janela por cima");
  assert.ok(content.includes("reattach"), "Deve conter ação de reacoplar");
});

