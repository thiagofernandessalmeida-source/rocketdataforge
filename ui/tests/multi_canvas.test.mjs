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

function validateParallelCellConsistency(cells) {
  const errors = [];
  for (const cell of cells) {
    for (const p of cell.preconditions || []) {
      const target = cells.find((c) => c.id === p.targetCellId || c.name === p.targetCellId);
      if (target) {
        if (target.order === cell.order) {
          errors.push(
            `A célula "${cell.name}" depende de "${target.name}", mas ambas possuem a mesma ordem de execução (${cell.order}). Células com a mesma ordem executam em paralelo e não podem ter interdependência.`
          );
        } else if (target.order > cell.order) {
          errors.push(
            `A célula "${cell.name}" (ordem ${cell.order}) não pode depender da célula "${target.name}" que possui ordem posterior (${target.order}).`
          );
        }
      }
    }
  }
  return errors.length > 0 ? errors : null;
}

function generateRocketNodeId(typeId, existingNodes = []) {
  let prefix = "node";
  if (typeId.includes("postgresql.output") || typeId.includes("postgres.output")) prefix = "postgres_sink";
  else if (typeId.includes("postgresql") || typeId.includes("postgres") || typeId.includes("database.source")) prefix = "postgres_source";
  else if (typeId.includes("duckdb.output")) prefix = "duckdb_sink";
  else if (typeId.includes("duckdb")) prefix = "duckdb_source";
  else if (typeId.includes("oracle.output")) prefix = "oracle_sink";
  else if (typeId.includes("oracle")) prefix = "oracle_source";
  else if (typeId.includes("sqlserver.output")) prefix = "sqlserver_sink";
  else if (typeId.includes("sqlserver")) prefix = "sqlserver_source";
  else if (typeId.includes("mysql.output")) prefix = "mysql_sink";
  else if (typeId.includes("mysql")) prefix = "mysql_source";
  else if (typeId.includes("file.source.csv") || typeId.includes(".csv")) prefix = "csv_source";
  else if (typeId.includes("file.source.parquet") || typeId.includes(".parquet")) prefix = "parquet_source";
  else if (typeId.includes("file.source.json") || typeId.includes(".json")) prefix = "json_source";
  else if (typeId.includes("file.source.excel") || typeId.includes(".excel")) prefix = "excel_source";
  else if (typeId.includes("file.target")) prefix = "file_sink";
  else if (typeId.includes("file.source")) prefix = "file_source";
  else if (typeId.includes("tmap") || typeId.includes("mapper")) prefix = "data_mapper";
  else if (typeId.includes("filter")) prefix = "filter";
  else if (typeId.includes("select")) prefix = "project";
  else if (typeId.includes("join")) prefix = "join";
  else if (typeId.includes("aggregate")) prefix = "aggregate";
  else if (typeId.includes("sort")) prefix = "sort";
  else if (typeId.includes("deduplicate")) prefix = "dedup";
  else if (typeId.includes("lookup")) prefix = "lookup";
  else if (typeId.includes("union")) prefix = "union";
  else if (typeId.includes("pivot")) prefix = "pivot";
  else {
    const last = typeId.split(".").pop() || "node";
    prefix = last.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  }

  let count = 1;
  const existingIds = new Set(existingNodes.map((n) => n.id.toLowerCase()));
  while (existingIds.has(`${prefix}_${count}`.toLowerCase())) {
    count++;
  }
  return `${prefix}_${count}`;
}

function healDuplicateNodeIdsAcrossCells(cells) {
  const seenIds = new Set();
  let repairedCount = 0;

  const repairedCells = cells.map((cell) => {
    const idMap = {};
    const newNodes = (cell.nodes || []).map((node) => {
      const lower = node.id.toLowerCase();
      if (!seenIds.has(lower)) {
        seenIds.add(lower);
        return {
          ...node,
          data: {
            ...node.data,
            cellId: cell.id,
          },
        };
      }

      repairedCount++;
      let count = 2;
      let candidate = `${node.id}_${count}`;
      while (seenIds.has(candidate.toLowerCase())) {
        count++;
        candidate = `${node.id}_${count}`;
      }
      seenIds.add(candidate.toLowerCase());
      idMap[node.id] = candidate;

      return {
        ...node,
        id: candidate,
        data: {
          ...node.data,
          cellId: cell.id,
        },
      };
    });

    const newEdges = (cell.edges || []).map((edge) => {
      const newSource = idMap[edge.source] || edge.source;
      const newTarget = idMap[edge.target] || edge.target;
      if (newSource !== edge.source || newTarget !== edge.target) {
        return {
          ...edge,
          source: newSource,
          target: newTarget,
        };
      }
      return edge;
    });

    return {
      ...cell,
      nodes: newNodes,
      edges: newEdges,
    };
  });

  return { cells: repairedCells, repairedCount };
}

// ─── Simulation of jobStore methods for testing ───────────────
function createTestJobStore() {
  let state = {
    jobs: [],
    connections: [],
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
        id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

    createCell(jobId, customName, cellType = "CANVAS") {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return null;

      const existingCells = job.cells || [];
      const nextIndex = existingCells.length + 1;
      const prefix = cellType === "PYTHON" ? "python-cell" : "canvas-cell";
      const defaultId = `${prefix}-${String(nextIndex).padStart(2, "0")}`;
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

      const defaultCodeSnippet = cellType === "PYTHON"
        ? `# CellFlow Python Cell\ndf = context.read_output('${prevCell?.id || "canvas-cell-01"}')\ncontext.write_output(df)`
        : undefined;

      const newCell = {
        id: defaultId,
        name,
        cellType,
        codeSnippet: defaultCodeSnippet,
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
      const isPython = source.cellType === "PYTHON";
      const prefix = isPython ? "python-cell" : "canvas-cell";
      const newId = `${prefix}-${String(nextIndex).padStart(2, "0")}`;
      const newName = `Cópia de ${source.name}`.slice(0, 50);
      const maxOrder = job.cells.reduce((max, c) => Math.max(max, c.order || 0), 0);

      const cloned = {
        ...source,
        id: newId,
        name: newName,
        cellType: source.cellType || "CANVAS",
        codeSnippet: source.codeSnippet,
        order: maxOrder + 1,
        preconditions: [...source.preconditions],
        nodes: source.nodes.map((n) => ({ ...n, id: `${n.id}_copy` })),
      };

      job.cells.push(cloned);
      return cloned;
    },

    updateCell(jobId, cellId, updates) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      job.cells = (job.cells || []).map((c) => (c.id === cellId ? { ...c, ...updates } : c));
    },

    updateCellCode(jobId, cellId, codeSnippet) {
      this.updateCell(jobId, cellId, { codeSnippet });
    },

    _pythonCellsEnabled: true,
    isPythonCellsEnabled() {
      return this._pythonCellsEnabled;
    },
    setPythonCellsEnabled(enabled) {
      this._pythonCellsEnabled = Boolean(enabled);
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

    setCellStatus(jobId, cellId, status) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const cell = job.cells.find((c) => c.id === cellId);
      if (cell) cell.status = status;
    },

    resetCellStatus(jobId, cellId) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const cell = job.cells.find((c) => c.id === cellId);
      if (cell) {
        cell.status = "idle";
        cell.metrics = undefined;
        cell.logs = undefined;
        cell.showMetricsPanel = false;
        cell.nodes = (cell.nodes || []).map((n) => ({
          ...n,
          data: { ...n.data, status: undefined, metrics: undefined },
        }));
      }
    },

    resetAllCellsStatus(jobId) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      job.cells.forEach((c) => {
        c.status = "idle";
        c.metrics = undefined;
        c.logs = undefined;
        c.showMetricsPanel = false;
        c.nodes = (c.nodes || []).map((n) => ({
          ...n,
          data: { ...n.data, status: undefined, metrics: undefined },
        }));
      });
    },

    getJob(id) {
      return state.jobs.find((j) => j.id === id);
    },

    saveConnection(conn) {
      const entry = {
        ...conn,
        id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        scope: conn.scope ?? "global",
        jobId: conn.scope === "local" ? conn.jobId : undefined,
      };
      state.connections.push(entry);
      return entry;
    },

    getConnectionsForJob(jobId) {
      if (!jobId) {
        return state.connections.filter((c) => !c.scope || c.scope === "global");
      }
      return state.connections.filter(
        (c) => !c.scope || c.scope === "global" || c.jobId === jobId
      );
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

describe("Multi-Canvas (Canvas-Cells): Consistência de Paralelismo e Ordem", () => {
  it("deve rejeitar pré-condição entre células com a mesma ordem de execução", () => {
    const cells = [
      { id: "c1", name: "Célula 1", order: 2, preconditions: [] },
      { id: "c2", name: "Célula 2", order: 2, preconditions: [{ targetCellId: "c1", expectedStatus: "OK" }] },
    ];

    const errors = validateParallelCellConsistency(cells);
    assert.notEqual(errors, null);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("mesma ordem de execução (2)"));
  });

  it("deve rejeitar pré-condição que aponta para célula com ordem posterior", () => {
    const cells = [
      { id: "c1", name: "Célula 1", order: 1, preconditions: [{ targetCellId: "c2", expectedStatus: "OK" }] },
      { id: "c2", name: "Célula 2", order: 3, preconditions: [] },
    ];

    const errors = validateParallelCellConsistency(cells);
    assert.notEqual(errors, null);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("ordem posterior (3)"));
  });

  it("deve aprovar pré-condição válida apontando para célula de ordem anterior", () => {
    const cells = [
      { id: "c1", name: "Célula 1", order: 1, preconditions: [] },
      { id: "c2", name: "Célula 2", order: 2, preconditions: [{ targetCellId: "c1", expectedStatus: "OK" }] },
      { id: "c3", name: "Célula 3", order: 2, preconditions: [{ targetCellId: "c1", expectedStatus: "OK" }] },
    ];

    const errors = validateParallelCellConsistency(cells);
    assert.equal(errors, null);
  });
});

describe("Multi-Canvas (Canvas-Cells): Reset de Status de Células", () => {
  it("deve resetar o status de uma célula individualmente para idle", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Reset");
    store.createCell(job.id, "cell_2");

    store.setCellStatus(job.id, "canvas-cell-01", "success");
    store.setCellStatus(job.id, "canvas-cell-02", "failed");

    store.resetCellStatus(job.id, "canvas-cell-01");

    const j = store.getJob(job.id);
    assert.equal(j.cells[0].status, "idle");
    assert.equal(j.cells[1].status, "failed");
  });

  it("deve resetar o status de todas as células do job para idle", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Reset All");
    store.createCell(job.id, "cell_2");

    store.setCellStatus(job.id, "canvas-cell-01", "success");
    store.setCellStatus(job.id, "canvas-cell-02", "failed");

    store.resetAllCellsStatus(job.id);

    const j = store.getJob(job.id);
    assert.equal(j.cells[0].status, "idle");
    assert.equal(j.cells[1].status, "idle");
  });
});

describe("Multi-Canvas (Canvas-Cells): Cancelamento e Parada de Execução", () => {
  it("deve permitir transicionar status de uma célula para cancelled", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Cancel Test");
    store.setCellStatus(job.id, "canvas-cell-01", "running");

    const j1 = store.getJob(job.id);
    assert.equal(j1.cells[0].status, "running");

    store.setCellStatus(job.id, "canvas-cell-01", "cancelled");

    const j2 = store.getJob(job.id);
    assert.equal(j2.cells[0].status, "cancelled");
  });

  it("ao cancelar orquestração do job, deve marcar células em execução como cancelled e na fila como skipped", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Stop Orchestration");
    store.createCell(job.id, "cell_2");
    store.createCell(job.id, "cell_3");

    store.setCellStatus(job.id, "canvas-cell-01", "running");
    store.setCellStatus(job.id, "canvas-cell-02", "queued");
    store.setCellStatus(job.id, "canvas-cell-03", "queued");

    // Simulação do comportamento de parada implementado no MultiCanvasContainer/App
    const j = store.getJob(job.id);
    j.cells.forEach((c) => {
      if (c.status === "running") {
        store.setCellStatus(job.id, c.id, "cancelled");
      } else if (c.status === "queued") {
        store.setCellStatus(job.id, c.id, "skipped");
      }
    });

    const updated = store.getJob(job.id);
    assert.equal(updated.cells[0].status, "cancelled");
    assert.equal(updated.cells[1].status, "skipped");
    assert.equal(updated.cells[2].status, "skipped");
  });
});

describe("Multi-Canvas: Validação de Grafo e Prevenção de ERR_EMPTY_GRAPH", () => {
  function testAnalyzeJobProblems(job, fallbackNodes = [], fallbackEdges = []) {
    const hasCells = Boolean(job?.cells && job.cells.length > 0);
    if (!hasCells) {
      if (fallbackNodes.length === 0) {
        return [{ code: "ERR_EMPTY_GRAPH", message: "Nenhum componente foi adicionado ao Canvas." }];
      }
      return [];
    }

    const totalNodesCount = (job.cells || []).reduce((acc, c) => acc + (c.nodes?.length || 0), 0);
    if (totalNodesCount === 0) {
      return [{ code: "ERR_EMPTY_GRAPH", message: "Nenhum componente foi adicionado ao Canvas." }];
    }

    const problems = [];
    (job.cells || []).forEach((cell) => {
      if (!cell.nodes || cell.nodes.length === 0) {
        problems.push({ code: "WARN_EMPTY_CELL", message: `A célula "${cell.name}" está vazia.` });
      }
    });
    return problems;
  }

  it("não deve gerar ERR_EMPTY_GRAPH quando um job multi-canvas possui componentes em qualquer célula", () => {
    const store = createTestJobStore();
    const job = store.createJob("Pipeline com Nós na Célula 1");
    // Adiciona nós dentro da célula
    job.cells[0].nodes = [
      { id: "csv_source_01", data: { componentType: "file.source.csv", category: "source" } },
      { id: "duckdb_sink_01", data: { componentType: "connector.db.duckdb.output", category: "target" } },
    ];
    job.cells[0].edges = [
      { id: "e1", source: "csv_source_01", target: "duckdb_sink_01" },
    ];

    // fallbackNodes no App.tsx estariam vazios ([]), mas o job tem componentes
    const fallbackNodes = [];
    const fallbackEdges = [];
    const problems = testAnalyzeJobProblems(job, fallbackNodes, fallbackEdges);

    const hasEmptyGraphError = problems.some((p) => p.code === "ERR_EMPTY_GRAPH");
    assert.equal(hasEmptyGraphError, false, "Não deve reportar ERR_EMPTY_GRAPH quando a célula possui componentes");
  });

  it("deve gerar ERR_EMPTY_GRAPH se todas as células estiverem totalmente vazias", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Vazio");
    job.cells[0].nodes = [];
    job.cells[0].edges = [];

    const problems = testAnalyzeJobProblems(job, [], []);
    assert.equal(problems[0].code, "ERR_EMPTY_GRAPH");
  });
});

describe("Gerenciador de Conexões: Suporte a DuckDB e Escopo Global vs Local", () => {
  it("deve permitir cadastrar e persistir conexão DuckDB com parâmetros em memória e arquivo", () => {
    const store = createTestJobStore();
    const duckConn = store.saveConnection({
      name: "DuckDB In-Memory Dev",
      type: "duckdb",
      config: {
        database_path: ":memory:",
        memory_limit: "2GB",
        read_only: false,
      },
      environments: ["dev", "hml"],
      scope: "global",
    });

    assert.equal(duckConn.type, "duckdb");
    assert.equal(duckConn.config.database_path, ":memory:");
    assert.equal(duckConn.scope, "global");
  });

  it("deve suportar escopo local atribuído a um job específico e filtrar corretamente", () => {
    const store = createTestJobStore();
    const jobA = store.createJob("Job A");
    const jobB = store.createJob("Job B");

    // Conexão Global
    const globalConn = store.saveConnection({
      name: "PostgreSQL Corporativo",
      type: "postgresql",
      config: { host: "db.empresa.com", port: 5432 },
      environments: ["dev", "prd"],
      scope: "global",
    });

    // Conexão Local do Job A (DuckDB de staging exclusivo do Job A)
    const localConnA = store.saveConnection({
      name: "DuckDB Local Staging A",
      type: "duckdb",
      config: { database_path: "data/job_a_stage.duckdb" },
      environments: ["dev"],
      scope: "local",
      jobId: jobA.id,
    });

    // Conexão Local do Job B
    const localConnB = store.saveConnection({
      name: "DuckDB Local Staging B",
      type: "duckdb",
      config: { database_path: "data/job_b_stage.duckdb" },
      environments: ["dev"],
      scope: "local",
      jobId: jobB.id,
    });

    // No Job A: deve ver a conexão Global e a conexão Local do Job A, mas NÃO a do Job B
    const connsJobA = store.getConnectionsForJob(jobA.id);
    assert.equal(connsJobA.some((c) => c.name === "PostgreSQL Corporativo"), true);
    assert.equal(connsJobA.some((c) => c.name === "DuckDB Local Staging A"), true);
    assert.equal(connsJobA.some((c) => c.name === "DuckDB Local Staging B"), false);

    // No Job B: deve ver a conexão Global e a conexão Local do Job B, mas NÃO a do Job A
    const connsJobB = store.getConnectionsForJob(jobB.id);
    assert.equal(connsJobB.some((c) => c.name === "PostgreSQL Corporativo"), true);
    assert.equal(connsJobB.some((c) => c.name === "DuckDB Local Staging A"), false);
    assert.equal(connsJobB.some((c) => c.name === "DuckDB Local Staging B"), true);

    // Sem jobId (visão geral/global): vê apenas conexões globais
    const connsGeneral = store.getConnectionsForJob(undefined);
    assert.equal(connsGeneral.some((c) => c.name === "PostgreSQL Corporativo"), true);
    assert.equal(connsGeneral.some((c) => c.name === "DuckDB Local Staging A"), false);
    assert.equal(connsGeneral.some((c) => c.name === "DuckDB Local Staging B"), false);
  });
});

describe("Multi-Canvas: Unicidade Global de IDs de Componentes entre Células", () => {
  it("deve gerar IDs únicos para componentes do mesmo tipo adicionados em células distintas", () => {
    // Célula 1 já possui um DuckDB Output
    const cell1Nodes = [
      { id: "duckdb_sink_1", data: { componentType: "connector.db.duckdb.output" } },
    ];
    // Célula 2 está vazia
    const cell2Nodes = [];

    // Todos os nós existentes no Job
    const allJobNodes = [...cell1Nodes, ...cell2Nodes];

    // Ao adicionar DuckDB Output na Célula 2, deve checar allJobNodes e gerar duckdb_sink_2
    const newIdCell2 = generateRocketNodeId("connector.db.duckdb.output", allJobNodes);
    assert.equal(newIdCell2, "duckdb_sink_2");

    // Ao adicionar outro DuckDB Output na Célula 1 considerando o nó da Célula 2, gera duckdb_sink_3
    const updatedJobNodes = [...allJobNodes, { id: newIdCell2, data: { componentType: "connector.db.duckdb.output" } }];
    const newIdCell1Again = generateRocketNodeId("connector.db.duckdb.output", updatedJobNodes);
    assert.equal(newIdCell1Again, "duckdb_sink_3");
  });

  it("deve detectar e desambiguar componentes com o mesmo ID em células distintas (Auto-Heal) e ajustar arestas", () => {
    // Simula o cenário relatado pelo usuário no print:
    // Célula 1 e Célula 2 ambas possuem duckdb_sink_22
    const corruptedCells = [
      {
        id: "canvas-cell-01",
        name: "canvas-cell-01",
        nodes: [
          { id: "postgres_source_1", data: { label: "PostgreSQL" } },
          { id: "duckdb_sink_22", data: { label: "DuckDB Output" } },
        ],
        edges: [
          { id: "e1", source: "postgres_source_1", target: "duckdb_sink_22" },
        ],
      },
      {
        id: "canvas-cell-02",
        name: "canvas-cell-02",
        nodes: [
          { id: "duckdb_source_1", data: { label: "DuckDB Input" } },
          { id: "duckdb_sink_22", data: { label: "DuckDB Output 2" } }, // DUPLICADO!
        ],
        edges: [
          { id: "e2", source: "duckdb_source_1", target: "duckdb_sink_22" },
        ],
      },
    ];

    const { cells: repairedCells, repairedCount } = healDuplicateNodeIdsAcrossCells(corruptedCells);

    assert.equal(repairedCount, 1);
    // Célula 1 manteve seu ID duckdb_sink_22
    assert.equal(repairedCells[0].nodes[1].id, "duckdb_sink_22");
    assert.equal(repairedCells[0].edges[0].target, "duckdb_sink_22");

    // Célula 2 teve o nó desambiguado para duckdb_sink_22_2
    assert.equal(repairedCells[1].nodes[1].id, "duckdb_sink_22_2");
    // A aresta da Célula 2 foi atualizada para apontar para o novo ID único
    assert.equal(repairedCells[1].edges[0].target, "duckdb_sink_22_2");

    // Todos os IDs no Job agora são estritamente únicos
    const allIds = repairedCells.flatMap((c) => c.nodes.map((n) => n.id));
    const uniqueIds = new Set(allIds);
    assert.equal(allIds.length, uniqueIds.size);
  });
});

describe("Multi-Canvas: Suporte a Python-Cells e Recurso Enterprise", () => {
  it("deve permitir criar uma python-cell com tipo PYTHON e snippet padrão", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Misto Visual e Codigo");
    assert.equal(job.cells.length, 1);
    assert.equal(job.cells[0].cellType || "CANVAS", "CANVAS");

    // Adiciona célula do tipo PYTHON
    const pyCell = store.createCell(job.id, "Etapa Python Notebook", "PYTHON");
    assert.ok(pyCell);
    assert.equal(pyCell.cellType, "PYTHON");
    assert.ok(pyCell.id.startsWith("python-cell-"));
    assert.ok(pyCell.codeSnippet.includes("context.write_output"));
    assert.ok(pyCell.codeSnippet.includes("context.read_output"));

    const updatedJob = store.getJob(job.id);
    assert.equal(updatedJob.cells.length, 2);
    assert.equal(updatedJob.cells[1].cellType, "PYTHON");
  });

  it("deve duplicar uma python-cell preservando cellType e codeSnippet", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job com Python");
    const pyCell = store.createCell(job.id, "Filtro Polars", "PYTHON");
    store.updateCell(job.id, pyCell.id, { codeSnippet: "df_filtrado = df.filter(pl.col('v') > 0)" });

    const duplicated = store.duplicateCell(job.id, pyCell.id);
    assert.ok(duplicated);
    assert.equal(duplicated.cellType, "PYTHON");
    assert.equal(duplicated.codeSnippet, "df_filtrado = df.filter(pl.col('v') > 0)");
    assert.ok(duplicated.id.startsWith("python-cell-"));
  });

  it("deve atualizar o snippet da célula via updateCellCode", () => {
    const store = createTestJobStore();
    const job = store.createJob("Job Script");
    const pyCell = store.createCell(job.id, "Script ETL", "PYTHON");
    store.updateCellCode(job.id, pyCell.id, "print('novo script')");

    const updated = store.getJob(job.id).cells.find((c) => c.id === pyCell.id);
    assert.equal(updated.codeSnippet, "print('novo script')");
  });

  it("deve alternar a feature flag de células python (Enterprise)", () => {
    const store = createTestJobStore();
    assert.equal(store.isPythonCellsEnabled(), true);

    store.setPythonCellsEnabled(false);
    assert.equal(store.isPythonCellsEnabled(), false);

    store.setPythonCellsEnabled(true);
    assert.equal(store.isPythonCellsEnabled(), true);
  });
});
