// ============================================================
// RocketDataForge — Job Store v2 (LocalStorage Persistence)
// ============================================================

import { Node, Edge } from "reactflow";
import { CanvasNodeData } from "../types";

export type JobStatus = "draft" | "saved" | "published";
export type Environment = "dev" | "hml" | "prd";

// ─── Multi-Canvas Cell Models ───────────────────────────────

export type CellExecutionStatus = "idle" | "queued" | "running" | "success" | "failed" | "skipped" | "cancelled";

export interface CellPrecondition {
  id: string;
  targetCellId: string;
  expectedStatus: "OK" | "ERROR";
}

export interface CellExecutionTaskMetric {
  node_id: string;
  status: string;
  rows_in: number;
  rows_out: number;
  duration_ms: number;
  error_message?: string;
}

export interface CellExecutionMetrics {
  durationMs: number;
  rowsIn: number;
  rowsOut: number;
  tasks?: CellExecutionTaskMetric[];
}

export interface CanvasCellData {
  id: string;
  name: string;
  description?: string;
  order: number;
  preconditions: CellPrecondition[];
  preconditionOperator: "AND" | "OR";
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
  nodeSchemas?: Record<string, SchemaColumn[]>;
  status?: CellExecutionStatus;
  metrics?: CellExecutionMetrics;
  logs?: any[];
  showMetricsPanel?: boolean;
}

export interface JobData {
  id: string;
  name: string;
  folderId: string;
  description?: string;
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
  status: JobStatus;
  environment: Environment; // Ambiente ativo deste job
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  // Schema definitions per node
  nodeSchemas?: Record<string, SchemaColumn[]>;
  // Multi-Canvas cells
  cells?: CanvasCellData[];
  activeCellId?: string;
}

export interface FolderData {
  id: string;
  name: string;
  parentId: string | null;
  expanded: boolean;
  createdAt: string;
}

// ─── Schema ─────────────────────────────────────────────────

export type SchemaColumnType =
  | "String" | "Integer" | "Long" | "Float" | "Double" | "Decimal"
  | "Boolean" | "Date" | "DateTime" | "Timestamp" | "Time"
  | "Bytes" | "JSON" | "Array" | "Object" | "Unknown";

export interface SchemaColumn {
  id: string;
  name: string;
  type: SchemaColumnType;
  nullable: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  format?: string;
  comment?: string;
  isPrimaryKey?: boolean;
  defaultValue?: string;
}

// ─── Connections ─────────────────────────────────────────────

export interface ConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string; // Stored raw; backend applies quote_plus on use
  serviceName?: string;
  sid?: string;
  instance?: string;
  jdbcUrl?: string;
  bucket?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  endpoint?: string;
  baseUrl?: string;
  authType?: "none" | "basic" | "bearer" | "apikey" | "oauth2";
  apiKey?: string;
  bearerToken?: string;
  httpPath?: string;
  catalog?: string;
  schema?: string;
  sslMode?: string;
  extraParams?: Record<string, string>;
  useEnvVars?: boolean;
  [key: string]: any;
}

export type ConnectionType =
  | "duckdb"
  | "oracle" | "sqlserver" | "mysql" | "postgresql" | "redshift"
  | "databricks" | "snowflake" | "bigquery" | "s3" | "azure_blob"
  | "gcs" | "rest_api" | "soap_api" | "mongodb" | "cassandra" | "scylla"
  | "elasticsearch" | "kafka" | "aws_sqs" | "aws_sns" | "sftp" | "ftp";

export type ConnectionScope = "global" | "local";

export interface ConnectionEntry {
  id: string;
  name: string;
  type: ConnectionType;
  config: ConnectionConfig;
  description?: string;
  environments: Environment[]; // Quais ambientes esta conexão pertence
  scope?: ConnectionScope;      // "global" (todos jobs) ou "local" (restrito a um job)
  jobId?: string;               // preenchido se scope === "local"
  testStatus?: "untested" | "success" | "failed";
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Context Variables ───────────────────────────────────────

export type ContextVarType = "string" | "number" | "boolean" | "secret";
export type ContextVarScope = "global" | "local";

export interface ContextVariable {
  id: string;
  key: string;
  type: ContextVarType;
  scope: ContextVarScope;        // global = todos jobs, local = job específico
  jobId?: string;                // preenchido se scope === "local"
  values: Record<Environment, string>; // valor por ambiente
  description?: string;
  isSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Query Bank ───────────────────────────────────────────────

export type QueryDialect =
  | "sql" | "postgresql" | "oracle" | "sqlserver" | "mysql"
  | "redshift" | "bigquery" | "snowflake" | "databricks"
  | "python" | "jinja";

export interface QueryEntry {
  id: string;
  name: string;
  description?: string;
  sql: string;
  dialect: QueryDialect;
  tags: string[];
  /** Optional connection this query was designed for */
  connectionRef?: string;
  /** Optional schema inferred or defined for this query */
  schema?: SchemaColumn[];
  createdAt: string;
  updatedAt: string;
  /** Times inserted into a node */
  usageCount: number;
}

// ─── Store State ─────────────────────────────────────────────

interface StoreState {
  folders: FolderData[];
  jobs: JobData[];
  connections: ConnectionEntry[];
  contextVariables: ContextVariable[];
  queryBank: QueryEntry[];
  activeEnvironment: Environment;
  openTabIds: string[];
  activeTabId: string | null;
}

const STORAGE_KEY = "rdf_studio_v2";

function loadState(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migration: add environments field if missing from old connections
      if (Array.isArray(parsed.connections)) {
        parsed.connections = parsed.connections.map((c: any) => ({
          ...c,
          environments: c.environments ?? ["dev"],
        }));
      } else {
        parsed.connections = [];
      }
      
      // Migration: add scope/jobId/createdAt/updatedAt to old contextVariables
      if (Array.isArray(parsed.contextVariables)) {
        parsed.contextVariables = parsed.contextVariables.map((cv: any) => ({
          ...cv,
          scope: cv.scope ?? "global",
          createdAt: cv.createdAt ?? new Date().toISOString(),
          updatedAt: cv.updatedAt ?? new Date().toISOString(),
        }));
      } else {
        parsed.contextVariables = [];
      }
      
      // Migration: add environment and multi-canvas cells to old jobs
      if (Array.isArray(parsed.jobs)) {
        parsed.jobs = parsed.jobs.map((j: any) => {
          const cells: CanvasCellData[] =
            Array.isArray(j.cells) && j.cells.length > 0
              ? j.cells
              : [
                  {
                    id: "canvas-cell-01",
                    name: "canvas-cell-01",
                    description: "",
                    order: 1,
                    preconditions: [],
                    preconditionOperator: "AND",
                    nodes: Array.isArray(j.nodes) ? j.nodes : [],
                    edges: Array.isArray(j.edges) ? j.edges : [],
                    viewport: j.viewport,
                    nodeSchemas: j.nodeSchemas || {},
                    status: "idle",
                  },
                ];
          const activeCellId =
            j.activeCellId && cells.some((c) => c.id === j.activeCellId)
              ? j.activeCellId
              : cells[0]?.id || "canvas-cell-01";
          return {
            ...j,
            environment: j.environment ?? "dev",
            cells,
            activeCellId,
          };
        });
      } else {
        parsed.jobs = [];
      }
      
      // Migration: add queryBank if missing
      if (!Array.isArray(parsed.queryBank)) parsed.queryBank = [];
      
      // Fix undefined properties that crash App
      if (!parsed.openTabIds) parsed.openTabIds = [];
      if (!parsed.activeEnvironment) parsed.activeEnvironment = "dev";
      if (!parsed.folders) parsed.folders = [];
      
      return parsed;
    }
  } catch (e) {
    console.error("[jobStore] Failed to parse localStorage state:", e);
  }

  const rootFolderId = "folder-root";
  const exampleFolderId = "folder-etl";
  const now = new Date().toISOString();

  return {
    folders: [
      { id: rootFolderId, name: "Jobs", parentId: null, expanded: true, createdAt: now },
      { id: exampleFolderId, name: "ETL Pipelines", parentId: rootFolderId, expanded: true, createdAt: now },
      { id: "folder-reports", name: "Reports", parentId: rootFolderId, expanded: false, createdAt: now },
    ],
    jobs: [],
    connections: [],
    contextVariables: [
      {
        id: "cv-default-1",
        key: "DB_HOST",
        type: "string",
        scope: "global",
        values: { dev: "localhost", hml: "hml-db.example.com", prd: "prd-db.example.com" },
        description: "Hostname do banco de dados principal",
        isSecret: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "cv-default-2",
        key: "DB_PASSWORD",
        type: "secret",
        scope: "global",
        values: { dev: "", hml: "", prd: "" },
        description: "Senha do banco de dados (suporta @ e outros chars especiais via quote_plus)",
        isSecret: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    queryBank: [],
    activeEnvironment: "dev",
    openTabIds: [],
    activeTabId: null,
  };
}

function saveState(state: StoreState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

type Listener = () => void;
let state = loadState();
const listeners: Set<Listener> = new Set();

function notify() {
  listeners.forEach((l) => l());
}

// ─── Connection Environment Change Detection ──────────────────

export interface EnvSwitchWarning {
  connectionRef: string;
  nodeName: string;
  availableEnvironments: Environment[];
}

export function detectMissingConnectionsForEnv(
  nodeConfigs: Array<{ nodeId: string; nodeName: string; connection_ref?: string }>,
  targetEnv: Environment,
  connections: ConnectionEntry[]
): EnvSwitchWarning[] {
  const warnings: EnvSwitchWarning[] = [];
  for (const node of nodeConfigs) {
    if (!node.connection_ref) continue;
    const ref = node.connection_ref;
    // Find connections with same name (case-insensitive slug match)
    const matching = connections.filter(
      (c) => c.name.toLowerCase().replace(/\s+/g, "_") === ref
    );
    if (matching.length === 0) continue;
    const hasTargetEnv = matching.some((c) => c.environments.includes(targetEnv));
    if (!hasTargetEnv) {
      const available = [...new Set(matching.flatMap((c) => c.environments))];
      warnings.push({ connectionRef: ref, nodeName: node.nodeName, availableEnvironments: available });
    }
  }
  return warnings;
}

// ─── Multi-Canvas Cell Evaluation & Cycle Detection ──────────

export function evaluateCellPreconditions(
  cell: CanvasCellData,
  completedStatuses: Record<string, "success" | "failed" | "skipped">,
  allCells: CanvasCellData[] = []
): boolean {
  if (!cell.preconditions || cell.preconditions.length === 0) {
    return true;
  }

  const results = cell.preconditions.map((p) => {
    // Target can be matched by targetCellId or by name
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
  // Default is AND
  return results.every((r) => r === true);
}

export function detectCellCycles(cells: CanvasCellData[]): string[] | null {
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

export function validateParallelCellConsistency(cells: CanvasCellData[]): string[] | null {
  const errors: string[] = [];
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

export const jobStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getState(): StoreState {
    return state;
  },

  // ─── Folders ──────────────────────────────────────────────

  createFolder(name: string, parentId: string | null = "folder-root"): FolderData {
    const folder: FolderData = {
      id: `folder-${Date.now()}`,
      name,
      parentId,
      expanded: true,
      createdAt: new Date().toISOString(),
    };
    state = { ...state, folders: [...state.folders, folder] };
    saveState(state);
    notify();
    return folder;
  },

  renameFolder(folderId: string, newName: string): void {
    state = {
      ...state,
      folders: state.folders.map((f) => f.id === folderId ? { ...f, name: newName } : f),
    };
    saveState(state);
    notify();
  },

  deleteFolder(folderId: string): void {
    const jobIds = state.jobs.filter((j) => j.folderId === folderId).map((j) => j.id);
    state = {
      ...state,
      folders: state.folders.filter((f) => f.id !== folderId && f.parentId !== folderId),
      jobs: state.jobs.filter((j) => !jobIds.includes(j.id)),
      openTabIds: state.openTabIds.filter((id) => !jobIds.includes(id)),
      activeTabId: jobIds.includes(state.activeTabId ?? "") ? state.openTabIds.find((id) => !jobIds.includes(id)) ?? null : state.activeTabId,
    };
    saveState(state);
    notify();
  },

  toggleFolderExpanded(folderId: string): void {
    state = {
      ...state,
      folders: state.folders.map((f) => f.id === folderId ? { ...f, expanded: !f.expanded } : f),
    };
    saveState(state);
    notify();
  },

  // ─── Jobs ─────────────────────────────────────────────────

  createJob(name: string, folderId: string, env: Environment = "dev"): JobData {
    const defaultCell: CanvasCellData = {
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
    const job: JobData = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      folderId,
      nodes: [],
      edges: [],
      cells: [defaultCell],
      activeCellId: "canvas-cell-01",
      status: "draft",
      environment: env,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state = { ...state, jobs: [...state.jobs, job] };
    saveState(state);
    notify();
    return job;
  },

  saveJob(
    jobId: string,
    nodes: Node<CanvasNodeData>[],
    edges: Edge[],
    viewport?: { x: number; y: number; zoom: number },
    targetCellId?: string
  ): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;

        let updatedCells = j.cells;
        if (targetCellId) {
          // Destino explícito de célula informado
          updatedCells = (j.cells || []).map((c) =>
            c.id === targetCellId ? { ...c, nodes, edges, viewport } : c
          );
        } else if (!j.cells || j.cells.length === 0) {
          // Job sem células (canvas legado): cria a célula padrão
          updatedCells = [
            {
              id: "canvas-cell-01",
              name: "canvas-cell-01",
              description: "",
              order: 1,
              preconditions: [],
              preconditionOperator: "AND",
              nodes,
              edges,
              status: "idle",
              viewport,
            },
          ];
        } else {
          // Em multi-canvas sem targetCellId explícito:
          // As células já são salvas individualmente via saveCellGraph.
          // PRESERVA as células existentes sem sobrescrever nem zerar nós!
          updatedCells = j.cells;
        }

        // Se os nós passados estiverem vazios mas o job possuir células,
        // deriva j.nodes e j.edges de todas as células do job para consistência.
        const effectiveNodes =
          nodes && nodes.length > 0
            ? nodes
            : (updatedCells || []).flatMap((c) => c.nodes || []);
        const effectiveEdges =
          edges && edges.length > 0
            ? edges
            : (updatedCells || []).flatMap((c) => c.edges || []);

        return {
          ...j,
          nodes: effectiveNodes,
          edges: effectiveEdges,
          viewport,
          cells: updatedCells,
          status: "saved",
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
  },

  // ─── Multi-Canvas Cell Operations ─────────────────────────

  createCell(jobId: string, customName?: string): CanvasCellData | null {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return null;

    const existingCells = job.cells || [];
    const nextIndex = existingCells.length + 1;
    const defaultId = `canvas-cell-${String(nextIndex).padStart(2, "0")}`;
    const name = (customName?.trim() || defaultId).slice(0, 50);

    const maxOrder = existingCells.reduce((max, c) => Math.max(max, c.order || 0), 0);
    const newOrder = maxOrder + 1;

    // Default precondition: points to the immediately preceding cell if one exists
    const prevCell = existingCells[existingCells.length - 1];
    const defaultPreconditions: CellPrecondition[] = prevCell
      ? [
          {
            id: `prec-${Date.now()}`,
            targetCellId: prevCell.id,
            expectedStatus: "OK",
          },
        ]
      : [];

    const newCell: CanvasCellData = {
      id: defaultId,
      name,
      description: "",
      order: newOrder,
      preconditions: defaultPreconditions,
      preconditionOperator: "AND",
      nodes: [],
      edges: [],
      status: "idle",
    };

    state = {
      ...state,
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              cells: [...(j.cells || []), newCell],
              activeCellId: newCell.id,
              updatedAt: new Date().toISOString(),
            }
          : j
      ),
    };
    saveState(state);
    notify();
    return newCell;
  },

  updateCell(jobId: string, cellId: string, updates: Partial<CanvasCellData>): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, ...updates } : c
        );
        return {
          ...j,
          cells: updatedCells,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
  },

  renameCell(jobId: string, oldCellIdOrName: string, newName: string): void {
    const safeName = newName.trim().slice(0, 50);
    if (!safeName) return;

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const oldTarget = oldCellIdOrName;
        const updatedCells = (j.cells || []).map((cell) => {
          let c = { ...cell };
          const matches = c.id === oldTarget || c.name === oldTarget;
          if (matches) {
            c.name = safeName;
            if (c.id === oldTarget) {
              c.id = safeName;
            }
          }

          // Cascading rename across preconditions in all other cells
          if (Array.isArray(c.preconditions)) {
            c.preconditions = c.preconditions.map((p) =>
              p.targetCellId === oldTarget ? { ...p, targetCellId: safeName } : p
            );
          }

          // Cascading rename in node configs
          if (Array.isArray(c.nodes)) {
            const oldClean = oldTarget.replace(/-/g, "_").toLowerCase();
            const newClean = safeName.replace(/-/g, "_").toLowerCase();
            c.nodes = c.nodes.map((node) => {
              const cfg = node.data?.config;
              if (!cfg) return node;
              let changed = false;
              const newCfg = { ...cfg };
              if (newCfg.source_cell === oldTarget) {
                newCfg.source_cell = safeName;
                changed = true;
              }
              if (newCfg.table === `cell_output_${oldClean}`) {
                newCfg.table = `cell_output_${newClean}`;
                changed = true;
              }
              if (changed) {
                return { ...node, data: { ...node.data, config: newCfg } };
              }
              return node;
            });
          }
          return c;
        });

        const activeCellId =
          j.activeCellId === oldTarget ? safeName : j.activeCellId;

        return {
          ...j,
          cells: updatedCells,
          activeCellId,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
  },

  deleteCell(jobId: string, cellId: string): boolean {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job || !job.cells || job.cells.length <= 1) {
      return false; // Job must retain at least one cell
    }

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const remainingCells = (j.cells || []).filter((c) => c.id !== cellId);
        // Clean up preconditions referencing the deleted cell
        const cleanedCells = remainingCells.map((c) => ({
          ...c,
          preconditions: (c.preconditions || []).filter(
            (p) => p.targetCellId !== cellId
          ),
        }));

        const newActive =
          j.activeCellId === cellId
            ? cleanedCells[0]?.id || "canvas-cell-01"
            : j.activeCellId;

        const activeCellObj = cleanedCells.find((c) => c.id === newActive);

        return {
          ...j,
          cells: cleanedCells,
          activeCellId: newActive,
          nodes: activeCellObj ? activeCellObj.nodes : j.nodes,
          edges: activeCellObj ? activeCellObj.edges : j.edges,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
    return true;
  },

  duplicateCell(jobId: string, cellId: string): CanvasCellData | null {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return null;

    const sourceCell = (job.cells || []).find((c) => c.id === cellId);
    if (!sourceCell) return null;

    const existingCells = job.cells || [];
    const nextIndex = existingCells.length + 1;
    const newId = `canvas-cell-${String(nextIndex).padStart(2, "0")}`;
    const newName = `Cópia de ${sourceCell.name}`.slice(0, 50);
    const maxOrder = existingCells.reduce((max, c) => Math.max(max, c.order || 0), 0);

    // Deep clone nodes and edges with id mapping
    const idMap: Record<string, string> = {};
    const clonedNodes = (sourceCell.nodes || []).map((n) => {
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
      const newNId = `${n.id}_${uniqueSuffix}`;
      idMap[n.id] = newNId;
      return {
        ...n,
        id: newNId,
        position: { x: n.position.x + 30, y: n.position.y + 30 },
      };
    });

    const clonedEdges = (sourceCell.edges || []).map((e) => ({
      ...e,
      id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      source: idMap[e.source] || e.source,
      target: idMap[e.target] || e.target,
    }));

    const newCell: CanvasCellData = {
      id: newId,
      name: newName,
      description: sourceCell.description || "",
      order: maxOrder + 1,
      preconditions: [...(sourceCell.preconditions || [])],
      preconditionOperator: sourceCell.preconditionOperator || "AND",
      nodes: clonedNodes,
      edges: clonedEdges,
      viewport: sourceCell.viewport ? { ...sourceCell.viewport } : undefined,
      nodeSchemas: sourceCell.nodeSchemas ? { ...sourceCell.nodeSchemas } : {},
      status: "idle",
    };

    state = {
      ...state,
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              cells: [...(j.cells || []), newCell],
              activeCellId: newCell.id,
              updatedAt: new Date().toISOString(),
            }
          : j
      ),
    };
    saveState(state);
    notify();
    return newCell;
  },

  reorderCells(jobId: string, orderedCellIds: string[]): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const currentCells = j.cells || [];
        const cellMap = new Map(currentCells.map((c) => [c.id, c]));
        const reordered = orderedCellIds
          .map((id, index) => {
            const cell = cellMap.get(id);
            return cell ? { ...cell, order: index + 1 } : null;
          })
          .filter(Boolean) as CanvasCellData[];

        // Append any cells not explicitly in orderedCellIds
        const remaining = currentCells.filter((c) => !orderedCellIds.includes(c.id));
        remaining.forEach((c, idx) => {
          reordered.push({ ...c, order: reordered.length + idx + 1 });
        });

        return {
          ...j,
          cells: reordered,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
  },

  setCellStatus(jobId: string, cellId: string, status: CellExecutionStatus): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, status } : c
        );
        return { ...j, cells: updatedCells };
      }),
    };
    saveState(state);
    notify();
  },

  resetCellStatus(jobId: string, cellId: string): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) => {
          if (c.id !== cellId) return c;
          const resetNodes = (c.nodes || []).map((n) => ({
            ...n,
            data: {
              ...n.data,
              status: undefined,
              metrics: undefined,
            },
          }));
          return {
            ...c,
            status: "idle" as CellExecutionStatus,
            metrics: undefined,
            logs: undefined,
            showMetricsPanel: false,
            nodes: resetNodes,
          };
        });
        const activeCellObj = updatedCells.find((c) => c.id === j.activeCellId);
        return {
          ...j,
          cells: updatedCells,
          nodes: activeCellObj ? activeCellObj.nodes : j.nodes,
        };
      }),
    };
    saveState(state);
    notify();
  },

  resetAllCellsStatus(jobId: string): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) => {
          const resetNodes = (c.nodes || []).map((n) => ({
            ...n,
            data: {
              ...n.data,
              status: undefined,
              metrics: undefined,
            },
          }));
          return {
            ...c,
            status: "idle" as CellExecutionStatus,
            metrics: undefined,
            logs: undefined,
            showMetricsPanel: false,
            nodes: resetNodes,
          };
        });
        const activeCellObj = updatedCells.find((c) => c.id === j.activeCellId);
        return {
          ...j,
          cells: updatedCells,
          nodes: activeCellObj ? activeCellObj.nodes : j.nodes,
        };
      }),
    };
    saveState(state);
    notify();
  },

  setCellExecutionResults(
    jobId: string,
    cellId: string,
    status: CellExecutionStatus,
    metrics?: CellExecutionMetrics,
    logs?: any[],
    showMetricsPanel = true
  ): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) => {
          if (c.id !== cellId) return c;
          let updatedNodes = c.nodes || [];
          if (metrics?.tasks && metrics.tasks.length > 0) {
            updatedNodes = updatedNodes.map((n) => {
              const task = metrics.tasks?.find((t) => t.node_id === n.id);
              if (task) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    status: task.status as any,
                    metrics: {
                      rowsIn: task.rows_in,
                      rowsOut: task.rows_out,
                      durationMs: task.duration_ms,
                    },
                  },
                };
              }
              return n;
            });
          }
          return {
            ...c,
            status,
            metrics: metrics || c.metrics,
            logs: logs || c.logs,
            showMetricsPanel,
            nodes: updatedNodes,
          };
        });
        const activeCellObj = updatedCells.find((c) => c.id === j.activeCellId);
        return {
          ...j,
          cells: updatedCells,
          nodes: activeCellObj ? activeCellObj.nodes : j.nodes,
        };
      }),
    };
    saveState(state);
    notify();
  },

  setCellShowMetrics(jobId: string, cellId: string, show: boolean): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, showMetricsPanel: show } : c
        );
        return { ...j, cells: updatedCells };
      }),
    };
    saveState(state);
    notify();
  },

  setActiveCell(jobId: string, cellId: string): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const targetCell = (j.cells || []).find((c) => c.id === cellId);
        return {
          ...j,
          activeCellId: cellId,
          nodes: targetCell ? targetCell.nodes : j.nodes,
          edges: targetCell ? targetCell.edges : j.edges,
        };
      }),
    };
    saveState(state);
    notify();
  },

  saveCellGraph(
    jobId: string,
    cellId: string,
    nodes: Node<CanvasNodeData>[],
    edges: Edge[],
    viewport?: { x: number; y: number; zoom: number }
  ): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, nodes, edges, viewport } : c
        );
        const isActive = j.activeCellId === cellId;
        return {
          ...j,
          cells: updatedCells,
          nodes: isActive ? nodes : j.nodes,
          edges: isActive ? edges : j.edges,
          viewport: isActive ? viewport : j.viewport,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
  },

  saveCellSchemas(jobId: string, cellId: string, schemas: Record<string, SchemaColumn[]>): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, nodeSchemas: schemas } : c
        );
        return {
          ...j,
          cells: updatedCells,
          nodeSchemas: j.activeCellId === cellId ? schemas : j.nodeSchemas,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
  },

  saveJobSchemas(jobId: string, schemas: Record<string, SchemaColumn[]>): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, nodeSchemas: schemas, updatedAt: new Date().toISOString() } : j
      ),
    };
    saveState(state);
    notify();
  },

  setJobEnvironment(jobId: string, env: Environment): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, environment: env, updatedAt: new Date().toISOString() } : j
      ),
    };
    saveState(state);
    notify();
  },

  renameJob(jobId: string, newName: string): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, name: newName, updatedAt: new Date().toISOString() } : j
      ),
    };
    saveState(state);
    notify();
  },

  deleteJob(jobId: string): void {
    state = {
      ...state,
      jobs: state.jobs.filter((j) => j.id !== jobId),
      openTabIds: state.openTabIds.filter((id) => id !== jobId),
      activeTabId:
        state.activeTabId === jobId
          ? state.openTabIds.find((id) => id !== jobId) ?? null
          : state.activeTabId,
    };
    saveState(state);
    notify();
  },

  getJob(jobId: string): JobData | undefined {
    return state.jobs.find((j) => j.id === jobId);
  },

  importJob(
    imported: {
      job?: Partial<JobData>;
      name?: string;
      nodes?: Node<CanvasNodeData>[];
      edges?: Edge[];
      nodeSchemas?: Record<string, SchemaColumn[]>;
      environment?: Environment;
      folderId?: string;
      viewport?: { x: number; y: number; zoom: number };
    },
    targetFolderId?: string
  ): JobData {
    const rawJob = imported.job || imported;
    const name = imported.name || rawJob.name || "Job Importado";
    const defaultFolderId = state.folders.find((f) => f.parentId === null)?.id ?? "folder-root";
    const folderId = targetFolderId || rawJob.folderId || defaultFolderId;
    const nodes = imported.nodes || rawJob.nodes || [];
    const edges = imported.edges || rawJob.edges || [];
    const nodeSchemas = imported.nodeSchemas || rawJob.nodeSchemas || {};
    const environment = imported.environment || rawJob.environment || "dev";
    const viewport = imported.viewport || rawJob.viewport;

    const importedCells: CanvasCellData[] =
      Array.isArray((rawJob as any).cells) && (rawJob as any).cells.length > 0
        ? (rawJob as any).cells
        : [
            {
              id: "canvas-cell-01",
              name: "canvas-cell-01",
              description: "",
              order: 1,
              preconditions: [],
              preconditionOperator: "AND",
              nodes,
              edges,
              viewport,
              nodeSchemas,
              status: "idle",
            },
          ];
    const activeCellId = (rawJob as any).activeCellId || importedCells[0]?.id || "canvas-cell-01";

    // Create new job with fresh ID to prevent collision
    const newId = `job-${Date.now()}`;
    const newJob: JobData = {
      id: newId,
      name,
      folderId,
      nodes,
      edges,
      cells: importedCells,
      activeCellId,
      nodeSchemas,
      environment,
      viewport,
      status: "saved",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state = {
      ...state,
      jobs: [...state.jobs, newJob],
      openTabIds: state.openTabIds.includes(newId) ? state.openTabIds : [...state.openTabIds, newId],
      activeTabId: newId,
    };
    saveState(state);
    notify();
    return newJob;
  },

  // ─── Tabs ─────────────────────────────────────────────────

  openTab(jobId: string): void {
    const isOpen = state.openTabIds.includes(jobId);
    state = {
      ...state,
      openTabIds: isOpen ? state.openTabIds : [...state.openTabIds, jobId],
      activeTabId: jobId,
    };
    saveState(state);
    notify();
  },

  closeTab(jobId: string): void {
    const idx = state.openTabIds.indexOf(jobId);
    const remaining = state.openTabIds.filter((id) => id !== jobId);
    const nextActive =
      state.activeTabId === jobId
        ? remaining[idx - 1] ?? remaining[0] ?? null
        : state.activeTabId;
    state = { ...state, openTabIds: remaining, activeTabId: nextActive };
    saveState(state);
    notify();
  },

  setActiveTab(jobId: string): void {
    state = { ...state, activeTabId: jobId };
    saveState(state);
    notify();
  },

  // ─── Connections ──────────────────────────────────────────

  saveConnection(
    conn: Omit<ConnectionEntry, "id" | "createdAt" | "updatedAt">
  ): ConnectionEntry {
    const now = new Date().toISOString();
    const entry: ConnectionEntry = {
      ...conn,
      id: `conn-${Date.now()}`,
      scope: conn.scope ?? "global",
      jobId: conn.scope === "local" ? conn.jobId : undefined,
      environments: conn.environments ?? ["dev"],
      testStatus: "untested",
      createdAt: now,
      updatedAt: now,
    };
    state = { ...state, connections: [...state.connections, entry] };
    saveState(state);
    notify();
    return entry;
  },

  updateConnection(connId: string, updates: Partial<ConnectionEntry>): void {
    state = {
      ...state,
      connections: state.connections.map((c) =>
        c.id === connId ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
      ),
    };
    saveState(state);
    notify();
  },

  deleteConnection(connId: string): void {
    state = {
      ...state,
      connections: state.connections.filter((c) => c.id !== connId),
    };
    saveState(state);
    notify();
  },

  /** Retorna conexões disponíveis para um ambiente específico */
  getConnectionsForEnv(env: Environment): ConnectionEntry[] {
    return state.connections.filter((c) => c.environments.includes(env));
  },

  /** Retorna conexões para um job: conexões globais + conexões locais do job */
  getConnectionsForJob(jobId?: string): ConnectionEntry[] {
    if (!jobId) {
      return state.connections.filter((c) => !c.scope || c.scope === "global");
    }
    return state.connections.filter(
      (c) => !c.scope || c.scope === "global" || c.jobId === jobId
    );
  },

  // ─── Context Variables ────────────────────────────────────

  saveContextVar(cv: Omit<ContextVariable, "id" | "createdAt" | "updatedAt">): ContextVariable {
    const now = new Date().toISOString();
    const entry: ContextVariable = {
      ...cv,
      id: `cv-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    state = { ...state, contextVariables: [...state.contextVariables, entry] };
    saveState(state);
    notify();
    return entry;
  },

  updateContextVar(cvId: string, updates: Partial<ContextVariable>): void {
    state = {
      ...state,
      contextVariables: state.contextVariables.map((cv) =>
        cv.id === cvId ? { ...cv, ...updates, updatedAt: new Date().toISOString() } : cv
      ),
    };
    saveState(state);
    notify();
  },

  deleteContextVar(cvId: string): void {
    state = {
      ...state,
      contextVariables: state.contextVariables.filter((cv) => cv.id !== cvId),
    };
    saveState(state);
    notify();
  },

  /** Retorna variáveis disponíveis para um job (globais + locais daquele job) */
  getVarsForJob(jobId: string): ContextVariable[] {
    return state.contextVariables.filter(
      (cv) => cv.scope === "global" || cv.jobId === jobId
    );
  },

  setEnvironment(env: Environment): void {
    state = { ...state, activeEnvironment: env };
    saveState(state);
    notify();
  },

  resolveVariable(key: string, env?: Environment): string {
    const activeEnv = env ?? state.activeEnvironment;
    const cv = state.contextVariables.find((v) => v.key === key);
    if (!cv) return `\${${key}}`;
    return cv.values[activeEnv] ?? cv.values["dev"] ?? `\${${key}}`;
  },

  // ─── Query Bank ────────────────────────────────────────────

  saveQuery(q: Omit<QueryEntry, "id" | "createdAt" | "updatedAt" | "usageCount">): QueryEntry {
    const now = new Date().toISOString();
    const entry: QueryEntry = { ...q, id: `qry-${Date.now()}`, usageCount: 0, createdAt: now, updatedAt: now };
    state = { ...state, queryBank: [...state.queryBank, entry] };
    saveState(state);
    notify();
    return entry;
  },

  updateQuery(qId: string, updates: Partial<Omit<QueryEntry, "id" | "createdAt">>): void {
    state = {
      ...state,
      queryBank: state.queryBank.map((q) =>
        q.id === qId ? { ...q, ...updates, updatedAt: new Date().toISOString() } : q
      ),
    };
    saveState(state);
    notify();
  },

  deleteQuery(qId: string): void {
    state = { ...state, queryBank: state.queryBank.filter((q) => q.id !== qId) };
    saveState(state);
    notify();
  },

  incrementQueryUsage(qId: string): void {
    state = {
      ...state,
      queryBank: state.queryBank.map((q) =>
        q.id === qId ? { ...q, usageCount: q.usageCount + 1 } : q
      ),
    };
    saveState(state);
    notify();
  },

  /** Filter queries by dialect and optional connectionRef */
  getQueriesForConnection(dialect: QueryDialect, connectionRef?: string): QueryEntry[] {
    return state.queryBank.filter((q) => {
      const dialectMatch = q.dialect === dialect || q.dialect === "sql";
      if (!dialectMatch) return false;
      if (connectionRef && q.connectionRef) {
        return q.connectionRef === connectionRef;
      }
      return true;
    });
  },
};
