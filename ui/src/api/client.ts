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


export const getBaseApiUrl = () => {
  if (
    typeof window !== "undefined" &&
    window.location &&
    window.location.protocol.startsWith("http") &&
    window.location.port === "5173"
  ) {
    return "/api/v1";
  }
  return "http://127.0.0.1:8000/api/v1";
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {})
  };

  const baseUrl = getBaseApiUrl();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  } catch (err: any) {
    // Network-level failure: proxy itself couldn't reach the backend
    throw new Error(
      "Não foi possível conectar ao servidor backend. " +
      "Certifique-se de que a API (FastAPI) está rodando na porta 8000 " +
      "e que o frontend foi iniciado com 'npm run dev'."
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
  executeVersion: (versionId: string) =>
    request<{ execution_id: string; status: string; correlation_id: string }>(
      `/pipeline-versions/${versionId}/execute`,
      { method: "POST" }
    ),
  getExecution: (executionId: string) => request<ExecutionDetail>(`/executions/${executionId}`),
  cancelExecution: (executionId: string) =>
    request<ExecutionDetail>(`/executions/${executionId}/cancel`, { method: "POST" }),
  getExecutionLogs: (executionId: string, nodeId?: string) => {
    const q = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    return request<LogEntry[]>(`/executions/${executionId}/logs${q}`);
  },

  // Live Preview, Partial Execution & Lineage (Spec 005)
  executePartial: (params: { target_node_id: string; pipeline_id?: string; version_id?: string; draft_definition?: any }) =>
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
  exportStandaloneCode: (pipelineId: string, draftDefinition?: any) =>
    request<StandaloneCodeResult>(`/pipelines/${pipelineId}/export/standalone`, {
      method: "POST",
      body: JSON.stringify({ draft_definition: draftDefinition }),
    }),
  exportAirflowDag: (pipelineId: string, options?: AirflowExportOptions, draftDefinition?: any) =>
    request<AirflowDagResult>(`/pipelines/${pipelineId}/export/airflow`, {
      method: "POST",
      body: JSON.stringify({ ...options, draft_definition: draftDefinition }),
    }),

  // Git integration
  getGitStatus: () =>
    request<{ branch: string; clean: boolean; commit_hash: string; commit_message: string }>("/git/status")
};

