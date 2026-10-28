// ============================================================
// RocketDataForge — Job Store v2 (LocalStorage Persistence)
// ============================================================

import { Node, Edge } from "reactflow";
import { CanvasNodeData, ComponentCategory } from "../types/index";
import { telemetryStore } from "./telemetryStore";
import { getBaseApiUrl } from "../api/client";

export type JobStatus = "draft" | "saved" | "published";
export type Environment = "dev" | "hml" | "prd";

// ─── Ephemeral Property Sanitizers (RF-01.1 & T-1.3) ────────
export const sanitizeNode = <T extends Record<string, any>>({
  selected,
  dragging,
  measured,
  ...node
}: T): T => node as T;

export const sanitizeEdge = <T extends Record<string, any>>({
  selected,
  ...edge
}: T): T => edge as T;

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

export type CellType = "CANVAS" | "PYTHON";

export interface CanvasCellData {
  id: string;
  name: string;
  cellType?: CellType;
  codeSnippet?: string;
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
  layoutDirection?: "LR" | "TB";
  is_active?: boolean;
  is_minimized?: boolean;
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
  masking?: string;
  maskingSalt?: string;
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

export function generateRocketNodeId(typeId: string, existingNodes: Node<CanvasNodeData>[]): string {
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

export function inferAndNormalizeNode(rawNode: any): Node<CanvasNodeData> {
  const id = String(rawNode.id || `node_${Date.now()}`);
  const idLower = id.toLowerCase();

  let componentType = rawNode.data?.componentType || rawNode.componentType;
  let label = rawNode.data?.label || rawNode.name;
  let category: ComponentCategory = rawNode.data?.category || "transform";
  let ports = rawNode.data?.ports;
  let config = { ...(rawNode.data?.config || rawNode.config || {}) };
  let schema = rawNode.data?.schema || rawNode.schema || [];

  if (!componentType || componentType === "generic") {
    if (idLower.includes("duckdb") && (idLower.includes("sink") || idLower.includes("target") || idLower.includes("output"))) {
      componentType = "connector.db.duckdb.output";
      label = label && label !== id ? label : "DuckDB Output";
      category = "target";
      ports = [{ name: "input", direction: "input", type: "dataset" }];
      if (!config.table) {
        if (config.target) {
          config.table = config.target;
        } else {
          const parts = id.split("_sink_");
          config.table = parts.length > 1 && parts[1] && isNaN(Number(parts[1])) ? parts[1] : "output_table";
        }
      }
      if (!config.target && config.table) {
        config.target = config.table;
      }
    } else if (idLower.includes("duckdb")) {
      componentType = "connector.db.duckdb";
      label = label && label !== id ? label : "DuckDB Input";
      category = "source";
      ports = [{ name: "main", direction: "output", type: "dataset" }];
    } else if (idLower.includes("csv") && (idLower.includes("sink") || idLower.includes("target") || idLower.includes("output"))) {
      componentType = "core.file.target.csv";
      label = label && label !== id ? label : "Arquivo Delimitado (Saída)";
      category = "target";
      ports = [{ name: "input", direction: "input", type: "dataset" }];
    } else if (idLower.includes("csv")) {
      componentType = "core.file.source.csv";
      label = label && label !== id ? label : "CSV / Delimitado";
      category = "source";
      ports = [
        { name: "input", direction: "input", type: "dataset" },
        { name: "main", direction: "output", type: "dataset" },
      ];
    } else if (idLower.includes("parquet") && (idLower.includes("sink") || idLower.includes("target"))) {
      componentType = "core.file.target.parquet";
      label = label && label !== id ? label : "Parquet Output";
      category = "target";
      ports = [{ name: "input", direction: "input", type: "dataset" }];
    } else if (idLower.includes("parquet")) {
      componentType = "core.file.source.parquet";
      label = label && label !== id ? label : "Apache Parquet";
      category = "source";
      ports = [
        { name: "input", direction: "input", type: "dataset" },
        { name: "main", direction: "output", type: "dataset" },
      ];
    } else if (idLower.includes("postgres") && (idLower.includes("sink") || idLower.includes("target") || idLower.includes("output"))) {
      componentType = "connector.db.postgresql.output";
      label = label && label !== id ? label : "PostgreSQL Output";
      category = "target";
      ports = [{ name: "input", direction: "input", type: "dataset" }];
    } else if (idLower.includes("postgres")) {
      componentType = "connector.db.postgresql";
      label = label && label !== id ? label : "PostgreSQL Source";
      category = "source";
      ports = [
        { name: "input", direction: "input", type: "dataset" },
        { name: "main", direction: "output", type: "dataset" },
      ];
      if (idLower.includes("brm") && !config.connection_ref) {
        config.connection_ref = "brm";
      }
    } else if (idLower.includes("mapper") || idLower.includes("tmap")) {
      componentType = "core.tmap";
      label = label && label !== id ? label : "Data Mapper (tMap)";
      category = "transform";
      ports = [
        { name: "input", direction: "input", type: "dataset" },
        { name: "main", direction: "output", type: "dataset" },
      ];
    } else if (idLower.includes("sink") || idLower.includes("target")) {
      componentType = "core.file.target.csv";
      label = label && label !== id ? label : "Arquivo de Saída";
      category = "target";
      ports = [{ name: "input", direction: "input", type: "dataset" }];
    } else {
      componentType = componentType || "core.tmap";
      label = label || id;
      category = category || "transform";
      ports = ports || [
        { name: "input", direction: "input", type: "dataset" },
        { name: "main", direction: "output", type: "dataset" },
      ];
    }
  }

  if (!ports || ports.length === 0) {
    if (category === "source") {
      ports = [
        { name: "input", direction: "input", type: "dataset" },
        { name: "main", direction: "output", type: "dataset" },
      ];
    } else if (category === "target") {
      ports = [{ name: "input", direction: "input", type: "dataset" }];
    } else {
      ports = [
        { name: "input", direction: "input", type: "dataset" },
        { name: "main", direction: "output", type: "dataset" },
      ];
    }
  }

  return {
    id,
    type: "genericNode",
    position: rawNode.position || { x: 0, y: 0 },
    width: rawNode.width,
    height: rawNode.height,
    targetPosition: rawNode.targetPosition,
    sourcePosition: rawNode.sourcePosition,
    data: {
      label: label || id,
      componentType,
      componentVersion: rawNode.data?.componentVersion || "1.0.0",
      category,
      ports,
      config,
      schema,
      cellId: rawNode.data?.cellId || rawNode.cellId,
      layoutDirection: rawNode.data?.layoutDirection || rawNode.layoutDirection,
      status: rawNode.data?.status,
      metrics: rawNode.data?.metrics,
    },
  };
}

export function inferPipelineEdges(nodes: Node<CanvasNodeData>[]): Edge[] {
  if (!nodes || nodes.length < 2) return [];

  const sources = nodes.filter((n) => n.data.category === "source");
  const transforms = nodes.filter((n) => n.data.category === "transform");
  const targets = nodes.filter((n) => n.data.category === "target");

  const edges: Edge[] = [];

  if (transforms.length > 0) {
    transforms.forEach((t) => {
      sources.forEach((s) => {
        edges.push({
          id: `e-${s.id}-${t.id}`,
          source: s.id,
          target: t.id,
          sourceHandle: "main",
          targetHandle: "input",
          type: "smoothstep",
          animated: true,
          label: s.data.label || "row",
        });
      });

      targets.forEach((tgt) => {
        edges.push({
          id: `e-${t.id}-${tgt.id}`,
          source: t.id,
          target: tgt.id,
          sourceHandle: "main",
          targetHandle: "input",
          type: "smoothstep",
          animated: true,
          label: tgt.data.label || "out",
        });
      });
    });
  } else if (sources.length > 0 && targets.length > 0) {
    sources.forEach((s, idx) => {
      const tgt = targets[idx] || targets[0];
      edges.push({
        id: `e-${s.id}-${tgt.id}`,
        source: s.id,
        target: tgt.id,
        sourceHandle: "main",
        targetHandle: "input",
        type: "smoothstep",
        animated: true,
        label: "main",
      });
    });
  }

  return edges;
}

const STORAGE_KEY = "rdf_studio_v2";

/**
 * Substitui recursivamente referências a IDs antigos por novos IDs (ex: {{old_id.col}}, {old_id.col}, lookups.node_id, etc.)
 */
export function remapNodeReferences<T = any>(obj: T, idMap: Record<string, string>): T {
  if (!obj || Object.keys(idMap).length === 0) return obj;

  if (typeof obj === "string") {
    let result: string = obj;
    for (const [oldId, newId] of Object.entries(idMap)) {
      result = result.split(`{{${oldId}.`).join(`{{${newId}.`);
      result = result.split(`{${oldId}.`).join(`{${newId}.`);
      result = result.replace(new RegExp(`\\{\\{\\s*${oldId}\\.`, "g"), `{{${newId}.`);
    }
    return result as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => remapNodeReferences(item, idMap)) as any;
  }

  if (typeof obj === "object") {
    const copy: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (
        (k === "node_id" || k === "targetId" || k === "main_input_id" || k === "upstream_id") &&
        typeof v === "string" &&
        idMap[v]
      ) {
        copy[k] = idMap[v];
      } else {
        copy[k] = remapNodeReferences(v, idMap);
      }
    }
    return copy as any;
  }

  return obj;
}

/**
 * Garante que todos os nós em todas as células de um Job possuam IDs únicos globais.
 * Se múltiplos nós possuírem o mesmo ID (por exemplo, criados em células distintas em versões anteriores),
 * desambigua gerando novos IDs únicos e ajustando as arestas conectadas da célula.
 */
export function healDuplicateNodeIdsAcrossCells(cells: CanvasCellData[]): {
  cells: CanvasCellData[];
  repairedCount: number;
} {
  const seenIds = new Set<string>();
  let repairedCount = 0;

  const repairedCells = cells.map((cell) => {
    const idMap: Record<string, string> = {};
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

      // Colisão de ID detectada entre nós do Job!
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

    // Se houve renomeação, atualiza as arestas e dados dos nós desta célula
    const hasRenames = Object.keys(idMap).length > 0;
    const finalNodes = hasRenames
      ? newNodes.map((n) => ({
          ...n,
          data: remapNodeReferences(n.data, idMap),
        }))
      : newNodes;

    const newEdges = (cell.edges || []).map((edge) => {
      const newSource = idMap[edge.source] || edge.source;
      const newTarget = idMap[edge.target] || edge.target;
      const remappedData = hasRenames ? remapNodeReferences(edge.data, idMap) : edge.data;
      if (newSource !== edge.source || newTarget !== edge.target || hasRenames) {
        return {
          ...edge,
          source: newSource,
          target: newTarget,
          data: remappedData,
        };
      }
      return edge;
    });

    return {
      ...cell,
      nodes: finalNodes,
      edges: newEdges,
    };
  });

  return { cells: repairedCells, repairedCount };
}

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
      
      // Migration: add environment, multi-canvas cells and heal unstyled nodes
      if (Array.isArray(parsed.jobs)) {
        parsed.jobs = parsed.jobs.map((j: any) => {
          const cells: CanvasCellData[] = (
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
                ]
          ).map((c: CanvasCellData) => {
            const isV2OrHigher = Boolean(
              j.schemaVersion && (j.schemaVersion.includes("v2") || j.schemaVersion >= "rdf.job/v2")
            );
            const normNodes = (c.nodes || []).map(inferAndNormalizeNode);
            const normEdges =
              c.edges && c.edges.length > 0
                ? c.edges
                : isV2OrHigher
                ? []
                : inferPipelineEdges(normNodes);
            return {
              ...c,
              nodes: normNodes,
              edges: normEdges,
            };
          });

          // Garante unicidade de IDs de nós através de todas as células do Job
          const { cells: healedCells, repairedCount } = healDuplicateNodeIdsAcrossCells(cells);
          if (repairedCount > 0) {
            console.info(`[jobStore] Desambiguados ${repairedCount} nó(s) com IDs duplicados no job '${j.name || j.id}'`);
          }

          const activeCellId =
            j.activeCellId && healedCells.some((c) => c.id === j.activeCellId)
              ? j.activeCellId
              : healedCells[0]?.id || "canvas-cell-01";
          const activeCell = healedCells.find((c) => c.id === activeCellId) || healedCells[0];

          return {
            ...j,
            environment: j.environment ?? "dev",
            cells: healedCells,
            activeCellId,
            nodes: activeCell ? activeCell.nodes : healedCells.flatMap((c) => c.nodes),
            edges: activeCell ? activeCell.edges : healedCells.flatMap((c) => c.edges),
          };
        });
      } else {
        parsed.jobs = [];
      }
      
      // Migration: add queryBank if missing and normalize existing entries
      if (!Array.isArray(parsed.queryBank)) {
        parsed.queryBank = [];
      } else {
        parsed.queryBank = parsed.queryBank.map((q: any) => ({
          ...q,
          tags: Array.isArray(q?.tags) ? q.tags : [],
          schema: Array.isArray(q?.schema) ? q.schema : [],
          usageCount: typeof q?.usageCount === "number" ? q.usageCount : 0,
        }));
      }
      
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

let syncWorkspaceTimeout: any = null;

export function syncWorkspaceDebounced(currentState: StoreState): void {
  if (syncWorkspaceTimeout) clearTimeout(syncWorkspaceTimeout);
  syncWorkspaceTimeout = setTimeout(() => {
    try {
      fetch(`${getBaseApiUrl()}/workspaces/local/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeJobId: currentState.activeTabId,
          jobs: currentState.jobs,
          connections: currentState.connections,
          queryBank: currentState.queryBank,
        }),
      }).catch(() => {});
    } catch (_) {}
  }, 1000);
}

function saveState(state: StoreState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
  syncWorkspaceDebounced(state);
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  dataDir: string;
  jobsDir: string;
  connectionsDir: string;
  queriesDir: string;
  jobsCount: number;
  connectionsCount: number;
  queriesCount: number;
  recentWorkspaces: string[];
}

let currentWorkspace: WorkspaceInfo | null = null;

export async function fetchCurrentWorkspaceInfo(): Promise<WorkspaceInfo | null> {
  try {
    const res = await fetch(`${getBaseApiUrl()}/workspaces/local/current`);
    if (!res.ok) return null;
    const data = await res.json();
    currentWorkspace = data;
    return data;
  } catch (_) {
    return null;
  }
}

export async function hydrateFromActiveWorkspace(): Promise<{ success: boolean; workspace?: WorkspaceInfo }> {
  try {
    const baseUrl = getBaseApiUrl();
    const [syncRes, infoRes] = await Promise.all([
      fetch(`${baseUrl}/workspaces/local/sync`).catch(() => null),
      fetch(`${baseUrl}/workspaces/local/current`).catch(() => null),
    ]);

    if (infoRes && infoRes.ok) {
      currentWorkspace = await infoRes.json();
    }

    if (!syncRes || !syncRes.ok) {
      return { success: false, workspace: currentWorkspace || undefined };
    }

    const data = await syncRes.json();
    const hasWorkspaceData =
      (Array.isArray(data.jobs) && data.jobs.length > 0) ||
      (Array.isArray(data.connections) && data.connections.length > 0) ||
      (Array.isArray(data.queryBank) && data.queryBank.length > 0);

    if (hasWorkspaceData) {
      state = {
        ...state,
        jobs: Array.isArray(data.jobs) && data.jobs.length > 0 ? data.jobs : state.jobs,
        connections: Array.isArray(data.connections) && data.connections.length > 0 ? data.connections : state.connections,
        queryBank: Array.isArray(data.queryBank) && data.queryBank.length > 0 ? data.queryBank : state.queryBank,
        openTabIds: data.activeJobId ? [data.activeJobId] : state.openTabIds,
        activeTabId: data.activeJobId || state.activeTabId,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (_) {}
      notify();
    } else {
      // Se for workspace novo/vazio, salva os itens padrão para persistir em disco
      syncWorkspaceDebounced(state);
    }
    return { success: true, workspace: currentWorkspace || undefined };
  } catch (_) {
    return { success: false, workspace: currentWorkspace || undefined };
  }
}

export async function switchWorkspace(path: string, name?: string): Promise<{ success: boolean; workspace?: WorkspaceInfo; error?: string }> {
  try {
    const cleanPath = (path || "").trim().replace(/^["']|["']$/g, "").trim();
    if (!cleanPath) {
      return { success: false, error: "Informe o caminho da pasta raiz do workspace." };
    }

    const res = await fetch(`${getBaseApiUrl()}/workspaces/local/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cleanPath, name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.detail || "Erro ao alternar workspace" };
    }
    const info = await res.json();
    currentWorkspace = info;
    await hydrateFromActiveWorkspace();
    return { success: true, workspace: currentWorkspace || info };
  } catch (e: any) {
    return { success: false, error: String(e) };
  }
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

// ─── Undo/Redo (History) & Clipboard State ───────────────────────

interface HistorySnapshot {
  cells: CanvasCellData[];
  activeCellId?: string;
}

const undoStacks: Record<string, HistorySnapshot[]> = {};
const redoStacks: Record<string, HistorySnapshot[]> = {};
let lastSnapshotTime = 0;

export function takeSnapshot(jobId: string, force = false): void {
  const now = Date.now();
  if (!force && now - lastSnapshotTime < 400) {
    return;
  }
  lastSnapshotTime = now;
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return;
  if (!undoStacks[jobId]) undoStacks[jobId] = [];
  undoStacks[jobId].push({
    cells: JSON.parse(JSON.stringify(job.cells || [])),
    activeCellId: job.activeCellId,
  });
  if (undoStacks[jobId].length > 40) {
    undoStacks[jobId].shift();
  }
  redoStacks[jobId] = [];
}

interface ClipboardData {
  nodes: Node<CanvasNodeData>[];
  sourceCellId?: string;
}

let nodeClipboard: ClipboardData | null = null;

export const jobStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getState(): StoreState {
    return state;
  },

  getActiveJob(): JobData | undefined {
    return state.jobs.find((j) => j.id === state.activeTabId);
  },

  // ─── History (Undo / Redo) ────────────────────────────────

  takeSnapshot(jobId: string, force = true): void {
    takeSnapshot(jobId, force);
  },

  canUndo(jobId?: string): boolean {
    const id = jobId || state.activeTabId;
    return Boolean(id && undoStacks[id] && undoStacks[id].length > 0);
  },

  canRedo(jobId?: string): boolean {
    const id = jobId || state.activeTabId;
    return Boolean(id && redoStacks[id] && redoStacks[id].length > 0);
  },

  undo(jobId?: string): boolean {
    const id = jobId || state.activeTabId;
    if (!id) return false;
    const job = state.jobs.find((j) => j.id === id);
    const stack = undoStacks[id];
    if (!job || !stack || stack.length === 0) return false;

    const previous = stack.pop()!;
    if (!redoStacks[id]) redoStacks[id] = [];
    redoStacks[id].push({
      cells: JSON.parse(JSON.stringify(job.cells || [])),
      activeCellId: job.activeCellId,
    });

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== id) return j;
        const activeCell = previous.cells.find((c) => c.id === previous.activeCellId) || previous.cells[0];
        return {
          ...j,
          cells: previous.cells,
          activeCellId: previous.activeCellId || activeCell?.id,
          nodes: activeCell ? activeCell.nodes : previous.cells.flatMap((c) => c.nodes),
          edges: activeCell ? activeCell.edges : previous.cells.flatMap((c) => c.edges),
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
    return true;
  },

  redo(jobId?: string): boolean {
    const id = jobId || state.activeTabId;
    if (!id) return false;
    const job = state.jobs.find((j) => j.id === id);
    const stack = redoStacks[id];
    if (!job || !stack || stack.length === 0) return false;

    const next = stack.pop()!;
    if (!undoStacks[id]) undoStacks[id] = [];
    undoStacks[id].push({
      cells: JSON.parse(JSON.stringify(job.cells || [])),
      activeCellId: job.activeCellId,
    });

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== id) return j;
        const activeCell = next.cells.find((c) => c.id === next.activeCellId) || next.cells[0];
        return {
          ...j,
          cells: next.cells,
          activeCellId: next.activeCellId || activeCell?.id,
          nodes: activeCell ? activeCell.nodes : next.cells.flatMap((c) => c.nodes),
          edges: activeCell ? activeCell.edges : next.cells.flatMap((c) => c.edges),
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
    return true;
  },

  // ─── Clipboard (Copy / Paste) ─────────────────────────────

  copyNodes(jobId: string, cellId: string, nodeIds: string[]): boolean {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    const cell = (job.cells || []).find((c) => c.id === cellId);
    if (!cell) return false;
    const targetNodes = (cell.nodes || []).filter((n) => nodeIds.includes(n.id));
    if (targetNodes.length === 0) return false;
    nodeClipboard = {
      nodes: JSON.parse(JSON.stringify(targetNodes)),
      sourceCellId: cellId,
    };
    return true;
  },

  hasClipboardNodes(): boolean {
    return Boolean(nodeClipboard && nodeClipboard.nodes && nodeClipboard.nodes.length > 0);
  },

  pasteNodes(jobId: string, targetCellId?: string): Node<CanvasNodeData>[] {
    if (!nodeClipboard || !nodeClipboard.nodes || nodeClipboard.nodes.length === 0) return [];
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return [];
    const effectiveCellId = targetCellId || job.activeCellId || job.cells?.[0]?.id;
    const targetCell = (job.cells || []).find((c) => c.id === effectiveCellId) || job.cells?.[0];
    if (!targetCell) return [];

    takeSnapshot(jobId, true);

    const allJobNodes = (job.cells || []).flatMap((c) => c.nodes || []);
    const pastedNodes: Node<CanvasNodeData>[] = [];

    nodeClipboard.nodes.forEach((originalNode, idx) => {
      const newId = generateRocketNodeId(originalNode.data?.componentType || "node", [...allJobNodes, ...pastedNodes]);

      const clonedNode: Node<CanvasNodeData> = {
        ...JSON.parse(JSON.stringify(originalNode)),
        id: newId,
        position: {
          x: originalNode.position.x + 35 * (idx + 1),
          y: originalNode.position.y + 35 * (idx + 1),
        },
        selected: true,
        data: {
          ...originalNode.data,
          label: `${originalNode.data?.label || originalNode.id} (Cópia)`,
          cellId: targetCell.id,
          status: undefined,
          metrics: undefined,
        },
      };
      pastedNodes.push(clonedNode);
    });

    const unselectedExistingNodes = (targetCell.nodes || []).map((n) => ({
      ...n,
      selected: false,
    }));

    const updatedNodes = [...unselectedExistingNodes, ...pastedNodes];

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === targetCell.id ? { ...c, nodes: updatedNodes } : c
        );
        const isActive = j.activeCellId === targetCell.id;
        return {
          ...j,
          cells: updatedCells,
          nodes: isActive ? updatedNodes : j.nodes,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
    return pastedNodes;
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

  createCell(jobId: string, customName?: string, cellType: CellType = "CANVAS"): CanvasCellData | null {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return null;

    takeSnapshot(jobId, true);

    const existingCells = job.cells || [];
    const nextIndex = existingCells.length + 1;
    const prefix = cellType === "PYTHON" ? "python-cell" : "canvas-cell";
    const defaultId = `${prefix}-${String(nextIndex).padStart(2, "0")}`;
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

    const defaultCodeSnippet = cellType === "PYTHON"
      ? `# CellFlow Python Cell - Enterprise Notebook Engine
# Objetos disponíveis: context, pl (polars), duckdb, datetime, math, json

# 1. Lê os dados de uma etapa anterior (State Handoff):
# df_anterior = context.read_output('${prevCell?.id || "canvas-cell-01"}')

# 2. Processa ou cria dados usando Polars:
df = pl.DataFrame({
    "id": [1, 2, 3],
    "item": ["Produto A", "Produto B", "Produto C"],
    "valor": [150.0, 320.5, 89.9]
})
print(f"Processando {len(df)} registros na célula...")

# 3. Publica a saída desta célula para as próximas etapas:
context.write_output(df)
print("Dados publicados com sucesso via context.write_output!")
`
      : undefined;

    const newCell: CanvasCellData = {
      id: defaultId,
      name,
      cellType,
      codeSnippet: defaultCodeSnippet,
      description: "",
      order: newOrder,
      preconditions: defaultPreconditions,
      preconditionOperator: "AND",
      nodes: [],
      edges: [],
      status: "idle",
      is_active: true,
      is_minimized: false,
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
    if (updates.nodes || updates.edges || updates.order !== undefined || updates.layoutDirection) {
      takeSnapshot(jobId, true);
    }
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

    takeSnapshot(jobId, true);

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

  deleteEdge(jobId: string, cellId: string, edgeId: string): boolean {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return false;

    takeSnapshot(jobId, true);

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) => {
          if (c.id !== cellId) return c;
          const nextEdges = (c.edges || []).filter((e) => e.id !== edgeId);
          return {
            ...c,
            edges: nextEdges,
          };
        });
        const activeCell = updatedCells.find((c) => c.id === j.activeCellId);
        return {
          ...j,
          cells: updatedCells,
          nodes: activeCell ? activeCell.nodes : j.nodes,
          edges: activeCell ? activeCell.edges : j.edges,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
    saveState(state);
    notify();
    return true;
  },

  deleteNode(jobId: string, cellId: string, nodeId: string): boolean {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return false;

    takeSnapshot(jobId, true);

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) => {
          if (c.id !== cellId) return c;
          const nextNodes = (c.nodes || []).filter((n) => n.id !== nodeId);
          const nextEdges = (c.edges || []).filter(
            (e) => e.source !== nodeId && e.target !== nodeId
          );
          return {
            ...c,
            nodes: nextNodes,
            edges: nextEdges,
          };
        });
        const activeCell = updatedCells.find((c) => c.id === j.activeCellId);
        return {
          ...j,
          cells: updatedCells,
          nodes: activeCell ? activeCell.nodes : j.nodes,
          edges: activeCell ? activeCell.edges : j.edges,
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
    const newName = `Cópia de ${sourceCell.name}`.slice(0, 50);
    const maxOrder = existingCells.reduce((max, c) => Math.max(max, c.order || 0), 0);

    // Deep clone nodes and edges with id mapping and template token interpolation remapping
    const idMap: Record<string, string> = {};
    const clonedNodesRaw = (sourceCell.nodes || []).map((n) => {
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
      const newNId = `${n.id}_${uniqueSuffix}`;
      idMap[n.id] = newNId;
      return { n, newNId };
    });

    const isPython = sourceCell.cellType === "PYTHON";
    const prefix = isPython ? "python-cell" : "canvas-cell";
    const newId = `${prefix}-${String(nextIndex).padStart(2, "0")}`;

    const clonedNodes = clonedNodesRaw.map(({ n, newNId }) => {
      const deepData = JSON.parse(JSON.stringify(n.data || {}));
      const remappedData = remapNodeReferences(deepData, idMap);
      return {
        ...n,
        id: newNId,
        position: { x: n.position.x + 30, y: n.position.y + 30 },
        data: {
          ...remappedData,
          cellId: newId,
        },
      };
    });

    const clonedEdges = (sourceCell.edges || []).map((e) => {
      const deepData = JSON.parse(JSON.stringify(e.data || {}));
      const remappedData = remapNodeReferences(deepData, idMap);
      return {
        ...e,
        id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        source: idMap[e.source] || e.source,
        target: idMap[e.target] || e.target,
        data: remappedData,
      };
    });

    const clonedNodeSchemas: Record<string, SchemaColumn[]> = {};
    if (sourceCell.nodeSchemas) {
      for (const [oldId, schema] of Object.entries(sourceCell.nodeSchemas)) {
        const mappedId = idMap[oldId] || oldId;
        clonedNodeSchemas[mappedId] = JSON.parse(JSON.stringify(schema));
      }
    }

    const newCell: CanvasCellData = {
      id: newId,
      name: newName,
      cellType: sourceCell.cellType || "CANVAS",
      codeSnippet: sourceCell.codeSnippet,
      description: sourceCell.description || "",
      order: maxOrder + 1,
      preconditions: [...(sourceCell.preconditions || [])],
      preconditionOperator: sourceCell.preconditionOperator || "AND",
      nodes: clonedNodes,
      edges: clonedEdges,
      viewport: sourceCell.viewport ? { ...sourceCell.viewport } : undefined,
      nodeSchemas: clonedNodeSchemas,
      status: "idle",
      is_active: sourceCell.is_active !== undefined ? sourceCell.is_active : true,
      is_minimized: false,
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

  toggleCellActive(cellIdOrJobId: string, maybeCellId?: string): void {
    const jobId = maybeCellId ? cellIdOrJobId : (state.activeTabId || "");
    const cellId = maybeCellId ? maybeCellId : cellIdOrJobId;
    if (!jobId || !cellId) return;
    takeSnapshot(jobId, true);
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, is_active: c.is_active === false ? true : false } : c
        );
        return { ...j, cells: updatedCells, updatedAt: new Date().toISOString() };
      }),
    };
    saveState(state);
    notify();
  },

  toggleCellMinimized(cellIdOrJobId: string, maybeCellId?: string): void {
    const jobId = maybeCellId ? cellIdOrJobId : (state.activeTabId || "");
    const cellId = maybeCellId ? maybeCellId : cellIdOrJobId;
    if (!jobId || !cellId) return;
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, is_minimized: !c.is_minimized } : c
        );
        return { ...j, cells: updatedCells, updatedAt: new Date().toISOString() };
      }),
    };
    saveState(state);
    notify();
  },

  setCellActive(jobId: string, cellId: string, isActive: boolean): void {
    takeSnapshot(jobId, true);
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, is_active: isActive } : c
        );
        return { ...j, cells: updatedCells, updatedAt: new Date().toISOString() };
      }),
    };
    saveState(state);
    notify();
  },

  setCellMinimized(jobId: string, cellId: string, isMinimized: boolean): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, is_minimized: isMinimized } : c
        );
        return { ...j, cells: updatedCells, updatedAt: new Date().toISOString() };
      }),
    };
    saveState(state);
    notify();
  },

  resetCellStatus(jobId: string, cellId: string): void {
    let affectedNodeIds: string[] = [];
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) => {
          if (c.id !== cellId) return c;
          affectedNodeIds = (c.nodes || []).map((n) => n.id);
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
    if (affectedNodeIds.length > 0) {
      telemetryStore.clearNodes(affectedNodeIds);
    }
    saveState(state);
    notify();
  },

  resetAllCellsStatus(jobId: string): void {
    let affectedNodeIds: string[] = [];
    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) => {
          (c.nodes || []).forEach((n) => affectedNodeIds.push(n.id));
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
    if (affectedNodeIds.length > 0) {
      telemetryStore.clearNodes(affectedNodeIds);
    }
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
        const updatedCells = (j.cells || []).map((c) => {
          if (c.id !== cellId) {
            return {
              ...c,
              nodes: (c.nodes || []).map(({ selected, dragging, measured, ...n }: any) => ({
                ...n,
                selected: false,
              })),
              edges: (c.edges || []).map(({ selected, ...e }: any) => ({
                ...e,
                selected: false,
              })),
            };
          }
          return c;
        });
        const targetCell = updatedCells.find((c) => c.id === cellId);
        return {
          ...j,
          activeCellId: cellId,
          cells: updatedCells,
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
    takeSnapshot(jobId);
    // Assegura que todos os nós tenham data.cellId registrado e higieniza arestas órfãs e propriedades efêmeras
    const safeNodes = (nodes || []).map((n) => {
      const sanitized = sanitizeNode(n);
      return {
        ...sanitized,
        data: {
          ...sanitized.data,
          cellId,
        },
      };
    });
    const validNodeIds = new Set(safeNodes.map((n) => n.id));
    const safeEdges = (edges || [])
      .filter((e) => validNodeIds.has(e.source) && validNodeIds.has(e.target))
      .map((e) => {
        const sanitized = sanitizeEdge(e);
        return {
          ...sanitized,
          data: {
            ...sanitized.data,
            cellId,
          },
        };
      });

    state = {
      ...state,
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const updatedCells = (j.cells || []).map((c) =>
          c.id === cellId ? { ...c, nodes: safeNodes, edges: safeEdges, viewport } : c
        );
        const isActive = j.activeCellId === cellId;
        return {
          ...j,
          cells: updatedCells,
          nodes: isActive ? safeNodes : j.nodes,
          edges: isActive ? safeEdges : j.edges,
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
    const schemaVersion = (imported as any).schemaVersion || (rawJob as any).schemaVersion || "";
    const isV2OrHigher = Boolean(
      schemaVersion && (schemaVersion.includes("v2") || schemaVersion >= "rdf.job/v2")
    );
    const rawNodes = imported.nodes || rawJob.nodes || [];
    const normalizedNodes = rawNodes.map(inferAndNormalizeNode);
    let edges = imported.edges || rawJob.edges || [];
    if (!isV2OrHigher && edges.length === 0 && normalizedNodes.length > 0) {
      edges = inferPipelineEdges(normalizedNodes);
    }

    const nodeSchemas = imported.nodeSchemas || rawJob.nodeSchemas || {};
    const environment = imported.environment || rawJob.environment || "dev";
    const viewport = imported.viewport || rawJob.viewport;

    const rawCells = (rawJob as any).cells;
    const importedCells: CanvasCellData[] =
      Array.isArray(rawCells) && rawCells.length > 0
        ? rawCells.map((c: CanvasCellData) => {
            const normC = (c.nodes || []).map(inferAndNormalizeNode);
            const edgeC =
              c.edges && c.edges.length > 0
                ? c.edges
                : isV2OrHigher
                ? []
                : inferPipelineEdges(normC);
            return {
              ...c,
              nodes: normC,
              edges: edgeC,
            };
          })
        : [
            {
              id: "canvas-cell-01",
              name: "canvas-cell-01",
              description: "",
              order: 1,
              preconditions: [],
              preconditionOperator: "AND",
              nodes: normalizedNodes,
              edges: edges,
              viewport,
              nodeSchemas,
              status: "idle",
            },
          ];
    const activeCellId = (rawJob as any).activeCellId || importedCells[0]?.id || "canvas-cell-01";
    const activeCell = importedCells.find((c) => c.id === activeCellId) || importedCells[0];

    // Se o payload contiver conexões migradas, importa para o repositório global
    if (Array.isArray((imported as any).connections)) {
      (imported as any).connections.forEach((conn: any) => {
        if (!state.connections.some((c) => c.id === conn.id || c.name === conn.name)) {
          state.connections.push({
            ...conn,
            createdAt: conn.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }

    // Create new job with fresh ID to prevent collision
    const newId = `job-${Date.now()}`;
    const newJob: JobData = {
      id: newId,
      name,
      folderId,
      nodes: activeCell ? activeCell.nodes : normalizedNodes,
      edges: activeCell ? activeCell.edges : edges,
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
    const entry: QueryEntry = {
      ...q,
      tags: Array.isArray(q.tags) ? q.tags : [],
      schema: Array.isArray(q.schema) ? q.schema : [],
      id: `qry-${Date.now()}`,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    state = { ...state, queryBank: [...state.queryBank, entry] };
    saveState(state);
    notify();
    return entry;
  },

  updateQuery(qId: string, updates: Partial<Omit<QueryEntry, "id" | "createdAt">>): void {
    state = {
      ...state,
      queryBank: state.queryBank.map((q) => {
        if (q.id !== qId) return q;
        const updated = { ...q, ...updates, updatedAt: new Date().toISOString() };
        if (updates.tags !== undefined) updated.tags = Array.isArray(updates.tags) ? updates.tags : [];
        if (updates.schema !== undefined) updated.schema = Array.isArray(updates.schema) ? updates.schema : [];
        return updated;
      }),
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

  getWorkspaceInfo(): WorkspaceInfo | null {
    return currentWorkspace;
  },

  async hydrateFromWorkspace(): Promise<{ success: boolean; workspace?: WorkspaceInfo }> {
    return hydrateFromActiveWorkspace();
  },

  updateCellCode(jobId: string, cellId: string, codeSnippet: string): void {
    this.updateCell(jobId, cellId, { codeSnippet });
  },

  isPythonCellsEnabled(): boolean {
    try {
      const val = localStorage.getItem("cellflow_enable_python_cells");
      return val === null ? true : val === "true";
    } catch (_) {
      return true;
    }
  },

  setPythonCellsEnabled(enabled: boolean): void {
    try {
      localStorage.setItem("cellflow_enable_python_cells", enabled ? "true" : "false");
    } catch (_) {}
    notify();
  },
};

