import {
  CompiledPlans,
  ComponentDefinition,
  ExecutionDetail,
  InferredSchema,
  LogEntry,
  PipelineDraft,
  PipelineVersion,
  ValidationReport,
} from "../types";

const API_BASE = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    let errorDetail = res.statusText;
    try {
      const json = await res.json();
      errorDetail = json.detail || json.message || JSON.stringify(json);
    } catch (_) {}
    throw new Error(`[${res.status}] ${errorDetail}`);
  }

  return res.json();
}

export const api = {
  // Catalog & Schemas
  getCatalog: () => request<ComponentDefinition[]>("/components/catalog"),
  inferSchema: (pathOrQuery: string, connectorType = "file") =>
    request<InferredSchema>("/schemas/infer", {
      method: "POST",
      body: JSON.stringify({ connector_type: connectorType, path_or_query: pathOrQuery })
    }),

  // Pipelines & Drafts
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

  // Git integration
  getGitStatus: () =>
    request<{ branch: string; clean: boolean; commit_hash: string; commit_message: string }>("/git/status")
};
