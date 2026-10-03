import React, { useState, useCallback } from "react";
import {
  X, Plus, Trash2, Loader2, Wand2, ChevronUp, ChevronDown,
  Key, AlertCircle, Check, GripVertical, Table2,
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

// ─── Main Component ───────────────────────────────────────────

export const SchemaEditor: React.FC<SchemaEditorProps> = ({
  schema,
  onChange,
  onInferRequest,
  canInfer = false,
  inferLabel = "Inferir Schema",
  title = "Schema de Colunas",
  compact = false,
}) => {
  const [inferring, setInferring] = useState(false);
  const [editingCell, setEditingCell] = useState<{ colId: string; field: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState<string | null>(null);

  const handleInfer = async () => {
    if (!onInferRequest) return;
    setInferring(true);
    try {
      const inferred = await onInferRequest();
      onChange(inferred);
    } catch (_) {}
    setInferring(false);
  };

  const addColumn = () => {
    const col = makeColumn({ name: `col_${schema.length + 1}` });
    onChange([...schema, col]);
    // Auto-focus new column name
    setTimeout(() => setEditingCell({ colId: col.id, field: "name" }), 50);
  };

  const removeColumn = (id: string) => {
    onChange(schema.filter((c) => c.id !== id));
    if (editingCell?.colId === id) setEditingCell(null);
    if (showAdvanced === id) setShowAdvanced(null);
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

  const clearAll = () => onChange([]);

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
              className="btn btn-secondary schema-infer-btn"
              onClick={handleInfer}
              disabled={inferring}
              title={inferLabel}
            >
              {inferring ? (
                <Loader2 size={12} className="spin" />
              ) : (
                <Wand2 size={12} />
              )}
              {inferLabel}
            </button>
          )}
          <button className="btn btn-secondary schema-add-btn" onClick={addColumn} title="Adicionar coluna">
            <Plus size={12} /> Coluna
          </button>
          {schema.length > 0 && (
            <button className="icon-btn danger" onClick={clearAll} title="Limpar schema">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {schema.length === 0 ? (
        <div className="schema-empty">
          <Table2 size={28} opacity={0.15} />
          <p>Nenhuma coluna definida</p>
          {canInfer && (
            <button className="btn btn-secondary" onClick={handleInfer} disabled={inferring}>
              {inferring ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
              Inferir automaticamente
            </button>
          )}
          <button className="btn btn-secondary" onClick={addColumn}>
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
                          className="schema-order-btn"
                          onClick={() => moveColumn(col.id, "up")}
                          disabled={idx === 0}
                        >
                          <ChevronUp size={10} />
                        </button>
                        <button
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

  const handleChange = (schema: SchemaColumn[]) => {
    setLocalSchema(schema);
    setDirty(true);
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
            <span>Schema: {nodeLabel}</span>
            {dirty && (
              <span className="schema-dirty-badge">● não salvo</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-success"
              onClick={handleSave}
            >
              <Check size={13} /> Aplicar Schema
            </button>
            <button className="modal-close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="schema-modal-body">
          <SchemaEditor
            {...props}
            schema={localSchema}
            onChange={handleChange}
          />
        </div>
      </div>
    </div>
  );
};
