import React, { useState, useCallback, useRef, useEffect } from "react";
import { Node } from "reactflow";
import { CanvasNodeData } from "../../types";
import { SchemaEditor, SchemaEditorModal } from "./SchemaEditor";
import { Settings, Trash2, Database, Link2, ChevronDown, Maximize2, Server, Layers, Zap } from "lucide-react";
import { ConnectionEntry, ContextVariable, SchemaColumn, Environment } from "../../store/jobStore";

interface PropertyPanelProps {
  selectedNode: Node<CanvasNodeData> | null;
  onUpdateConfig: (nodeId: string, newConfig: Record<string, any>) => void;
  onUpdateLabel?: (nodeId: string, newLabel: string) => void;
  onUpdateSchema?: (nodeId: string, schema: SchemaColumn[]) => void;
  onDeleteNode: (nodeId: string) => void;
  connections?: ConnectionEntry[];
  contextVariables?: ContextVariable[];
  activeEnvironment?: Environment;
  /** Called on double-click header to pop-out into floating window */
  onPopOut?: (node: Node<CanvasNodeData>) => void;
}

// ─── Connection select dropdown ───────────────────────────────
const ConnectionSelect: React.FC<{
  value: string;
  connections: ConnectionEntry[];
  activeEnvironment?: Environment;
  onChange: (val: string) => void;
}> = ({ value, connections, activeEnvironment, onChange }) => {
  const filtered = activeEnvironment
    ? connections.filter((c) => c.environments && c.environments.includes(activeEnvironment))
    : connections;

  return (
    <div>
      {filtered.length > 0 ? (
        <select
          className="form-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">-- Selecione uma Conexão --</option>
          {filtered.map((c) => (
            <option key={c.id} value={c.name.toLowerCase().replace(/\s+/g, "_")}>
              {c.name}
              {activeEnvironment && c.environments ? ` [${c.environments.join(",")}]` : ""}
            </option>
          ))}
        </select>
      ) : (
        <div className="no-conn-hint">
          <Database size={13} />
          <span>
            {connections.length === 0
              ? "Nenhuma conexão cadastrada"
              : `Nenhuma conexão para o ambiente ${activeEnvironment?.toUpperCase()}`}
          </span>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            Abra o Gerenciador de Conexões no header
          </span>
        </div>
      )}
      {value && (
        <div className="conn-ref-chip">
          <Link2 size={11} />
          <code>{value}</code>
        </div>
      )}
    </div>
  );
};

// ─── Debounced textarea to avoid cursor jump bug ───────────────
/**
 * BUG FIX: The original textarea lost focus because every keystroke triggered
 * onUpdateConfig → setNodes → re-render → PropertyPanel re-renders with new
 * selectedNode prop, reassigning the textarea value and resetting cursor.
 *
 * Solution: local state + debounce. The textarea uses local state for immediate
 * display. The parent store is updated only after 400ms of inactivity (debounce),
 * avoiding the re-render cascade while typing.
 */
const DebouncedTextarea: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, onChange, placeholder, className, style }) => {
  const [local, setLocal] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevValueRef = useRef(value);

  // Sync local state if the external value changes from outside (e.g. node switch)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      setLocal(value);
      prevValueRef.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLocal(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(val);
      prevValueRef.current = val;
    }, 400);
  };

  return (
    <textarea
      className={className ?? "form-textarea"}
      style={style}
      value={local}
      placeholder={placeholder}
      onChange={handleChange}
    />
  );
};

// Same pattern for text inputs:
const DebouncedInput: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}> = ({ value, onChange, placeholder, className, style, disabled }) => {
  const [local, setLocal] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      setLocal(value);
      prevValueRef.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocal(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(val);
      prevValueRef.current = val;
    }, 300);
  };

  return (
    <input
      className={className ?? "form-input"}
      style={style}
      value={local}
      placeholder={placeholder}
      disabled={disabled}
      onChange={handleChange}
    />
  );
};

// ─── Main Panel ───────────────────────────────────────────────

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  selectedNode,
  onUpdateConfig,
  onUpdateLabel,
  onUpdateSchema,
  onDeleteNode,
  connections = [],
  contextVariables = [],
  activeEnvironment = "dev",
  onPopOut,
}) => {
  const [showVarHint, setShowVarHint] = useState(false);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "schema">("config");

  const handleChange = useCallback(
    (key: string, value: any) => {
      if (!selectedNode) return;
      const config = selectedNode.data.config || {};
      onUpdateConfig(selectedNode.id, { ...config, [key]: value });
    },
    [selectedNode, onUpdateConfig]
  );

  const handleSchemaChange = useCallback(
    (newSchema: SchemaColumn[]) => {
      if (!selectedNode) return;
      onUpdateSchema?.(selectedNode.id, newSchema);
    },
    [selectedNode, onUpdateSchema]
  );

  if (!selectedNode) {
    return (
      <div className="sidebar-properties" id="property-panel">
        <div className="prop-header">
          <span>Propriedades do Nó</span>
        </div>
        <div className="prop-empty">
          <Settings size={32} opacity={0.15} />
          <p>Selecione um nó no canvas para configurar parâmetros</p>
          <p style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4 }}>
            Clique simples → configurar aqui<br />
            Duplo clique → janela separada
          </p>
        </div>
      </div>
    );
  }

  const { id, data } = selectedNode;
  const config = data.config || {};
  const schema: SchemaColumn[] = (data as any).schema || [];
  const ct = data.componentType || "";

  // Simulate schema inference (replace with real API call)
  const handleInferSchema = async (): Promise<SchemaColumn[]> => {
    await new Promise((r) => setTimeout(r, 800));
    // Demo columns — in real impl, call backend /schemas/infer
    return [
      { id: "c1", name: "id", type: "Integer", nullable: false, isPrimaryKey: true },
      { id: "c2", name: "nome", type: "String", nullable: true, length: 255 },
      { id: "c3", name: "valor", type: "Decimal", nullable: true, precision: 18, scale: 4 },
      { id: "c4", name: "data_criacao", type: "DateTime", nullable: true, format: "yyyy-MM-dd HH:mm:ss" },
      { id: "c5", name: "ativo", type: "Boolean", nullable: false, defaultValue: "true" },
    ];
  };

  // Detect connector family
  const isFileSource = ct.includes("file.source");
  const isFilter = ct.includes("filter");
  const isSelect = ct.includes("select");
  const isJoin = ct.includes("join");
  const isFileTarget = ct.includes("file.target");
  const isDbConnector = ct.includes("connector.db") || ct.includes("connector.cloud") || ct.includes("connector.api");
  const isAggregate = ct.includes("aggregate");
  const isSort = ct.includes("sort");
  const isDeduplicate = ct.includes("deduplicate");
  const isMapExpr = ct.includes("map_expression");
  const isS3 = ct.includes("s3");
  const isAzureBlob = ct.includes("azure_blob");
  const isGcs = ct.includes("gcs");
  const isRestApi = ct.includes("rest_api") || ct.includes("rest_output");
  const isDatabricks = ct.includes("databricks");
  const isOracleOrSql = ct.includes("oracle") || ct.includes("sqlserver") || ct.includes("mysql") || ct.includes("postgresql") || ct.includes("redshift") || ct.includes("snowflake") || ct.includes("bigquery");
  const isScylla = ct.includes("scylla");
  const isKafka = ct.includes("kafka");
  const isSqs = ct.includes("sqs");
  const isSns = ct.includes("sns");
  const isOutput = ct.includes("output");
  const canHaveSchema =
    isFileSource || isFileTarget || isDbConnector || isOracleOrSql || isDatabricks || isScylla || isKafka || isSqs || isSns;

  const WriteMode = () => (
    <div className="form-group">
      <label className="form-label">Modo de Gravação</label>
      <select className="form-select" value={config.write_mode ?? "append"}
        onChange={(e) => handleChange("write_mode", e.target.value)}>
        <option value="append">Append — Adicionar registros</option>
        <option value="overwrite">Overwrite — Substituir tudo</option>
        <option value="upsert">Upsert — Inserir ou atualizar</option>
        <option value="update">Update — Apenas atualizar</option>
        <option value="truncate_insert">Truncate + Insert</option>
      </select>
    </div>
  );

  const DbConnectionSection = ({ showQuery = true, showTable = false }) => (
    <>
      <div className="form-group">
        <label className="form-label">
          <Database size={12} /> Conexão ({activeEnvironment.toUpperCase()})
        </label>
        <ConnectionSelect
          value={config.connection_ref ?? ""}
          connections={connections}
          activeEnvironment={activeEnvironment}
          onChange={(v) => handleChange("connection_ref", v)}
        />
      </div>
      {showTable && (
        <div className="form-group">
          <label className="form-label">Tabela de Destino</label>
          <DebouncedInput
            value={config.table ?? ""}
            placeholder="schema.tabela"
            onChange={(v) => handleChange("table", v)}
          />
        </div>
      )}
      {showQuery && (
        <div className="form-group">
          <label className="form-label">Query SQL</label>
          {/* DebouncedTextarea fixes the cursor-jump bug */}
          <DebouncedTextarea
            value={config.query ?? ""}
            placeholder={"SELECT *\nFROM tabela\nWHERE ativo = 1"}
            style={{ minHeight: 90, fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}
            onChange={(v) => handleChange("query", v)}
          />
          <div className="var-hint-trigger" onClick={() => setShowVarHint((v) => !v)}>
            <ChevronDown size={11} style={{ transform: showVarHint ? "rotate(180deg)" : "none" }} />
            Variáveis de contexto disponíveis ({contextVariables.length})
          </div>
          {showVarHint && (
            <div className="var-hint-list">
              {contextVariables.map((cv) => (
                <div
                  key={cv.id}
                  className="var-hint-item"
                  onClick={() => handleChange("query", (config.query ?? "") + "${" + cv.key + "}")}
                >
                  <code>{"${" + cv.key + "}"}</code>
                  <span>{cv.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="sidebar-properties" id="property-panel">
        {/* Header: single click = sidebar (current), double click = pop-out */}
        <div
          className="prop-header"
          onDoubleClick={() => onPopOut?.(selectedNode)}
          title="Duplo clique para abrir em janela separada"
          style={{ cursor: "pointer" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Settings size={15} color="var(--accent-cyan)" />
            <span>{data.label || id}</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {onPopOut && (
              <button
                type="button"
                className="icon-btn"
                title="Abrir em janela flutuante (ou duplo clique no header)"
                onClick={() => onPopOut(selectedNode)}
              >
                <Maximize2 size={12} />
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              id="btn-delete-node"
              onClick={() => onDeleteNode(id)}
              title="Remover nó"
              style={{ padding: "4px 8px" }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Tabs: Config | Schema */}
        <div className="prop-tabs">
          <button
            className={`prop-tab ${activeTab === "config" ? "active" : ""}`}
            onClick={() => setActiveTab("config")}
          >
            Configuração
          </button>
          <button
            className={`prop-tab ${activeTab === "schema" ? "active" : ""}`}
            onClick={() => setActiveTab("schema")}
          >
            Schema
            {schema.length > 0 && (
              <span className="prop-tab-badge">{schema.length}</span>
            )}
          </button>
          {activeTab === "schema" && (
            <button
              className="icon-btn"
              style={{ marginLeft: "auto" }}
              onClick={() => setShowSchemaModal(true)}
              title="Abrir schema em tela cheia"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>

        {activeTab === "config" && (
          <div className="prop-content">
            {/* Component Name / Label */}
            <div className="form-group">
              <label className="form-label">Nome / Rótulo no Canvas</label>
              <DebouncedInput
                value={data.label || id}
                placeholder="Ex: Minha Consulta SQL"
                onChange={(v) => onUpdateLabel?.(id, v)}
              />
            </div>

            {/* Node ID */}
            <div className="form-group">
              <label className="form-label">Node ID</label>
              <input
                className="form-input"
                value={id}
                disabled
                style={{ opacity: 0.55, cursor: "not-allowed", fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}
              />
            </div>

            {/* Type */}
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", background: "var(--bg-card)", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
                {ct}
              </div>
            </div>

            {/* ─── File Source ── */}
            {isFileSource && (
              <>
                <div className="form-group">
                  <label className="form-label">Caminho do Arquivo</label>
                  <DebouncedInput value={config.path ?? ""} placeholder="data/sales.csv" onChange={(v) => handleChange("path", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Formato</label>
                  <select className="form-select" value={config.format ?? "csv"} onChange={(e) => handleChange("format", e.target.value)}>
                    <option value="csv">CSV</option>
                    <option value="tsv">TSV</option>
                    <option value="parquet">Apache Parquet</option>
                    <option value="json">JSON / NDJSON</option>
                    <option value="excel">Excel (XLSX)</option>
                    <option value="orc">Apache ORC</option>
                    <option value="avro">Apache Avro</option>
                  </select>
                </div>
                {(config.format === "csv" || config.format === "tsv" || !config.format) && (
                  <div className="conn-form-row">
                    <div className="form-group">
                      <label className="form-label">Delimitador</label>
                      <DebouncedInput value={config.delimiter ?? ","} style={{ maxWidth: 70, fontFamily: "var(--font-mono)" }} onChange={(v) => handleChange("delimiter", v)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Encoding</label>
                      <select className="form-select" value={config.encoding ?? "utf-8"} onChange={(e) => handleChange("encoding", e.target.value)}>
                        <option value="utf-8">UTF-8</option>
                        <option value="utf-8-sig">UTF-8 BOM</option>
                        <option value="latin-1">Latin-1</option>
                        <option value="cp1252">Windows-1252</option>
                      </select>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ─── DB Sources ── */}
            {isDbConnector && !isOutput && (isOracleOrSql || isDatabricks) && (
              <DbConnectionSection showQuery={true} showTable={false} />
            )}

            {/* ─── Oracle special ── */}
            {ct.includes("oracle") && !isOutput && (
              <div className="form-group">
                <label className="form-label">Service Name / SID</label>
                <DebouncedInput value={config.serviceName ?? ""} placeholder="ORCL" onChange={(v) => handleChange("serviceName", v)} />
              </div>
            )}

            {/* ─── Databricks special ── */}
            {isDatabricks && !isOutput && (
              <div className="conn-form-row">
                <div className="form-group">
                  <label className="form-label">Catalog</label>
                  <DebouncedInput value={config.catalog ?? ""} placeholder="hive_metastore" onChange={(v) => handleChange("catalog", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Schema</label>
                  <DebouncedInput value={config.schema ?? ""} placeholder="default" onChange={(v) => handleChange("schema", v)} />
                </div>
              </div>
            )}

            {/* ─── Cloud Source ── */}
            {(isS3 || isAzureBlob || isGcs) && !isOutput && (
              <>
                <div className="form-group">
                  <label className="form-label"><Database size={12} /> Conexão</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Bucket / Container</label>
                  <DebouncedInput value={config.bucket ?? ""} placeholder="meu-bucket" onChange={(v) => handleChange("bucket", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Prefixo / Caminho</label>
                  <DebouncedInput value={config.prefix ?? ""} placeholder="dados/2024/" onChange={(v) => handleChange("prefix", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Formato</label>
                  <select className="form-select" value={config.format ?? "parquet"} onChange={(e) => handleChange("format", e.target.value)}>
                    <option value="parquet">Parquet</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON Lines</option>
                    <option value="orc">ORC</option>
                  </select>
                </div>
              </>
            )}

            {/* ─── REST API Source ── */}
            {isRestApi && !isOutput && (
              <>
                <div className="form-group">
                  <label className="form-label"><Database size={12} /> Conexão</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Endpoint</label>
                  <DebouncedInput value={config.endpoint ?? ""} placeholder="/users?page={page}" onChange={(v) => handleChange("endpoint", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tipo de Paginação</label>
                  <select className="form-select" value={config.pagination_type ?? "none"} onChange={(e) => handleChange("pagination_type", e.target.value)}>
                    <option value="none">Sem Paginação</option>
                    <option value="page_number">Número de Página</option>
                    <option value="cursor">Cursor</option>
                    <option value="offset_limit">Offset + Limit</option>
                    <option value="link_header">Link Header</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Caminho dos Dados (JSONPath)</label>
                  <DebouncedInput value={config.data_path ?? ""} placeholder="data.items" onChange={(v) => handleChange("data_path", v)} />
                </div>
              </>
            )}

            {/* ─── ScyllaDB Source ── */}
            {isScylla && !isOutput && (
              <>
                <div className="form-group">
                  <label className="form-label"><Database size={12} /> Conexão ScyllaDB</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Keyspace</label>
                  <DebouncedInput value={config.keyspace ?? ""} placeholder="analytics" onChange={(v) => handleChange("keyspace", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tabela CQL</label>
                  <DebouncedInput value={config.table ?? ""} placeholder="users_by_region" onChange={(v) => handleChange("table", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Consulta CQL Personalizada (opcional)</label>
                  <DebouncedTextarea value={config.query ?? ""} placeholder="SELECT * FROM users_by_region WHERE status = 'ACTIVE'" onChange={(v) => handleChange("query", v)} />
                </div>
              </>
            )}

            {/* ─── Kafka Consumer Source ── */}
            {isKafka && !isOutput && (
              <>
                <div className="form-group">
                  <label className="form-label"><Server size={12} /> Conexão Kafka</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tópico de Origem</label>
                  <DebouncedInput value={config.topic ?? ""} placeholder="events.transactions" onChange={(v) => handleChange("topic", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Consumer Group ID</label>
                  <DebouncedInput value={config.consumer_group ?? ""} placeholder="rocket-consumer-group" onChange={(v) => handleChange("consumer_group", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Limite de Mensagens (Lote)</label>
                  <input className="form-input" type="number" value={config.max_messages ?? 1000} onChange={(e) => handleChange("max_messages", parseInt(e.target.value))} />
                </div>
              </>
            )}

            {/* ─── AWS SQS Consumer Source ── */}
            {isSqs && !isOutput && (
              <>
                <div className="form-group">
                  <label className="form-label"><Layers size={12} /> Conexão SQS</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Queue URL ou Nome da Fila</label>
                  <DebouncedInput value={config.queue_url ?? ""} placeholder="https://sqs.sa-east-1.amazonaws.com/123456/minha-fila" onChange={(v) => handleChange("queue_url", v)} />
                </div>
                <div className="conn-form-row">
                  <div className="form-group">
                    <label className="form-label">Max Mensagens</label>
                    <input className="form-input" type="number" value={config.max_messages ?? 10} onChange={(e) => handleChange("max_messages", parseInt(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Wait Time (seg)</label>
                    <input className="form-input" type="number" value={config.wait_time_seconds ?? 2} onChange={(e) => handleChange("wait_time_seconds", parseInt(e.target.value))} />
                  </div>
                </div>
              </>
            )}

            {/* ─── Filter ── */}
            {isFilter && (
              <div className="form-group">
                <label className="form-label">Expressão do Predicado</label>
                <DebouncedTextarea value={config.expression ?? ""} placeholder={"status == 'ACTIVE' and valor > 100"} onChange={(v) => handleChange("expression", v)} />
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Sintaxe Polars / Python</span>
              </div>
            )}

            {/* ─── Select ── */}
            {isSelect && (
              <div className="form-group">
                <label className="form-label">Colunas (vírgula)</label>
                <DebouncedInput value={Array.isArray(config.columns) ? config.columns.join(", ") : ""} placeholder="id, nome, email" onChange={(v) => handleChange("columns", v.split(",").map((c) => c.trim()).filter(Boolean))} />
              </div>
            )}

            {/* ─── Join ── */}
            {isJoin && (
              <>
                <div className="form-group">
                  <label className="form-label">Tipo de Join</label>
                  <select className="form-select" value={config.join_type ?? "inner"} onChange={(e) => handleChange("join_type", e.target.value)}>
                    <option value="inner">Inner Join</option>
                    <option value="left">Left Outer</option>
                    <option value="right">Right Outer</option>
                    <option value="outer">Full Outer</option>
                    <option value="semi">Semi Join</option>
                    <option value="anti">Anti Join</option>
                    <option value="cross">Cross Join</option>
                  </select>
                </div>
                <div className="conn-form-row">
                  <div className="form-group">
                    <label className="form-label">Chaves Esquerda</label>
                    <DebouncedInput value={Array.isArray(config.left_keys) ? config.left_keys.join(", ") : ""} placeholder="customer_id" onChange={(v) => handleChange("left_keys", v.split(",").map((k) => k.trim()).filter(Boolean))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Chaves Direita</label>
                    <DebouncedInput value={Array.isArray(config.right_keys) ? config.right_keys.join(", ") : ""} placeholder="id" onChange={(v) => handleChange("right_keys", v.split(",").map((k) => k.trim()).filter(Boolean))} />
                  </div>
                </div>
              </>
            )}

            {/* ─── Aggregate ── */}
            {isAggregate && (
              <>
                <div className="form-group">
                  <label className="form-label">GROUP BY</label>
                  <DebouncedInput value={Array.isArray(config.group_by) ? config.group_by.join(", ") : ""} placeholder="regiao, produto" onChange={(v) => handleChange("group_by", v.split(",").map((c) => c.trim()).filter(Boolean))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Agregações</label>
                  <DebouncedTextarea value={config.aggregations_raw ?? ""} placeholder={"SUM(valor) AS total\nCOUNT(*) AS qtd\nAVG(preco) AS media"} onChange={(v) => handleChange("aggregations_raw", v)} />
                </div>
              </>
            )}

            {/* ─── Sort ── */}
            {isSort && (
              <div className="form-group">
                <label className="form-label">ORDER BY</label>
                <DebouncedTextarea value={config.order_by_raw ?? ""} placeholder={"data DESC\nvalor ASC"} onChange={(v) => handleChange("order_by_raw", v)} />
              </div>
            )}

            {/* ─── Deduplicate ── */}
            {isDeduplicate && (
              <>
                <div className="form-group">
                  <label className="form-label">Colunas de Chave</label>
                  <DebouncedInput value={Array.isArray(config.key_columns) ? config.key_columns.join(", ") : ""} placeholder="cpf, email" onChange={(v) => handleChange("key_columns", v.split(",").map((c) => c.trim()).filter(Boolean))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Manter</label>
                  <select className="form-select" value={config.keep ?? "first"} onChange={(e) => handleChange("keep", e.target.value)}>
                    <option value="first">Primeira ocorrência</option>
                    <option value="last">Última ocorrência</option>
                  </select>
                </div>
              </>
            )}

            {/* ─── Map Expression ── */}
            {isMapExpr && (
              <div className="form-group">
                <label className="form-label">Mapeamentos</label>
                <DebouncedTextarea style={{ minHeight: 100 }} value={config.mappings_raw ?? ""} placeholder={"nome_completo = first_name + ' ' + last_name\nvalor_brl = valor * 5.2"} onChange={(v) => handleChange("mappings_raw", v)} />
              </div>
            )}

            {/* ─── File Target ── */}
            {isFileTarget && (
              <>
                <div className="form-group">
                  <label className="form-label">Caminho de Destino</label>
                  <DebouncedInput value={config.path ?? ""} placeholder="output/resultado.parquet" onChange={(v) => handleChange("path", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Formato</label>
                  <select className="form-select" value={config.format ?? "parquet"} onChange={(e) => handleChange("format", e.target.value)}>
                    <option value="parquet">Apache Parquet</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON Lines</option>
                    <option value="excel">Excel (XLSX)</option>
                    <option value="delta">Delta Lake</option>
                  </select>
                </div>
                <WriteMode />
              </>
            )}

            {/* ─── DB/Databricks Output ── */}
            {isOutput && (isOracleOrSql || isDatabricks) && (
              <>
                <DbConnectionSection showQuery={false} showTable={true} />
                <div className="form-group">
                  <label className="form-label">Schema</label>
                  <DebouncedInput value={config.schema ?? ""} placeholder="dbo ou public" onChange={(v) => handleChange("schema", v)} />
                </div>
                <WriteMode />
                <div className="form-group">
                  <label className="form-label">Batch Size</label>
                  <input className="form-input" type="number" value={config.batch_size ?? 5000} onChange={(e) => handleChange("batch_size", parseInt(e.target.value))} />
                </div>
              </>
            )}

            {/* ─── Cloud Output ── */}
            {isOutput && (isS3 || isAzureBlob || isGcs) && (
              <>
                <div className="form-group">
                  <label className="form-label"><Database size={12} /> Conexão</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Bucket</label>
                  <DebouncedInput value={config.bucket ?? ""} placeholder="meu-bucket" onChange={(v) => handleChange("bucket", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Prefixo</label>
                  <DebouncedInput value={config.prefix ?? ""} placeholder="output/2024/" onChange={(v) => handleChange("prefix", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Formato</label>
                  <select className="form-select" value={config.format ?? "parquet"} onChange={(e) => handleChange("format", e.target.value)}>
                    <option value="parquet">Parquet</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON Lines</option>
                    <option value="orc">ORC</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Particionado Por</label>
                  <DebouncedInput value={Array.isArray(config.partitioned_by) ? config.partitioned_by.join(", ") : ""} placeholder="ano, mes" onChange={(v) => handleChange("partitioned_by", v.split(",").map((c) => c.trim()).filter(Boolean))} />
                </div>
                <WriteMode />
              </>
            )}

            {/* ─── REST Output ── */}
            {isOutput && isRestApi && (
              <>
                <div className="form-group">
                  <label className="form-label"><Database size={12} /> Conexão</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Endpoint</label>
                  <DebouncedInput value={config.endpoint ?? ""} placeholder="/records" onChange={(v) => handleChange("endpoint", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Método HTTP</label>
                  <select className="form-select" value={config.method ?? "POST"} onChange={(e) => handleChange("method", e.target.value)}>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Batch Size</label>
                  <input className="form-input" type="number" value={config.batch_size ?? 100} onChange={(e) => handleChange("batch_size", parseInt(e.target.value))} />
                </div>
              </>
            )}

            {/* ─── ScyllaDB Output ── */}
            {isOutput && isScylla && (
              <>
                <div className="form-group">
                  <label className="form-label"><Database size={12} /> Conexão ScyllaDB</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tabela de Destino</label>
                  <DebouncedInput value={config.table ?? ""} placeholder="minha_tabela" onChange={(v) => handleChange("table", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Batch Size (CQL)</label>
                  <input className="form-input" type="number" value={config.batch_size ?? 1000} onChange={(e) => handleChange("batch_size", parseInt(e.target.value))} />
                </div>
              </>
            )}

            {/* ─── Kafka Producer Output ── */}
            {isOutput && isKafka && (
              <>
                <div className="form-group">
                  <label className="form-label"><Server size={12} /> Conexão Kafka</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tópico de Destino</label>
                  <DebouncedInput value={config.topic ?? ""} placeholder="events.output" onChange={(v) => handleChange("topic", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Coluna de Chave (Opcional)</label>
                  <DebouncedInput value={config.key_column ?? ""} placeholder="id_ou_cpf" onChange={(v) => handleChange("key_column", v)} />
                </div>
              </>
            )}

            {/* ─── AWS SQS Output ── */}
            {isOutput && isSqs && (
              <>
                <div className="form-group">
                  <label className="form-label"><Layers size={12} /> Conexão SQS</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Queue URL ou Nome da Fila</label>
                  <DebouncedInput value={config.queue_url ?? ""} placeholder="https://sqs.sa-east-1.amazonaws.com/123456/minha-fila" onChange={(v) => handleChange("queue_url", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Message Group ID (para Filas FIFO)</label>
                  <DebouncedInput value={config.message_group_id ?? ""} placeholder="default_group" onChange={(v) => handleChange("message_group_id", v)} />
                </div>
              </>
            )}

            {/* ─── AWS SNS Output ── */}
            {isOutput && isSns && (
              <>
                <div className="form-group">
                  <label className="form-label"><Zap size={12} /> Conexão SNS</label>
                  <ConnectionSelect value={config.connection_ref ?? ""} connections={connections} activeEnvironment={activeEnvironment} onChange={(v) => handleChange("connection_ref", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Topic ARN</label>
                  <DebouncedInput value={config.topic_arn ?? ""} placeholder="arn:aws:sns:sa-east-1:123456789012:meu-topico" onChange={(v) => handleChange("topic_arn", v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Assunto da Notificação (Subject)</label>
                  <DebouncedInput value={config.subject ?? ""} placeholder="Alerta de Pipeline" onChange={(v) => handleChange("subject", v)} />
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "schema" && (
          <div className="prop-content">
            <SchemaEditor
              schema={schema}
              onChange={handleSchemaChange}
              onInferRequest={canHaveSchema ? handleInferSchema : undefined}
              canInfer={canHaveSchema}
              inferLabel={isFileSource || isFileTarget ? "Inferir do Arquivo" : "Inferir da Query"}
              compact
            />
          </div>
        )}
      </div>

      {/* Schema full-screen modal */}
      {showSchemaModal && (
        <SchemaEditorModal
          schema={schema}
          onChange={handleSchemaChange}
          onInferRequest={canHaveSchema ? handleInferSchema : undefined}
          canInfer={canHaveSchema}
          inferLabel={isFileSource || isFileTarget ? "Inferir do Arquivo" : "Inferir da Query"}
          nodeLabel={data.label || id}
          onClose={() => setShowSchemaModal(false)}
        />
      )}
    </>
  );
};
