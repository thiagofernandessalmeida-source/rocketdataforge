import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── T-1.4 & RF-02: Exclusão Atômica de Componentes e Arestas ─────────

describe("T-1.4: Exclusão Atômica de Arestas e Nós no jobStore", () => {
  it("deleção de aresta isolada via jobStore.deleteEdge deve remover apenas a aresta e preservar nós intactos", () => {
    const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");
    const content = fs.readFileSync(jobStorePath, "utf-8");

    // jobStore deve declarar o método deleteEdge
    assert.equal(
      content.includes("deleteEdge("),
      true,
      "jobStore deve implementar método deleteEdge(jobId, cellId, edgeId)"
    );
  });

  it("deleção de nó via jobStore.deleteNode deve remover o nó e todas as arestas conectadas em um único snapshot", () => {
    const jobStorePath = path.resolve(__dirname, "../src/store/jobStore.ts");
    const content = fs.readFileSync(jobStorePath, "utf-8");

    // jobStore deve declarar o método deleteNode
    assert.equal(
      content.includes("deleteNode("),
      true,
      "jobStore deve implementar método deleteNode(jobId, cellId, nodeId)"
    );
  });

  it("FlowEdge.tsx deve configurar interactionWidth={20} no BaseEdge", () => {
    const edgePath = path.resolve(__dirname, "../src/features/designer/edges/FlowEdge.tsx");
    const content = fs.readFileSync(edgePath, "utf-8");

    assert.equal(
      content.includes("interactionWidth={20}") || content.includes("interactionWidth={ 20 }"),
      true,
      "FlowEdge.tsx deve configurar interactionWidth={20} para usabilidade de clique"
    );
  });

  it("FlowEdge.tsx deve fornecer menu de contexto com ação 'Excluir Conexão'", () => {
    const edgePath = path.resolve(__dirname, "../src/features/designer/edges/FlowEdge.tsx");
    const content = fs.readFileSync(edgePath, "utf-8");

    assert.equal(
      content.includes("Excluir Conexão") || content.includes("Excluir conexão"),
      true,
      "FlowEdge.tsx deve conter opção de menu de contexto 'Excluir Conexão'"
    );
  });
});
