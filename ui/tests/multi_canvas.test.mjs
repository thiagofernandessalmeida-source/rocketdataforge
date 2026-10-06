import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Implementation functions under test (from jobStore) ───────
function evaluateCellPreconditions(cell, completedStatuses, allCells = []) {
  if (!cell.preconditions || cell.preconditions.length === 0) {
    return true;
  }

  const results = cell.preconditions.map((p) => {
    const targetCell = allCells.find(
      (c) => c.id === p.targetCellId || c.name === p.targetCellId
    );
    const targetKey = targetCell ? targetCell.id : p.targetCellId;
    const actualStatus = completedStatuses[targetKey] || (targetCell ? completedStatuses[targetCell.name] : undefined);

    if (!actualStatus) return false;
    if (p.expectedStatus === "OK") return actualStatus === "success";
    if (p.expectedStatus === "ERROR") return actualStatus === "failed";
    return false;
  });

  if (cell.preconditionOperator === "OR") {
    return results.some((r) => r === true);
  }
  return results.every((r) => r === true);
}

function detectCellCycles(cells) {
  const cellIds = cells.map((c) => c.id);
  const cellIdSet = new Set(cellIds);
  const adjList = {};
  const inDegree = {};

  cellIds.forEach((id) => {
    adjList[id] = [];
    inDegree[id] = 0;
  });

  for (const cell of cells) {
    for (const p of cell.preconditions || []) {
      const target = cells.find((c) => c.id === p.targetCellId || c.name === p.targetCellId);
      const targetId = target ? target.id : p.targetCellId;

      if (targetId === cell.id) {
        return [cell.id];
      }
      if (cellIdSet.has(targetId)) {
        adjList[targetId].push(cell.id);
        inDegree[cell.id] = (inDegree[cell.id] || 0) + 1;
      }
    }
  }

  const queue = cellIds.filter((id) => inDegree[id] === 0);
  const visited = [];

  while (queue.length > 0) {
    const curr = queue.shift();
    visited.push(curr);
    for (const neighbor of adjList[curr] || []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (visited.length < cellIds.length) {
    return cellIds.filter((id) => inDegree[id] > 0);
  }
  return null;
}

// ─── Simulation of jobStore methods for testing ───────────────
function createTestJobStore() {
  let state = {
    jobs: [],
  };

  return {
    createJob(name, env = "dev") {
      const defaultCell = {
        id: "canvas-cell-01",
        name: "canvas-cell-01",
        description: "",
        order: 1,
        preconditions: [],
        preconditionOperator: "AND",
        nodes: [],
        edges: [],
        status: "idle",
      };
      const job = {
        id: `job-${Date.now()}`,
        name,
        nodes: [],
        edges: [],
        cells: [defaultCell],
        activeCellId: "canvas-cell-01",
        environment: env,
      };
      state.jobs.push(job);
      return job;
    },

    createCell(jobId, customName) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return null;

      const existingCells = job.cells || [];
      const nextIndex = existingCells.length + 1;
      const defaultId = `canvas-cell-${String(nextIndex).padStart(2, "0")}`;
      const name = (customName?.trim() || defaultId).slice(0, 50);

      const maxOrder = existingCells.reduce((max, c) => Math.max(max, c.order || 0), 0);
      const prevCell = existingCells[existingCells.length - 1];
      const defaultPreconditions = prevCell
        ? [
            {
              id: `prec-${Date.now()}`,
              targetCellId: prevCell.id,
              expectedStatus: "OK",
            },
          ]
        : [];

      const newCell = {
        id: defaultId,
        name,
        description: "",
        order: maxOrder + 1,
        preconditions: defaultPreconditions,
        preconditionOperator: "AND",
        nodes: [],
        edges: [],
        status: "idle",
      };

      job.cells.push(newCell);
      job.activeCellId = newCell.id;
      return newCell;
    },

    renameCell(jobId, oldCellIdOrName, newName) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;

      const safeName = newName.trim().slice(0, 50);
      if (!safeName) return;

      const oldTarget = oldCellIdOrName;
      job.cells = job.cells.map((cell) => {
        let c = { ...cell };
        const matches = c.id === oldTarget || c.name === oldTarget;
        if (matches) {
          c.name = safeName;
          if (c.id === oldTarget) {
            c.id = safeName;
          }
        }

        // Cascading rename in preconditions
        if (Array.isArray(c.preconditions)) {
          c.preconditions = c.preconditions.map((p) =>
            p.targetCellId === oldTarget ? { ...p, targetCellId: safeName } : p
          );
        }

        // Cascading rename in nodes
        if (Array.isArray(c.nodes)) {
          const oldClean = oldTarget.replace(/-/g, "_").toLowerCase();
          const newClean = safeName.replace(/-/g, "_").toLowerCase();
          c.nodes = c.nodes.map((node) => {
            const cfg = node.data?.config;
            if (!cfg) return node;
            const newCfg = { ...cfg };
            let changed = false;
            if (newCfg.source_cell === oldTarget) {
              newCfg.source_cell = safeName;
              changed = true;
            }
            if (newCfg.table === `cell_output_${oldClean}`) {
              newCfg.table = `cell_output_${newClean}`;
              changed = true;
            }
            return changed ? { ...node, data: { ...node.data, config: newCfg } } : node;
          });
        }
        return c;
      });

      if (job.activeCellId === oldTarget) {
        job.activeCellId = safeName;
      }
    },

    deleteCell(jobId, cellId) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job || !job.cells || job.cells.length <= 1) return false;

      job.cells = job.cells
        .filter((c) => c.id !== cellId)
        .map((c) => ({
          ...c,
          preconditions: (c.preconditions || []).filter((p) => p.targetCellId !== cellId),
        }));

      if (job.activeCellId === cellId) {
        job.activeCellId = job.cells[0]?.id || "canvas-cell-01";
      }
      return true;
    },

    duplicateCell(jobId, cellId) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return null;

      const source = job.cells.find((c) => c.id === cellId);
      if (!source) return null;

      const nextIndex = job.cells.length + 1;
      const newId = `canvas-cell-${String(nextIndex).padStart(2, "0")}`;
      const newName = `Cópia de ${source.name}`.slice(0, 50);
      const maxOrder = job.cells.reduce((max, c) => Math.max(max, c.order || 0), 0);

      const cloned = {
        ...source,
        id: newId,
        name: newName,
        order: maxOrder + 1,
        preconditions: [...source.preconditions],
        nodes: source.nodes.map((n) => ({ ...n, id: `${n.id}_copy` })),
      };

      job.cells.push(cloned);
      return cloned;
    },

    reorderCells(jobId, orderedCellIds) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;

      const cellMap = new Map(job.cells.map((c) => [c.id, c]));
      job.cells = orderedCellIds
        .map((id, index) => {
          const c = cellMap.get(id);
          return c ? { ...c, order: index + 1 } : null;
        })
        .filter(Boolean);
    },

    getJob(id) {
      return state.jobs.find((j) => j.id === id);
    },
  };
}

describe("Multi-Canvas (Canvas-Cells): Ciclo de Vida e Criação", () => {
  it("deve criar um novo job com uma canvas-cell padrão (canvas-cell-01, ordem 1)", () => {
    const store = createTestJobStore();
    const job = store.createJob("ETL Pipeline Vendas");

    assert.equal(job.cells.length, 1);
    assert.equal(job.cells[0].id, "canvas-cell-01");
    assert.equal(job.cells[0].name, "canvas-cell-01");
    assert.equal(job.cells[0].order, 1);
    assert.equal(job.cells[0].preconditions.length, 0);
  });

  it("ao adicionar nova célula (canvas-cell-02), deve criar pré-condição padrão apontando para a célula anterior", () => {
    const store = createTestJobStore();
    const job = store.createJob("ETL Clientes");

    const cell2 = store.createCell(job.id);
    assert.equal(cell2.id, "canvas-cell-02");
    assert.equal(cell2.order, 2);
    assert.equal(cell2.preconditions.length, 1);
    assert.equal(cell2.preconditions[0].targetCellId, "canvas-cell-01");
    assert.equal(cell2.preconditions[0].expectedStatus, "OK");

    const cell3 = store.createCell(job.id, "Carga Staging");
    assert.equal(cell3.name, "Carga Staging");
    assert.equal(cell3.order, 3);
    assert.equal(cell3.preconditions[0].targetCellId, "canvas-cell-02");
  });

  it("deve limitar o nome da célula a 50 caracteres", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Teste");
    const longName = "A".repeat(80);
    const cell = store.createCell(job.id, longName);

    assert.equal(cell.name.length, 50);
  });
});

describe("Multi-Canvas (Canvas-Cells): Propagação de Renomeação (Cascading Rename)", () => {
  it("deve varrer o Job e atualizar referências em pré-condições de outras células", () => {
    const store = createTestJobStore();
    const job = store.createJob("ETL Completo");

    store.createCell(job.id, "Etapa 02"); // depende de canvas-cell-01
    store.createCell(job.id, "Etapa 03"); // depende de canvas-cell-02

    // Renomeia canvas-cell-01 -> Extracao_Raw
    store.renameCell(job.id, "canvas-cell-01", "Extracao_Raw");

    const j = store.getJob(job.id);
    assert.equal(j.cells[0].name, "Extracao_Raw");
    assert.equal(j.cells[1].preconditions[0].targetCellId, "Extracao_Raw");
  });

  it("deve atualizar referências em nós com conexões entre células (source_cell / tabelas temporárias)", () => {
    const store = createTestJobStore();
    const job = store.createJob("ETL com Data Handoff");

    const cell2 = store.createCell(job.id, "cell_transform");
    cell2.nodes = [
      {
        id: "node_duckdb_read",
        data: {
          config: {
            source_cell: "canvas-cell-01",
            table: "cell_output_canvas_cell_01",
          },
        },
      },
    ];

    store.renameCell(job.id, "canvas-cell-01", "stage_bronze");

    const j = store.getJob(job.id);
    const nodeCfg = j.cells[1].nodes[0].data.config;
    assert.equal(nodeCfg.source_cell, "stage_bronze");
    assert.equal(nodeCfg.table, "cell_output_stage_bronze");
  });
});

describe("Multi-Canvas (Canvas-Cells): Avaliação de Pré-condições e Operadores Lógicos", () => {
  it("deve aprovar execução com operador AND apenas se todas as pré-condições forem satisfeitas", () => {
    const cell = {
      id: "cell-03",
      name: "cell-03",
      preconditionOperator: "AND",
      preconditions: [
        { id: "p1", targetCellId: "cell-01", expectedStatus: "OK" },
        { id: "p2", targetCellId: "cell-02", expectedStatus: "OK" },
      ],
    };

    // Caso 1: Apenas cell-01 concluída
    assert.equal(
      evaluateCellPreconditions(cell, { "cell-01": "success" }),
      false,
      "Não deve executar se cell-02 ainda não concluiu"
    );

    // Caso 2: Ambas concluídas com sucesso
    assert.equal(
      evaluateCellPreconditions(cell, { "cell-01": "success", "cell-02": "success" }),
      true,
      "Deve executar quando ambas forem OK"
    );

    // Caso 3: Uma falhou
    assert.equal(
      evaluateCellPreconditions(cell, { "cell-01": "success", "cell-02": "failed" }),
      false,
      "Não deve executar se uma falhou"
    );
  });

  it("deve aprovar execução com operador OR se pelo menos uma for satisfeita", () => {
    const cell = {
      id: "cell-consolidate",
      name: "cell-consolidate",
      preconditionOperator: "OR",
      preconditions: [
        { id: "p1", targetCellId: "cell-stream", expectedStatus: "OK" },
        { id: "p2", targetCellId: "cell-batch", expectedStatus: "OK" },
      ],
    };

    assert.equal(
      evaluateCellPreconditions(cell, { "cell-stream": "failed", "cell-batch": "success" }),
      true,
      "Deve executar no OR se pelo menos uma deu OK"
    );

    assert.equal(
      evaluateCellPreconditions(cell, { "cell-stream": "failed", "cell-batch": "failed" }),
      false,
      "Não deve executar se todas falharam"
    );
  });

  it("deve suportar tratamento de erro (catch/fallback) com expectedStatus ERROR", () => {
    const cellFallback = {
      id: "cell-catch-notify",
      name: "cell-catch-notify",
      preconditionOperator: "AND",
      preconditions: [
        { id: "p1", targetCellId: "cell-etl-critico", expectedStatus: "ERROR" },
      ],
    };

    // Se a célula anterior foi OK, o catch não dispara
    assert.equal(
      evaluateCellPreconditions(cellFallback, { "cell-etl-critico": "success" }),
      false
    );

    // Se a célula anterior falhou, o catch dispara!
    assert.equal(
      evaluateCellPreconditions(cellFallback, { "cell-etl-critico": "failed" }),
      true
    );
  });
});

describe("Multi-Canvas (Canvas-Cells): Prevenção de Ciclos Globais", () => {
  it("deve retornar null para topologia linear sem ciclos", () => {
    const cells = [
      { id: "c1", name: "c1", preconditions: [] },
      { id: "c2", name: "c2", preconditions: [{ targetCellId: "c1", expectedStatus: "OK" }] },
      { id: "c3", name: "c3", preconditions: [{ targetCellId: "c2", expectedStatus: "OK" }] },
    ];

    const cycle = detectCellCycles(cells);
    assert.equal(cycle, null);
  });

  it("deve detectar e identificar ciclo circular entre células (C1 -> C2 -> C1)", () => {
    const cells = [
      { id: "c1", name: "c1", preconditions: [{ targetCellId: "c2", expectedStatus: "OK" }] },
      { id: "c2", name: "c2", preconditions: [{ targetCellId: "c1", expectedStatus: "OK" }] },
    ];

    const cycle = detectCellCycles(cells);
    assert.notEqual(cycle, null);
    assert.ok(cycle.includes("c1"));
    assert.ok(cycle.includes("c2"));
  });

  it("deve detectar auto-dependência de célula", () => {
    const cells = [
      { id: "c1", name: "c1", preconditions: [{ targetCellId: "c1", expectedStatus: "OK" }] },
    ];

    const cycle = detectCellCycles(cells);
    assert.notEqual(cycle, null);
    assert.deepEqual(cycle, ["c1"]);
  });
});

describe("Multi-Canvas (Canvas-Cells): Operações Estruturais (Duplicar, Reordenar, Excluir)", () => {
  it("deve duplicar célula com novos nós e incrementar a ordem", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Duplicação");
    job.cells[0].nodes = [{ id: "n1", position: { x: 0, y: 0 }, data: {} }];

    const dup = store.duplicateCell(job.id, "canvas-cell-01");
    assert.equal(dup.name, "Cópia de canvas-cell-01");
    assert.equal(dup.order, 2);
    assert.equal(dup.nodes.length, 1);
    assert.equal(dup.nodes[0].id, "n1_copy");
  });

  it("não deve permitir excluir a única célula existente no job", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Único");

    const deleted = store.deleteCell(job.id, "canvas-cell-01");
    assert.equal(deleted, false);
    assert.equal(store.getJob(job.id).cells.length, 1);
  });

  it("deve excluir célula e limpar dependências quebradas em outras células", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Múltiplas");
    store.createCell(job.id, "cell_2");
    store.createCell(job.id, "cell_3");

    // cell_2 depende de canvas-cell-01
    assert.equal(job.cells[1].preconditions[0].targetCellId, "canvas-cell-01");

    // Exclui canvas-cell-01
    const deleted = store.deleteCell(job.id, "canvas-cell-01");
    assert.equal(deleted, true);

    const j = store.getJob(job.id);
    assert.equal(j.cells.length, 2);
    // Pré-condição órfã para canvas-cell-01 deve ter sido removida
    assert.equal(j.cells[0].preconditions.length, 0);
  });

  it("deve reordenar a sequência de execução das células", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Reordenar");
    store.createCell(job.id, "cell_2");
    store.createCell(job.id, "cell_3");

    store.reorderCells(job.id, ["canvas-cell-03", "canvas-cell-01", "canvas-cell-02"]);

    const j = store.getJob(job.id);
    assert.equal(j.cells[0].id, "canvas-cell-03");
    assert.equal(j.cells[0].order, 1);
    assert.equal(j.cells[1].id, "canvas-cell-01");
    assert.equal(j.cells[1].order, 2);
    assert.equal(j.cells[2].id, "canvas-cell-02");
    assert.equal(j.cells[2].order, 3);
  });
});
