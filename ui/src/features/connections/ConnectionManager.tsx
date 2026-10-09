import React, { useState } from "react";
import {
  X,
  Database,
  Cloud,
  Globe,
  Plus,
  Trash2,
  TestTube2,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  Key,
  Server,
  Layers,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react";
import { jobStore, ConnectionEntry, ConnectionType, Environment } from "../../store/jobStore";
import { useJobStore } from "../../store/useJobStore";

interface ConnectionManagerProps {
  onClose: () => void;
  activeJobId?: string | null;
  activeJobName?: string | null;
}

type ConnTypeGroup = {
  label: string;
  icon: React.ReactNode;
  types: { type: ConnectionType; label: string; color: string }[];
};

const CONNECTION_GROUPS: ConnTypeGroup[] = [
  {
    label: "Bancos Relacionais & Analíticos",
    icon: <Database size={14} />,
    types: [
      { type: "duckdb", label: "DuckDB (In-Memory / Arquivo)", color: "#eab308" },
      { type: "oracle", label: "Oracle Database", color: "#c74634" },
      { type: "sqlserver", label: "SQL Server / Azure SQL", color: "#0078d4" },
      { type: "mysql", label: "MySQL / MariaDB", color: "#4479a1" },
      { type: "postgresql", label: "PostgreSQL", color: "#336791" },
      { type: "redshift", label: "Amazon Redshift", color: "#8c4fff" },
      { type: "databricks", label: "Databricks (Delta)", color: "#ff3621" },
      { type: "snowflake", label: "Snowflake", color: "#29b5e8" },
      { type: "bigquery", label: "Google BigQuery", color: "#4285f4" },
    ],
  },
  {
    label: "Cloud Storage",
    icon: <Cloud size={14} />,
    types: [
      { type: "s3", label: "AWS S3 Bucket", color: "#ff9900" },
      { type: "azure_blob", label: "Azure Blob Storage", color: "#0078d4" },
      { type: "gcs", label: "Google Cloud Storage", color: "#4285f4" },
    ],
  },
  {
    label: "Streaming & Mensageria",
    icon: <Server size={14} />,
    types: [
      { type: "kafka", label: "Apache Kafka", color: "#e65100" },
      { type: "aws_sqs", label: "AWS SQS", color: "#ff9900" },
      { type: "aws_sns", label: "AWS SNS", color: "#e11d48" },
    ],
  },
  {
    label: "APIs & Serviços",
    icon: <Globe size={14} />,
    types: [
      { type: "rest_api", label: "REST API", color: "#10b981" },
      { type: "soap_api", label: "SOAP / Web Service", color: "#8b5cf6" },
      { type: "sftp", label: "SFTP", color: "#f59e0b" },
    ],
  },
  {
    label: "NoSQL",
    icon: <Layers size={14} />,
    types: [
      { type: "scylla", label: "ScyllaDB", color: "#00e5ff" },
      { type: "mongodb", label: "MongoDB", color: "#47a248" },
      { type: "cassandra", label: "Apache Cassandra", color: "#1287b1" },
      { type: "elasticsearch", label: "Elasticsearch", color: "#005571" },
    ],
  },
];

const ALL_TYPES = CONNECTION_GROUPS.flatMap((g) => g.types);

function getTypeLabel(type: ConnectionType): string {
  return ALL_TYPES.find((t) => t.type === type)?.label ?? type;
}
function getTypeColor(type: ConnectionType): string {
  return ALL_TYPES.find((t) => t.type === type)?.color ?? "#64748b";
}

// ─── Specific config forms ────────────────────────────────────

const DuckDbForm: React.FC<{
  config: any;
  onChange: (key: string, val: any) => void;
}> = ({ config, onChange }) => (
  <>
    <div className="form-group">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <label className="form-label" style={{ margin: 0 }}>Caminho do Banco (.duckdb ou :memory:)</label>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="badge"
            style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(234, 179, 8, 0.12)", borderColor: "rgba(234, 179, 8, 0.4)", color: "#facc15" }}
            onClick={() => {
              onChange("database_path", ":memory:");
              onChange("database", ":memory:");
            }}
            title="Usar banco puramente em memória RAM"
          >
            :memory:
          </button>
          <button
            type="button"
            className="badge"
            style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(234, 179, 8, 0.12)", borderColor: "rgba(234, 179, 8, 0.4)", color: "#facc15" }}
            onClick={() => {
              onChange("database_path", "data/analytics.duckdb");
              onChange("database", "data/analytics.duckdb");
            }}
            title="Usar arquivo local data/analytics.duckdb"
          >
            data/analytics.duckdb
          </button>
        </div>
      </div>
      <input
        className="form-input"
        value={config.database_path ?? config.database ?? ":memory:"}
        placeholder=":memory: ou data/meu_banco.duckdb"
        onChange={(e) => {
          onChange("database_path", e.target.value);
          onChange("database", e.target.value);
        }}
      />
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 4 }}>
        Use <code>:memory:</code> para dados voláteis em memória RAM ou especifique um arquivo local (ex: <code>data/warehouse.duckdb</code>).
      </div>
    </div>

    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Limite de Memória (Max RAM)</label>
        <input
          className="form-input"
          value={config.memory_limit ?? "1GB"}
          placeholder="512MB, 1GB, 4GB"
          onChange={(e) => onChange("memory_limit", e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Diretório Temporário (Opcional)</label>
        <input
          className="form-input"
          value={config.temp_directory ?? ""}
          placeholder="temp/duckdb"
          onChange={(e) => onChange("temp_directory", e.target.value)}
        />
      </div>
    </div>

    <div className="form-group">
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.78rem" }}>
        <input
          type="checkbox"
          checked={Boolean(config.read_only)}
          onChange={(e) => onChange("read_only", e.target.checked)}
        />
        <span>Modo Somente Leitura (Read-Only)</span>
      </label>
    </div>
  </>
);

const SqlDbForm: React.FC<{
  config: any;
  onChange: (key: string, val: any) => void;
  showPassword: boolean;
  toggleShowPw: () => void;
  extra?: React.ReactNode;
}> = ({ config, onChange, showPassword, toggleShowPw, extra }) => (
  <>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Host / IP</label>
        <input
          className="form-input"
          value={config.host ?? ""}
          placeholder="localhost ou 192.168.1.100"
          onChange={(e) => onChange("host", e.target.value)}
        />
      </div>
      <div className="form-group" style={{ width: 120, flexShrink: 0 }}>
        <label className="form-label">Porta</label>
        <input
          className="form-input"
          type="number"
          value={config.port ?? ""}
          onChange={(e) => onChange("port", parseInt(e.target.value) || undefined)}
        />
      </div>
    </div>
    <div className="form-group">
      <label className="form-label">Database / Schema</label>
      <input
        className="form-input"
        value={config.database ?? ""}
        placeholder="nome_do_banco"
        onChange={(e) => onChange("database", e.target.value)}
      />
    </div>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Usuário</label>
        <input
          className="form-input"
          value={config.username ?? ""}
          placeholder="usuário"
          onChange={(e) => onChange("username", e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Senha</label>
        <div className="input-with-icon">
          <input
            className="form-input"
            type={showPassword ? "text" : "password"}
            value={config.password ?? ""}
            placeholder="••••••••"
            onChange={(e) => onChange("password", e.target.value)}
          />
          <button className="input-icon-btn" onClick={toggleShowPw} type="button">
            {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>
    </div>
    {extra}
    <div className="form-group">
      <label className="form-label">SSL Mode</label>
      <select
        className="form-select"
        value={config.sslMode ?? "prefer"}
        onChange={(e) => onChange("sslMode", e.target.value)}
      >
        <option value="disable">disable</option>
        <option value="prefer">prefer</option>
        <option value="require">require</option>
        <option value="verify-full">verify-full</option>
      </select>
    </div>
    <div className="form-group">
      <label className="form-label">JDBC URL (opcional — override)</label>
      <input
        className="form-input font-mono"
        value={config.jdbcUrl ?? ""}
        placeholder="jdbc:postgresql://host:5432/db?ssl=true"
        onChange={(e) => onChange("jdbcUrl", e.target.value)}
      />
    </div>
    <div className="conn-env-hint">
      💡 Use variáveis: <code>{"${DB_HOST}"}</code>, <code>{"${DB_PASSWORD}"}</code>
    </div>
  </>
);

const S3Form: React.FC<{ config: any; onChange: (k: string, v: any) => void; showPassword: boolean; toggleShowPw: () => void }> = ({
  config,
  onChange,
  showPassword,
  toggleShowPw,
}) => (
  <>
    <div className="form-group">
      <label className="form-label">Região AWS</label>
      <select className="form-select" value={config.region ?? "us-east-1"} onChange={(e) => onChange("region", e.target.value)}>
        {["us-east-1","us-east-2","us-west-1","us-west-2","sa-east-1","eu-west-1","eu-central-1","ap-southeast-1","ap-northeast-1"].map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </div>
    <div className="form-group">
      <label className="form-label">Bucket Padrão</label>
      <input className="form-input" value={config.bucket ?? ""} placeholder="meu-bucket" onChange={(e) => onChange("bucket", e.target.value)} />
    </div>
    <div className="form-group">
      <label className="form-label">Access Key ID</label>
      <input className="form-input" value={config.accessKey ?? ""} placeholder="AKIAIOSFODNN7EXAMPLE" onChange={(e) => onChange("accessKey", e.target.value)} />
    </div>
    <div className="form-group">
      <label className="form-label">Secret Access Key</label>
      <div className="input-with-icon">
        <input className="form-input" type={showPassword ? "text" : "password"} value={config.secretKey ?? ""} placeholder="••••••••" onChange={(e) => onChange("secretKey", e.target.value)} />
        <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </div>
    </div>
    <div className="form-group">
      <label className="form-label">Endpoint personalizado (MinIO, etc.)</label>
      <input className="form-input" value={config.endpoint ?? ""} placeholder="https://minio.example.com" onChange={(e) => onChange("endpoint", e.target.value)} />
    </div>
    <div className="conn-env-hint">💡 Use variáveis: <code>{"${AWS_ACCESS_KEY}"}</code>, <code>{"${AWS_SECRET_KEY}"}</code></div>
  </>
);

const RestApiForm: React.FC<{ config: any; onChange: (k: string, v: any) => void; showPassword: boolean; toggleShowPw: () => void }> = ({
  config, onChange, showPassword, toggleShowPw,
}) => (
  <>
    <div className="form-group">
      <label className="form-label">Base URL</label>
      <input className="form-input" value={config.baseUrl ?? ""} placeholder="https://api.example.com/v1" onChange={(e) => onChange("baseUrl", e.target.value)} />
    </div>
    <div className="form-group">
      <label className="form-label">Tipo de Autenticação</label>
      <select className="form-select" value={config.authType ?? "none"} onChange={(e) => onChange("authType", e.target.value)}>
        <option value="none">Sem Autenticação</option>
        <option value="basic">Basic Auth</option>
        <option value="bearer">Bearer Token</option>
        <option value="apikey">API Key</option>
        <option value="oauth2">OAuth 2.0</option>
      </select>
    </div>
    {config.authType === "basic" && (
      <div className="conn-form-row">
        <div className="form-group">
          <label className="form-label">Usuário</label>
          <input className="form-input" value={config.username ?? ""} onChange={(e) => onChange("username", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Senha</label>
          <div className="input-with-icon">
            <input className="form-input" type={showPassword ? "text" : "password"} value={config.password ?? ""} onChange={(e) => onChange("password", e.target.value)} />
            <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          </div>
        </div>
      </div>
    )}
    {config.authType === "bearer" && (
      <div className="form-group">
        <label className="form-label">Bearer Token</label>
        <div className="input-with-icon">
          <input className="form-input" type={showPassword ? "text" : "password"} value={config.bearerToken ?? ""} onChange={(e) => onChange("bearerToken", e.target.value)} />
          <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        </div>
      </div>
    )}
    {config.authType === "apikey" && (
      <div className="form-group">
        <label className="form-label">API Key</label>
        <div className="input-with-icon">
          <input className="form-input" type={showPassword ? "text" : "password"} value={config.apiKey ?? ""} onChange={(e) => onChange("apiKey", e.target.value)} />
          <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        </div>
      </div>
    )}
    <div className="conn-env-hint">💡 Use variáveis: <code>{"${API_TOKEN}"}</code></div>
  </>
);

const DatabricksForm: React.FC<{ config: any; onChange: (k: string, v: any) => void; showPassword: boolean; toggleShowPw: () => void }> = ({
  config, onChange, showPassword, toggleShowPw,
}) => (
  <>
    <div className="form-group">
      <label className="form-label">Server Hostname</label>
      <input className="form-input" value={config.host ?? ""} placeholder="adb-xxxx.azuredatabricks.net" onChange={(e) => onChange("host", e.target.value)} />
    </div>
    <div className="form-group">
      <label className="form-label">HTTP Path</label>
      <input className="form-input" value={config.httpPath ?? ""} placeholder="/sql/1.0/warehouses/xxxx" onChange={(e) => onChange("httpPath", e.target.value)} />
    </div>
    <div className="form-group">
      <label className="form-label">Personal Access Token</label>
      <div className="input-with-icon">
        <input className="form-input" type={showPassword ? "text" : "password"} value={config.password ?? ""} placeholder="dapi..." onChange={(e) => onChange("password", e.target.value)} />
        <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </div>
    </div>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Catalog</label>
        <input className="form-input" value={config.catalog ?? ""} placeholder="hive_metastore" onChange={(e) => onChange("catalog", e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Schema</label>
        <input className="form-input" value={config.schema ?? ""} placeholder="default" onChange={(e) => onChange("schema", e.target.value)} />
      </div>
    </div>
    <div className="conn-env-hint">💡 Use variáveis: <code>{"${DATABRICKS_TOKEN}"}</code></div>
  </>
);

const ScyllaForm: React.FC<{ config: any; onChange: (k: string, v: any) => void; showPassword: boolean; toggleShowPw: () => void }> = ({
  config, onChange, showPassword, toggleShowPw,
}) => (
  <>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Contact Points (Hosts)</label>
        <input className="form-input" value={config.host ?? ""} placeholder="10.0.0.1, 10.0.0.2" onChange={(e) => onChange("host", e.target.value)} />
      </div>
      <div className="form-group" style={{ width: 110, flexShrink: 0 }}>
        <label className="form-label">Porta CQL</label>
        <input className="form-input" type="number" value={config.port ?? 9042} onChange={(e) => onChange("port", parseInt(e.target.value) || 9042)} />
      </div>
    </div>
    <div className="form-group">
      <label className="form-label">Keyspace Padrão</label>
      <input className="form-input" value={config.keyspace ?? ""} placeholder="meu_keyspace" onChange={(e) => onChange("keyspace", e.target.value)} />
    </div>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Usuário</label>
        <input className="form-input" value={config.username ?? ""} placeholder="cassandra" onChange={(e) => onChange("username", e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Senha</label>
        <div className="input-with-icon">
          <input className="form-input" type={showPassword ? "text" : "password"} value={config.password ?? ""} placeholder="••••••••" onChange={(e) => onChange("password", e.target.value)} />
          <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        </div>
      </div>
    </div>
    <div className="form-group">
      <label className="form-label">Nível de Consistência</label>
      <select className="form-select" value={config.consistencyLevel ?? "LOCAL_QUORUM"} onChange={(e) => onChange("consistencyLevel", e.target.value)}>
        <option value="LOCAL_QUORUM">LOCAL_QUORUM (Recomendado)</option>
        <option value="QUORUM">QUORUM</option>
        <option value="ONE">ONE</option>
        <option value="ALL">ALL</option>
      </select>
    </div>
    <div className="conn-env-hint">💡 Suporta clusters ScyllaDB Enterprise e Apache Cassandra</div>
  </>
);

const KafkaForm: React.FC<{ config: any; onChange: (k: string, v: any) => void; showPassword: boolean; toggleShowPw: () => void }> = ({
  config, onChange, showPassword, toggleShowPw,
}) => (
  <>
    <div className="form-group">
      <label className="form-label">Bootstrap Servers</label>
      <input className="form-input" value={config.host ?? ""} placeholder="broker1:9092, broker2:9092" onChange={(e) => onChange("host", e.target.value)} />
    </div>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Tópico Padrão</label>
        <input className="form-input" value={config.topic ?? ""} placeholder="events.telemetry" onChange={(e) => onChange("topic", e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Consumer Group ID</label>
        <input className="form-input" value={config.consumerGroup ?? ""} placeholder="rocket-data-group" onChange={(e) => onChange("consumerGroup", e.target.value)} />
      </div>
    </div>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Protocolo de Segurança</label>
        <select className="form-select" value={config.securityProtocol ?? "PLAINTEXT"} onChange={(e) => onChange("securityProtocol", e.target.value)}>
          <option value="PLAINTEXT">PLAINTEXT</option>
          <option value="SSL">SSL</option>
          <option value="SASL_PLAINTEXT">SASL_PLAINTEXT</option>
          <option value="SASL_SSL">SASL_SSL</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Auto Offset Reset</label>
        <select className="form-select" value={config.autoOffsetReset ?? "earliest"} onChange={(e) => onChange("autoOffsetReset", e.target.value)}>
          <option value="earliest">earliest</option>
          <option value="latest">latest</option>
        </select>
      </div>
    </div>
    <div className="conn-env-hint">💡 Compatível com Apache Kafka, Confluent Cloud, Redpanda e AWS MSK</div>
  </>
);

const AwsSqsForm: React.FC<{ config: any; onChange: (k: string, v: any) => void; showPassword: boolean; toggleShowPw: () => void }> = ({
  config, onChange, showPassword, toggleShowPw,
}) => (
  <>
    <div className="form-group">
      <label className="form-label">Queue URL ou Nome da Fila</label>
      <input className="form-input" value={config.endpoint ?? config.queueUrl ?? ""} placeholder="https://sqs.sa-east-1.amazonaws.com/123456/minha-fila" onChange={(e) => onChange("endpoint", e.target.value)} />
    </div>
    <div className="form-group">
      <label className="form-label">Região AWS</label>
      <select className="form-select" value={config.region ?? "sa-east-1"} onChange={(e) => onChange("region", e.target.value)}>
        {["sa-east-1","us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-central-1"].map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </div>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Access Key ID</label>
        <input className="form-input" value={config.accessKey ?? ""} placeholder="AKIAIOSFODNN7EXAMPLE" onChange={(e) => onChange("accessKey", e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Secret Access Key</label>
        <div className="input-with-icon">
          <input className="form-input" type={showPassword ? "text" : "password"} value={config.password ?? config.secretKey ?? ""} placeholder="••••••••" onChange={(e) => onChange("password", e.target.value)} />
          <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        </div>
      </div>
    </div>
    <div className="form-group">
      <label className="form-label">Endpoint Personalizado (LocalStack)</label>
      <input className="form-input" value={config.endpoint_url ?? ""} placeholder="http://localhost:4566" onChange={(e) => onChange("endpoint_url", e.target.value)} />
    </div>
  </>
);

const AwsSnsForm: React.FC<{ config: any; onChange: (k: string, v: any) => void; showPassword: boolean; toggleShowPw: () => void }> = ({
  config, onChange, showPassword, toggleShowPw,
}) => (
  <>
    <div className="form-group">
      <label className="form-label">Topic ARN</label>
      <input className="form-input" value={config.endpoint ?? config.topicArn ?? ""} placeholder="arn:aws:sns:sa-east-1:123456789012:meu-topico" onChange={(e) => onChange("endpoint", e.target.value)} />
    </div>
    <div className="form-group">
      <label className="form-label">Região AWS</label>
      <select className="form-select" value={config.region ?? "sa-east-1"} onChange={(e) => onChange("region", e.target.value)}>
        {["sa-east-1","us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-central-1"].map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </div>
    <div className="conn-form-row">
      <div className="form-group">
        <label className="form-label">Access Key ID</label>
        <input className="form-input" value={config.accessKey ?? ""} placeholder="AKIAIOSFODNN7EXAMPLE" onChange={(e) => onChange("accessKey", e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Secret Access Key</label>
        <div className="input-with-icon">
          <input className="form-input" type={showPassword ? "text" : "password"} value={config.password ?? config.secretKey ?? ""} placeholder="••••••••" onChange={(e) => onChange("password", e.target.value)} />
          <button className="input-icon-btn" onClick={toggleShowPw} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        </div>
      </div>
    </div>
  </>
);

// ─── Main Component ───────────────────────────────────────────

const ENVS: { id: Environment; label: string; color: string }[] = [
  { id: "dev", label: "DEV", color: "#10b981" },
  { id: "hml", label: "HML", color: "#f59e0b" },
  { id: "prd", label: "PRD", color: "#ef4444" },
];

export const ConnectionManager: React.FC<ConnectionManagerProps> = ({
  onClose,
  activeJobId,
  activeJobName,
}) => {
  const state = useJobStore();
  const [selectedConnId, setSelectedConnId] = useState<string | null>(
    state.connections[0]?.id ?? null
  );
  const [editingConn, setEditingConn] = useState<Partial<ConnectionEntry> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "local">("all");

  const selectedConn = state.connections.find((c) => c.id === selectedConnId);

  const startCreate = (type: ConnectionType) => {
    setIsCreating(true);
    setSelectedConnId(null);
    setShowQuickAdd(false);
    const defaults: Record<ConnectionType, any> = {
      duckdb: { database_path: ":memory:", memory_limit: "1GB", read_only: false },
      oracle: { port: 1521 }, sqlserver: { port: 1433 }, mysql: { port: 3306 },
      postgresql: { port: 5432 }, redshift: { port: 5439 }, databricks: {},
      snowflake: {}, bigquery: {}, s3: { region: "us-east-1" },
      azure_blob: {}, gcs: {}, rest_api: { authType: "none" }, soap_api: {},
      mongodb: { port: 27017 }, cassandra: { port: 9042 }, scylla: { port: 9042, consistencyLevel: "LOCAL_QUORUM" }, elasticsearch: { port: 9200 },
      kafka: { port: 9092, autoOffsetReset: "earliest", securityProtocol: "PLAINTEXT" },
      aws_sqs: { region: "sa-east-1" },
      aws_sns: { region: "sa-east-1" },
      sftp: { port: 22 }, ftp: { port: 21 },
    };
    setEditingConn({
      name: `Nova Conexão ${getTypeLabel(type)}`,
      type,
      config: defaults[type] ?? {},
      description: "",
      environments: ["dev"] as Environment[],
      scope: "global",
      jobId: undefined,
    });
  };

  const handleSave = () => {
    if (!editingConn?.name || !editingConn.type) return;
    const finalScope = editingConn.scope ?? "global";
    const finalJobId = finalScope === "local" ? (activeJobId || editingConn.jobId) : undefined;

    if (isCreating) {
      const entry = jobStore.saveConnection({
        name: editingConn.name!,
        type: editingConn.type!,
        config: editingConn.config ?? {},
        description: editingConn.description,
        environments: (editingConn.environments ?? ["dev"]) as Environment[],
        scope: finalScope,
        jobId: finalJobId,
      });
      setSelectedConnId(entry.id);
      setIsCreating(false);
    } else if (selectedConnId) {
      jobStore.updateConnection(selectedConnId, {
        name: editingConn!.name,
        config: editingConn!.config,
        description: editingConn!.description,
        environments: editingConn!.environments ?? ["dev"],
        scope: finalScope,
        jobId: finalJobId,
      });
    }
    setEditingConn(null);
  };

  const handleTest = async (connId: string) => {
    setTestingId(connId);
    const targetConn = state.connections.find((c) => c.id === connId) || editingConn;
    if (targetConn?.type === "duckdb") {
      await new Promise((r) => setTimeout(r, 600));
      jobStore.updateConnection(connId, {
        testStatus: "success",
        lastTestedAt: new Date().toISOString(),
      });
      setTestingId(null);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
    // Simulate test result
    const success = Math.random() > 0.3;
    jobStore.updateConnection(connId, {
      testStatus: success ? "success" : "failed",
      lastTestedAt: new Date().toISOString(),
    });
    setTestingId(null);
  };

  const configField = (key: string, val: any) => {
    setEditingConn((prev) => ({
      ...prev!,
      config: { ...prev?.config, [key]: val },
    }));
  };

  const renderConfigForm = () => {
    if (!editingConn) return null;
    const { type, config = {} } = editingConn;
    const commonProps = { config, onChange: configField, showPassword, toggleShowPw: () => setShowPassword((p) => !p) };

    switch (type) {
      case "duckdb":
        return <DuckDbForm config={config} onChange={configField} />;
      case "oracle":
        return (
          <SqlDbForm {...commonProps} extra={
            <div className="form-group">
              <label className="form-label">Service Name / SID</label>
              <input className="form-input" value={config.serviceName ?? ""} placeholder="ORCL ou XE" onChange={(e) => configField("serviceName", e.target.value)} />
            </div>
          } />
        );
      case "sqlserver":
        return <SqlDbForm {...commonProps} extra={
          <div className="form-group">
            <label className="form-label">Instância (opcional)</label>
            <input className="form-input" value={config.instance ?? ""} placeholder="MSSQLSERVER" onChange={(e) => configField("instance", e.target.value)} />
          </div>
        } />;
      case "mysql":
      case "postgresql":
      case "redshift":
      case "snowflake":
      case "bigquery":
        return <SqlDbForm {...commonProps} />;
      case "databricks":
        return <DatabricksForm {...commonProps} />;
      case "s3":
        return <S3Form {...commonProps} />;
      case "azure_blob":
        return (
          <>
            <div className="form-group">
              <label className="form-label">Storage Account Name</label>
              <input className="form-input" value={config.username ?? ""} placeholder="mystorageaccount" onChange={(e) => configField("username", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Account Key ou SAS Token</label>
              <div className="input-with-icon">
                <input className="form-input" type={showPassword ? "text" : "password"} value={config.password ?? ""} onChange={(e) => configField("password", e.target.value)} />
                <button className="input-icon-btn" onClick={() => setShowPassword((p) => !p)} type="button">{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Container</label>
              <input className="form-input" value={config.bucket ?? ""} onChange={(e) => configField("bucket", e.target.value)} />
            </div>
          </>
        );
      case "rest_api":
      case "soap_api":
        return <RestApiForm {...commonProps} />;
      case "mongodb":
        return (
          <>
            <div className="form-group">
              <label className="form-label">Connection String</label>
              <input className="form-input font-mono" value={config.jdbcUrl ?? ""} placeholder="mongodb://user:pass@host:27017/db" onChange={(e) => configField("jdbcUrl", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Database</label>
              <input className="form-input" value={config.database ?? ""} onChange={(e) => configField("database", e.target.value)} />
            </div>
          </>
        );
      case "scylla":
        return <ScyllaForm {...commonProps} />;
      case "kafka":
        return <KafkaForm {...commonProps} />;
      case "aws_sqs":
        return <AwsSqsForm {...commonProps} />;
      case "aws_sns":
        return <AwsSnsForm {...commonProps} />;
      default:
        return (
          <>
            <div className="form-group">
              <label className="form-label">Host</label>
              <input className="form-input" value={config.host ?? ""} onChange={(e) => configField("host", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Porta</label>
              <input className="form-input" type="number" value={config.port ?? ""} onChange={(e) => configField("port", parseInt(e.target.value))} />
            </div>
          </>
        );
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container conn-manager" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Database size={18} color="var(--accent-cyan)" />
            <span>Gerenciador de Conexões</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="conn-manager-body">
          {/* Left — Connection List */}
          <div className="conn-list">
            <div className="conn-list-header">
              <span>Conexões ({state.connections.length})</span>
              {/* Quick Add button — create new without leaving current view */}
              <div style={{ position: "relative" }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => setShowQuickAdd((v) => !v)}
                  title="Adicionar nova conexão"
                >
                  <Plus size={12} /> Nova
                </button>
                {showQuickAdd && (
                  <div className="quick-add-dropdown">
                    {CONNECTION_GROUPS.map((group) => (
                      <div key={group.label}>
                        <div className="quick-add-group-label">{group.label}</div>
                        {group.types.map((t) => (
                          <button
                            key={t.type}
                            className="conn-type-btn"
                            onClick={() => startCreate(t.type)}
                          >
                            <span className="conn-type-dot" style={{ background: t.color }} />
                            {t.label}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {showQuickAdd && (
                  <div className="ctx-overlay" onClick={() => setShowQuickAdd(false)} />
                )}
              </div>
            </div>

            {/* Scope Filter Tabs */}
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: "6px 8px",
                borderBottom: "1px solid var(--border-subtle)",
                background: "rgba(0,0,0,0.18)",
              }}
            >
              <button
                type="button"
                className={`badge ${scopeFilter === "all" ? "active" : ""}`}
                style={{
                  cursor: "pointer",
                  fontSize: "0.68rem",
                  background: scopeFilter === "all" ? "var(--accent-blue)" : "transparent",
                  color: scopeFilter === "all" ? "#fff" : "var(--text-secondary)",
                  border: "none",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
                onClick={() => setScopeFilter("all")}
              >
                Todas ({state.connections.length})
              </button>
              <button
                type="button"
                className={`badge ${scopeFilter === "global" ? "active" : ""}`}
                style={{
                  cursor: "pointer",
                  fontSize: "0.68rem",
                  background: scopeFilter === "global" ? "var(--accent-blue)" : "transparent",
                  color: scopeFilter === "global" ? "#fff" : "var(--text-secondary)",
                  border: "none",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
                onClick={() => setScopeFilter("global")}
              >
                🌐 Globais ({state.connections.filter((c) => !c.scope || c.scope === "global").length})
              </button>
              <button
                type="button"
                className={`badge ${scopeFilter === "local" ? "active" : ""}`}
                style={{
                  cursor: "pointer",
                  fontSize: "0.68rem",
                  background: scopeFilter === "local" ? "var(--accent-blue)" : "transparent",
                  color: scopeFilter === "local" ? "#fff" : "var(--text-secondary)",
                  border: "none",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
                onClick={() => setScopeFilter("local")}
              >
                💼 Deste Job ({state.connections.filter((c) => c.scope === "local" && (!activeJobId || c.jobId === activeJobId)).length})
              </button>
            </div>

            <div className="conn-list-items">
              {state.connections
                .filter((c) => {
                  if (scopeFilter === "global") return !c.scope || c.scope === "global";
                  if (scopeFilter === "local") return c.scope === "local" && (!activeJobId || c.jobId === activeJobId);
                  return true;
                })
                .map((conn) => (
                  <div
                    key={conn.id}
                    className={`conn-list-item ${selectedConnId === conn.id && !isCreating ? "active" : ""}`}
                    onClick={() => { setSelectedConnId(conn.id); setIsCreating(false); setEditingConn(null); }}
                  >
                    <div className="conn-type-dot" style={{ background: getTypeColor(conn.type) }} />
                    <div className="conn-list-info">
                      <div className="conn-list-name" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>{conn.name}</span>
                        <span
                          style={{
                            fontSize: "0.62rem",
                            padding: "1px 4px",
                            borderRadius: 3,
                            background: conn.scope === "local" ? "rgba(168, 85, 247, 0.15)" : "rgba(59, 130, 246, 0.15)",
                            color: conn.scope === "local" ? "#c084fc" : "#93c5fd",
                            border: `1px solid ${conn.scope === "local" ? "rgba(168, 85, 247, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
                          }}
                        >
                          {conn.scope === "local" ? "💼 Local" : "🌐 Global"}
                        </span>
                      </div>
                      <div className="conn-list-type-row">
                        <span className="conn-list-type">{getTypeLabel(conn.type)}</span>
                        <div className="conn-env-badges">
                          {(conn.environments ?? []).map((env) => (
                            <span
                              key={env}
                              className="conn-env-mini-badge"
                              style={{ color: ENVS.find((e) => e.id === env)?.color }}
                            >
                              {env.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {conn.testStatus === "success" && <CheckCircle2 size={13} color="var(--status-success)" />}
                    {conn.testStatus === "failed" && <XCircle size={13} color="var(--status-danger)" />}
                  </div>
                ))}
              {state.connections.length === 0 && (
                <div className="conn-list-empty">
                  <Database size={28} opacity={0.2} />
                  <span>Nenhuma conexão</span>
                  <span style={{ fontSize: "0.7rem" }}>Use "+ Nova" para adicionar</span>
                </div>
              )}
            </div>

            {/* New Connection */}
            <div className="conn-new-section">
              {CONNECTION_GROUPS.map((group) => (
                <div key={group.label}>
                  <button
                    className="conn-group-toggle"
                    onClick={() => setActiveGroup(activeGroup === group.label ? null : group.label)}
                  >
                    {group.icon}
                    <span>{group.label}</span>
                    <ChevronDown size={11} style={{ transform: activeGroup === group.label ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                  {activeGroup === group.label && (
                    <div className="conn-type-list">
                      {group.types.map((t) => (
                        <button
                          key={t.type}
                          className="conn-type-btn"
                          onClick={() => startCreate(t.type)}
                        >
                          <span className="conn-type-dot" style={{ background: t.color }} />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right — Connection Detail */}
          <div className="conn-detail">
            {(selectedConn || isCreating) ? (
              <>
                <div className="conn-detail-header">
                  {editingConn ? (
                    <input
                      className="form-input conn-name-input"
                      value={editingConn.name ?? ""}
                      onChange={(e) => setEditingConn((prev) => ({ ...prev!, name: e.target.value }))}
                      placeholder="Nome da conexão"
                    />
                  ) : (
                    <div className="conn-detail-title">
                      <div className="conn-type-dot lg" style={{ background: getTypeColor(selectedConn!.type) }} />
                      <span>{selectedConn?.name}</span>
                    </div>
                  )}
                  <div className="conn-detail-actions">
                    {!editingConn && selectedConn && (
                      <>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleTest(selectedConn.id)}
                          disabled={testingId === selectedConn.id}
                        >
                          {testingId === selectedConn.id ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <TestTube2 size={13} />
                          )}
                          Testar
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => setEditingConn({ ...selectedConn })}
                        >
                          Editar
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => { jobStore.deleteConnection(selectedConn.id); setSelectedConnId(null); }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                    {editingConn && (
                      <>
                        <button className="btn btn-success" onClick={handleSave}>
                          <CheckCircle2 size={13} /> Salvar
                        </button>
                        <button className="btn btn-secondary" onClick={() => { setEditingConn(null); setIsCreating(false); }}>
                          Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Type badge */}
                {(editingConn ?? selectedConn) && (
                  <div className="conn-type-badge" style={{ borderColor: getTypeColor((editingConn ?? selectedConn)!.type as ConnectionType) }}>
                    {getTypeLabel((editingConn ?? selectedConn)!.type as ConnectionType)}
                  </div>
                )}

                <div className="conn-detail-body">
                  {editingConn ? (
                    <>
                      <div className="form-group">
                        <label className="form-label">Descrição</label>
                        <input
                          className="form-input"
                          value={editingConn.description ?? ""}
                          placeholder="Descreva para que serve essa conexão..."
                          onChange={(e) => setEditingConn((prev) => ({ ...prev!, description: e.target.value }))}
                        />
                      </div>

                      {/* Environment selector */}
                      <div className="form-group">
                        <label className="form-label">Ambientes disponíveis</label>
                        <div className="conn-env-selector">
                          {ENVS.map((env) => {
                            const selected = (editingConn.environments ?? ["dev"]).includes(env.id);
                            return (
                              <button
                                key={env.id}
                                type="button"
                                className={`conn-env-toggle ${selected ? "active" : ""}`}
                                style={{ "--env-color": env.color } as any}
                                onClick={() => {
                                  const current = editingConn.environments ?? ["dev"];
                                  const next = selected
                                    ? current.filter((e) => e !== env.id)
                                    : [...current, env.id];
                                  setEditingConn((p) => ({ ...p!, environments: next.length ? next : [env.id] }));
                                }}
                              >
                                <span className="env-dot" style={{ background: env.color }} />
                                {env.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="conn-env-hint" style={{ marginTop: 6 }}>
                          💡 A conexão ficará disponível nos nós somente quando o job estiver no ambiente selecionado.
                        </div>
                      </div>

                      {/* Scope Selection (Global vs Local) */}
                      <div className="form-group" style={{ background: "rgba(0,0,0,0.18)", padding: 10, borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                        <label className="form-label" style={{ fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>Disponibilidade da Conexão (Escopo)</span>
                          <span
                            className="badge"
                            style={{
                              fontSize: "0.68rem",
                              background: (editingConn.scope ?? "global") === "local" ? "rgba(168, 85, 247, 0.2)" : "rgba(59, 130, 246, 0.2)",
                              color: (editingConn.scope ?? "global") === "local" ? "#c084fc" : "#93c5fd",
                            }}
                          >
                            {(editingConn.scope ?? "global") === "local" ? "💼 Conexão Local" : "🌐 Conexão Global"}
                          </span>
                        </label>
                        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.78rem" }}>
                            <input
                              type="radio"
                              name="conn-scope-radio"
                              checked={(editingConn.scope ?? "global") === "global"}
                              onChange={() => {
                                setEditingConn((p) => ({ ...p!, scope: "global", jobId: undefined }));
                              }}
                            />
                            <span>🌐 <strong>Global</strong> (Disponível em todos os jobs)</span>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.78rem" }}>
                            <input
                              type="radio"
                              name="conn-scope-radio"
                              checked={(editingConn.scope ?? "global") === "local"}
                              onChange={() => {
                                setEditingConn((p) => ({ ...p!, scope: "local", jobId: activeJobId || p?.jobId }));
                              }}
                            />
                            <span>💼 <strong>Local</strong> {activeJobName ? `(Restrito ao job "${activeJobName}")` : "(Restrito a este job)"}</span>
                          </label>
                        </div>
                        <div className="conn-env-hint" style={{ marginTop: 6 }}>
                          {(editingConn.scope ?? "global") === "local"
                            ? "🔒 Conexões locais só aparecem na lista e nós deste job, evitando poluir o catálogo global."
                            : "🌍 Conexões globais ficam disponíveis para qualquer pipeline ou job do projeto."}
                        </div>
                      </div>

                      <div className="conn-section-divider">Parâmetros de Conexão</div>
                      {renderConfigForm()}
                    </>
                  ) : selectedConn ? (
                    <div className="conn-readonly-view">
                      {/* Environment and Scope badges */}
                      <div className="conn-env-badges-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="form-label" style={{ margin: 0 }}>Escopo:</span>
                        <span
                          className="conn-env-badge-pill"
                          style={{
                            borderColor: selectedConn.scope === "local" ? "rgba(168, 85, 247, 0.4)" : "rgba(59, 130, 246, 0.4)",
                            color: selectedConn.scope === "local" ? "#c084fc" : "#93c5fd",
                            background: selectedConn.scope === "local" ? "rgba(168, 85, 247, 0.12)" : "rgba(59, 130, 246, 0.12)",
                          }}
                        >
                          {selectedConn.scope === "local" ? "💼 LOCAL (Job Atual)" : "🌐 GLOBAL (Todos os Jobs)"}
                        </span>
                        <span className="form-label" style={{ margin: 0, marginLeft: 8 }}>Ambientes:</span>
                        {(selectedConn.environments ?? []).map((env) => (
                          <span
                            key={env}
                            className="conn-env-badge-pill"
                            style={{ borderColor: ENVS.find((e) => e.id === env)?.color, color: ENVS.find((e) => e.id === env)?.color }}
                          >
                            {env.toUpperCase()}
                          </span>
                        ))}
                      </div>

                      {selectedConn.description && (
                        <div className="conn-desc">{selectedConn.description}</div>
                      )}
                      {selectedConn.testStatus === "success" && (
                        <div className="conn-test-banner success">
                          <CheckCircle2 size={14} /> Conexão testada com sucesso
                          {selectedConn.lastTestedAt && (
                            <span className="test-time">
                              {new Date(selectedConn.lastTestedAt).toLocaleString("pt-BR")}
                            </span>
                          )}
                        </div>
                      )}
                      {selectedConn.testStatus === "failed" && (
                        <div className="conn-test-banner error">
                          <XCircle size={14} /> Falha ao conectar — verifique as credenciais
                        </div>
                      )}
                      <div className="conn-params-grid">
                        {Object.entries(selectedConn.config)
                          .filter(([k]) => !["password", "secretKey", "apiKey", "bearerToken", "extraParams"].includes(k))
                          .map(([k, v]) => (
                            <div key={k} className="conn-param-row">
                              <span className="conn-param-key">{k}</span>
                              <span className="conn-param-val">{String(v)}</span>
                            </div>
                          ))}
                        {["password", "secretKey", "apiKey", "bearerToken"].filter((k) => selectedConn.config[k]).map((k) => (
                          <div key={k} className="conn-param-row">
                            <span className="conn-param-key">{k}</span>
                            <span className="conn-param-val masked">••••••••••••</span>
                          </div>
                        ))}
                      </div>
                      <div className="conn-ref-hint">
                        <Key size={12} />
                        Referência nos nodes: <code>{selectedConn.name.toLowerCase().replace(/\s+/g, "_")}</code>
                        <button className="copy-ref-btn" onClick={() => navigator.clipboard.writeText(selectedConn.name.toLowerCase().replace(/\s+/g, "_"))}>
                          <Copy size={11} />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="conn-detail-placeholder">
                <Database size={48} opacity={0.1} />
                <p>Selecione uma conexão ou crie uma nova</p>
                <p className="conn-detail-hint">Use os grupos abaixo para adicionar uma nova conexão de banco de dados, cloud storage ou API</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
