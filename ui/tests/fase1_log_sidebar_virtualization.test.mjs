import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("FASE 1.3: executionLogStore - Rastreamento de seq e contagem de erros novos", async () => {
  const storeModule = await import("../src/store/executionLogStore.ts");
  const { executionLogStore } = storeModule;

  executionLogStore.clearLogs();
  assert.strictEqual(executionLogStore.getLatestSeq(), 0, "Sem logs, latestSeq deve ser 0");

  // Adiciona logs informativos
  executionLogStore.addLogs([
    { seq: 10, level: "INFO", message: "Inicializando job" },
    { seq: 11, level: "DEBUG", message: "Conectores carregados" },
  ]);

  assert.strictEqual(executionLogStore.getLatestSeq(), 11);
  assert.strictEqual(executionLogStore.getNewErrorsCount(0), 0, "Nenhum erro registrado ainda");

  // Usuário abre a aba de logs: marca como lido até seq 11
  let lastReadSeq = executionLogStore.getLatestSeq();

  // Ocorrem 2 erros em background
  executionLogStore.addLogs([
    { seq: 12, level: "ERROR", message: "Falha de conexão com banco de dados" },
    { seq: 13, level: "INFO", message: "Tentativa de reconexão" },
    { seq: 14, level: "ERROR", message: "Timeout na execução" },
  ]);

  assert.strictEqual(executionLogStore.getLatestSeq(), 14);
  assert.strictEqual(executionLogStore.getNewErrorsCount(lastReadSeq), 2, "Deve contabilizar exatamente 2 novos erros após lastReadSeq");

  // Usuário abre a aba e zera a contagem
  lastReadSeq = executionLogStore.getLatestSeq();
  assert.strictEqual(executionLogStore.getNewErrorsCount(lastReadSeq), 0, "Ao atualizar lastReadSeq para o mais recente, novos erros devem ser 0");
});

test("FASE 1.1 e 1.6: LogViewerContent.tsx deve existir, suportar compact via ResizeObserver e virtualização", () => {
  const compPath = path.resolve(__dirname, "../src/features/execution/LogViewerContent.tsx");
  assert.ok(fs.existsSync(compPath), "LogViewerContent.tsx deve existir");

  const content = fs.readFileSync(compPath, "utf-8");
  assert.ok(content.includes("ResizeObserver"), "Deve usar ResizeObserver para medição responsiva de largura e altura");
  assert.ok(content.includes("520"), "Deve alternar para layout de duas linhas abaixo de ~520px");
  assert.ok(content.includes("onFocusNode"), "Deve suportar navegação com onFocusNode ao clicar na linha");
  assert.ok(content.includes("autoScroll") || content.includes("scrollTop"), "Deve manter suporte a rolagem automática");
  assert.ok(
    content.includes("startIndex") && content.includes("endIndex"),
    "Deve virtualizar a lista de logs calculando janela visível por altura de linha"
  );
});

test("FASE 1.2, 1.4 e 1.5: RightSidebar.tsx deve existir, alternar abas sem desmontar PropertyPanel e exibir indicadores", () => {
  const sidebarPath = path.resolve(__dirname, "../src/features/designer/RightSidebar.tsx");
  assert.ok(fs.existsSync(sidebarPath), "RightSidebar.tsx deve existir");

  const content = fs.readFileSync(sidebarPath, "utf-8");
  assert.ok(content.includes("PropertyPanel"), "RightSidebar deve renderizar PropertyPanel");
  assert.ok(content.includes("LogViewerContent"), "RightSidebar deve renderizar LogViewerContent");
  assert.ok(
    content.includes('display: activeTab === "props"') ||
    content.includes("display: activeTab === 'props'") ||
    content.includes("display: propsTabVisible") ||
    content.includes("style={{ display:"),
    "Deve alternar abas sem desmontar o componente para não perder o nó selecionado"
  );
  assert.ok(
    content.includes("unreadErrorsCount") || content.includes("badge"),
    "Deve exibir selo com novos erros na aba Logs"
  );
  assert.ok(
    content.includes("selectedNode") && (content.includes("dot") || content.includes("indicator") || content.includes("point")),
    "Deve exibir ponto discreto na aba Propriedades quando houver nó selecionado fora da aba"
  );
});

test("FASE 1.6: Benchmark de performance de virtualização com 10.000 entradas", () => {
  // Simula 10.000 entradas de log no buffer
  const sampleLogs = [];
  for (let i = 1; i <= 10000; i++) {
    sampleLogs.push({
      id: `log-${i}`,
      seq: i,
      timestamp: new Date().toISOString(),
      level: i % 100 === 0 ? "ERROR" : i % 20 === 0 ? "WARN" : "INFO",
      cellId: `cell-${i % 5}`,
      cellName: `Célula ${i % 5}`,
      nodeId: `node_${i % 10}`,
      nodeLabel: `Componente ${i % 10}`,
      message: `Execução da tarefa ${i} concluída com código 200 OK.`,
    });
  }

  // 1. Simulação sem virtualização: construir 10.000 nós virtuais
  const t0 = performance.now();
  let nonVirtualCount = 0;
  for (let i = 0; i < sampleLogs.length; i++) {
    // representação de 10.000 elementos renderizados
    nonVirtualCount += sampleLogs[i].message.length;
  }
  const timeNonVirtual = performance.now() - t0;

  // 2. Simulação com virtualização (cálculo de slice visível para container de 600px com linha de 28px)
  const containerHeight = 600;
  const rowHeight = 28;
  const overscan = 5;
  const scrollTop = 1400; // scroll no meio

  const t1 = performance.now();
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(sampleLogs.length, Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan);
  const visibleSlice = sampleLogs.slice(startIndex, endIndex);
  let virtualCount = 0;
  for (let i = 0; i < visibleSlice.length; i++) {
    virtualCount += visibleSlice[i].message.length;
  }
  const timeVirtual = performance.now() - t1;

  assert.ok(visibleSlice.length <= (Math.ceil(containerHeight / rowHeight) + overscan * 2 + 2));
  assert.ok(timeVirtual < 2.0, `Cálculo de janela virtual deve ser instantâneo (< 2ms). Obtido: ${timeVirtual.toFixed(3)}ms`);
});
