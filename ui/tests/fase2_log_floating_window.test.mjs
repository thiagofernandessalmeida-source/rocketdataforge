import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("FASE 2.1: useDraggableResizable.ts deve existir e exportar hook de arrasto e redimensionamento", () => {
  const hookPath = path.resolve(__dirname, "../src/features/designer/hooks/useDraggableResizable.ts");
  assert.ok(fs.existsSync(hookPath), "useDraggableResizable.ts deve existir");

  const content = fs.readFileSync(hookPath, "utf-8");
  assert.ok(content.includes("export function useDraggableResizable") || content.includes("export const useDraggableResizable"), "Deve exportar useDraggableResizable");
  assert.ok(content.includes("onMouseDownHeader"), "Deve fornecer onMouseDownHeader para movimentação");
  assert.ok(content.includes("onStartResize"), "Deve fornecer onStartResize para redimensionamento multi-direcional");
  assert.ok(content.includes("handleToggleMaximize") || content.includes("toggleMaximize"), "Deve fornecer toggleMaximize");
  assert.ok(content.includes("localStorage"), "Deve suportar persistência com localStorage");
});

test("FASE 2.1: FloatingNodeConfig.tsx deve reutilizar o hook useDraggableResizable", () => {
  const compPath = path.resolve(__dirname, "../src/features/designer/FloatingNodeConfig.tsx");
  assert.ok(fs.existsSync(compPath), "FloatingNodeConfig.tsx deve existir");

  const content = fs.readFileSync(compPath, "utf-8");
  assert.ok(content.includes("useDraggableResizable"), "FloatingNodeConfig deve importar e utilizar useDraggableResizable");
  assert.ok(content.includes("PropertyPanel"), "Deve manter PropertyPanel no corpo");
  assert.ok(content.includes("onDeleteNode"), "Deve manter suporte a exclusão");
});

test("FASE 2.2 e 2.3: LogFloatingWindow.tsx deve existir, conter LogViewerContent e aviso de navegador", () => {
  const compPath = path.resolve(__dirname, "../src/features/execution/LogFloatingWindow.tsx");
  assert.ok(fs.existsSync(compPath), "LogFloatingWindow.tsx deve existir");

  const content = fs.readFileSync(compPath, "utf-8");
  assert.ok(content.includes("useDraggableResizable"), "LogFloatingWindow deve usar useDraggableResizable");
  assert.ok(content.includes("LogViewerContent"), "LogFloatingWindow deve renderizar LogViewerContent");
  assert.ok(
    content.includes("No navegador, a janela fica dentro do app") ||
    content.includes("No navegador"),
    "Deve conter aviso informativo sobre o escopo da janela no navegador"
  );
  assert.ok(content.includes("onFocusNode"), "Deve propagar onFocusNode");
});
