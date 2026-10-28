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
  layoutDirection?: "LR" | "TB";
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

export interface ColumnProfile {
  column_name: string;
  total_count: number;
  null_count: number;
  null_percentage: number;
  distinct_count: number;
  min_value: any;
  max_value: any;
  inferred_type: string;
  sample_values?: any[];
}

export interface DatasetProfile {
  row_count: number;
  column_count: number;
  columns: Record<string, ColumnProfile>;
}

export interface TypeMismatch {
  column: string;
  frozen_type: string;
  current_type: string;
}

export interface SchemaDriftReport {
  has_drift: boolean;
  added_columns: string[];
  removed_columns: string[];
  type_mismatches: TypeMismatch[];
  drift_summary: string;
}

export interface NodePreviewData {
  execution_id: string;
  node_id: string;
  port: string;
  available_ports: string[];
  columns: string[];
  rows: Record<string, any>[];
  total_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface LineageTransformationEdge {
  source_node_id: string;
  source_port: string;
  source_column: string;
  target_node_id: string;
  target_port: string;
  target_column: string;
  transformation_type: "PASSTHROUGH" | "EXPRESSION" | "LOOKUP_MATCH";
  expression?: string;
}

export interface ColumnLineageReport {
  pipeline_id: string;
  target_column?: string;
  target_node_id?: string;
  nodes: string[];
  edges: LineageTransformationEdge[];
}

export interface ScheduleItem {
  id: string;
  pipeline_id: string;
  name: string;
  cron_expression?: string;
  interval_seconds?: number;
  concurrency_policy: "ALLOW" | "SKIP_IF_RUNNING" | "QUEUE";
  enabled: boolean;
  webhook_url?: string;
  webhook_events?: string[];
  created_at?: string;
  last_run_at?: string;
  next_run_at?: string;
  last_status?: string;
}

export interface ScheduleCreateData {
  pipeline_id: string;
  name: string;
  cron_expression?: string;
  interval_seconds?: number;
  concurrency_policy?: "ALLOW" | "SKIP_IF_RUNNING" | "QUEUE";
  enabled?: boolean;
  webhook_url?: string;
  webhook_events?: string[];
}

export interface StandaloneCodeResult {
  script_py: string;
  requirements_txt: string;
  env_example: string;
  pipeline_name: string;
  generated_at: string;
}

export interface AirflowDagResult {
  dag_py: string;
  dag_id: string;
  schedule_interval: string;
  generated_at: string;
}

export interface AirflowExportOptions {
  dag_id?: string;
  schedule_interval?: string;
  start_date?: string;
  owner?: string;
  retries?: number;
  retry_delay_minutes?: number;
  catchup?: boolean;
  tags?: string[];
}

