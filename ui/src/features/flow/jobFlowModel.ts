/**
 * RocketDataForge — Job Flow Model (Modelo Puro da View de Fluxo)
 * Extrai nós e ligações a partir de CanvasCellData[] e pré-condições.
 */

export interface FlowNodeModel {
  id: string;
  name: string;
  cellType: "CANVAS" | "PYTHON";
  order: number;
  status: string;
  metrics?: {
    durationMs?: number;
    rowsIn?: number;
    rowsOut?: number;
    recordsProcessed?: number;
  };
  is_active: boolean;
  codeSnippet?: string;
  nodes?: any[];
  edges?: any[];
  preconditions?: Array<{
    id: string;
    targetCellId: string;
    expectedStatus: "OK" | "ERROR";
  }>;
  preconditionOperator?: "AND" | "OR";
}

export interface FlowLinkModel {
  id: string;
  source: string; // cell ID da origem (predecessora)
  target: string; // cell ID do destino (dependente)
  expectedStatus: "OK" | "ERRO";
}

export interface JobFlowModel {
  nodes: FlowNodeModel[];
  links: FlowLinkModel[];
  warnings: string[];
}

/**
 * Detecta ciclos entre células a partir das suas pré-condições.
 * Algoritmo puramente funcional sem dependências externas.
 */
export function detectCellCycles(cells: any[]): string[] | null {
  if (!cells || cells.length === 0) return null;
  const cellIds = cells.map((c) => c.id);
  const cellIdSet = new Set(cellIds);
  const adjList: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};

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

  const queue: string[] = cellIds.filter((id) => inDegree[id] === 0);
  const visited: string[] = [];

  while (queue.length > 0) {
    const curr = queue.shift()!;
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

/**
 * Valida consistência de ordem para células paralelas e pré-condições inválidas.
 */
export function validateParallelCellConsistency(cells: any[]): string[] | null {
  if (!cells || cells.length === 0) return null;
  const errors: string[] = [];
  for (const cell of cells) {
    for (const p of cell.preconditions || []) {
      const target = cells.find((c) => c.id === p.targetCellId || c.name === p.targetCellId);
      if (target) {
        const cellOrder = cell.order ?? 1;
        const targetOrder = target.order ?? 1;
        if (targetOrder === cellOrder) {
          errors.push(
            `A célula "${cell.name}" depende de "${target.name}", mas ambas possuem a mesma ordem de execução (${cellOrder}). Células com a mesma ordem executam em paralelo e não podem ter interdependência.`
          );
        } else if (targetOrder > cellOrder) {
          errors.push(
            `A célula "${cell.name}" (ordem ${cellOrder}) não pode depender da célula "${target.name}" que possui ordem posterior (${targetOrder}).`
          );
        }
      }
    }
  }
  return errors.length > 0 ? errors : null;
}

/**
 * Constrói o modelo unificado da View de Fluxo a partir da lista de células.
 * Resolve pré-condições por ID ou por NOME, coletando warnings para inconsistências.
 */
export function buildJobFlowModel(cells: any[] = []): JobFlowModel {
  const warnings: string[] = [];

  if (!cells || cells.length === 0) {
    return { nodes: [], links: [], warnings: [] };
  }

  // 1. Mapeia os nós
  const nodes: FlowNodeModel[] = cells.map((c) => ({
    id: c.id,
    name: c.name || c.id,
    cellType: c.cellType === "PYTHON" ? "PYTHON" : "CANVAS",
    order: typeof c.order === "number" && !isNaN(c.order) ? c.order : 1,
    status: c.status || "idle",
    metrics: c.metrics,
    is_active: c.is_active !== false,
    codeSnippet: c.codeSnippet || "",
    nodes: c.nodes || [],
    edges: c.edges || [],
    preconditions: c.preconditions || [],
    preconditionOperator: c.preconditionOperator === "OR" ? "OR" : "AND",
  }));

  // Mapas para resolução rápida de predecessores
  const cellById = new Map<string, any>();
  const cellByName = new Map<string, any>();
  for (const cell of cells) {
    cellById.set(cell.id, cell);
    if (cell.name) {
      cellByName.set(cell.name, cell);
    }
  }

  // 2. Extrai as ligações direcionadas a partir das pré-condições
  const links: FlowLinkModel[] = [];

  for (const cell of cells) {
    for (const p of cell.preconditions || []) {
      const targetRef = p.targetCellId;
      if (!targetRef) continue;

      // Resolve por ID ou por NOME
      const resolvedTarget = cellById.get(targetRef) || cellByName.get(targetRef);

      if (!resolvedTarget) {
        warnings.push(
          `Aviso: Referência inexistente "${targetRef}" na pré-condição da célula "${cell.name || cell.id}".`
        );
        continue;
      }

      // Origem = predecessor resolvido; Destino = célula atual dependente
      links.push({
        id: `link-${resolvedTarget.id}-${cell.id}-${p.id || Math.random().toString(36).substring(2, 7)}`,
        source: resolvedTarget.id,
        target: cell.id,
        expectedStatus: p.expectedStatus === "ERROR" ? "ERRO" : "OK",
      });
    }
  }

  // 3. Verifica ciclos no grafo
  const cycleCellIds = detectCellCycles(cells);
  if (cycleCellIds && cycleCellIds.length > 0) {
    warnings.push(`Aviso: Ciclo detectado entre células: ${cycleCellIds.join(", ")}.`);
  }

  // 4. Verifica inconsistências de paralelismo
  const consistencyErrors = validateParallelCellConsistency(cells);
  if (consistencyErrors && consistencyErrors.length > 0) {
    warnings.push(...consistencyErrors);
  }

  return {
    nodes,
    links,
    warnings,
  };
}
