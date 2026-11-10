import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Refatoração do ImportSchemaModal (Overlay, Portal e Design System Dark)", () => {
  const modalFile = path.resolve(__dirname, "../src/features/designer/ImportSchemaModal.tsx");
  const modalContent = fs.readFileSync(modalFile, "utf-8");

  test("1. Estrutura Modal com Portal para document.body e backdrop escuro", () => {
    assert.ok(modalContent.includes("createPortal"), "Deve importar e usar createPortal");
    assert.ok(modalContent.includes("document.body"), "Deve anexar o portal ao document.body");
    assert.ok(modalContent.includes("bg-black/60"), "Backdrop deve conter bg-black/60");
    assert.ok(modalContent.includes("backdrop-blur-sm"), "Backdrop deve conter backdrop-blur-sm");
    assert.ok(modalContent.includes("max-w-2xl"), "Container deve ter max-w-2xl");
    assert.ok(modalContent.includes("bg-slate-900"), "Container deve ter bg-slate-900");
    assert.ok(modalContent.includes("border-slate-700"), "Container deve ter border-slate-700");
  });

  test("2. Cabeçalho & Stepper Visual Horizontal com 3 etapas e destaque Cyan", () => {
    assert.ok(modalContent.includes("1. Origem"), "Deve conter etapa 1. Origem");
    assert.ok(modalContent.includes("2. Colunas"), "Deve conter etapa 2. Colunas");
    assert.ok(modalContent.includes("3. Conflitos"), "Deve conter etapa 3. Conflitos");
    assert.ok(modalContent.includes("text-cyan-400"), "Stepper ativo deve usar text-cyan-400");
    assert.ok(modalContent.includes("bg-cyan-500/10"), "Stepper ativo deve usar bg-cyan-500/10");
    assert.ok(modalContent.includes("hover:bg-slate-800"), "Botão fechar deve usar hover:bg-slate-800");
  });

  test("3. Passo 1: Busca estilizada e grid de cards responsivo", () => {
    assert.ok(modalContent.includes("grid-cols-2"), "Deve exibir grid de 2 colunas para componentes");
    assert.ok(modalContent.includes("bg-slate-800/60"), "Cards devem ter fundo bg-slate-800/60");
    assert.ok(modalContent.includes("hover:border-cyan-500/50"), "Cards devem ter hover:border-cyan-500/50");
    assert.ok(modalContent.includes("bg-slate-700/50"), "Badge de colunas deve ter bg-slate-700/50");
  });

  test("4. Passo 2: Toolbar de seleção e linhas horizontais estruturadas", () => {
    assert.ok(modalContent.includes("Marcar Todas") || modalContent.includes("Selecionar Todas"), "Deve conter botão para marcar todas");
    assert.ok(modalContent.includes("Desmarcar Todas") || modalContent.includes("Limpar Seleção"), "Deve conter botão para desmarcar todas");
    assert.ok(modalContent.includes("bg-cyan-950/40"), "Badge de tipo de coluna deve usar bg-cyan-950/40");
    assert.ok(modalContent.includes("text-cyan-400"), "Badge de tipo de coluna deve usar text-cyan-400");
    assert.ok(modalContent.includes("font-mono"), "Nome da coluna deve ter fonte monospace");
  });

  test("5. Passo 3: 3 opções de resolução de conflitos (overwrite, skip, rename)", () => {
    assert.ok(modalContent.includes("overwrite"), "Deve suportar overwrite");
    assert.ok(modalContent.includes("skip"), "Deve suportar skip");
    assert.ok(modalContent.includes("rename"), "Deve suportar rename");
    assert.ok(modalContent.includes("Sobrescrever colunas existentes"), "Deve descrever opção Overwrite");
    assert.ok(modalContent.includes("Ignorar duplicadas"), "Deve descrever opção Skip");
    assert.ok(modalContent.includes("Renomear novas colunas com sufixo"), "Deve descrever opção Rename");
  });

  test("6. Rodapé: Botões de navegação e confirmação com tema Cyan", () => {
    assert.ok(modalContent.includes("Voltar"), "Deve ter botão Voltar");
    assert.ok(modalContent.includes("Cancelar"), "Deve ter botão Cancelar");
    assert.ok(modalContent.includes("bg-cyan-600"), "Botão de confirmação deve usar bg-cyan-600");
    assert.ok(modalContent.includes("hover:bg-cyan-500"), "Botão de confirmação deve usar hover:bg-cyan-500");
  });
});
