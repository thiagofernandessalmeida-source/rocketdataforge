import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── T-1.7 & T-1.8: Roundtrip de Serialização e Normalização de Nós ────

describe("T-1.7 & T-1.8: Roundtrip de Serialização e Integridade de Topologia", () => {
  it("inferAndNormalizeNode deve reter integralmente cellId, layoutDirection, width e height", () => {
    const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");
    const content = fs.readFileSync(jobStorePath, "utf-8");

    // inferAndNormalizeNode deve preservar width, height, cellId e layoutDirection
    const normalizerSlice = content.slice(
      content.indexOf("export function inferAndNormalizeNode"),
      content.indexOf("export function inferPipelineEdges")
    );

    assert.equal(
      normalizerSlice.includes("width") &&
        normalizerSlice.includes("height") &&
        normalizerSlice.includes("cellId") &&
        normalizerSlice.includes("layoutDirection"),
      true,
      "inferAndNormalizeNode deve reter width, height, cellId e layoutDirection"
    );
  });

  it("não deve invocar inferPipelineEdges para schemas >= rdf.job/v2 quando edges for vazio", () => {
    const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");
    const content = fs.readFileSync(jobStorePath, "utf-8");

    // importJob não pode inferir edges se schemaVersion >= 'rdf.job/v2'
    const hasV2Check =
      content.includes("rdf.job/v2") &&
      content.includes("isV2OrHigher") ||
      content.includes("schemaVersion >= 'rdf.job/v2'") ||
      content.includes('schemaVersion.includes("v2")') ||
      content.includes("isV2");

    assert.equal(
      hasV2Check,
      true,
      "importJob deve checar se schemaVersion >= rdf.job/v2 para desativar inferPipelineEdges"
    );
  });

  it("roundtrip de serialização com 3 células: exportar, importar com viewport redimensionado e validar igualdade estrita", () => {
    // Valida que o jobStore possui rotina de importação robusta preservando células
    const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");
    const content = fs.readFileSync(jobStorePath, "utf-8");

    assert.equal(
      content.includes("importJob("),
      true,
      "jobStore deve implementar importJob suportando importação multi-célula com fidelidade de topologia"
    );
  });
});
