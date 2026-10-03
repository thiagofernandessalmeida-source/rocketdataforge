// ============================================================
// RocketDataForge — Job Store v2 (LocalStorage Persistence)
// ============================================================

import { Node, Edge } from "reactflow";
import { CanvasNodeData } from "../types";

export type JobStatus = "draft" | "saved" | "published";
export type Environment = "dev" | "hml" | "prd";

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
  | "oracle" | "sqlserver" | "mysql" | "postgresql" | "redshift"
  | "databricks" | "snowflake" | "bigquery" | "s3" | "azure_blob"
  | "gcs" | "rest_api" | "soap_api" | "mongodb" | "cassandra" | "scylla"
  | "elasticsearch" | "kafka" | "aws_sqs" | "aws_sns" | "sftp" | "ftp";

export interface ConnectionEntry {
  id: string;
  name: string;
  type: ConnectionType;
  config: ConnectionConfig;
  description?: string;
  environments: Environment[]; // Quais ambientes esta conexão pertence
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
      
      // Migration: add environment field to old jobs
      if (Array.isArray(parsed.jobs)) {
        parsed.jobs = parsed.jobs.map((j: any) => ({
          ...j,
          environment: j.environment ?? "dev",
        }));
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
    const job: JobData = {
      id: `job-${Date.now()}`,
      name,
      folderId,
      nodes: [],
      edges: [],
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
    viewport?: { x: number; y: number; zoom: number }
  ): void {
    state = {
      ...state,
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? { ...j, nodes, edges, viewport, status: "saved", updatedAt: new Date().toISOString() }
          : j
      ),
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
};
