import React from "react";
import {
  Database,
  FileSpreadsheet,
  FileCode,
  FileText,
  Flame,
  Cloud,
  Layers,
  Radio,
  Server,
  Filter,
  BarChart2,
  GitMerge,
  Cpu,
  Globe,
  HardDrive,
  Workflow,
} from "lucide-react";
import { jobStore, ConnectionEntry } from "../../../store/jobStore";

export interface TechnologyMeta {
  key: string;
  name: string;
  badgeLabel: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
}

export function getTechnologyMeta(
  componentType?: string,
  config?: Record<string, any>,
  customConnections?: ConnectionEntry[]
): TechnologyMeta {
  const ct = (componentType || "").toLowerCase();
  const connections: ConnectionEntry[] = customConnections || jobStore.getState().connections || [];

  // 1. Tenta identificar por conexão referenciada
  let connType = "";
  if (config?.connection_ref) {
    const conn = connections.find((c: ConnectionEntry) => c.id === config.connection_ref || c.name === config.connection_ref);
    if (conn) {
      connType = conn.type.toLowerCase();
    }
  }

  // 2. Dialeto configurado explicitamente
  const dialect = (config?.dialect || config?.db_type || "").toLowerCase();

  // 3. Extensão do arquivo para componentes file
  const path = (config?.path || "").toLowerCase();
  const fileExt = path.split(".").pop() || "";

  // ─── POSTGRESQL ─────────────────────────────────────────────
  if (
    ct.includes("postgresql") ||
    ct.includes("postgres") ||
    connType.includes("postgres") ||
    dialect.includes("postgres")
  ) {
    return {
      key: "postgres",
      name: "PostgreSQL",
      badgeLabel: "PostgreSQL",
      color: "#38bdf8", // Sky blue
      bgColor: "rgba(14, 165, 233, 0.16)",
      borderColor: "rgba(56, 189, 248, 0.5)",
      icon: <Database size={15} color="#38bdf8" />,
    };
  }

  // ─── ORACLE ─────────────────────────────────────────────────
  if (
    ct.includes("oracle") ||
    connType.includes("oracle") ||
    dialect.includes("oracle")
  ) {
    return {
      key: "oracle",
      name: "Oracle DB",
      badgeLabel: "Oracle",
      color: "#f87171", // Red
      bgColor: "rgba(239, 68, 68, 0.16)",
      borderColor: "rgba(248, 113, 113, 0.5)",
      icon: <Database size={15} color="#f87171" />,
    };
  }

  // ─── DATABRICKS ─────────────────────────────────────────────
  if (
    ct.includes("databricks") ||
    connType.includes("databricks") ||
    dialect.includes("databricks")
  ) {
    return {
      key: "databricks",
      name: "Databricks Lakehouse",
      badgeLabel: "Databricks",
      color: "#fb923c", // Vibrant Orange
      bgColor: "rgba(249, 115, 22, 0.18)",
      borderColor: "rgba(251, 146, 60, 0.6)",
      icon: <Flame size={15} color="#fb923c" />,
    };
  }

  // ─── DUCKDB ─────────────────────────────────────────────────
  if (
    ct.includes("duckdb") ||
    connType.includes("duckdb") ||
    dialect.includes("duckdb") ||
    fileExt === "duckdb"
  ) {
    return {
      key: "duckdb",
      name: "DuckDB In-Memory",
      badgeLabel: "DuckDB",
      color: "#facc15", // Yellow
      bgColor: "rgba(234, 179, 8, 0.16)",
      borderColor: "rgba(250, 204, 21, 0.55)",
      icon: <Cpu size={15} color="#facc15" />,
    };
  }

  // ─── MYSQL ──────────────────────────────────────────────────
  if (
    ct.includes("mysql") ||
    connType.includes("mysql") ||
    dialect.includes("mysql")
  ) {
    return {
      key: "mysql",
      name: "MySQL",
      badgeLabel: "MySQL",
      color: "#00a4db",
      bgColor: "rgba(0, 164, 219, 0.15)",
      borderColor: "rgba(0, 164, 219, 0.5)",
      icon: <Database size={15} color="#00a4db" />,
    };
  }

  // ─── SQL SERVER ─────────────────────────────────────────────
  if (
    ct.includes("sqlserver") ||
    ct.includes("mssql") ||
    connType.includes("sqlserver") ||
    dialect.includes("sqlserver")
  ) {
    return {
      key: "sqlserver",
      name: "Microsoft SQL Server",
      badgeLabel: "SQL Server",
      color: "#60a5fa",
      bgColor: "rgba(37, 99, 235, 0.18)",
      borderColor: "rgba(96, 165, 250, 0.55)",
      icon: <Server size={15} color="#60a5fa" />,
    };
  }

  // ─── SNOWFLAKE ──────────────────────────────────────────────
  if (
    ct.includes("snowflake") ||
    connType.includes("snowflake") ||
    dialect.includes("snowflake")
  ) {
    return {
      key: "snowflake",
      name: "Snowflake Cloud DW",
      badgeLabel: "Snowflake",
      color: "#22d3ee",
      bgColor: "rgba(6, 182, 212, 0.18)",
      borderColor: "rgba(34, 211, 238, 0.55)",
      icon: <Cloud size={15} color="#22d3ee" />,
    };
  }

  // ─── GOOGLE BIGQUERY ────────────────────────────────────────
  if (
    ct.includes("bigquery") ||
    connType.includes("bigquery") ||
    dialect.includes("bigquery")
  ) {
    return {
      key: "bigquery",
      name: "Google BigQuery",
      badgeLabel: "BigQuery",
      color: "#818cf8",
      bgColor: "rgba(99, 102, 241, 0.18)",
      borderColor: "rgba(129, 140, 248, 0.55)",
      icon: <Database size={15} color="#818cf8" />,
    };
  }

  // ─── SCYLLADB / CASSANDRA ───────────────────────────────────
  if (
    ct.includes("scylla") ||
    ct.includes("cassandra") ||
    connType.includes("scylla") ||
    connType.includes("cassandra")
  ) {
    return {
      key: "scylla",
      name: "ScyllaDB / Cassandra",
      badgeLabel: "ScyllaDB",
      color: "#2dd4bf", // Teal
      bgColor: "rgba(20, 184, 166, 0.18)",
      borderColor: "rgba(45, 212, 191, 0.55)",
      icon: <Database size={15} color="#2dd4bf" />,
    };
  }

  // ─── APACHE KAFKA ───────────────────────────────────────────
  if (ct.includes("kafka") || connType.includes("kafka")) {
    return {
      key: "kafka",
      name: "Apache Kafka",
      badgeLabel: "Kafka",
      color: "#f97316",
      bgColor: "rgba(249, 115, 22, 0.18)",
      borderColor: "rgba(249, 115, 22, 0.55)",
      icon: <Radio size={15} color="#f97316" />,
    };
  }

  // ─── AWS S3 ─────────────────────────────────────────────────
  if (ct.includes("s3") || connType.includes("s3")) {
    return {
      key: "s3",
      name: "Amazon S3",
      badgeLabel: "AWS S3",
      color: "#eab308",
      bgColor: "rgba(234, 179, 8, 0.18)",
      borderColor: "rgba(234, 179, 8, 0.55)",
      icon: <Cloud size={15} color="#eab308" />,
    };
  }

  // ─── CSV / DELIMITADO ───────────────────────────────────────
  if (ct.includes("csv") || fileExt === "csv" || fileExt === "tsv") {
    return {
      key: "csv",
      name: "CSV / Delimitado",
      badgeLabel: "CSV",
      color: "#34d399", // Emerald
      bgColor: "rgba(52, 211, 153, 0.16)",
      borderColor: "rgba(52, 211, 153, 0.5)",
      icon: <FileSpreadsheet size={15} color="#34d399" />,
    };
  }

  // ─── APACHE PARQUET ─────────────────────────────────────────
  if (ct.includes("parquet") || fileExt === "parquet") {
    return {
      key: "parquet",
      name: "Apache Parquet",
      badgeLabel: "Parquet",
      color: "#06b6d4", // Cyan
      bgColor: "rgba(6, 182, 212, 0.16)",
      borderColor: "rgba(6, 182, 212, 0.5)",
      icon: <HardDrive size={15} color="#06b6d4" />,
    };
  }

  // ─── EXCEL (XLSX / XLS) ─────────────────────────────────────
  if (ct.includes("excel") || fileExt === "xlsx" || fileExt === "xls") {
    return {
      key: "excel",
      name: "Excel Spreadsheet",
      badgeLabel: "Excel",
      color: "#10b981", // Green
      bgColor: "rgba(16, 185, 129, 0.18)",
      borderColor: "rgba(16, 185, 129, 0.55)",
      icon: <FileSpreadsheet size={15} color="#10b981" />,
    };
  }

  // ─── JSON / JSON LINES ──────────────────────────────────────
  if (ct.includes("json") || fileExt === "json" || fileExt === "jsonl") {
    return {
      key: "json",
      name: "JSON / JSONL",
      badgeLabel: "JSON",
      color: "#fbbf24", // Amber
      bgColor: "rgba(251, 191, 36, 0.16)",
      borderColor: "rgba(251, 191, 36, 0.5)",
      icon: <FileCode size={15} color="#fbbf24" />,
    };
  }

  // ─── REST / HTTP API ────────────────────────────────────────
  if (ct.includes("rest") || ct.includes("http") || connType.includes("rest_api")) {
    return {
      key: "api",
      name: "REST API",
      badgeLabel: "REST API",
      color: "#a855f7",
      bgColor: "rgba(168, 85, 247, 0.18)",
      borderColor: "rgba(168, 85, 247, 0.55)",
      icon: <Globe size={15} color="#a855f7" />,
    };
  }

  // ─── TRANSFORM / TMAP / FILTER / AGGREGATE ──────────────────
  if (ct.includes("tmap") || ct.includes("mapping")) {
    return {
      key: "tmap",
      name: "Data Mapping (tMap)",
      badgeLabel: "tMap",
      color: "#818cf8",
      bgColor: "rgba(99, 102, 241, 0.16)",
      borderColor: "rgba(129, 140, 248, 0.5)",
      icon: <Workflow size={15} color="#818cf8" />,
    };
  }

  if (ct.includes("filter")) {
    return {
      key: "filter",
      name: "Filtro de Registros",
      badgeLabel: "Filter",
      color: "#3b82f6",
      bgColor: "rgba(59, 130, 246, 0.16)",
      borderColor: "rgba(59, 130, 246, 0.5)",
      icon: <Filter size={15} color="#3b82f6" />,
    };
  }

  if (ct.includes("aggregate")) {
    return {
      key: "aggregate",
      name: "Agregação e Métricas",
      badgeLabel: "Aggregate",
      color: "#06b6d4",
      bgColor: "rgba(6, 182, 212, 0.16)",
      borderColor: "rgba(6, 182, 212, 0.5)",
      icon: <BarChart2 size={15} color="#06b6d4" />,
    };
  }

  // ─── GENERIC DB OU GENERIC COMPONENT ────────────────────────
  if (ct.includes("database") || ct.includes(".db")) {
    return {
      key: "generic_db",
      name: "Banco de Dados",
      badgeLabel: "Database",
      color: "#10b981",
      bgColor: "rgba(16, 185, 129, 0.16)",
      borderColor: "rgba(16, 185, 129, 0.5)",
      icon: <Database size={15} color="#10b981" />,
    };
  }

  return {
    key: "generic",
    name: "Componente",
    badgeLabel: "Component",
    color: "#94a3b8",
    bgColor: "rgba(148, 163, 184, 0.12)",
    borderColor: "rgba(148, 163, 184, 0.35)",
    icon: <Layers size={15} color="#94a3b8" />,
  };
}
