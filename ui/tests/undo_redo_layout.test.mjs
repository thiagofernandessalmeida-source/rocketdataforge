import { describe, it } from "node:test";
import assert from "node:assert/strict";
import dagre from "dagre";

// ─── Auto-Layout Function Under Test ─────────────────────────
const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

function getLayoutedElements(nodes, edges, direction = "LR") {
  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges };
  }

  const isHorizontal = direction === "LR";
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: isHorizontal ? 50 : 60,
    ranksep: isHorizontal ? 90 : 70,
    marginx: 40,
    marginy: 40,
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      dagreGraph.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const x = nodeWithPosition ? nodeWithPosition.x - NODE_WIDTH / 2 : node.position.x;
    const y = nodeWithPosition ? nodeWithPosition.y - NODE_HEIGHT / 2 : node.position.y;

    return {
      ...node,
      targetPosition: isHorizontal ? "left" : "top",
      sourcePosition: isHorizontal ? "right" : "bottom",
      position: { x, y },
      data: {
        ...node.data,
        layoutDirection: direction,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ─── Undo/Redo & Clipboard Engine Under Test ─────────────────
class HistoryManager {
  constructor() {
    this.undoStacks = {};
    this.redoStacks = {};
    this.clipboard = null;
  }

  takeSnapshot(jobId, cells, activeCellId) {
    if (!this.undoStacks[jobId]) this.undoStacks[jobId] = [];
    this.undoStacks[jobId].push({
      cells: JSON.parse(JSON.stringify(cells || [])),
      activeCellId,
    });
    this.redoStacks[jobId] = [];
  }

  canUndo(jobId) {
    return Boolean(this.undoStacks[jobId] && this.undoStacks[jobId].length > 0);
  }

  canRedo(jobId) {
    return Boolean(this.redoStacks[jobId] && this.redoStacks[jobId].length > 0);
  }

  undo(jobId, currentCells, currentActive) {
    if (!this.canUndo(jobId)) return null;
    const previous = this.undoStacks[jobId].pop();
    if (!this.redoStacks[jobId]) this.redoStacks[jobId] = [];
    this.redoStacks[jobId].push({
      cells: JSON.parse(JSON.stringify(currentCells || [])),
      activeCellId: currentActive,
    });
    return previous;
  }

  redo(jobId, currentCells, currentActive) {
    if (!this.canRedo(jobId)) return null;
    const next = this.redoStacks[jobId].pop();
    if (!this.undoStacks[jobId]) this.undoStacks[jobId] = [];
    this.undoStacks[jobId].push({
      cells: JSON.parse(JSON.stringify(currentCells || [])),
      activeCellId: currentActive,
    });
    return next;
  }

  copyNodes(nodes, cellId) {
    this.clipboard = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      cellId,
    };
  }

  hasClipboard() {
    return Boolean(this.clipboard && this.clipboard.nodes.length > 0);
  }

  pasteNodes(targetCell, existingAllNodes) {
    if (!this.hasClipboard()) return [];
    const pasted = [];
    const existingIds = new Set(existingAllNodes.map((n) => n.id.toLowerCase()));

    this.clipboard.nodes.forEach((node, idx) => {
      let count = 1;
      let newId = `${node.id}_copy_${count}`;
      while (existingIds.has(newId.toLowerCase())) {
        count++;
        newId = `${node.id}_copy_${count}`;
      }
      existingIds.add(newId.toLowerCase());

      pasted.push({
        ...node,
        id: newId,
        position: {
          x: node.position.x + 35 * (idx + 1),
          y: node.position.y + 35 * (idx + 1),
        },
        selected: true,
        data: {
          ...node.data,
          label: `${node.data?.label || node.id} (Cópia)`,
          cellId: targetCell.id,
        },
      });
    });
    return pasted;
  }
}

describe("Auto-Layout Direcional (Horizontal 'LR' vs Vertical 'TB')", () => {
  it("1. Deve reorganizar todos os nós na horizontal (LR) e definir layoutDirection e handles corretos", () => {
    const nodes = [
      { id: "node_1", type: "genericNode", position: { x: 0, y: 0 }, data: { label: "Input" } },
      { id: "node_2", type: "genericNode", position: { x: 0, y: 100 }, data: { label: "Filter" } },
      { id: "node_3", type: "genericNode", position: { x: 0, y: 200 }, data: { label: "Output" } },
    ];
    const edges = [
      { id: "e1", source: "node_1", target: "node_2" },
      { id: "e2", source: "node_2", target: "node_3" },
    ];

    const resultLR = getLayoutedElements(nodes, edges, "LR");
    assert.equal(resultLR.nodes.length, 3);

    // Em LR, node_1.x < node_2.x < node_3.x (fluxo da esquerda para a direita)
    const n1 = resultLR.nodes.find((n) => n.id === "node_1");
    const n2 = resultLR.nodes.find((n) => n.id === "node_2");
    const n3 = resultLR.nodes.find((n) => n.id === "node_3");

    assert.ok(n1.position.x < n2.position.x, `node_1 (${n1.position.x}) deve estar à esquerda de node_2 (${n2.position.x})`);
    assert.ok(n2.position.x < n3.position.x, `node_2 (${n2.position.x}) deve estar à esquerda de node_3 (${n3.position.x})`);

    // Todos os nós devem ter targetPosition='left', sourcePosition='right' e layoutDirection='LR'
    resultLR.nodes.forEach((n) => {
      assert.equal(n.targetPosition, "left");
      assert.equal(n.sourcePosition, "right");
      assert.equal(n.data.layoutDirection, "LR");
    });
  });

  it("2. Deve reorganizar todos os nós na vertical (TB) e definir layoutDirection e handles corretos", () => {
    const nodes = [
      { id: "node_1", type: "genericNode", position: { x: 0, y: 0 }, data: { label: "Input" } },
      { id: "node_2", type: "genericNode", position: { x: 200, y: 0 }, data: { label: "Filter" } },
      { id: "node_3", type: "genericNode", position: { x: 400, y: 0 }, data: { label: "Output" } },
    ];
    const edges = [
      { id: "e1", source: "node_1", target: "node_2" },
      { id: "e2", source: "node_2", target: "node_3" },
    ];

    const resultTB = getLayoutedElements(nodes, edges, "TB");
    assert.equal(resultTB.nodes.length, 3);

    // Em TB, node_1.y < node_2.y < node_3.y (fluxo de cima para baixo)
    const n1 = resultTB.nodes.find((n) => n.id === "node_1");
    const n2 = resultTB.nodes.find((n) => n.id === "node_2");
    const n3 = resultTB.nodes.find((n) => n.id === "node_3");

    assert.ok(n1.position.y < n2.position.y, `node_1 (${n1.position.y}) deve estar acima de node_2 (${n2.position.y})`);
    assert.ok(n2.position.y < n3.position.y, `node_2 (${n2.position.y}) deve estar acima de node_3 (${n3.position.y})`);

    // Todos os nós devem ter targetPosition='top', sourcePosition='bottom' e layoutDirection='TB'
    resultTB.nodes.forEach((n) => {
      assert.equal(n.targetPosition, "top");
      assert.equal(n.sourcePosition, "bottom");
      assert.equal(n.data.layoutDirection, "TB");
    });
  });

  it("3. Ignora arestas cruzadas ou inválidas sem quebrar o Dagre", () => {
    const nodes = [
      { id: "node_A", position: { x: 0, y: 0 }, data: {} },
      { id: "node_B", position: { x: 100, y: 100 }, data: {} },
    ];
    // Aresta apontando para nó inexistente node_Z de outra célula
    const edges = [
      { id: "e1", source: "node_A", target: "node_B" },
      { id: "e_cross", source: "node_A", target: "node_Z" },
    ];

    const result = getLayoutedElements(nodes, edges, "LR");
    assert.equal(result.nodes.length, 2);
    assert.ok(Number.isFinite(result.nodes[0].position.x));
    assert.ok(Number.isFinite(result.nodes[1].position.x));
  });
});

describe("Undo / Redo (History) & Node Copy / Paste Engine", () => {
  it("1. Deve criar snapshot e permitir desfazer (undo) e refazer (redo) alterações", () => {
    const history = new HistoryManager();
    const jobId = "job-1";

    let cells = [{ id: "cell-1", nodes: [] }];
    let activeId = "cell-1";

    // Snapshot inicial
    history.takeSnapshot(jobId, cells, activeId);
    assert.equal(history.canUndo(jobId), true);
    assert.equal(history.canRedo(jobId), false);

    // Modificação: Adiciona nós
    cells = [
      {
        id: "cell-1",
        nodes: [
          { id: "n1", position: { x: 10, y: 10 }, data: { label: "N1" } },
          { id: "n2", position: { x: 200, y: 10 }, data: { label: "N2" } },
        ],
      },
    ];

    // Desfazer (Undo)
    const previous = history.undo(jobId, cells, activeId);
    assert.notEqual(previous, null);
    assert.equal(previous.cells[0].nodes.length, 0, "Após desfazer, células retornam ao estado vazio");
    assert.equal(history.canRedo(jobId), true);

    // Refazer (Redo)
    const next = history.redo(jobId, previous.cells, previous.activeCellId);
    assert.notEqual(next, null);
    assert.equal(next.cells[0].nodes.length, 2, "Após refazer, os 2 nós são restaurados");
  });

  it("2. Deve copiar componente(s) e colar com novo ID e deslocamento de coordenadas", () => {
    const history = new HistoryManager();
    const originalNode = {
      id: "postgres_source_1",
      position: { x: 100, y: 100 },
      data: { label: "Postgres Input" },
    };

    assert.equal(history.hasClipboard(), false);
    history.copyNodes([originalNode], "cell-1");
    assert.equal(history.hasClipboard(), true);

    const pasted = history.pasteNodes({ id: "cell-2" }, [originalNode]);
    assert.equal(pasted.length, 1);
    assert.notEqual(pasted[0].id, "postgres_source_1");
    assert.equal(pasted[0].position.x, 135);
    assert.equal(pasted[0].position.y, 135);
    assert.equal(pasted[0].data.cellId, "cell-2");
    assert.equal(pasted[0].data.label, "Postgres Input (Cópia)");
  });
});
