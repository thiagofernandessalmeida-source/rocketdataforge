import React, { useState, useCallback, useMemo } from "react";
import {
  X, Plus, Trash2, Loader2, Wand2, ChevronUp, ChevronDown,
  Key, AlertCircle, Check, Table2, ArrowRight, ArrowLeft,
  ChevronsRight, ChevronsLeft, RefreshCw, Search, ArrowDownToLine,
  ArrowUpFromLine, Layers, HelpCircle, CheckSquare, Square
} from "lucide-react";
import { SchemaColumn, SchemaColumnType } from "../../store/jobStore";

// ─── Types ────────────────────────────────────────────────────

export interface SchemaEditorProps {
  schema: SchemaColumn[];
  onChange: (schema: SchemaColumn[]) => void;
  onInferRequest?: () => Promise<SchemaColumn[]>;
  canInfer?: boolean;
  inferLabel?: string;
  title?: string;
  compact?: boolean;
  upstreamSchema?: SchemaColumn[];
  upstreamNodeLabel?: string;
  nodeLabel?: string;
  onOpenModal?: () => void;
}

const COLUMN_TYPES: SchemaColumnType[] = [
  "String", "Integer", "Long", "Float", "Double", "Decimal",
  "Boolean", "Date", "DateTime", "Timestamp", "Time",
  "Bytes", "JSON", "Array", "Object", "Unknown",
];

const TYPE_COLORS: Record<SchemaColumnType, string> = {
  String: "#4f8ef7",
  Integer: "#22c55e",
  Long: "#22c55e",
  Float: "#f59e0b",
  Double: "#f59e0b",
  Decimal: "#f59e0b",
  Boolean: "#9b72f7",
  Date: "#06b6d4",
  DateTime: "#06b6d4",
  Timestamp: "#06b6d4",
  Time: "#06b6d4",
  Bytes: "#94a3b8",
  JSON: "#ec4899",
  Array: "#ec4899",
  Object: "#ec4899",
  Unknown: "#64748b",
};

function makeColumn(overrides?: Partial<SchemaColumn>): SchemaColumn {
  return {
    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    type: "String",
    nullable: true,
    ...overrides,
  };
}

// ─── Main SchemaEditor Component ──────────────────────────────

export const SchemaEditor: React.FC<SchemaEditorProps> = ({
  schema,
  onChange,
  onInferRequest,
  canInfer = false,
  inferLabel = "Inferir Schema Real",
  title = "Schema de Colunas",
  compact = false,
  upstreamSchema = [],
  upstreamNodeLabel = "",
  nodeLabel = "",
  onOpenModal,
}) => {
  const [inferring, setInferring] = useState(false);
  const [inferStatus, setInferStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ colId: string; field: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState<string | null>(null);

  // Selection states for two-container transfer
  const [selectedUpstreamKeys, setSelectedUpstreamKeys] = useState<Set<string>>(new Set());
  const [selectedComponentKeys, setSelectedComponentKeys] = useState<Set<string>>(new Set());

  // Search filter states
  const [upstreamSearch, setUpstreamSearch] = useState("");
  const [componentSearch, setComponentSearch] = useState("");

  const hasUpstream = upstreamSchema && upstreamSchema.length > 0;

  // Filtered lists
  const filteredUpstream = useMemo(() => {
    if (!upstreamSearch.trim()) return upstreamSchema;
    const q = upstreamSearch.toLowerCase();
    return upstreamSchema.filter((c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q));
  }, [upstreamSchema, upstreamSearch]);

  const filteredComponent = useMemo(() => {
    if (!componentSearch.trim()) return schema;
    const q = componentSearch.toLowerCase();
    return schema.filter((c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q));
  }, [schema, componentSearch]);

  // ─── Direct inference ───────────────────────────────────────
  const handleInfer = async () => {
    if (!onInferRequest) return;
    setInferring(true);
    setInferStatus(null);
    try {
      const inferred = await onInferRequest();
      if (!inferred || inferred.length === 0) {
        setInferStatus({
          type: "error",
          message: "Nenhuma coluna detectada no arquivo ou query.",
        });
      } else {
        onChange(inferred);
        setInferStatus({
          type: "success",
          message: `${inferred.length} coluna(s) inferida(s) com sucesso: ${inferred.map((c) => c.name).join(", ")}`,
        });
        setTimeout(() => setInferStatus(null), 6000);
      }
    } catch (err: any) {
      setInferStatus({
        type: "error",
        message: err.message || "Falha ao inferir schema. Verifique o caminho do arquivo ou query SQL.",
      });
    } finally {
      setInferring(false);
    }
  };

  // ─── Component Schema Operations ────────────────────────────
  const addColumn = () => {
    const col = makeColumn({ name: `col_${schema.length + 1}` });
    onChange([...schema, col]);
    setTimeout(() => setEditingCell({ colId: col.id, field: "name" }), 50);
  };

  const removeColumn = (id: string) => {
    onChange(schema.filter((c) => c.id !== id));
    if (editingCell?.colId === id) setEditingCell(null);
    if (showAdvanced === id) setShowAdvanced(null);
    setSelectedComponentKeys((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateColumn = useCallback(
    (id: string, field: keyof SchemaColumn, value: any) => {
      onChange(schema.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    },
    [schema, onChange]
  );

  const moveColumn = (id: string, direction: "up" | "down") => {
    const idx = schema.findIndex((c) => c.id === id);
    if (idx < 0) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === schema.length - 1) return;
    const arr = [...schema];
    const target = direction === "up" ? idx - 1 : idx + 1;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    onChange(arr);
  };

  const clearAll = () => {
    onChange([]);
    setSelectedComponentKeys(new Set());
  };

  // ─── Two-Container Transfer Operations ───────

  // >> Import all columns from upstream (replace or sync)
  const handleImportAll = () => {
    const newCols: SchemaColumn[] = upstreamSchema.map((uc) => ({
      ...uc,
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }));
    onChange(newCols);
    setSelectedUpstreamKeys(new Set());
  };

  // > Import selected columns from upstream (append / merge)
  const handleImportSelected = () => {
    const selectedCols = upstreamSchema.filter((uc) => selectedUpstreamKeys.has(uc.id) || selectedUpstreamKeys.has(uc.name));
    if (selectedCols.length === 0) return;

    const existingNames = new Set(schema.map((c) => c.name.toLowerCase()));
    const toAdd: SchemaColumn[] = [];

    for (const uc of selectedCols) {
      if (!existingNames.has(uc.name.toLowerCase())) {
        toAdd.push({
          ...uc,
          id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        });
        existingNames.add(uc.name.toLowerCase());
      }
    }

    if (toAdd.length > 0) {
      onChange([...schema, ...toAdd]);
    }
    setSelectedUpstreamKeys(new Set());
  };

  // Quick single column transfer
  const handleTransferSingle = (col: SchemaColumn) => {
    const exists = schema.some((c) => c.name.toLowerCase() === col.name.toLowerCase());
    if (!exists) {
      const newCol: SchemaColumn = {
        ...col,
        id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      onChange([...schema, newCol]);
    }
  };

  // < Remove selected columns from component schema
  const handleRemoveSelected = () => {
    if (selectedComponentKeys.size === 0) return;
    onChange(schema.filter((c) => !selectedComponentKeys.has(c.id)));
    setSelectedComponentKeys(new Set());
  };

  // Upstream Multi-select helpers
  const handleToggleUpstreamKey = (key: string) => {
    setSelectedUpstreamKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectAllUpstream = (select: boolean) => {
    if (select) {
      setSelectedUpstreamKeys(new Set(filteredUpstream.map((c) => c.id || c.name)));
    } else {
      setSelectedUpstreamKeys(new Set());
    }
  };

  // Component Multi-select helpers
  const handleToggleComponentKey = (key: string) => {
    setSelectedComponentKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectAllComponent = (select: boolean) => {
    if (select) {
      setSelectedComponentKeys(new Set(filteredComponent.map((c) => c.id)));
    } else {
      setSelectedComponentKeys(new Set());
    }
  };

  const allUpstreamSelected = filteredUpstream.length > 0 && filteredUpstream.every((c) => selectedUpstreamKeys.has(c.id || c.name));
  const allComponentSelected = filteredComponent.length > 0 && filteredComponent.every((c) => selectedComponentKeys.has(c.id));

  // ─────────────────────────────────────────────────────────────
  // RENDER: SPLIT VIEW (When Upstream Schema is Available)
  // ─────────────────────────────────────────────────────────────
  if (hasUpstream) {
    return (
      <div className="schema-two-container">
        {/* Top Sync & Info Bar */}
        <div className="schema-flow-bar">
          <div className="schema-flow-info">
            <Layers size={13} color="var(--accent-cyan)" />
            <span>
              Entrada conectada: <strong>{upstreamNodeLabel || "Nó a Montante"}</strong> ({upstreamSchema.length} colunas)
            </span>
          </div>
          <div className="schema-flow-actions">
            <button
              type="button"
              className="btn btn-secondary schema-sync-btn"
              onClick={handleImportAll}
              title="Copiar todas as colunas de entrada para este componente"
            >
              <RefreshCw size={12} /> Sincronizar Tudo
            </button>
            {onOpenModal && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onOpenModal}
                title="Abrir em janela inteira"
              >
                Expandir
              </button>
            )}
          </div>
        </div>

        {/* Feedback Banner */}
        {inferStatus && (
          <div
            className={`schema-status-banner ${inferStatus.type}`}
          >
            {inferStatus.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
            <span style={{ flex: 1 }}>{inferStatus.message}</span>
            <button className="icon-btn" onClick={() => setInferStatus(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* Split Grid */}
        <div className="schema-split-layout">
          {/* ─── LEFT CONTAINER: Upstream Schema ─── */}
          <div className="schema-panel schema-panel-input">
            <div className="schema-panel-header">
              <div className="schema-panel-title">
                <ArrowDownToLine size={13} color="var(--accent-cyan)" />
                <span>Schema de Entrada</span>
                <span className="schema-badge input">{upstreamSchema.length}</span>
              </div>
              <div className="schema-search-box">
                <Search size={11} />
                <input
                  type="text"
                  placeholder="Filtrar..."
                  value={upstreamSearch}
                  onChange={(e) => setUpstreamSearch(e.target.value)}
                />
                {upstreamSearch && (
                  <button className="clear-search" onClick={() => setUpstreamSearch("")}>
                    <X size={10} />
                  </button>
                )}
              </div>
            </div>

            <div className="schema-panel-table-wrap">
              <table className="schema-table compact-table">
                <thead>
                  <tr>
                    <th style={{ width: 28, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={allUpstreamSelected}
                        onChange={(e) => handleSelectAllUpstream(e.target.checked)}
                        title="Selecionar todas"
                      />
                    </th>
                    <th style={{ width: 20 }}><Key size={10} /></th>
                    <th>Coluna Entrada</th>
                    <th style={{ width: 75 }}>Tipo</th>
                    <th style={{ width: 45 }}>Null</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUpstream.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="schema-empty-cell">
                        Nenhuma coluna encontrada
                      </td>
                    </tr>
                  ) : (
                    filteredUpstream.map((col) => {
                      const key = col.id || col.name;
                      const isSelected = selectedUpstreamKeys.has(key);
                      const isAlreadyInComponent = schema.some((c) => c.name.toLowerCase() === col.name.toLowerCase());

                      return (
                        <tr
                          key={key}
                          className={`schema-row ${isSelected ? "selected" : ""} ${isAlreadyInComponent ? "imported" : ""}`}
                          onDoubleClick={() => handleTransferSingle(col)}
                          title="Duplo clique para adicionar ao schema do componente"
                        >
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleUpstreamKey(key)}
                            />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {col.isPrimaryKey && <Key size={10} color="var(--accent-amber)" />}
                          </td>
                          <td
                            className="schema-col-name-cell"
                            onClick={() => handleToggleUpstreamKey(key)}
                          >
                            <span className="col-name-text">{col.name}</span>
                            {isAlreadyInComponent && <span className="imported-indicator">✓</span>}
                          </td>
                          <td>
                            <span
                              className="schema-type-badge"
                              style={{
                                borderColor: TYPE_COLORS[col.type] || "var(--border-subtle)",
                                color: TYPE_COLORS[col.type] || "var(--text-primary)"
                              }}
                            >
                              {col.type}
                            </span>
                          </td>
                          <td style={{ textAlign: "center", fontSize: "0.68rem" }}>
                            <span className={`null-tag ${col.nullable ? "yes" : "no"}`}>
                              {col.nullable ? "NULL" : "NOT"}
                            </span>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              className="schema-quick-add-btn"
                              onClick={() => handleTransferSingle(col)}
                              disabled={isAlreadyInComponent}
                              title={isAlreadyInComponent ? "Já incluída" : "Adicionar coluna"}
                            >
                              <Plus size={11} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="schema-panel-footer">
              <span>{selectedUpstreamKeys.size} de {upstreamSchema.length} selecionadas</span>
              <button
                type="button"
                className="btn-link-sm"
                onClick={() => handleSelectAllUpstream(!allUpstreamSelected)}
              >
                {allUpstreamSelected ? "Desmarcar todas" : "Marcar todas"}
              </button>
            </div>
          </div>

          {/* ─── CENTER: Transfer Toolbar ─── */}
          <div className="schema-transfer-toolbar">
            <button
              type="button"
              className="schema-transfer-btn"
              onClick={handleImportAll}
              title="Copiar todas as colunas de entrada (>>)"
            >
              <ChevronsRight size={15} />
            </button>
            <button
              type="button"
              className="schema-transfer-btn primary"
              onClick={handleImportSelected}
              disabled={selectedUpstreamKeys.size === 0}
              title="Copiar colunas marcadas na entrada (>)"
            >
              <ArrowRight size={14} />
            </button>
            <button
              type="button"
              className="schema-transfer-btn"
              onClick={handleRemoveSelected}
              disabled={selectedComponentKeys.size === 0}
              title="Remover colunas marcadas do componente (<)"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              type="button"
              className="schema-transfer-btn danger"
              onClick={clearAll}
              disabled={schema.length === 0}
              title="Limpar schema do componente (<<)"
            >
              <ChevronsLeft size={15} />
            </button>
          </div>

          {/* ─── RIGHT CONTAINER: Component Schema ─── */}
          <div className="schema-panel schema-panel-output">
            <div className="schema-panel-header">
              <div className="schema-panel-title">
                <ArrowUpFromLine size={13} color="var(--accent-blue)" />
                <span>Schema do Componente</span>
                <span className="schema-badge output">{schema.length}</span>
              </div>
              <div className="schema-header-actions">
                <div className="schema-search-box">
                  <Search size={11} />
                  <input
                    type="text"
                    placeholder="Filtrar..."
                    value={componentSearch}
                    onChange={(e) => setComponentSearch(e.target.value)}
                  />
                  {componentSearch && (
                    <button className="clear-search" onClick={() => setComponentSearch("")}>
                      <X size={10} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary schema-add-btn"
                  onClick={addColumn}
                  title="Adicionar coluna manual"
                >
                  <Plus size={11} /> Coluna
                </button>
                {selectedComponentKeys.size > 0 && (
                  <button
                    type="button"
                    className="btn btn-danger-subtle"
                    onClick={handleRemoveSelected}
                    title="Excluir selecionadas"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>

            <div className="schema-panel-table-wrap">
              {schema.length === 0 ? (
                <div className="schema-empty-output">
                  <Table2 size={24} opacity={0.2} />
                  <p>Nenhuma coluna definida no componente</p>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                    Selecione colunas à esquerda e clique em <strong>&gt;</strong> ou <strong>&gt;&gt;</strong>
                  </span>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button type="button" className="btn btn-secondary" onClick={handleImportAll}>
                      <ChevronsRight size={12} /> Importar Tudo ({upstreamSchema.length})
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={addColumn}>
                      <Plus size={12} /> Coluna Manual
                    </button>
                  </div>
                </div>
              ) : (
                <table className="schema-table">
                  <thead>
                    <tr>
                      <th style={{ width: 24, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={allComponentSelected}
                          onChange={(e) => handleSelectAllComponent(e.target.checked)}
                          title="Selecionar todas"
                        />
                      </th>
                      <th style={{ width: 24 }}></th>
                      <th style={{ width: 20 }}><Key size={10} /></th>
                      <th>Nome da Coluna</th>
                      <th style={{ width: 95 }}>Tipo</th>
                      <th style={{ width: 55 }}>Nullable</th>
                      <th style={{ width: 60 }}>Tamanho</th>
                      <th style={{ width: 32 }}>···</th>
                      <th style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredComponent.map((col, idx) => {
                      const isSelected = selectedComponentKeys.has(col.id);

                      return (
                        <React.Fragment key={col.id}>
                          <tr className={`schema-row ${isSelected ? "selected" : ""} ${showAdvanced === col.id ? "expanded" : ""}`}>
                            {/* Checkbox */}
                            <td style={{ textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleComponentKey(col.id)}
                              />
                            </td>

                            {/* Reorder buttons */}
                            <td className="schema-order-cell">
                              <div className="schema-order-btns">
                                <button
                                  type="button"
                                  className="schema-order-btn"
                                  onClick={() => moveColumn(col.id, "up")}
                                  disabled={idx === 0}
                                  title="Mover para cima"
                                >
                                  <ChevronUp size={9} />
                                </button>
                                <button
                                  type="button"
                                  className="schema-order-btn"
                                  onClick={() => moveColumn(col.id, "down")}
                                  disabled={idx === schema.length - 1}
                                  title="Mover para baixo"
                                >
                                  <ChevronDown size={9} />
                                </button>
                              </div>
                            </td>

                            {/* PK */}
                            <td>
                              <button
                                type="button"
                                className={`pk-btn ${col.isPrimaryKey ? "active" : ""}`}
                                onClick={() => updateColumn(col.id, "isPrimaryKey", !col.isPrimaryKey)}
                                title="Chave Primária"
                              >
                                <Key size={10} />
                              </button>
                            </td>

                            {/* Column Name */}
                            <td>
                              <input
                                className="schema-cell-input name-input"
                                value={col.name}
                                placeholder="nome_coluna"
                                autoFocus={editingCell?.colId === col.id && editingCell.field === "name"}
                                onChange={(e) => updateColumn(col.id, "name", e.target.value)}
                                onFocus={() => setEditingCell({ colId: col.id, field: "name" })}
                              />
                            </td>

                            {/* Type */}
                            <td>
                              <div className="type-select-wrap">
                                <span
                                  className="type-dot"
                                  style={{ background: TYPE_COLORS[col.type] }}
                                />
                                <select
                                  className="schema-cell-select"
                                  value={col.type}
                                  onChange={(e) =>
                                    updateColumn(col.id, "type", e.target.value as SchemaColumnType)
                                  }
                                >
                                  {COLUMN_TYPES.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </div>
                            </td>

                            {/* Nullable */}
                            <td style={{ textAlign: "center" }}>
                              <button
                                type="button"
                                className={`nullable-btn ${col.nullable ? "yes" : "no"}`}
                                onClick={() => updateColumn(col.id, "nullable", !col.nullable)}
                                title={col.nullable ? "Permite NULL" : "NOT NULL"}
                              >
                                {col.nullable ? "NULL" : "NOT"}
                              </button>
                            </td>

                            {/* Length */}
                            <td>
                              {["String", "Bytes", "Decimal"].includes(col.type) ? (
                                <input
                                  className="schema-cell-input number-input"
                                  type="number"
                                  value={col.length ?? ""}
                                  placeholder="255"
                                  onChange={(e) =>
                                    updateColumn(col.id, "length", parseInt(e.target.value) || undefined)
                                  }
                                />
                              ) : (
                                <span className="schema-na">—</span>
                              )}
                            </td>

                            {/* Advanced toggle */}
                            <td style={{ textAlign: "center" }}>
                              <button
                                type="button"
                                className={`schema-adv-btn ${showAdvanced === col.id ? "active" : ""}`}
                                onClick={() =>
                                  setShowAdvanced(showAdvanced === col.id ? null : col.id)
                                }
                                title="Configurações avançadas"
                              >
                                ···
                              </button>
                            </td>

                            {/* Delete */}
                            <td>
                              <button
                                type="button"
                                className="icon-btn danger"
                                onClick={() => removeColumn(col.id)}
                                title="Remover coluna"
                              >
                                <Trash2 size={11} />
                              </button>
                            </td>
                          </tr>

                          {/* Advanced Row Details */}
                          {showAdvanced === col.id && (
                            <tr className="schema-adv-row">
                              <td colSpan={9}>
                                <div className="schema-adv-content">
                                  {["Decimal", "Double", "Float"].includes(col.type) && (
                                    <div className="schema-adv-group">
                                      <label>Precisão</label>
                                      <input
                                        className="schema-cell-input number-input"
                                        type="number"
                                        value={col.precision ?? ""}
                                        placeholder="18"
                                        onChange={(e) =>
                                          updateColumn(col.id, "precision", parseInt(e.target.value) || undefined)
                                        }
                                      />
                                      <label>Escala</label>
                                      <input
                                        className="schema-cell-input number-input"
                                        type="number"
                                        value={col.scale ?? ""}
                                        placeholder="4"
                                        onChange={(e) =>
                                          updateColumn(col.id, "scale", parseInt(e.target.value) || undefined)
                                        }
                                      />
                                    </div>
                                  )}
                                  {["Date", "DateTime", "Timestamp", "Time"].includes(col.type) && (
                                    <div className="schema-adv-group">
                                      <label>Formato</label>
                                      <input
                                        className="schema-cell-input"
                                        style={{ width: 160 }}
                                        value={col.format ?? ""}
                                        placeholder="yyyy-MM-dd HH:mm:ss"
                                        onChange={(e) => updateColumn(col.id, "format", e.target.value)}
                                      />
                                    </div>
                                  )}
                                  <div className="schema-adv-group">
                                    <label>Valor Padrão</label>
                                    <input
                                      className="schema-cell-input"
                                      style={{ width: 120 }}
                                      value={col.defaultValue ?? ""}
                                      placeholder="NULL"
                                      onChange={(e) => updateColumn(col.id, "defaultValue", e.target.value)}
                                    />
                                  </div>
                                  <div className="schema-adv-group">
                                    <label>Comentário</label>
                                    <input
                                      className="schema-cell-input"
                                      style={{ flex: 1, minWidth: 160 }}
                                      value={col.comment ?? ""}
                                      placeholder="Descrição..."
                                      onChange={(e) => updateColumn(col.id, "comment", e.target.value)}
                                    />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="schema-panel-footer">
              <span>{schema.length} coluna(s) no schema</span>
              {selectedComponentKeys.size > 0 && (
                <span style={{ color: "var(--accent-cyan)", fontSize: "0.7rem" }}>
                  ({selectedComponentKeys.size} selecionadas)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: SINGLE CONTAINER (When No Upstream Node is Available)
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="schema-editor">
      {/* Header */}
      <div className="schema-editor-header">
        <div className="schema-editor-title">
          <Table2 size={14} color="var(--accent-cyan)" />
          <span>{title}</span>
          <span className="schema-col-count">{schema.length}</span>
        </div>
        <div className="schema-editor-actions">
          {canInfer && onInferRequest && (
            <button
              type="button"
              className="btn btn-secondary schema-infer-btn"
              onClick={handleInfer}
              disabled={inferring}
              title={inferLabel}
            >
              {inferring ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
              {inferLabel}
            </button>
          )}
          <button type="button" className="btn btn-secondary schema-add-btn" onClick={addColumn} title="Adicionar coluna">
            <Plus size={12} /> Coluna
          </button>
          {schema.length > 0 && (
            <button type="button" className="icon-btn danger" onClick={clearAll} title="Limpar schema">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {inferStatus && (
        <div
          className={`schema-status-banner ${inferStatus.type}`}
        >
          {inferStatus.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
          <span style={{ flex: 1 }}>{inferStatus.message}</span>
          <button
            type="button"
            className="icon-btn"
            style={{ padding: 2 }}
            onClick={() => setInferStatus(null)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {schema.length === 0 ? (
        <div className="schema-empty">
          <Table2 size={28} opacity={0.15} />
          <p>Nenhuma coluna definida</p>
          {canInfer && (
            <button type="button" className="btn btn-secondary" onClick={handleInfer} disabled={inferring}>
              {inferring ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
              Inferir automaticamente
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={addColumn}>
            <Plus size={12} /> Adicionar coluna manual
          </button>
        </div>
      ) : (
        <div className="schema-table-wrap">
          <table className="schema-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th style={{ width: 20 }}><Key size={10} /></th>
                <th>Nome da Coluna</th>
                <th style={{ width: 110 }}>Tipo</th>
                <th style={{ width: 60 }}>Nullable</th>
                <th style={{ width: 70 }}>Tamanho</th>
                <th style={{ width: 40 }}>Avançado</th>
                <th style={{ width: 60 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {schema.map((col, idx) => (
                <React.Fragment key={col.id}>
                  <tr
                    className={`schema-row ${showAdvanced === col.id ? "expanded" : ""}`}
                  >
                    {/* Drag handle / order */}
                    <td className="schema-order-cell">
                      <div className="schema-order-btns">
                        <button
                          type="button"
                          className="schema-order-btn"
                          onClick={() => moveColumn(col.id, "up")}
                          disabled={idx === 0}
                        >
                          <ChevronUp size={10} />
                        </button>
                        <button
                          type="button"
                          className="schema-order-btn"
                          onClick={() => moveColumn(col.id, "down")}
                          disabled={idx === schema.length - 1}
                        >
                          <ChevronDown size={10} />
                        </button>
                      </div>
                    </td>

                    {/* Primary Key */}
                    <td>
                      <button
                        type="button"
                        className={`pk-btn ${col.isPrimaryKey ? "active" : ""}`}
                        onClick={() => updateColumn(col.id, "isPrimaryKey", !col.isPrimaryKey)}
                        title="Chave Primária"
                      >
                        <Key size={11} />
                      </button>
                    </td>

                    {/* Column Name */}
                    <td>
                      <input
                        className="schema-cell-input name-input"
                        value={col.name}
                        placeholder="nome_coluna"
                        autoFocus={editingCell?.colId === col.id && editingCell.field === "name"}
                        onChange={(e) => updateColumn(col.id, "name", e.target.value)}
                        onFocus={() => setEditingCell({ colId: col.id, field: "name" })}
                      />
                    </td>

                    {/* Type */}
                    <td>
                      <div className="type-select-wrap">
                        <span
                          className="type-dot"
                          style={{ background: TYPE_COLORS[col.type] }}
                        />
                        <select
                          className="schema-cell-select"
                          value={col.type}
                          onChange={(e) =>
                            updateColumn(col.id, "type", e.target.value as SchemaColumnType)
                          }
                        >
                          {COLUMN_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    </td>

                    {/* Nullable */}
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className={`nullable-btn ${col.nullable ? "yes" : "no"}`}
                        onClick={() => updateColumn(col.id, "nullable", !col.nullable)}
                        title={col.nullable ? "Permite NULL" : "NOT NULL"}
                      >
                        {col.nullable ? "NULL" : "NOT NULL"}
                      </button>
                    </td>

                    {/* Length / Size */}
                    <td>
                      {["String", "Bytes", "Decimal"].includes(col.type) ? (
                        <input
                          className="schema-cell-input number-input"
                          type="number"
                          value={col.length ?? ""}
                          placeholder="255"
                          onChange={(e) =>
                            updateColumn(col.id, "length", parseInt(e.target.value) || undefined)
                          }
                        />
                      ) : (
                        <span className="schema-na">—</span>
                      )}
                    </td>

                    {/* Advanced toggle */}
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className={`schema-adv-btn ${showAdvanced === col.id ? "active" : ""}`}
                        onClick={() =>
                          setShowAdvanced(showAdvanced === col.id ? null : col.id)
                        }
                        title="Configurações avançadas"
                      >
                        ···
                      </button>
                    </td>

                    {/* Actions */}
                    <td>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => removeColumn(col.id)}
                        title="Remover coluna"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>

                  {/* Advanced Row */}
                  {showAdvanced === col.id && (
                    <tr className="schema-adv-row">
                      <td colSpan={8}>
                        <div className="schema-adv-content">
                          {["Decimal", "Double", "Float"].includes(col.type) && (
                            <div className="schema-adv-group">
                              <label>Precisão</label>
                              <input
                                className="schema-cell-input number-input"
                                type="number"
                                value={col.precision ?? ""}
                                placeholder="18"
                                onChange={(e) =>
                                  updateColumn(col.id, "precision", parseInt(e.target.value) || undefined)
                                }
                              />
                              <label>Escala</label>
                              <input
                                className="schema-cell-input number-input"
                                type="number"
                                value={col.scale ?? ""}
                                placeholder="4"
                                onChange={(e) =>
                                  updateColumn(col.id, "scale", parseInt(e.target.value) || undefined)
                                }
                              />
                            </div>
                          )}
                          {["Date", "DateTime", "Timestamp", "Time"].includes(col.type) && (
                            <div className="schema-adv-group">
                              <label>Formato</label>
                              <input
                                className="schema-cell-input"
                                style={{ width: 180 }}
                                value={col.format ?? ""}
                                placeholder="yyyy-MM-dd HH:mm:ss"
                                onChange={(e) => updateColumn(col.id, "format", e.target.value)}
                              />
                            </div>
                          )}
                          <div className="schema-adv-group">
                            <label>Valor Padrão</label>
                            <input
                              className="schema-cell-input"
                              style={{ width: 140 }}
                              value={col.defaultValue ?? ""}
                              placeholder="NULL"
                              onChange={(e) => updateColumn(col.id, "defaultValue", e.target.value)}
                            />
                          </div>
                          <div className="schema-adv-group">
                            <label>Comentário</label>
                            <input
                              className="schema-cell-input"
                              style={{ flex: 1, minWidth: 200 }}
                              value={col.comment ?? ""}
                              placeholder="Descrição da coluna..."
                              onChange={(e) => updateColumn(col.id, "comment", e.target.value)}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Modal Wrapper (for double-click full-screen edit) ────────

export interface SchemaEditorModalProps extends SchemaEditorProps {
  onClose: () => void;
  nodeLabel: string;
}

export const SchemaEditorModal: React.FC<SchemaEditorModalProps> = ({
  onClose,
  nodeLabel,
  ...props
}) => {
  const [localSchema, setLocalSchema] = useState<SchemaColumn[]>(props.schema);
  const [dirty, setDirty] = useState(false);

  React.useEffect(() => {
    setLocalSchema(props.schema);
  }, [props.schema]);

  const handleChange = (schema: SchemaColumn[]) => {
    setLocalSchema(schema);
    setDirty(true);
    props.onChange(schema);
  };

  const handleSave = () => {
    props.onChange(localSchema);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container schema-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            <Table2 size={18} color="var(--accent-cyan)" />
            <span>Schema Editor: {nodeLabel}</span>
            {dirty && (
              <span className="schema-dirty-badge">● não salvo</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-success"
              onClick={handleSave}
            >
              <Check size={13} /> Aplicar Schema
            </button>
            <button type="button" className="modal-close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="schema-modal-body">
          <SchemaEditor
            {...props}
            schema={localSchema}
            onChange={handleChange}
            nodeLabel={nodeLabel}
          />
        </div>
      </div>
    </div>
  );
};
