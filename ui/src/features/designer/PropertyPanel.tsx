import React, { useState, useCallback, useRef, useEffect } from "react";
import { Node } from "reactflow";
import { CanvasNodeData, DatasetProfile, SchemaDriftReport, ColumnProfile } from "../../types";
import { SchemaEditor, SchemaEditorModal } from "./SchemaEditor";
import { ImportSchemaModal } from "./ImportSchemaModal";
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
  FileText,
  Filter,
  BarChart2,
  Plus,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Activity,
  X,
} from "lucide-react";
import { ConnectionEntry, ContextVariable, SchemaColumn, Environment, QueryEntry, QueryDialect, ConnectionType } from "../../store/jobStore";
import { SqlAutocompleteTextarea, AutocompleteSource } from "../../components/common/SqlAutocompleteTextarea";

export interface PropertyPanelProps {
  selectedNode: Node<CanvasNodeData> | null;
  onUpdateConfig: (nodeId: string, newConfig: Record<string, any>) => void;
  onUpdateLabel?: (nodeId: string, newLabel: string) => void;
  onUpdateSchema?: (nodeId: string, schema: SchemaColumn[]) => void;
  onUpdateNodeId?: (oldId: string, newId: string, cellId?: string) => void;
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
  allowedTypes?: ConnectionType[];
  onChange: (val: string) => void;
}> = ({ value, connections, activeEnvironment, allowedTypes, onChange }) => {
  let filtered = activeEnvironment
    ? connections.filter((c) => c.environments && c.environments.includes(activeEnvironment))
    : connections;

  if (allowedTypes && allowedTypes.length > 0) {
    filtered = filtered.filter((c) => allowedTypes.includes(c.type));
  }

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
              {c.scope === "local" ? " [Local]" : " [Global]"}
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
              : `Nenhuma conexão compatível para o ambiente ${activeEnvironment?.toUpperCase()}`}
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
  scylla: "sql",
  cassandra: "sql",
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
      return q.connectionRef.toLowerCase().trim() === connectionRef.toLowerCase().trim();
    }
    return true;
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
                {Array.isArray(q.schema) && q.schema.length > 0 && (
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

// ─── Seção de Ações de Tabela e Dados (Padrão Studio) ────────
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

      {/* Advanced Settings: Batch Mode & Batch Size */}
      <div className="form-group" style={{ background: "var(--bg-card)", padding: 10, borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={config.use_batch_mode !== false}
              onChange={(e) => onChange("use_batch_mode", e.target.checked)}
            />
            <span>📦 Ativar Modo em Lote (Use Batch Mode)</span>
          </label>
        </div>
        {config.use_batch_mode !== false && (
          <div>
            <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
              <span>Tamanho do Lote de Escrita (Batch Size)</span>
              <span style={{ color: "var(--text-muted)" }}>Registros por Commit</span>
            </label>
            <input
              type="number"
              className="form-input"
              style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
              value={config.batch_size ?? 10000}
              placeholder="10000"
              onChange={(e) => onChange("batch_size", parseInt(e.target.value, 10) || 10000)}
            />
            <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 4 }}>
              Agrupa instruções INSERT/UPDATE em lotes de N registros antes do commit no banco para alta performance de rede.
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// ─── Local Schema Drift Calculation Fallback ───────────────────
export function computeLocalSchemaDrift(frozen: SchemaColumn[], current: SchemaColumn[]): SchemaDriftReport {
  const frozenMap = new Map((frozen || []).map((c) => [c.name.toLowerCase().trim(), c]));
  const currentMap = new Map((current || []).map((c) => [c.name.toLowerCase().trim(), c]));

  const added: string[] = [];
  const removed: string[] = [];
  const mismatches: { column: string; frozen_type: string; current_type: string }[] = [];

  for (const [name, col] of currentMap.entries()) {
    if (!frozenMap.has(name)) {
      added.push(col.name);
    } else {
      const fCol = frozenMap.get(name)!;
      if (fCol.type.toLowerCase() !== col.type.toLowerCase()) {
        mismatches.push({
          column: col.name,
          frozen_type: fCol.type,
          current_type: col.type,
        });
      }
    }
  }

  for (const [name, col] of frozenMap.entries()) {
    if (!currentMap.has(name)) {
      removed.push(col.name);
    }
  }

  const hasDrift = added.length > 0 || removed.length > 0 || mismatches.length > 0;
  return {
    has_drift: hasDrift,
    added_columns: added,
    removed_columns: removed,
    type_mismatches: mismatches,
    drift_summary: hasDrift
      ? `${added.length} adicionada(s), ${removed.length} removida(s), ${mismatches.length} tipos alterados`
      : "Sem drift",
  };
}

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
  const [showImportSchemaModal, setShowImportSchemaModal] = useState(false);
  const [showTMapModal, setShowTMapModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "schema" | "documentation">("config");
  const [editingNodeId, setEditingNodeId] = useState<string>("");
  const [isRenamingId, setIsRenamingId] = useState(false);
  const [inferringDirect, setInferringDirect] = useState(false);
  const [directInferMessage, setDirectInferMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Profiling & Schema Drift state (Fase 4 - Spec 004)
  const [isProfiling, setIsProfiling] = useState(false);
  const [profileData, setProfileData] = useState<DatasetProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [showProfilingPanel, setShowProfilingPanel] = useState(false);

  const [isCheckingDrift, setIsCheckingDrift] = useState(false);
  const [driftReport, setDriftReport] = useState<SchemaDriftReport | null>(null);
  const [pendingInferredSchema, setPendingInferredSchema] = useState<SchemaColumn[] | null>(null);
  const [driftStatusMessage, setDriftStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setEditingNodeId(selectedNode.id);
      setIsRenamingId(false);
      setDriftReport(null);
      setPendingInferredSchema(null);
      setDriftStatusMessage(null);
      setProfileData(null);
      setProfileError(null);
      setShowProfilingPanel(false);
    }
  }, [selectedNode?.id]);

  const handleChange = useCallback(
    (key: string, value: any) => {
      if (!selectedNode) return;
      const currentConfig = (allNodes.find((n) => n.id === selectedNode.id) || selectedNode).data.config || {};
      onUpdateConfig(selectedNode.id, { ...currentConfig, [key]: value });
    },
    [selectedNode, allNodes, onUpdateConfig]
  );

  const handleMultipleChange = useCallback(
    (updates: Record<string, any>) => {
      if (!selectedNode) return;
      const currentConfig = (allNodes.find((n) => n.id === selectedNode.id) || selectedNode).data.config || {};
      onUpdateConfig(selectedNode.id, { ...currentConfig, ...updates });
    },
    [selectedNode, allNodes, onUpdateConfig]
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
      onUpdateNodeId?.(selectedNode.id, trimmed, (selectedNode.data as any)?.cellId);
    }
    setIsRenamingId(false);
  };

  const onStartSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const computedW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--props-w")) || 380;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const newW = Math.max(280, Math.min(850, computedW + delta));
      document.documentElement.style.setProperty("--props-w", `${newW}px`);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ─── Busca Colunas a Montante (Upstream) e Fontes para Autocomplete ───
  const selectedNodeId = selectedNode?.id;
  const selectedCellId = (selectedNode?.data as any)?.cellId;

  const scopedEdges = React.useMemo(() => {
    if (!selectedNodeId) return [];
    if (!selectedCellId) return edges;
    // Se o nó pertence a uma canvas-cell específica, filtra apenas arestas cujos nós pertencem à mesma célula
    return edges.filter((e) => {
      if ((e.data as any)?.cellId) {
        return (e.data as any).cellId === selectedCellId;
      }
      const srcNode = allNodes.find((n) => n.id === e.source);
      const tgtNode = allNodes.find((n) => n.id === e.target);
      const srcCell = (srcNode?.data as any)?.cellId;
      const tgtCell = (tgtNode?.data as any)?.cellId;
      return (!srcCell || srcCell === selectedCellId) && (!tgtCell || tgtCell === selectedCellId);
    });
  }, [edges, selectedNodeId, selectedCellId, allNodes]);

  const incomingEdges = React.useMemo(() => {
    if (!selectedNodeId) return [];
    return scopedEdges.filter((e) => e.target === selectedNodeId);
  }, [scopedEdges, selectedNodeId]);

  const upstreamNodes = React.useMemo(() => {
    return incomingEdges
      .map((e) => allNodes.find((n) => n.id === e.source && (!selectedCellId || (n.data as any)?.cellId === selectedCellId)))
      .filter((n): n is Node<CanvasNodeData> => Boolean(n));
  }, [incomingEdges, allNodes, selectedCellId]);

  // ─── Prepara Fontes para Autocomplete (rowX.coluna / {{node.coluna}}) ───
  const autocompleteSources: AutocompleteSource[] = React.useMemo(() => {
    if (!selectedNodeId) return [];
    const list: AutocompleteSource[] = [];
    const addedIds = new Set<string>();

    // 1. Nós upstream diretos (conectados por edge de entrada)
    upstreamNodes.forEach((un) => {
      addedIds.add(un.id);
      const flows = incomingEdges
        .filter((e) => e.source === un.id)
        .map((e) => e.data?.flowName || (typeof e.label === "string" ? e.label : "") || e.id)
        .filter(Boolean);

      const unSchema = ((un.data as any).schema || []) as SchemaColumn[];
      list.push({
        id: un.id,
        label: un.data.label || un.id,
        flowNames: flows,
        isUpstream: true,
        columns: unSchema.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
        })),
      });
    });

    // 2. Todos os demais nós do Job / Célula que possuam schema
    allNodes.forEach((n) => {
      if (n.id === selectedNodeId || addedIds.has(n.id)) return;
      const nSchema = ((n.data as any).schema || []) as SchemaColumn[];
      if (nSchema.length > 0) {
        list.push({
          id: n.id,
          label: n.data.label || n.id,
          flowNames: [],
          isUpstream: false,
          columns: nSchema.map((c) => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
          })),
        });
      }
    });

    return list;
  }, [allNodes, incomingEdges, upstreamNodes, selectedNodeId]);

  if (!selectedNode) {
    return (
      <div className="sidebar-properties" id="property-panel">
        {onPopOut && (
          <div
            className="sidebar-drag-resizer"
            onMouseDown={onStartSidebarResize}
            title="Clique e arraste para redimensionar largura do painel"
          />
        )}
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

  // ─── Inferência e Detecção de Schema Drift (Fase 4 - Spec 004) ───
  const handleInferSchemaCandidate = async (): Promise<SchemaColumn[]> => {
    let pathOrQuery = (config.path || config.query || config.duckdb_query || "").trim();
    if (!pathOrQuery && config.table) {
      const ks = config.keyspace ? `${config.keyspace}.` : "";
      pathOrQuery = `SELECT * FROM ${ks}${config.table}`;
    }
    if (!pathOrQuery) {
      throw new Error("Informe o caminho do arquivo, query SQL/CQL ou tabela antes de inferir.");
    }
    const connEntry = connections.find(
      (c) =>
        c.name.toLowerCase().replace(/\s+/g, "_") === config.connection_ref ||
        c.id === config.connection_ref ||
        c.name.toLowerCase().trim() === String(config.connection_ref || "").toLowerCase().trim()
    );
    const connDetails = connEntry?.config
      ? {
          type: connEntry.type,
          host: connEntry.config.host,
          port: connEntry.config.port,
          database: connEntry.config.database || connEntry.config.keyspace,
          keyspace: config.keyspace || connEntry.config.keyspace,
          username: connEntry.config.username,
          password: connEntry.config.password,
          sslMode: connEntry.config.sslMode,
          consistencyLevel: config.consistency_level || connEntry.config.consistencyLevel || "LOCAL_QUORUM",
          ...connEntry.config,
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
    return mapped;
  };

  const handleCheckDrift = async (inferredCandidate?: SchemaColumn[]) => {
    setIsCheckingDrift(true);
    setDriftStatusMessage(null);
    try {
      let targetInferred = inferredCandidate;
      if (!targetInferred) {
        targetInferred = await handleInferSchemaCandidate();
      }
      if (!targetInferred || targetInferred.length === 0) {
        setDriftStatusMessage("Nenhum dado retornado para comparação.");
        return;
      }

      try {
        const report = await api.detectSchemaDrift(schema, targetInferred);
        setDriftReport(report);
        if (report.has_drift) {
          setPendingInferredSchema(targetInferred);
        } else {
          setPendingInferredSchema(null);
          setDriftStatusMessage("✓ Schema em conformidade — nenhum schema drift detectado.");
          setTimeout(() => setDriftStatusMessage(null), 4000);
        }
      } catch (_apiErr) {
        const localReport = computeLocalSchemaDrift(schema, targetInferred);
        setDriftReport(localReport);
        if (localReport.has_drift) {
          setPendingInferredSchema(targetInferred);
        } else {
          setPendingInferredSchema(null);
          setDriftStatusMessage("✓ Schema em conformidade — nenhum schema drift detectado.");
          setTimeout(() => setDriftStatusMessage(null), 4000);
        }
      }
    } catch (err: any) {
      setDriftStatusMessage(`Erro ao checar drift: ${err.message}`);
    } finally {
      setIsCheckingDrift(false);
    }
  };

  const handleAcceptDriftSchema = () => {
    if (pendingInferredSchema && pendingInferredSchema.length > 0) {
      onUpdateSchema?.(id, pendingInferredSchema);
    }
    setDriftReport(null);
    setPendingInferredSchema(null);
  };

  const handleDismissDrift = () => {
    setDriftReport(null);
    setPendingInferredSchema(null);
  };

  const handleRunProfiling = async () => {
    setIsProfiling(true);
    setProfileError(null);
    try {
      let pathOrQuery = (config.path || config.query || config.duckdb_query || "").trim();
      if (!pathOrQuery && config.table) {
        const ks = config.keyspace ? `${config.keyspace}.` : "";
        pathOrQuery = `SELECT * FROM ${ks}${config.table}`;
      }
      const connEntry = connections.find(
        (c) =>
          c.name.toLowerCase().replace(/\s+/g, "_") === config.connection_ref ||
          c.id === config.connection_ref ||
          c.name.toLowerCase().trim() === String(config.connection_ref || "").toLowerCase().trim()
      );
      const connDetails = connEntry?.config ? { ...connEntry.config, type: connEntry.type } : undefined;
      const res = await api.profileDataset(pathOrQuery, undefined, 1000, ct, connDetails);
      setProfileData(res);
      setShowProfilingPanel(true);
    } catch (err: any) {
      setProfileError(err.message || "Falha ao calcular profiling estatístico.");
      setShowProfilingPanel(true);
    } finally {
      setIsProfiling(false);
    }
  };

  const handleInferSchema = async (): Promise<SchemaColumn[]> => {
    const mapped = await handleInferSchemaCandidate();
    if (schema && schema.length > 0) {
      await handleCheckDrift(mapped);
    } else {
      onUpdateSchema?.(id, mapped);
    }
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

  // ─── Nós a Jusante (Downstream) e Metadados Upstream ───
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
  const isFilter = ct.includes("filter") || ct === "core.filter" || ct === "tFilterRow";
  const isAggregate = ct.includes("aggregate") || ct === "core.aggregate" || ct === "tAggregateRow";
  const isSelect = ct.includes("select");
  const isJoin = ct.includes("join");
  const isFileTarget = ct.includes("file.target");
  const isScyllaInput = ct === "connector.nosql.scylla" || (ct.includes("scylla") && !ct.includes(".output"));
  const isScyllaOutput = ct === "connector.nosql.scylla.output" || (ct.includes("scylla") && ct.includes(".output"));
  const isDbConnector =
    ct.includes("connector.db") ||
    ct.includes("core.database") ||
    ct.includes("database.source") ||
    ct.includes("connector.cloud") ||
    ct.includes("connector.api");
  const isDbTarget =
    (ct.includes(".output") && !isScyllaOutput) || ct === "core.database.target" || isDuckDbOutput;

  return (
    <>
      <div className="sidebar-properties" id="property-panel">
        {onPopOut && (
          <div
            className="sidebar-drag-resizer"
            onMouseDown={onStartSidebarResize}
            title="Clique e arraste para redimensionar largura do painel"
          />
        )}
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

        {isTMap ? (
          <div style={{ padding: "20px 16px", textAlign: "center" }}>
            <div
              style={{
                background: "rgba(13, 16, 31, 0.85)",
                border: "1px solid rgba(0, 212, 255, 0.3)",
                borderRadius: 10,
                padding: "24px 16px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "rgba(0, 212, 255, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(0, 212, 255, 0.4)",
                }}
              >
                <GitMerge size={24} color="var(--accent-cyan)" />
              </div>
              <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--text-primary)" }}>Data Mapper Studio</h3>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5, maxWidth: 280 }}>
                A identificação de schemas, conexões de entrada/saída, expressões e mapeamento de colunas é gerenciada 100% no <strong>Data Mapper Studio</strong>.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: "100%", padding: "10px 16px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}
                onClick={() => setShowTMapModal(true)}
              >
                <GitMerge size={15} /> Abrir Data Mapper Studio
              </button>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 4 }}>
                Entradas conectadas: {upstreamNodes.length} | Saídas: {downstreamNodes.length}
              </div>
            </div>
          </div>
        ) : (
          <>
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
          <button
            className={`prop-tab ${activeTab === "documentation" ? "active" : ""}`}
            onClick={() => setActiveTab("documentation")}
          >
            Documentação
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
                              title={`Clique para inserir {{${un.id}.${c.name}}} na query`}
                              onClick={() => {
                                const token = `{{${un.id}.${c.name}}}`;
                                handleChange("query", (config.query ?? "") + " " + token);
                              }}
                            >
                              <code>{`{{${un.id}.${c.name}}}`}</code>
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

            {/* ─── tFilterRow (Declarative Filter) ─── */}
            {isFilter && (
              <div
                className="form-group"
                style={{
                  background: "rgba(59, 130, 246, 0.05)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#3b82f6", fontWeight: 600, fontSize: "0.78rem" }}>
                    <Filter size={14} color="#3b82f6" />
                    <span>Regras do Filtro (tFilterRow)</span>
                  </div>
                  <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                    Portas: <b style={{ color: "var(--status-success)" }}>output</b> / <b style={{ color: "#ef4444" }}>reject</b>
                  </span>
                </div>

                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label" style={{ fontSize: "0.7rem" }}>Combinação Lógica dos Predicados</label>
                  <select
                    className="form-select"
                    style={{ fontSize: "0.75rem" }}
                    value={config.logical_operator ?? "AND"}
                    onChange={(e) => handleChange("logical_operator", e.target.value)}
                  >
                    <option value="AND">AND (Todas as condições devem ser satisfeitas)</option>
                    <option value="OR">OR (Pelo menos uma condição deve ser satisfeita)</option>
                  </select>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
                    <span>Predicados Declarativos</span>
                    <span>{(config.conditions || []).length} regra(s)</span>
                  </label>
                  
                  {((config.conditions || []) as Array<{ column: string; operator: string; value: any }>).map((cond, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        gap: 6,
                        marginBottom: 6,
                        alignItems: "center",
                        background: "var(--bg-card)",
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <input
                        className="form-input"
                        placeholder="Coluna"
                        style={{ flex: 1.2, fontSize: "0.72rem", padding: "4px 6px" }}
                        value={cond.column || ""}
                        onChange={(e) => {
                          const next = [...(config.conditions || [])];
                          next[idx] = { ...cond, column: e.target.value };
                          handleChange("conditions", next);
                        }}
                      />
                      <select
                        className="form-select"
                        style={{ flex: 1, fontSize: "0.72rem", padding: "4px 6px" }}
                        value={cond.operator || "=="}
                        onChange={(e) => {
                          const next = [...(config.conditions || [])];
                          next[idx] = { ...cond, operator: e.target.value };
                          handleChange("conditions", next);
                        }}
                      >
                        <option value="==">== (Igual)</option>
                        <option value="!=">!= (Diferente)</option>
                        <option value=">">&gt; (Maior)</option>
                        <option value="<">&lt; (Menor)</option>
                        <option value=">=">&gt;= (Maior ou Igual)</option>
                        <option value="<=">&lt;= (Menor ou Igual)</option>
                        <option value="LIKE">LIKE (Padrão %)</option>
                        <option value="NOT LIKE">NOT LIKE</option>
                        <option value="IN">IN (Lista)</option>
                        <option value="NOT IN">NOT IN</option>
                        <option value="IS NULL">IS NULL</option>
                        <option value="IS NOT NULL">IS NOT NULL</option>
                      </select>
                      {!["IS NULL", "IS NOT NULL"].includes(cond.operator) && (
                        <input
                          className="form-input"
                          placeholder="Valor"
                          style={{ flex: 1.2, fontSize: "0.72rem", padding: "4px 6px" }}
                          value={cond.value !== undefined ? String(cond.value) : ""}
                          onChange={(e) => {
                            const next = [...(config.conditions || [])];
                            next[idx] = { ...cond, value: e.target.value };
                            handleChange("conditions", next);
                          }}
                        />
                      )}
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        style={{ padding: "4px 6px" }}
                        title="Remover predicado"
                        onClick={() => {
                          const next = (config.conditions || []).filter((_: any, i: number) => i !== idx);
                          handleChange("conditions", next);
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
                    onClick={() => {
                      const next = [...(config.conditions || []), { column: "", operator: "==", value: "" }];
                      handleChange("conditions", next);
                    }}
                  >
                    <Plus size={12} /> Adicionar Condição
                  </button>
                </div>

                <div style={{ marginTop: 10, borderTop: "1px dashed rgba(59, 130, 246, 0.2)", paddingTop: 8 }}>
                  <label className="form-label" style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                    Expressão Livre SQL / Polars (Opcional)
                  </label>
                  <DebouncedInput
                    value={config.expression ?? ""}
                    placeholder="Ex: status == 'ACTIVE' and age >= 18"
                    onChange={(v) => handleChange("expression", v)}
                  />
                </div>
              </div>
            )}

            {/* ─── tAggregateRow (Declarative Aggregate) ─── */}
            {isAggregate && (
              <div
                className="form-group"
                style={{
                  background: "rgba(6, 182, 212, 0.05)",
                  border: "1px solid rgba(6, 182, 212, 0.25)",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#06b6d4", fontWeight: 600, fontSize: "0.78rem" }}>
                    <BarChart2 size={14} color="#06b6d4" />
                    <span>Agrupamento & Agregações (tAggregateRow)</span>
                  </div>
                </div>

                {/* Chaves de Agrupamento */}
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
                    <span>Chaves de Agrupamento (GROUP BY)</span>
                    <span>{(config.group_by || []).length} chave(s)</span>
                  </label>
                  
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                    {((config.group_by || []) as string[]).map((col, idx) => (
                      <span
                        key={idx}
                        style={{
                          background: "rgba(6, 182, 212, 0.15)",
                          border: "1px solid rgba(6, 182, 212, 0.4)",
                          color: "var(--text-primary)",
                          borderRadius: 4,
                          fontSize: "0.72rem",
                          padding: "2px 6px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <code>{col}</code>
                        <span
                          style={{ cursor: "pointer", color: "var(--text-muted)", marginLeft: 2 }}
                          onClick={() => {
                            const next = (config.group_by || []).filter((_: any, i: number) => i !== idx);
                            handleChange("group_by", next);
                          }}
                        >
                          ✕
                        </span>
                      </span>
                    ))}
                    {(!config.group_by || config.group_by.length === 0) && (
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                        Agregação global (sem GROUP BY)
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      id="input-new-groupby-col"
                      className="form-input"
                      placeholder="Nome da coluna (ex: departamento)"
                      style={{ flex: 1, fontSize: "0.72rem" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const val = (e.currentTarget.value || "").trim();
                          if (val && !(config.group_by || []).includes(val)) {
                            handleChange("group_by", [...(config.group_by || []), val]);
                            e.currentTarget.value = "";
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => {
                        const el = document.getElementById("input-new-groupby-col") as HTMLInputElement;
                        if (el) {
                          const val = (el.value || "").trim();
                          if (val && !(config.group_by || []).includes(val)) {
                            handleChange("group_by", [...(config.group_by || []), val]);
                            el.value = "";
                          }
                        }
                      }}
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {/* Lista de Operações de Agregação */}
                <div style={{ marginBottom: 8 }}>
                  <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
                    <span>Operações de Agregação</span>
                    <span>{(config.aggregations || []).length} operação(ões)</span>
                  </label>

                  {((config.aggregations || []) as Array<{ column: string; function: string; alias?: string; delimiter?: string }>).map((agg, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        marginBottom: 6,
                        background: "var(--bg-card)",
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <select
                          className="form-select"
                          style={{ flex: 1.1, fontSize: "0.72rem", padding: "4px 6px" }}
                          value={agg.function || "COUNT"}
                          onChange={(e) => {
                            const next = [...(config.aggregations || [])];
                            next[idx] = { ...agg, function: e.target.value };
                            handleChange("aggregations", next);
                          }}
                        >
                          <option value="COUNT">COUNT</option>
                          <option value="COUNT_DISTINCT">COUNT DISTINCT</option>
                          <option value="SUM">SUM</option>
                          <option value="AVG">AVG</option>
                          <option value="MIN">MIN</option>
                          <option value="MAX">MAX</option>
                          <option value="FIRST">FIRST</option>
                          <option value="LAST">LAST</option>
                          <option value="STRING_AGG">STRING_AGG</option>
                        </select>
                        <input
                          className="form-input"
                          placeholder="Coluna (* ou nome)"
                          style={{ flex: 1.1, fontSize: "0.72rem", padding: "4px 6px" }}
                          value={agg.column || ""}
                          onChange={(e) => {
                            const next = [...(config.aggregations || [])];
                            next[idx] = { ...agg, column: e.target.value };
                            handleChange("aggregations", next);
                          }}
                        />
                        <input
                          className="form-input"
                          placeholder="Alias Saída"
                          style={{ flex: 1.2, fontSize: "0.72rem", padding: "4px 6px" }}
                          value={agg.alias || ""}
                          onChange={(e) => {
                            const next = [...(config.aggregations || [])];
                            next[idx] = { ...agg, alias: e.target.value };
                            handleChange("aggregations", next);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          style={{ padding: "4px 6px" }}
                          title="Remover operação"
                          onClick={() => {
                            const next = (config.aggregations || []).filter((_: any, i: number) => i !== idx);
                            handleChange("aggregations", next);
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>

                      {agg.function === "STRING_AGG" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Delimitador:</span>
                          <input
                            className="form-input"
                            style={{ width: 80, fontSize: "0.72rem", padding: "2px 6px" }}
                            value={agg.delimiter ?? ", "}
                            onChange={(e) => {
                              const next = [...(config.aggregations || [])];
                              next[idx] = { ...agg, delimiter: e.target.value };
                              handleChange("aggregations", next);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
                    onClick={() => {
                      const next = [
                        ...(config.aggregations || []),
                        { column: "*", function: "COUNT", alias: "" }
                      ];
                      handleChange("aggregations", next);
                    }}
                  >
                    <Plus size={12} /> Adicionar Agregação
                  </button>
                </div>
              </div>
            )}

            {/* ─── DuckDB Input Dedicated (TASK-033) ─── */}
            {isDuckDbInput && (
              <>
                {connections.some((c) => c.type === "duckdb") && (
                  <div className="form-group">
                    <label className="form-label">
                      <Database size={12} /> Conexão DuckDB Cadastrada (Opcional)
                    </label>
                    <ConnectionSelect
                      value={config.connection_ref ?? ""}
                      connections={connections}
                      activeEnvironment={activeEnvironment}
                      allowedTypes={["duckdb"]}
                      onChange={(v) => {
                        const conn = connections.find(
                          (c) =>
                            c.name.toLowerCase().replace(/\s+/g, "_") === v ||
                            c.id === v
                        );
                        if (conn) {
                          handleChange("connection_ref", v);
                          const dbPath = conn.config?.database_path || conn.config?.database;
                          if (dbPath) {
                            handleChange("database_path", dbPath);
                          }
                        } else {
                          handleChange("connection_ref", "");
                        }
                      }}
                    />
                  </div>
                )}
                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label className="form-label" style={{ margin: 0 }}>Arquivo de Banco DuckDB (.duckdb ou :memory:)</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="badge"
                        style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(234, 179, 8, 0.12)", borderColor: "rgba(234, 179, 8, 0.4)", color: "#facc15" }}
                        onClick={() => handleChange("database_path", ":memory:")}
                        title="Usar em memória RAM"
                      >
                        :memory:
                      </button>
                    </div>
                  </div>
                  <DebouncedInput
                    value={config.database_path ?? ":memory:"}
                    placeholder=":memory: ou data/meu_banco.duckdb"
                    onChange={(v) => handleChange("database_path", v)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Query SQL DuckDB</label>
                  <SqlAutocompleteTextarea
                    value={config.query ?? ""}
                    placeholder={"SELECT * FROM read_parquet('data/sales.parquet')\nWHERE valor > 100"}
                    style={{ minHeight: 90 }}
                    sources={autocompleteSources}
                    contextVariables={contextVariables}
                    onChange={(v) => handleChange("query", v)}
                  />
                </div>
                <div className="form-group" style={{ background: "var(--bg-card)", padding: 10, borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
                  <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
                    <span>⚡ Tamanho do Lote de Leitura (Fetch Size)</span>
                    <span style={{ color: "var(--text-muted)" }}>Linhas por Lote</span>
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                    value={config.fetch_size ?? 10000}
                    placeholder="10000"
                    onChange={(e) => handleChange("fetch_size", parseInt(e.target.value, 10) || 10000)}
                  />
                  <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 4 }}>
                    Recupera dados em blocos paginados de N linhas para prevenir estouro de memória RAM.
                  </div>
                </div>
              </>
            )}

            {/* ─── DuckDB Output Dedicated (TASK-033 & TASK-034) ─── */}
            {isDuckDbOutput && (
              <>
                {connections.some((c) => c.type === "duckdb") && (
                  <div className="form-group">
                    <label className="form-label">
                      <Database size={12} /> Conexão DuckDB Cadastrada (Opcional)
                    </label>
                    <ConnectionSelect
                      value={config.connection_ref ?? ""}
                      connections={connections}
                      activeEnvironment={activeEnvironment}
                      allowedTypes={["duckdb"]}
                      onChange={(v) => {
                        const conn = connections.find(
                          (c) =>
                            c.name.toLowerCase().replace(/\s+/g, "_") === v ||
                            c.id === v
                        );
                        if (conn) {
                          handleChange("connection_ref", v);
                          const dbPath = conn.config?.database_path || conn.config?.database;
                          if (dbPath) {
                            handleChange("database_path", dbPath);
                          }
                        } else {
                          handleChange("connection_ref", "");
                        }
                      }}
                    />
                  </div>
                )}
                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label className="form-label" style={{ margin: 0 }}>Caminho / Nome do Banco (.duckdb)</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="badge"
                        style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(234, 179, 8, 0.12)", borderColor: "rgba(234, 179, 8, 0.4)", color: "#facc15" }}
                        onClick={() => {
                          handleChange("database_path", ":memory:");
                          handleChange("database", ":memory:");
                        }}
                        title="Gravar puramente em memória RAM"
                      >
                        :memory:
                      </button>
                      <button
                        type="button"
                        className="badge"
                        style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(234, 179, 8, 0.12)", borderColor: "rgba(234, 179, 8, 0.4)", color: "#facc15" }}
                        onClick={() => {
                          handleChange("database_path", "data/output.duckdb");
                          handleChange("database", "data/output.duckdb");
                        }}
                        title="Usar data/output.duckdb"
                      >
                        output.duckdb
                      </button>
                    </div>
                  </div>
                  <DebouncedInput
                    value={config.database_path ?? config.database ?? "data/output.duckdb"}
                    placeholder="data/vendas.duckdb ou vendas.duckdb"
                    onChange={(v) => {
                      handleChange("database_path", v);
                      handleChange("database", v);
                    }}
                  />
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 4 }}>
                    📁 Salvo na pasta <code>data/</code> do workspace ativo. Você pode alterar o nome do arquivo livremente (ex: <code>vendas.duckdb</code> ou <code>data/faturamento.duckdb</code>).
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Tabela de Destino</label>
                  <DebouncedInput
                    value={config.table ?? config.target ?? ""}
                    placeholder="nome_da_tabela"
                    onChange={(v) => {
                      const trimmed = (v || "").trim();
                      handleMultipleChange({ table: trimmed, target: trimmed });
                    }}
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
                      <SqlAutocompleteTextarea
                        value={config.duckdb_query ?? ""}
                        placeholder="SELECT * FROM source_data WHERE total > 0"
                        style={{ minHeight: 70 }}
                        sources={autocompleteSources}
                        contextVariables={contextVariables}
                        onChange={(v) => handleChange("duckdb_query", v)}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ─── ScyllaDB / Cassandra Input Dedicated ─── */}
            {isScyllaInput && (
              <>
                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label className="form-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, color: "#00e5ff" }}>
                      <Layers size={13} color="#00e5ff" />
                      <span>Conexão ScyllaDB / Cassandra ({activeEnvironment.toUpperCase()})</span>
                    </label>
                  </div>
                  <ConnectionSelect
                    value={config.connection_ref ?? ""}
                    connections={connections}
                    activeEnvironment={activeEnvironment}
                    allowedTypes={["scylla", "cassandra"]}
                    onChange={(v) => {
                      handleChange("connection_ref", v);
                      const conn = connections.find(
                        (c) =>
                          c.name.toLowerCase().replace(/\s+/g, "_") === v ||
                          c.id === v ||
                          c.name.toLowerCase().trim() === v.toLowerCase().trim()
                      );
                      if (conn?.config?.keyspace && !config.keyspace) {
                        handleChange("keyspace", conn.config.keyspace);
                      }
                    }}
                  />
                </div>

                <div className="conn-form-row" style={{ display: "flex", gap: 8 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Keyspace (Opcional)</label>
                    <DebouncedInput
                      value={config.keyspace ?? ""}
                      placeholder="analytics"
                      onChange={(v) => handleChange("keyspace", v)}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Tabela (Opcional)</label>
                    <DebouncedInput
                      value={config.table ?? ""}
                      placeholder="usuarios"
                      onChange={(v) => {
                        handleChange("table", v);
                        if (!config.query && v) {
                          const ksPrefix = config.keyspace ? `${config.keyspace}.` : "";
                          handleChange("query", `SELECT * FROM ${ksPrefix}${v}`);
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label className="form-label" style={{ margin: 0 }}>Consulta CQL</label>
                    {config.table && (
                      <button
                        type="button"
                        className="badge"
                        style={{ cursor: "pointer", fontSize: "0.68rem", background: "rgba(0, 229, 255, 0.12)", borderColor: "rgba(0, 229, 255, 0.4)", color: "#00e5ff" }}
                        onClick={() => {
                          const ksPrefix = config.keyspace ? `${config.keyspace}.` : "";
                          handleChange("query", `SELECT * FROM ${ksPrefix}${config.table}`);
                        }}
                        title="Gerar SELECT * padrão"
                      >
                        Auto SELECT
                      </button>
                    )}
                  </div>

                  {/* Query bank selector */}
                  {queryBank.length > 0 && (
                    <QuerySelect
                      queryBank={queryBank}
                      connections={connections}
                      connectionRef={config.connection_ref ?? ""}
                      onSelect={(q) => {
                        const currentCfg = (allNodes.find((n) => n.id === id) || liveNode).data.config || {};
                        onUpdateConfig(id, {
                          ...currentCfg,
                          query: q.sql,
                          ...(q.connectionRef ? { connection_ref: q.connectionRef } : {}),
                        });
                        if (q.schema && q.schema.length > 0) {
                          onUpdateSchema?.(id, q.schema);
                        }
                      }}
                    />
                  )}

                  <SqlAutocompleteTextarea
                    value={config.query ?? ""}
                    placeholder={"SELECT id, nome, email, valor\nFROM analytics.usuarios\nWHERE ativo = true"}
                    style={{ minHeight: 110 }}
                    sources={autocompleteSources}
                    contextVariables={contextVariables}
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
                    {inferringDirect ? "Inspecionando metadata Scylla..." : "🔍 Inferir Schema da Query CQL"}
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

                {/* Bloco de Performance e Paralelismo ScyllaDB */}
                <div className="form-group" style={{ background: "rgba(0, 229, 255, 0.04)", padding: 12, borderRadius: 8, border: "1px solid rgba(0, 229, 255, 0.2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#00e5ff", fontWeight: 600, fontSize: "0.76rem" }}>
                    <Zap size={14} color="#00e5ff" />
                    <span>⚡ Performance & Paralelismo Distribuído ScyllaDB</span>
                  </div>

                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
                      <span>Tamanho da Página CQL (Fetch Size)</span>
                      <span style={{ color: "var(--text-muted)" }}>Linhas por Lote</span>
                    </label>
                    <input
                      type="number"
                      className="form-input"
                      style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                      value={config.fetch_size ?? 5000}
                      placeholder="5000"
                      onChange={(e) => handleChange("fetch_size", parseInt(e.target.value, 10) || 5000)}
                    />
                    <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 2 }}>
                      Paginação do cursor CQL para prevenir estouro de memória RAM.
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label className="form-label" style={{ fontSize: "0.7rem" }}>Nível de Consistência (Consistency Level)</label>
                    <select
                      className="form-select"
                      style={{ fontSize: "0.75rem" }}
                      value={config.consistency_level ?? "LOCAL_QUORUM"}
                      onChange={(e) => handleChange("consistency_level", e.target.value)}
                    >
                      <option value="LOCAL_QUORUM">LOCAL_QUORUM (Recomendado - Quorum no Datacenter Local)</option>
                      <option value="QUORUM">QUORUM (Maioria Absoluta de Réplicas)</option>
                      <option value="ONE">ONE (Máxima Velocidade - 1 Réplica)</option>
                      <option value="LOCAL_ONE">LOCAL_ONE (1 Réplica no Datacenter Local)</option>
                      <option value="ALL">ALL (Forte Consistência - Todas as Réplicas)</option>
                    </select>
                  </div>

                  <div className="conn-form-row" style={{ display: "flex", gap: 8 }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Varredura Paralela (Token Scans)</label>
                      <input
                        type="number"
                        className="form-input"
                        min="1"
                        max="16"
                        style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                        value={config.parallel_scans ?? 1}
                        placeholder="1"
                        onChange={(e) => handleChange("parallel_scans", Math.min(16, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Timeout (Segundos)</label>
                      <input
                        type="number"
                        className="form-input"
                        min="5"
                        style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                        value={config.timeout_seconds ?? 30}
                        placeholder="30"
                        onChange={(e) => handleChange("timeout_seconds", parseInt(e.target.value, 10) || 30)}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 4 }}>
                    💡 Se <code>Token Scans &gt; 1</code>, a tabela é particionada em faixas de token e escaneada em paralelo entre múltiplos shards.
                  </div>
                </div>
              </>
            )}

            {/* ─── ScyllaDB / Cassandra Output Dedicated ─── */}
            {isScyllaOutput && (
              <>
                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label className="form-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, color: "#00e5ff" }}>
                      <Layers size={13} color="#00e5ff" />
                      <span>Conexão ScyllaDB Destino ({activeEnvironment.toUpperCase()})</span>
                    </label>
                  </div>
                  <ConnectionSelect
                    value={config.connection_ref ?? ""}
                    connections={connections}
                    activeEnvironment={activeEnvironment}
                    allowedTypes={["scylla", "cassandra"]}
                    onChange={(v) => {
                      handleChange("connection_ref", v);
                      const conn = connections.find(
                        (c) =>
                          c.name.toLowerCase().replace(/\s+/g, "_") === v ||
                          c.id === v ||
                          c.name.toLowerCase().trim() === v.toLowerCase().trim()
                      );
                      if (conn?.config?.keyspace && !config.keyspace) {
                        handleChange("keyspace", conn.config.keyspace);
                      }
                    }}
                  />
                </div>

                <div className="conn-form-row" style={{ display: "flex", gap: 8 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Keyspace</label>
                    <DebouncedInput
                      value={config.keyspace ?? ""}
                      placeholder="analytics"
                      onChange={(v) => handleChange("keyspace", v)}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Tabela de Destino</label>
                    <DebouncedInput
                      value={config.table ?? config.target ?? ""}
                      placeholder="usuarios_gold"
                      onChange={(v) => {
                        const trimmed = (v || "").trim();
                        handleMultipleChange({ table: trimmed, target: trimmed });
                      }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Ação na Tabela (Table Action)</label>
                  <select
                    className="form-select"
                    value={config.table_action ?? "append"}
                    onChange={(e) => handleChange("table_action", e.target.value)}
                  >
                    <option value="append">Nenhuma (Inserir / Preservar registros existentes)</option>
                    <option value="truncate">TRUNCATE (Limpar tabela antes de gravar)</option>
                  </select>
                </div>

                {/* Bloco de Performance e Concorrência de Escrita ScyllaDB */}
                <div className="form-group" style={{ background: "rgba(0, 229, 255, 0.04)", padding: 12, borderRadius: 8, border: "1px solid rgba(0, 229, 255, 0.2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#00e5ff", fontWeight: 600, fontSize: "0.76rem" }}>
                    <Zap size={14} color="#00e5ff" />
                    <span>⚡ Motor de Ingestão de Alta Vazão ScyllaDB</span>
                  </div>

                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label className="form-label" style={{ fontSize: "0.7rem" }}>Estratégia de Escrita (Write Strategy)</label>
                    <select
                      className="form-select"
                      style={{ fontSize: "0.75rem" }}
                      value={config.write_strategy ?? "concurrent"}
                      onChange={(e) => handleChange("write_strategy", e.target.value)}
                    >
                      <option value="concurrent">Prepared Statements Concorrentes (Recomendado Scylla - Shard-Aware)</option>
                      <option value="unlogged_batch">Unlogged Batch (Alta velocidade em lote atômico)</option>
                      <option value="logged_batch">Logged Batch (Transacional)</option>
                    </select>
                    <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 2 }}>
                      O modo concorrente utiliza roteamento shard-aware direcionando cada registro direto ao core/CPU responsável no Scylla.
                    </div>
                  </div>

                  <div className="conn-form-row" style={{ display: "flex", gap: 8 }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 8 }}>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Concorrência (In-Flight Requests)</label>
                      <input
                        type="number"
                        className="form-input"
                        min="10"
                        max="250"
                        style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                        value={config.concurrency ?? 100}
                        placeholder="100"
                        onChange={(e) => handleChange("concurrency", parseInt(e.target.value, 10) || 100)}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 8 }}>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Tamanho do Lote (Batch Size)</label>
                      <input
                        type="number"
                        className="form-input"
                        style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                        value={config.batch_size ?? 1000}
                        placeholder="1000"
                        onChange={(e) => handleChange("batch_size", parseInt(e.target.value, 10) || 1000)}
                      />
                    </div>
                  </div>

                  <div className="conn-form-row" style={{ display: "flex", gap: 8 }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Consistência de Escrita</label>
                      <select
                        className="form-select"
                        style={{ fontSize: "0.75rem" }}
                        value={config.consistency_level ?? "LOCAL_QUORUM"}
                        onChange={(e) => handleChange("consistency_level", e.target.value)}
                      >
                        <option value="LOCAL_QUORUM">LOCAL_QUORUM</option>
                        <option value="ONE">ONE (Máxima vazão)</option>
                        <option value="ANY">ANY</option>
                        <option value="QUORUM">QUORUM</option>
                        <option value="ALL">ALL</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: "0.7rem" }}>Timeout (Segundos)</label>
                      <input
                        type="number"
                        className="form-input"
                        min="5"
                        style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                        value={config.timeout_seconds ?? 30}
                        placeholder="30"
                        onChange={(e) => handleChange("timeout_seconds", parseInt(e.target.value, 10) || 30)}
                      />
                    </div>
                  </div>
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
                        const currentCfg = (allNodes.find((n) => n.id === id) || liveNode).data.config || {};
                        onUpdateConfig(id, {
                          ...currentCfg,
                          query: q.sql,
                          ...(q.connectionRef ? { connection_ref: q.connectionRef } : {}),
                        });
                        if (q.schema && q.schema.length > 0) {
                          onUpdateSchema?.(id, q.schema);
                        }
                      }}
                    />
                  )}
                  <SqlAutocompleteTextarea
                    value={config.query ?? ""}
                    placeholder={"SELECT *\nFROM tabela\nWHERE ativo = 1"}
                    style={{ minHeight: 110 }}
                    sources={autocompleteSources}
                    contextVariables={contextVariables}
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
                <div className="form-group" style={{ background: "var(--bg-card)", padding: 10, borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
                  <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
                    <span>⚡ Tamanho do Lote de Leitura (Fetch Size)</span>
                    <span style={{ color: "var(--text-muted)" }}>Cursor do Banco</span>
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                    value={config.fetch_size ?? 10000}
                    placeholder="10000"
                    onChange={(e) => handleChange("fetch_size", parseInt(e.target.value, 10) || 10000)}
                  />
                  <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 4 }}>
                    Define quantas linhas o cursor do banco recupera por vez para a memória (padrão: 10.000).
                  </div>
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
                    value={config.table ?? config.target ?? ""}
                    placeholder="schema.tabela"
                    onChange={(v) => {
                      const trimmed = (v || "").trim();
                      handleMultipleChange({ table: trimmed, target: trimmed });
                    }}
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

            {/* ─── Configurações Avançadas: Throttling, Timers & Resiliência (Tópico 6) ─── */}
            <div style={{ marginTop: 16, borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--accent-cyan)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <Zap size={13} />
                <span>Resiliência & Throttling (Controle Enterprise)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" title="Pausa intencional entre processamento de lotes/chunks em segundos (Sleep)">
                    Sleep Lote (seg)
                  </label>
                  <DebouncedInput
                    value={String(config.batch_delay_seconds ?? 0)}
                    placeholder="0"
                    onChange={(v) => handleChange("batch_delay_seconds", parseFloat(v) || 0)}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" title="Tentativas máximas de execução em caso de falha de rede/banco">
                    Max Retries
                  </label>
                  <DebouncedInput
                    value={String(config.max_retries ?? 0)}
                    placeholder="0"
                    onChange={(v) => handleChange("max_retries", parseInt(v, 10) || 0)}
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label" title="Intervalo de espera entre novas tentativas em segundos">
                  Intervalo Retry (segundos)
                </label>
                <DebouncedInput
                  value={String(config.retry_interval_seconds ?? 5)}
                  placeholder="5"
                  onChange={(v) => handleChange("retry_interval_seconds", parseFloat(v) || 5)}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === "schema" && (
          <div className="prop-content">
            {/* Top Toolbar */}
            <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleRunProfiling()}
                  disabled={isProfiling}
                  title="Calcular estatísticas de nulos, cardinalidade e min/max para este dataset"
                >
                  {isProfiling ? <Loader2 size={12} className="spin" style={{ marginRight: 5 }} /> : <BarChart2 size={12} style={{ marginRight: 5 }} />}
                  Profiling Estatístico
                </button>
                {schema.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleCheckDrift()}
                    disabled={isCheckingDrift}
                    title="Comparar schema atual contra a fonte de dados (Schema Drift)"
                  >
                    {isCheckingDrift ? <Loader2 size={12} className="spin" style={{ marginRight: 5 }} /> : <RefreshCw size={12} style={{ marginRight: 5 }} />}
                    Verificar Drift
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowImportSchemaModal(true)}
                title="Importar schema de outro componente do Job"
              >
                <Layers size={12} style={{ marginRight: 5 }} /> Importar de outro componente
              </button>
            </div>

            {/* Drift Status Notification */}
            {driftStatusMessage && (
              <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "var(--status-success)", fontSize: "0.75rem", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{driftStatusMessage}</span>
              </div>
            )}

            {/* Schema Drift Alert Banner */}
            {driftReport && driftReport.has_drift && (
              <div
                className="schema-drift-alert"
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  borderRadius: 8,
                  padding: "12px",
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--accent-warning, #f59e0b)", fontSize: "0.82rem" }}>
                    <AlertTriangle size={15} />
                    <span>⚠️ Schema Drift Detectado</span>
                    <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 4, background: "rgba(245, 158, 11, 0.2)", border: "1px solid rgba(245, 158, 11, 0.4)" }}>
                      schema_drift = true
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={handleDismissDrift}
                    title="Fechar alerta de drift"
                    style={{ padding: 2 }}
                  >
                    <X size={12} />
                  </button>
                </div>

                <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.4 }}>
                  O schema congelado deste componente difere da estrutura atual da fonte de dados:
                </div>

                {/* Structured Diff Items */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {driftReport.added_columns && driftReport.added_columns.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#22c55e", marginBottom: 3 }}>
                        + Colunas Adicionadas ({driftReport.added_columns.length}):
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {driftReport.added_columns.map((col) => (
                          <span key={col} style={{ fontSize: "0.68rem", padding: "2px 6px", borderRadius: 4, background: "rgba(34, 197, 94, 0.15)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "#22c55e", fontFamily: "var(--font-mono)" }}>
                            +{col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {driftReport.removed_columns && driftReport.removed_columns.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#ef4444", marginBottom: 3 }}>
                        - Colunas Removidas ({driftReport.removed_columns.length}):
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {driftReport.removed_columns.map((col) => (
                          <span key={col} style={{ fontSize: "0.68rem", padding: "2px 6px", borderRadius: 4, background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#ef4444", fontFamily: "var(--font-mono)" }}>
                            -{col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {driftReport.type_mismatches && driftReport.type_mismatches.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#f59e0b", marginBottom: 3 }}>
                        ≠ Tipos Incompatíveis ({driftReport.type_mismatches.length}):
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {driftReport.type_mismatches.map((m) => (
                          <span key={m.column} style={{ fontSize: "0.68rem", padding: "2px 6px", borderRadius: 4, background: "rgba(245, 158, 11, 0.15)", border: "1px solid rgba(245, 158, 11, 0.3)", color: "#f59e0b", fontFamily: "var(--font-mono)" }}>
                            {m.column}: {m.frozen_type} ➔ {m.current_type}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleDismissDrift}
                    style={{ fontSize: "0.72rem" }}
                  >
                    Ignorar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleAcceptDriftSchema}
                    style={{ fontSize: "0.72rem", background: "#22c55e", borderColor: "#22c55e" }}
                  >
                    <Check size={12} style={{ marginRight: 4 }} /> Aceitar Novo Schema (Atualizar)
                  </button>
                </div>
              </div>
            )}

            {/* Statistical Profiling Panel */}
            {showProfilingPanel && (
              <div
                className="data-profiling-panel"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-medium)",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: "0.82rem", color: "var(--accent-cyan)" }}>
                    <Activity size={15} />
                    <span>Profiling Estatístico de Dados</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {profileData && (
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", background: "var(--bg-surface)", padding: "2px 6px", borderRadius: 4 }}>
                        {profileData.row_count} linhas | {profileData.column_count} colunas
                      </span>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setShowProfilingPanel(false)}
                      title="Ocultar painel de profiling"
                      style={{ padding: 2 }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                {profileError && (
                  <div style={{ fontSize: "0.72rem", color: "var(--status-danger)", marginBottom: 8 }}>
                    {profileError}
                  </div>
                )}

                {profileData && profileData.columns && (
                  <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 6 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border-subtle)", color: "var(--text-muted)", textAlign: "left" }}>
                          <th style={{ padding: "6px 8px" }}>Coluna</th>
                          <th style={{ padding: "6px 8px" }}>Tipo</th>
                          <th style={{ padding: "6px 8px" }}>Nulos</th>
                          <th style={{ padding: "6px 8px" }}>Cardinalidade</th>
                          <th style={{ padding: "6px 8px" }}>Mín / Máx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(profileData.columns).map(([colName, col]) => (
                          <tr key={colName} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "5px 8px", fontWeight: 600, fontFamily: "var(--font-mono)" }}>{col.column_name}</td>
                            <td style={{ padding: "5px 8px" }}>
                              <span style={{ fontSize: "0.65rem", padding: "1px 5px", borderRadius: 3, background: "rgba(0, 212, 255, 0.1)", color: "var(--accent-cyan)" }}>
                                {col.inferred_type}
                              </span>
                            </td>
                            <td style={{ padding: "5px 8px" }}>
                              <span style={{ color: col.null_percentage > 0 ? "var(--status-warning, #f59e0b)" : "var(--status-success, #22c55e)" }}>
                                {col.null_count} ({col.null_percentage.toFixed(1)}%)
                              </span>
                            </td>
                            <td style={{ padding: "5px 8px" }}>{col.distinct_count}</td>
                            <td style={{ padding: "5px 8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>
                              {col.min_value !== null && col.min_value !== undefined ? String(col.min_value) : "—"} / {col.max_value !== null && col.max_value !== undefined ? String(col.max_value) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

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

        {activeTab === "documentation" && (
          <div className="prop-content">
            <div className="form-group">
              <label className="form-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>
                  <FileText size={12} style={{ marginRight: 5, verticalAlign: "middle" }} />
                  Notas de Negócio (Markdown)
                </span>
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Docs-as-Code</span>
              </label>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0 0 8px 0" }}>
                Descreva o propósito deste componente, regras de negócio ou transformações aplicadas. Este texto será incluído nos artefatos gerados pelo Auto-Doc (Markdown e HTML).
              </p>
              <DebouncedTextarea
                value={config.documentation_md ?? ""}
                placeholder="# Regras deste componente&#10;&#10;- Fonte: ERP SAP&#10;- Filtra registros ativos&#10;- Transforma chave para maiúsculo"
                style={{ minHeight: "220px", fontFamily: "monospace", fontSize: "0.8rem", lineHeight: "1.4" }}
                onChange={(v) => handleChange("documentation_md", v)}
              />
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* Import Schema Modal */}
      {showImportSchemaModal && (
        <ImportSchemaModal
          isOpen={showImportSchemaModal}
          onClose={() => setShowImportSchemaModal(false)}
          onImport={(imported) => handleSchemaChange(imported)}
          currentSchema={schema}
          excludeNodeId={id}
          title={`Importar Schema para: ${data.label || id}`}
        />
      )}

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
          availableUpstreamNodes={upstreamNodes.map((un, idx) => {
            const edge = incomingEdges.find((e) => e.source === un.id);
            const alias = edge?.data?.flowName || (idx === 0 ? "row1" : `row${idx + 1}`);
            return {
              id: un.id,
              label: un.data?.label || un.id,
              alias: alias,
              schema: (un.data as any)?.schema || [],
            };
          })}
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
