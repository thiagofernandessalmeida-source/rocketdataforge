import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("TAREFA 2: Logs e Métricas Expansíveis por Célula", () => {
  test("2.1 e 2.2: CanvasCellCard.tsx e index.css devem suportar modo expandido e alça de redimensionamento", () => {
    const cardPath = path.resolve(__dirname, "../src/features/designer/cells/CanvasCellCard.tsx");
    const cssPath = path.resolve(__dirname, "../src/index.css");

    const cardContent = fs.readFileSync(cardPath, "utf-8");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Valida botões e classes de expansão
    assert.ok(cardContent.includes("metricsPanelExpanded"), "CanvasCellCard deve ler metricsPanelExpanded");
    assert.ok(cardContent.includes("metricsPanelHeight"), "CanvasCellCard deve suportar metricsPanelHeight");
    assert.ok(cardContent.includes("cell-metrics-resizer"), "CanvasCellCard deve renderizar alça de redimensionamento");
    assert.ok(cardContent.includes("handleCopyAllLogs"), "CanvasCellCard deve possuir ação de copiar todos os logs");
    assert.ok(cardContent.includes("logLevelFilter"), "CanvasCellCard deve possuir filtro por nível de log");

    // Valida remoção de max-height fixo e animação limpa em index.css
    assert.ok(cssContent.includes(".cell-metrics-panel.expanded"), "index.css deve ter estilo para painel expandido");
    assert.ok(cssContent.includes(".cell-metrics-resizer"), "index.css deve ter estilo para alça de resize");
    assert.ok(!cssContent.includes("max-height: 250px;\n}"), "max-height 250px rígido deve ter sido relaxado na animação");
  });

  test("2.4 e 2.6: Campos de UI (metricsPanelExpanded, metricsPanelHeight) não devem vazar para o draft nem exportação", () => {
    const appPath = path.resolve(__dirname, "../src/App.tsx");
    const appContent = fs.readFileSync(appPath, "utf-8");

    // specCells mapeia explicitamente os campos canônicos do backend
    const specCellsIndex = appContent.indexOf("const specCells = currentJob?.cells?.map((c) => ({");
    assert.ok(specCellsIndex > 0, "App.tsx deve mapear specCells");

    const specCellsSnippet = appContent.slice(specCellsIndex, specCellsIndex + 400);
    assert.ok(!specCellsSnippet.includes("metricsPanelExpanded"), "metricsPanelExpanded não pode estar no specCells");
    assert.ok(!specCellsSnippet.includes("metricsPanelHeight"), "metricsPanelHeight não pode estar no specCells");
    assert.ok(!specCellsSnippet.includes("showMetricsPanel"), "showMetricsPanel não pode estar no specCells");
  });
});

