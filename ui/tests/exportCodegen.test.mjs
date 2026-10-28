import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Fase 3: Gerador de Código Autônomo e Airflow DAG (UI - T-3.5)", () => {
  test("T-3.5: types/index.ts deve exportar interfaces StandaloneCodeResult, AirflowDagResult e AirflowExportOptions", () => {
    const typesFile = path.resolve(__dirname, "../src/types/index.ts");
    const content = fs.readFileSync(typesFile, "utf-8");

    assert.ok(content.includes("export interface StandaloneCodeResult"), "Deve conter StandaloneCodeResult");
    assert.ok(content.includes("export interface AirflowDagResult"), "Deve conter AirflowDagResult");
    assert.ok(content.includes("export interface AirflowExportOptions"), "Deve conter AirflowExportOptions");
  });

  test("T-3.5: api/client.ts deve expor métodos de exportação autônoma e Airflow", () => {
    const clientFile = path.resolve(__dirname, "../src/api/client.ts");
    const content = fs.readFileSync(clientFile, "utf-8");

    assert.ok(content.includes("exportStandaloneCode:"), "api deve exportar exportStandaloneCode");
    assert.ok(content.includes("exportAirflowDag:"), "api deve exportar exportAirflowDag");
  });

  test("T-3.5: ExportCodegenModal.tsx deve existir com suporte a abas Standalone e Airflow", () => {
    const modalFile = path.resolve(__dirname, "../src/features/designer/codegen/ExportCodegenModal.tsx");
    assert.ok(fs.existsSync(modalFile), "ExportCodegenModal.tsx deve existir");

    const content = fs.readFileSync(modalFile, "utf-8");
    assert.ok(content.includes("tab-btn-standalone"), "Deve conter aba de Python Autônomo");
    assert.ok(content.includes("tab-btn-airflow"), "Deve conter aba de Apache Airflow DAG");
    assert.ok(content.includes("btn-download-code"), "Deve conter botão para download de script");
    assert.ok(content.includes("btn-copy-code"), "Deve conter botão para copiar código");
    assert.ok(content.includes("Zero Plaintext Secrets"), "Deve exibir badge de segurança");
  });

  test("T-3.5: Canvas.tsx deve renderizar o botão de exportar código e integrar o ExportCodegenModal", () => {
    const canvasFile = path.resolve(__dirname, "../src/features/designer/Canvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");

    assert.ok(content.includes("btn-export-codegen"), "Canvas deve conter botão com id/classe btn-export-codegen");
    assert.ok(content.includes("<ExportCodegenModal"), "Canvas deve integrar o componente ExportCodegenModal");
    assert.ok(content.includes("isExportModalOpen"), "Canvas deve gerenciar o estado isExportModalOpen");
  });
});
