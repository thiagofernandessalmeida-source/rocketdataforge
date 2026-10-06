import React, { useState, useCallback, useRef, useEffect } from "react";
import { Node } from "reactflow";
import { CanvasNodeData } from "../../types";
import { SchemaEditor, SchemaEditorModal } from "./SchemaEditor";
import { TMapModal, TMapConfig } from "./TMapModal";
import { api } from "../../api/client";
import {
  Settings,
  Trash2,
  Database,
  Link2,
  ChevronDown,
  Maximize2,
  Server,
  Layers,
  Zap,
  GitMerge,
  HelpCircle,
  Edit3,
  Check,
  Wand2,
  Loader2,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { ConnectionEntry, ContextVariable, SchemaColumn, Environment, QueryEntry, QueryDialect, ConnectionType } from "../../store/jobStore";

export interface PropertyPanelProps {
  selectedNode: Node<CanvasNodeData> | null;
  onUpdateConfig: (nodeId: string, newConfig: Record<string, any>) => void;
  onUpdateLabel?: (nodeId: string, newLabel: string) => void;
  onUpdateSchema?: (nodeId: string, schema: SchemaColumn[]) => void;
  onUpdateNodeId?: (oldId: string, newId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  connections?: ConnectionEntry[];
  queryBank?: QueryEntry[];
  contextVariables?: ContextVariable[];
  activeEnvironment?: Environment;
  allNodes?: Node<CanvasNodeData>[];
  edges?: any[];
  /** Called on double-click header to pop-out into floating window */
  onPopOut?: (node: Node<CanvasNodeData>) => void;
}

// ─── Connection select dropdown ───────────────────────────────
export const ConnectionSelect: React.FC<{
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

// ─── Connection type → query dialect mapper ───────────────────
const CONNECTION_TYPE_TO_DIALECT: Record<string, QueryDialect> = {
  postgresql: "postgresql",
  oracle: "oracle",
  sqlserver: "sqlserver",
  mysql: "mysql",
  redshift: "redshift",
  bigquery: "bigquery",
  snowflake: "snowflake",
  databricks: "databricks",
};

// ─── Query select dropdown ────────────────────────────────────
export const QuerySelect: React.FC<{
  queryBank: QueryEntry[];
  connections: ConnectionEntry[];
  connectionRef: string;
  onSelect: (query: QueryEntry) => void;
}> = ({ queryBank, connections, connectionRef, onSelect }) => {
  const [open, setOpen] = useState(false);

  // Find the connection entry to get its type/dialect
  const connEntry = connections.find(
    (c) => c.name.toLowerCase().replace(/\s+/g, "_") === connectionRef
  );
  const dialect: QueryDialect | undefined = connEntry
    ? CONNECTION_TYPE_TO_DIALECT[connEntry.type]
    : undefined;

  // Filter queries: must match dialect (or be generic SQL) AND match connectionRef if defined
  const filtered = queryBank.filter((q) => {
    const dialectMatch = !dialect || q.dialect === dialect || q.dialect === "sql";
    if (!dialectMatch) return false;
    if (q.connectionRef && connectionRef) {
      return q.connectionRef === connectionRef;
    }
    return dialectMatch;
  });

  if (filtered.length === 0) return null;

  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: "100%", justifyContent: "space-between", fontSize: "0.78rem" }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <BookOpen size={12} color="var(--accent-cyan)" />
          Usar query do banco ({filtered.length} disponíve{filtered.length === 1 ? "l" : "is"})
        </span>
        <ChevronRight
          size={12}
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 200,
            background: "var(--bg-card)",
            border: "1px solid var(--border-medium)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            maxHeight: 260,
            overflowY: "auto",
            marginTop: 4,
          }}
        >
          {filtered.map((q) => (
            <button
              key={q.id}
              type="button"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                borderBottom: "1px solid var(--border-subtle)",
                padding: "9px 12px",
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-card-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              onClick={() => {
                onSelect(q);
                setOpen(false);
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.78rem", marginBottom: 2 }}>{q.name}</div>
              {q.description && (
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{q.description}</div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.65rem", padding: "1px 5px", borderRadius: 3, background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                  {q.dialect}
                </span>
                {q.schema && q.schema.length > 0 && (
                  <span style={{ fontSize: "0.65rem", padding: "1px 5px", borderRadius: 3, background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.2)", color: "var(--accent-cyan)" }}>
                    {q.schema.length} colunas
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Debounced textarea (estável fora de PropertyPanel para não perder foco) ────────
export const DebouncedTextarea: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, onChange, placeholder, className, style }) => {
  const [local, setLocal] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevValueRef = useRef(value);

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
    }, 300);
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

// ─── Debounced input (estável fora de PropertyPanel) ─────────
export const DebouncedInput: React.FC<{
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

// ─── Seção de Ações de Tabela e Dados (Padrão Talend) ────────
export const TableActionsSection: React.FC<{
  config: Record<string, any>;
  onChange: (key: string, val: any) => void;
}> = ({ config, onChange }) => {
  return (
    <>
      <div className="form-group">
        <label className="form-label">Ação na Tabela (Action on Table)</label>
        <select
          className="form-select"
          value={config.table_action ?? "none"}
          onChange={(e) => onChange("table_action", e.target.value)}
        >
          <option value="none">Nenhuma (None) — Manter tabela como está</option>
          <option value="drop_create">Deletar e Criar Tabela (Drop and Create)</option>
          <option value="create_if_not_exists">Criar Tabela se não existir (Create if not exists)</option>
          <option value="drop_if_exists_create">Deletar se existir e Criar (Drop if exists and Create)</option>
          <option value="truncate">Limpar / Truncar Tabela (Truncate)</option>
          <option value="delete_all">Deletar todos os registros (Delete rows)</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Ação nos Dados (Action on Data)</label>
        <select
          className="form-select"
          value={config.data_action ?? "insert"}
          onChange={(e) => onChange("data_action", e.target.value)}
        >
          <option value="insert">Inserir registros (Insert)</option>
          <option value="update">Atualizar registros por Chave Primária (Update)</option>
          <option value="upsert">Inserir ou Atualizar (Upsert / Insert or Update)</option>
          <option value="update_or_insert">Atualizar ou Inserir (Update or Insert)</option>
          <option value="delete">Deletar registros por Chave Primária (Delete)</option>
        </select>
      </div>
    </>
  );
};

// ─── Main Panel Component ─────────────────────────────────────
export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  selectedNode,
  onUpdateConfig,
  onUpdateLabel,
  onUpdateSchema,
  onUpdateNodeId,
  onDeleteNode,
  connections = [],
  queryBank = [],
  contextVariables = [],
  activeEnvironment = "dev",
  allNodes = [],
  edges = [],
  onPopOut,
}) => {
  const [showVarHint, setShowVarHint] = useState(false);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [showTMapModal, setShowTMapModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "schema">("config");
  const [editingNodeId, setEditingNodeId] = useState<string>("");
  const [isRenamingId, setIsRenamingId] = useState(false);
  const [inferringDirect, setInferringDirect] = useState(false);
  const [directInferMessage, setDirectInferMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setEditingNodeId(selectedNode.id);
      setIsRenamingId(false);
    }
  }, [selectedNode?.id]);

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

  const handleApplyNodeId = () => {
    if (!selectedNode || !editingNodeId.trim()) return;
    const trimmed = editingNodeId.trim();
    if (trimmed !== selectedNode.id) {
      onUpdateNodeId?.(selectedNode.id, trimmed);
    }
    setIsRenamingId(false);
  };

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

  const liveNode = allNodes.find((n) => n.id === selectedNode.id) || selectedNode;
  const { id } = liveNode;
  const data = liveNode.data;
  const config = data.config || {};
  const schema: SchemaColumn[] = (data as any).schema || [];
  const ct = data.componentType || "";

  // ─── Inferência Real de Schema (BUG 1 FIX) ────────────────────
  const handleInferSchema = async (): Promise<SchemaColumn[]> => {
    const pathOrQuery = (config.path || config.query || config.duckdb_query || "").trim();
    if (!pathOrQuery) {
      throw new Error("Informe o caminho do arquivo (ex: 'data/users.csv') ou query SQL antes de inferir.");
    }
    const connEntry = connections.find(
      (c) => c.name.toLowerCase().replace(/\s+/g, "_") === config.connection_ref
    );
    const connDetails = connEntry?.config
      ? {
          type: connEntry.type,
          host: connEntry.config.host,
          port: connEntry.config.port,
          database: connEntry.config.database,
          username: connEntry.config.username,
          password: connEntry.config.password,
          sslMode: connEntry.config.sslMode,
        }
      : undefined;
    const inferred = await api.inferSchema(pathOrQuery, ct, connDetails);
    const mapped: SchemaColumn[] = inferred.fields.map((f, i) => ({
      id: `col-${Date.now()}-${i}`,
      name: f.name,
      type: (f.logical_type
        ? f.logical_type.charAt(0).toUpperCase() + f.logical_type.slice(1).toLowerCase()
        : "String") as any,
      nullable: f.nullable,
      physicalType: f.physical_type,
    }));
    onUpdateSchema?.(id, mapped);
    return mapped;
  };

  const handleDirectInfer = async () => {
    setInferringDirect(true);
    setDirectInferMessage(null);
    try {
      const mapped = await handleInferSchema();
      setDirectInferMessage({
        type: "success",
        text: `✓ ${mapped.length} coluna(s) inferida(s): ${mapped.map((c) => c.name).join(", ")}`,
      });
      setTimeout(() => setDirectInferMessage(null), 6000);
    } catch (err: any) {
      setDirectInferMessage({
        type: "error",
        text: `⚠️ ${err.message || "Falha ao inferir schema."}`,
      });
    } finally {
      setInferringDirect(false);
    }
  };

  // ─── Busca Colunas a Montante (Upstream) e Nós a Jusante (Downstream) ───
  const incomingEdges = edges.filter((e) => e.target === id);
  const upstreamNodes = incomingEdges
    .map((e) => allNodes.find((n) => n.id === e.source))
    .filter((n): n is Node<CanvasNodeData> => Boolean(n));

  const outgoingEdges = edges.filter((e) => e.source === id);
  const downstreamNodes = outgoingEdges
    .map((e) => {
      const tgtNode = allNodes.find((n) => n.id === e.target);
      const flowName =
        e.data?.flowName ||
        (typeof e.label === "string" ? e.label : "") ||
        (e.id.startsWith("e_") || e.id.startsWith("e-") ? "" : e.id);
      return {
        edgeId: e.id,
        flowName,
        targetId: e.target,
        targetLabel: tgtNode?.data?.label || e.target,
        targetCategory: tgtNode?.data?.category || "target",
        targetComponentType: tgtNode?.data?.componentType || "",
        targetSchema: (tgtNode?.data as any)?.schema || [],
      };
    })
    .filter((d) => Boolean(d.targetId));

  const upstreamSchema: SchemaColumn[] = (upstreamNodes[0]?.data as any)?.schema || [];
  const upstreamNodeLabel = upstreamNodes[0]?.data?.label || upstreamNodes[0]?.id || "";

  // Detect connector family
  const isFileSource = ct.includes("file.source");
  const isDuckDb = ct.includes("duckdb");
  const isDuckDbInput = ct === "connector.db.duckdb" || ct === "core.duckdb.source";
  const isDuckDbOutput = ct === "connector.db.duckdb.output" || ct === "core.duckdb.target";
  const isTMap = ct === "core.tmap" || ct === "transform.tmap";
  const isFilter = ct.includes("filter");
  const isSelect = ct.includes("select");
  const isJoin = ct.includes("join");
  const isFileTarget = ct.includes("file.target");
  const isDbConnector =
    ct.includes("connector.db") || ct.includes("connector.cloud") || ct.includes("connector.api");
  const isDbTarget =
    ct.includes(".output") || ct === "core.database.target" || isDuckDbOutput;

  return (
    <>
      <div className="sidebar-properties" id="property-panel">
        {/* Header */}
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
                title="Abrir em janela flutuante"
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

        {/* Tabs */}
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
            {schema.length > 0 && <span className="prop-tab-badge">{schema.length}</span>}
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
                placeholder="Ex: Consultas de Clientes"
                onChange={(v) => onUpdateLabel?.(id, v)}
              />
            </div>

            {/* Editable Node ID (TASK-036) */}
            <div className="form-group">
              <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>ID do Nó (Node ID)</span>
                {!isRenamingId ? (
                  <span
                    style={{ color: "var(--accent-cyan)", cursor: "pointer", fontSize: "0.68rem" }}
                    onClick={() => setIsRenamingId(true)}
                  >
                    ✏️ Editar ID
                  </span>
                ) : (
                  <span
                    style={{ color: "var(--status-success)", cursor: "pointer", fontSize: "0.68rem" }}
                    onClick={handleApplyNodeId}
                  >
                    <Check size={11} /> Salvar
                  </span>
                )}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="form-input"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
                  value={editingNodeId}
                  disabled={!isRenamingId}
                  onChange={(e) => setEditingNodeId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyNodeId()}
                />
                {isRenamingId && (
                  <button className="btn btn-secondary btn-xs" onClick={handleApplyNodeId}>
                    OK
                  </button>
                )}
              </div>
            </div>

            {/* Type */}
            <div className="form-group">
              <label className="form-label">Tipo de Componente</label>
              <div
                style={{
                  fontSize: "0.72rem",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-card)",
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {ct}
              </div>
            </div>

            {/* ─── Upstream Suggestion Chips for Iteration (TASK-030) ─── */}
            {upstreamNodes.length > 0 && (
              <div className="form-group upstream-chips-group">
                <label className="form-label" style={{ color: "var(--accent-cyan)", fontSize: "0.72rem" }}>
                  ⚡ Colunas de Nós a Montante (Iteração Presumida)
                </label>
                <div className="upstream-chips-list">
                  {upstreamNodes.map((un) => {
                    const unSchema: SchemaColumn[] = (un.data as any).schema || [];
                    return (
                      <div key={un.id} style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: 2 }}>
                          {un.data.label || un.id} ({un.id}):
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {unSchema.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              className="token-chip"
                              title={`Clique para inserir {${un.id}.${c.name}} na query`}
                              onClick={() => {
                                const token = `{${un.id}.${c.name}}`;
                                handleChange("query", (config.query ?? "") + " " + token);
                              }}
                            >
                              <code>{`{${un.id}.${c.name}}`}</code>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ─── Data Mapper Studio Transform ─── */}
            {isTMap && (
              <div className="form-group">
                <label className="form-label">
                  <GitMerge size={12} color="var(--accent-purple)" /> Data Mapper Studio
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: "100%", padding: "8px 12px" }}
                  onClick={() => setShowTMapModal(true)}
                >
                  <GitMerge size={14} /> Abrir Data Mapper Studio
                </button>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 6 }}>
                  Lookups configurados: {(config.lookups || []).length} | Saídas: {(config.outputs || []).length}
                </div>
              </div>
            )}

            {/* ─── DuckDB Input Dedicated (TASK-033) ─── */}
            {isDuckDbInput && (
              <>
                <div className="form-group">
                  <label className="form-label">Arquivo de Banco DuckDB (.duckdb ou :memory:)</label>
                  <DebouncedInput
                    value={config.database_path ?? ":memory:"}
                    placeholder=":memory: ou data/meu_banco.duckdb"
                    onChange={(v) => handleChange("database_path", v)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Query SQL DuckDB</label>
                  <DebouncedTextarea
                    value={config.query ?? ""}
                    placeholder={"SELECT * FROM read_parquet('data/sales.parquet')\nWHERE valor > 100"}
                    style={{ minHeight: 90, fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}
                    onChange={(v) => handleChange("query", v)}
                  />
                </div>
              </>
            )}

            {/* ─── DuckDB Output Dedicated (TASK-033 & TASK-034) ─── */}
            {isDuckDbOutput && (
              <>
                <div className="form-group">
                  <label className="form-label">Arquivo de Banco DuckDB Destino</label>
                  <DebouncedInput
                    value={config.database_path ?? "data/output.duckdb"}
                    placeholder="data/output.duckdb"
                    onChange={(v) => handleChange("database_path", v)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tabela de Destino</label>
                  <DebouncedInput
                    value={config.table ?? ""}
                    placeholder="nome_da_tabela"
                    onChange={(v) => handleChange("table", v)}
                  />
                </div>
                <TableActionsSection config={config} onChange={handleChange} />
              </>
            )}

            {/* ─── File Source with In-Memory DuckDB View (TASK-033) ── */}
            {isFileSource && (
              <>
                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label className="form-label" style={{ margin: 0 }}>Caminho do Arquivo</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="badge"
                        style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(0,229,255,0.08)", borderColor: "rgba(0,229,255,0.3)" }}
                        onClick={() => handleChange("path", "data/users.csv")}
                        title="Usar arquivo de exemplo users.csv"
                      >
                        users.csv
                      </button>
                      <button
                        type="button"
                        className="badge"
                        style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(0,229,255,0.08)", borderColor: "rgba(0,229,255,0.3)" }}
                        onClick={() => handleChange("path", "data/samples/customers.csv")}
                        title="Usar arquivo de exemplo customers.csv"
                      >
                        customers.csv
                      </button>
                    </div>
                  </div>
                  <DebouncedInput
                    value={config.path ?? ""}
                    placeholder="data/users.csv"
                    onChange={(v) => handleChange("path", v)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: 6, width: "100%", justifyContent: "center", fontSize: "0.78rem" }}
                    onClick={handleDirectInfer}
                    disabled={inferringDirect}
                  >
                    {inferringDirect ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
                    {inferringDirect ? "Inspecionando arquivo..." : "🔍 Inferir Schema deste Arquivo"}
                  </button>
                  {directInferMessage && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: "6px 8px",
                        borderRadius: 6,
                        fontSize: "0.72rem",
                        background: directInferMessage.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(244,63,94,0.15)",
                        color: directInferMessage.type === "success" ? "var(--status-success)" : "#fca5a5",
                        border: `1px solid ${directInferMessage.type === "success" ? "var(--status-success)" : "var(--status-danger)"}`
                      }}
                    >
                      {directInferMessage.text}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Formato</label>
                  <select
                    className="form-select"
                    value={config.format ?? "csv"}
                    onChange={(e) => handleChange("format", e.target.value)}
                  >
                    <option value="csv">CSV / Delimitado</option>
                    <option value="parquet">Apache Parquet</option>
                    <option value="json">JSON / NDJSON</option>
                    <option value="excel">Excel (XLSX)</option>
                  </select>
                </div>

                {/* Opção DuckDB in-memory */}
                <div className="form-group" style={{ background: "var(--bg-card)", padding: 10, borderRadius: 6 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(config.enable_duckdb_view)}
                      onChange={(e) => handleChange("enable_duckdb_view", e.target.checked)}
                    />
                    <span>⚡ Tratar como Tabela DuckDB em Memória</span>
                  </label>
                  {config.enable_duckdb_view && (
                    <div style={{ marginTop: 8 }}>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>
                        Query SQL de Leitura (Tabela: <code>source_data</code>)
                      </label>
                      <DebouncedTextarea
                        value={config.duckdb_query ?? ""}
                        placeholder="SELECT * FROM source_data WHERE total > 0"
                        style={{ minHeight: 70, fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
                        onChange={(v) => handleChange("duckdb_query", v)}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ─── DB Connectors Sources (PostgreSQL, Oracle, MySQL, etc.) ── */}
            {!isDuckDbInput && isDbConnector && !isDbTarget && (
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
                <div className="form-group">
                  <label className="form-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Query SQL</span>
                  </label>
                  {/* Query bank selector */}
                  {queryBank.length > 0 && (
                    <QuerySelect
                      queryBank={queryBank}
                      connections={connections}
                      connectionRef={config.connection_ref ?? ""}
                      onSelect={(q) => {
                        handleChange("query", q.sql);
                        if (q.schema && q.schema.length > 0) {
                          onUpdateSchema?.(id, q.schema);
                        }
                      }}
                    />
                  )}
                  <DebouncedTextarea
                    value={config.query ?? ""}
                    placeholder={"SELECT *\nFROM tabela\nWHERE ativo = 1"}
                    style={{ minHeight: 90, fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}
                    onChange={(v) => handleChange("query", v)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: 6, width: "100%", justifyContent: "center", fontSize: "0.78rem" }}
                    onClick={handleDirectInfer}
                    disabled={inferringDirect}
                  >
                    {inferringDirect ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
                    {inferringDirect ? "Inspecionando query..." : "🔍 Inferir Schema da Query SQL"}
                  </button>
                  {directInferMessage && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: "6px 8px",
                        borderRadius: 6,
                        fontSize: "0.72rem",
                        background: directInferMessage.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(244,63,94,0.15)",
                        color: directInferMessage.type === "success" ? "var(--status-success)" : "#fca5a5",
                        border: `1px solid ${directInferMessage.type === "success" ? "var(--status-success)" : "var(--status-danger)"}`
                      }}
                    >
                      {directInferMessage.text}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ─── DB Connectors Targets (PostgreSQL Output, etc.) ── */}
            {!isDuckDbOutput && isDbTarget && (
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
                <div className="form-group">
                  <label className="form-label">Tabela de Destino</label>
                  <DebouncedInput
                    value={config.table ?? ""}
                    placeholder="schema.tabela"
                    onChange={(v) => handleChange("table", v)}
                  />
                </div>
                <TableActionsSection config={config} onChange={handleChange} />
              </>
            )}

            {/* ─── File Target ── */}
            {isFileTarget && (
              <>
                <div className="form-group">
                  <label className="form-label">Caminho do Arquivo Destino</label>
                  <DebouncedInput
                    value={config.path ?? ""}
                    placeholder="data/output.parquet"
                    onChange={(v) => handleChange("path", v)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Formato</label>
                  <select
                    className="form-select"
                    value={config.format ?? "parquet"}
                    onChange={(e) => handleChange("format", e.target.value)}
                  >
                    <option value="parquet">Apache Parquet</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
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
              onInferRequest={handleInferSchema}
              canInfer={!upstreamSchema || upstreamSchema.length === 0}
              inferLabel="Inferir Schema Real"
              upstreamSchema={upstreamSchema}
              upstreamNodeLabel={upstreamNodeLabel}
              nodeLabel={data.label || id}
              onOpenModal={() => setShowSchemaModal(true)}
            />
          </div>
        )}
      </div>

      {/* Schema Modal */}
      {showSchemaModal && (
        <SchemaEditorModal
          schema={schema}
          onChange={handleSchemaChange}
          onClose={() => setShowSchemaModal(false)}
          nodeLabel={data.label || id}
          onInferRequest={handleInferSchema}
          canInfer={!upstreamSchema || upstreamSchema.length === 0}
          upstreamSchema={upstreamSchema}
          upstreamNodeLabel={upstreamNodeLabel}
        />
      )}

      {/* tMap Studio Modal */}
      {showTMapModal && (
        <TMapModal
          nodeId={id}
          nodeLabel={data.label || id}
          config={config as TMapConfig}
          mainSchema={(upstreamNodes[0]?.data as any)?.schema || schema || []}
          lookupSchemas={(() => {
            const lkSchemas: Record<string, SchemaColumn[]> = {};
            upstreamNodes.slice(1).forEach((un) => {
              lkSchemas[un.id] = (un.data as any)?.schema || [];
            });
            return lkSchemas;
          })()}
          availableUpstreamNodes={upstreamNodes.map((un) => ({
            id: un.id,
            label: un.data?.label || un.id,
            schema: (un.data as any)?.schema || [],
          }))}
          downstreamNodes={downstreamNodes}
          onSave={(newCfg, targetSchemaUpdates) => {
            onUpdateConfig(id, { ...config, ...newCfg });
            if (targetSchemaUpdates && targetSchemaUpdates.length > 0) {
              targetSchemaUpdates.forEach((up) => {
                onUpdateSchema?.(up.nodeId, up.schema);
              });
            }
          }}
          onClose={() => setShowTMapModal(false)}
        />
      )}
    </>
  );
};
