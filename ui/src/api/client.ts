import {
  ColumnLineageReport,
  CompiledPlans,
  ComponentDefinition,
  DatasetProfile,
  ExecutionDetail,
  InferredSchema,
  LogEntry,
  NodePreviewData,
  PipelineDraft,
  PipelineVersion,
  ScheduleCreateData,
  ScheduleItem,
  SchemaDriftReport,
  StandaloneCodeResult,
  AirflowDagResult,
  AirflowExportOptions,
  ValidationReport,
} from "../types";


declare global {
  interface Window {
    cellflow?: {
      apiBase?: string;
      token?: string;
      getConfig?: () => Promise<{ apiBase: string; token: string }>;
    };
  }
}

export const getCellflowConfig = (): { apiBase: string; token: string } => {
  if (typeof window !== "undefined" && window.cellflow && window.cellflow.apiBase) {
    return {
      apiBase: window.cellflow.apiBase,
      token: window.cellflow.token || "",
    };
  }
  const viteToken =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_CELLFLOW_TOKEN) ||
    (typeof process !== "undefined" && process.env?.VITE_CELLFLOW_TOKEN) ||
    "";
  const isViteDev =
    typeof window !== "undefined" &&
    window.location &&
    window.location.protocol.startsWith("http") &&
    window.location.port === "5173";
  return {
    apiBase: isViteDev ? "/api/v1" : "http://127.0.0.1:8000/api/v1",
    token: viteToken,
  };
};

export const getBaseApiUrl = () => {
  return getCellflowConfig().apiBase;
};

export const getAuthToken = () => {
  return getCellflowConfig().token;
};

export function createCellflowWebSocket(path: string): WebSocket {
  const { apiBase, token } = getCellflowConfig();
  const wsUrl = apiBase.replace(/^http/, "ws");
  const separator = path.includes("?") ? "&" : "?";
  const urlWithToken = token
    ? `${wsUrl}${path}${separator}token=${encodeURIComponent(token)}`
    : `${wsUrl}${path}`;
  return new WebSocket(urlWithToken);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { apiBase, token } = getCellflowConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["X-CellFlow-Token"] = token;
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, { ...options, headers });
  } catch (err: any) {
    // Falha em nível de rede
    throw new Error(
      `Não foi possível conectar ao servidor backend em ${apiBase}. ` +
      "Certifique-se de que a API FastAPI está em execução."
    );
  }

  if (res.ok) {
    return res.json();
  }

  let errorDetail = res.statusText;
  try {
    const json = await res.json();
    errorDetail = json.detail || json.message || JSON.stringify(json);
  } catch (_) {}
  throw new Error(`[${res.status}] ${errorDetail}`);
}

export const api = {
  // Catalog & Schemas
  getCatalog: () => request<ComponentDefinition[]>("/components/catalog"),
  inferSchema: (pathOrQuery: string, connectorType = "file", connectionDetails?: Record<string, any>) =>
    request<InferredSchema>("/schemas/infer", {
      method: "POST",
      body: JSON.stringify({
        connector_type: connectorType,
        path_or_query: pathOrQuery,
        connection_details: connectionDetails,
      })
    }),
  profileDataset: (pathOrQuery?: string, records?: any[], sampleSize = 1000, connectorType = "file", connectionDetails?: Record<string, any>) =>
    request<DatasetProfile>("/schemas/profile", {
      method: "POST",
      body: JSON.stringify({
        path_or_query: pathOrQuery,
        records: records,
        sample_size: sampleSize,
        connector_type: connectorType,
        connection_details: connectionDetails,
      })
    }),
  detectSchemaDrift: (frozenSchema: any[], currentSchema: any[]) =>
    request<SchemaDriftReport>("/schemas/drift", {
      method: "POST",
      body: JSON.stringify({
        frozen_schema: frozenSchema,
        current_schema: currentSchema,
      })
    }),

  // Pipelines & Drafts
  listPipelinesForProject: (projectId: string) =>
    request<Array<{ id: string; name: string; revision: number }>>(`/projects/${projectId}/pipelines`),
  createPipeline: (projectId: string, name: string) =>
    request<PipelineDraft>(`/projects/${projectId}/pipelines`, {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  getDraft: (pipelineId: string) => request<PipelineDraft>(`/pipelines/${pipelineId}/draft`),
  updateDraft: (pipelineId: string, expectedRevision: number, definition: any, layout: any) =>
    request<PipelineDraft>(`/pipelines/${pipelineId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ expected_revision: expectedRevision, definition, layout })
    }),
  validateDraft: (pipelineId: string) =>
    request<ValidationReport>(`/pipelines/${pipelineId}/validate`, { method: "POST" }),
  publishVersion: (pipelineId: string, versionTag: string) =>
    request<PipelineVersion>(`/pipelines/${pipelineId}/publish`, {
      method: "POST",
      body: JSON.stringify({ version_tag: versionTag })
    }),
  exportPipeline: (pipelineId: string) =>
    request<{ pipeline_yaml: string; layout_json: string }>(`/pipelines/${pipelineId}/export`),

  // Compilation & Execution
  compileVersion: (versionId: string) =>
    request<CompiledPlans>(`/pipeline-versions/${versionId}/compile`, { method: "POST" }),
  executeVersion: (versionId: string, context_variables?: Record<string, any>) =>
    request<{ execution_id: string; status: string; correlation_id: string }>(
      `/pipeline-versions/${versionId}/execute`,
      {
        method: "POST",
        body: context_variables ? JSON.stringify({ context_variables }) : undefined,
      }
    ),
  executePythonCell: (params: {
    code: string;
    cell_id: string;
    cell_name: string;
    shared_outputs?: Record<string, any>;
    context_variables?: Record<string, any>;
  }) =>
    request<{
      success: boolean;
      stdout: string;
      stderr: string;
      error: string | null;
      output_preview: any;
      duration_ms?: number;
      rows_out?: number;
      context_variables?: Record<string, any>;
    }>("/pipelines/cells/python/execute", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  getExecution: (executionId: string) => request<ExecutionDetail>(`/executions/${executionId}`),
  cancelExecution: (executionId: string) =>
    request<ExecutionDetail>(`/executions/${executionId}/cancel`, { method: "POST" }),
  getExecutionLogs: (executionId: string, nodeId?: string) => {
    const q = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    return request<LogEntry[]>(`/executions/${executionId}/logs${q}`);
  },

  // Live Preview, Partial Execution & Lineage (Spec 005)
  executePartial: (params: {
    target_node_id: string;
    pipeline_id?: string;
    version_id?: string;
    draft_definition?: any;
    context_variables?: Record<string, any>;
  }) =>
    request<{ execution_id: string; status: string; correlation_id: string }>("/executions/partial", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  getNodePreview: (
    executionId: string,
    nodeId: string,
    params?: { port?: string; page?: number; page_size?: number; search?: string; sort_by?: string; sort_desc?: boolean }
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.port) searchParams.set("port", params.port);
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.sort_by) searchParams.set("sort_by", params.sort_by);
    if (params?.sort_desc !== undefined) searchParams.set("sort_desc", params.sort_desc.toString());
    const query = searchParams.toString();
    return request<NodePreviewData>(`/executions/${executionId}/nodes/${nodeId}/preview${query ? `?${query}` : ""}`);
  },
  getColumnLineage: (pipelineId: string, column?: string, nodeId?: string) => {
    const searchParams = new URLSearchParams();
    if (column) searchParams.set("column", column);
    if (nodeId) searchParams.set("node_id", nodeId);
    const query = searchParams.toString();
    return request<ColumnLineageReport>(`/pipelines/${pipelineId}/lineage${query ? `?${query}` : ""}`);
  },

  // Setup helpers
  listWorkspaces: () => request<Array<{ id: string; name: string }>>("/workspaces"),
  createWorkspace: (name: string) =>
    request<{ id: string; name: string }>("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  listProjects: (workspaceId: string) =>
    request<Array<{ id: string; name: string; slug: string }>>(`/workspaces/${workspaceId}/projects`),
  createProject: (workspaceId: string, name: string, slug: string) =>
    request<{ id: string; name: string; slug: string }>(`/workspaces/${workspaceId}/projects`, {
      method: "POST",
      body: JSON.stringify({ name, slug })
    }),

  // Schedules (Spec 006 - Fase 1)
  listSchedules: (pipelineId?: string) =>
    request<ScheduleItem[]>(`/schedules${pipelineId ? `?pipeline_id=${pipelineId}` : ""}`),
  createSchedule: (data: ScheduleCreateData) =>
    request<ScheduleItem>("/schedules", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getSchedule: (scheduleId: string) =>
    request<ScheduleItem>(`/schedules/${scheduleId}`),
  pauseSchedule: (scheduleId: string) =>
    request<ScheduleItem>(`/schedules/${scheduleId}/pause`, { method: "POST" }),
  resumeSchedule: (scheduleId: string) =>
    request<ScheduleItem>(`/schedules/${scheduleId}/resume`, { method: "POST" }),
  triggerSchedule: (scheduleId: string) =>
    request<{ schedule_id: string; status: string }>(`/schedules/${scheduleId}/trigger`, { method: "POST" }),
  deleteSchedule: (scheduleId: string) =>
    request<void>(`/schedules/${scheduleId}`, { method: "DELETE" }),

  // Codegen Export (Spec 006 - Fase 3)
  exportStandaloneCode: (pipelineId: string, draftDefinition?: any, scope?: "cell" | "job") =>
    request<StandaloneCodeResult>(`/pipelines/${pipelineId}/export/standalone`, {
      method: "POST",
      body: JSON.stringify({ draft_definition: draftDefinition, export_scope: scope }),
    }),
  exportAirflowDag: (pipelineId: string, options?: AirflowExportOptions, draftDefinition?: any, scope?: "cell" | "job") =>
    request<AirflowDagResult>(`/pipelines/${pipelineId}/export/airflow`, {
      method: "POST",
      body: JSON.stringify({ ...options, draft_definition: draftDefinition, export_scope: scope }),
    }),

  // Git integration
  getGitStatus: () =>
    request<{ branch: string; clean: boolean; commit_hash: string; commit_message: string }>("/git/status"),

  // Filesystem & Arquivos Locais
  browseLocalFile: (initialDir?: string, fileTypes?: string) =>
    request<{ status: string; path: string | null }>("/workspaces/local/browse-file", {
      method: "POST",
      body: JSON.stringify({ initial_dir: initialDir, file_types: fileTypes }),
    }),
  listLocalFiles: (directory?: string) =>
    request<{ current_dir: string; items: Array<{ name: string; path: string; type: "file" | "directory"; extension?: string; size?: number }> }>(
      `/workspaces/local/files${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`
    ),
};

