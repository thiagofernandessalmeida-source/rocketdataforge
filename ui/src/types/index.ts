export type PortDirection = "input" | "output";
export type PortType = "dataset" | "control" | "reject";
export type ComponentCategory = "source" | "transform" | "target" | "control";

export interface PortDefinition {
  name: string;
  direction: PortDirection;
  type: PortType;
}

export interface ComponentCapability {
  supports_filter_pushdown: boolean;
  supports_projection_pushdown: boolean;
  supports_chunked_read: boolean;
  supports_bulk_write: boolean;
}

export interface ComponentDefinition {
  type_id: string;
  version: string;
  name: string;
  category: ComponentCategory;
  description: string;
  ports: PortDefinition[];
  config_schema: Record<string, any>;
  capabilities: ComponentCapability;
}

export interface CanvasNodeData {
  label: string;
  componentType: string;
  componentVersion: string;
  category: ComponentCategory;
  config: Record<string, any>;
  ports: PortDefinition[];
  schema?: Array<any>;
  status?: string;
  metrics?: {
    rowsIn?: number;
    rowsOut?: number;
    durationMs?: number;
  };
  cellId?: string;
}

export interface PipelineSummary {
  id: string;
  project_id: string;
  name: string;
  revision: number;
  updated_at: string;
}

export interface PipelineDraft {
  id: string;
  project_id: string;
  name: string;
  revision: number;
  definition: {
    metadata: { id?: string; name?: string; description?: string };
    spec: {
      nodes: Array<{
        id: string;
        component: { type: string; version: string };
        config: Record<string, any>;
      }>;
      edges: Array<{ id?: string; from: string; to: string }>;
      parameters?: Record<string, any>;
    };
  };
  layout: {
    viewport?: { x: number; y: number; zoom: number };
    nodes: Array<{
      id: string;
      position: { x: number; y: number };
      width?: number;
      height?: number;
    }>;
  };
}

export interface ValidationErrorItem {
  code: string;
  message: string;
  node_id?: string;
}

export interface ValidationReport {
  is_valid: boolean;
  errors: ValidationErrorItem[];
  warnings: ValidationErrorItem[];
}

export interface PipelineVersion {
  id: string;
  pipeline_id: string;
  version_tag: string;
  schema_version: string;
  definition_hash: string;
  published_at: string;
}

export interface TaskRunDetail {
  node_id: string;
  status: string;
  rows_in: number;
  rows_out: number;
  duration_ms?: number;
  error_message?: string;
}

export interface ExecutionDetail {
  execution_id: string;
  pipeline_version_id: string;
  status: string;
  attempt: number;
  started_at?: string;
  finished_at?: string;
  tasks: TaskRunDetail[];
}

export interface LogEntry {
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  execution_id: string;
  node_id?: string;
  message: string;
}

export interface CompiledPlans {
  logical_plan: Record<string, any>;
  optimized_plan: Record<string, any>;
  physical_plan: Record<string, any>;
  optimizations_applied: Array<{
    rule: string;
    description: string;
    affected_nodes: string[];
  }>;
}

export interface InferredField {
  name: string;
  logical_type: string;
  physical_type: string;
  nullable: boolean;
}

export interface InferredSchema {
  dataset_name: string;
  fields: InferredField[];
}
