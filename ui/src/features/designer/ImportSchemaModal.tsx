import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Layers,
  Table2,
  ArrowRight,
  ArrowLeft,
  CheckSquare,
  Square,
  Search,
  Key,
  Database,
  ArrowDownToLine,
  Filter,
  Sparkles,
  Info
} from "lucide-react";
import { SchemaColumn, jobStore } from "../../store/jobStore";
import { resolveSchemaCollisions, CollisionStrategy, generateColumnId } from "../../utils/schemaClipboard";

export interface ImportSchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (columns: SchemaColumn[]) => void;
  currentSchema: SchemaColumn[];
  excludeNodeId?: string;
  title?: string;
}

interface ComponentOption {
  cellId: string;
  cellName: string;
  nodeId: string;
  nodeLabel: string;
  componentType: string;
  schema: SchemaColumn[];
}

export const ImportSchemaModal: React.FC<ImportSchemaModalProps> = ({
  isOpen,
  onClose,
  onImport,
  currentSchema,
  excludeNodeId,
  title = "Importar Schema de Outro Componente"
}) => {
  // Passos: 1 = Componente de Origem, 2 = Seleção de Colunas, 3 = Resolução de Conflitos
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedComponent, setSelectedComponent] = useState<ComponentOption | null>(null);
  const [selectedColIds, setSelectedColIds] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<CollisionStrategy>("overwrite");
  const [searchQuery, setSearchQuery] = useState("");
  const [colSearchQuery, setColSearchQuery] = useState("");

  // Coleta todos os nós com schema no job agrupados por célula
  const componentsByCell = useMemo(() => {
    const activeJob = jobStore.getActiveJob();
    if (!activeJob || !activeJob.cells) return [];

    const grouped: { cellId: string; cellName: string; components: ComponentOption[] }[] = [];

    for (const cell of activeJob.cells) {
      const cellComponents: ComponentOption[] = [];
      const cellSchemas = cell.nodeSchemas || activeJob.nodeSchemas || {};

      for (const node of cell.nodes || []) {
        if (node.id === excludeNodeId) continue;

        let nodeSchema: SchemaColumn[] = [];
        if (Array.isArray((node.data as any)?.schema) && (node.data as any).schema.length > 0) {
          nodeSchema = (node.data as any).schema;
        } else if (cellSchemas[node.id] && cellSchemas[node.id].length > 0) {
          nodeSchema = cellSchemas[node.id];
        }

        if (nodeSchema.length > 0) {
          cellComponents.push({
            cellId: cell.id,
            cellName: cell.name || `Célula ${cell.order}`,
            nodeId: node.id,
            nodeLabel: (node.data as any)?.label || node.id,
            componentType: (node.data as any)?.componentType || (node.data as any)?.type || "Component",
            schema: nodeSchema
          });
        }
      }

      if (cellComponents.length > 0) {
        grouped.push({
          cellId: cell.id,
          cellName: cell.name || `Célula ${cell.order}`,
          components: cellComponents
        });
      }
    }

    return grouped;
  }, [excludeNodeId]);

  if (!isOpen) return null;

  const handleSelectComponent = (comp: ComponentOption) => {
    setSelectedComponent(comp);
    setSelectedColIds(new Set(comp.schema.map(c => c.id)));
    setStep(2);
  };

  const handleToggleColumn = (colId: string) => {
    setSelectedColIds(prev => {
      const next = new Set(prev);
      if (next.has(colId)) {
        next.delete(colId);
      } else {
        next.add(colId);
      }
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    if (!selectedComponent) return;
    setSelectedColIds(new Set(selectedComponent.schema.map(c => c.id)));
  };

  const handleDeselectAllColumns = () => {
    setSelectedColIds(new Set());
  };

  const handleConfirmImport = () => {
    if (!selectedComponent) return;
    // Cria novos IDs para as colunas selecionadas para garantir isolamento e unicidade de UUIDs
    const incomingSelected = selectedComponent.schema
      .filter(c => selectedColIds.has(c.id))
      .map(c => ({
        ...c,
        id: generateColumnId()
      }));

    const merged = resolveSchemaCollisions(currentSchema, incomingSelected, strategy);
    onImport(merged);
    onClose();
  };

  // Filtragem de colunas no Passo 2
  const filteredColumns = useMemo(() => {
    if (!selectedComponent) return [];
    if (!colSearchQuery.trim()) return selectedComponent.schema;
    const q = colSearchQuery.toLowerCase();
    return selectedComponent.schema.filter(
      c => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q)
    );
  }, [selectedComponent, colSearchQuery]);

  const modalContent = (
    <div
      className="import-schema-modal-overlay bg-black/60 backdrop-blur-sm z-50 fixed inset-0 flex items-center justify-center p-4"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="import-schema-modal-container max-w-2xl w-full max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: "#0f172a",
          border: "1px solid #334155",
          borderRadius: "16px",
          boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.8)",
          width: "100%",
          maxWidth: "672px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "#f1f5f9",
          fontFamily: "var(--font-sans, sans-serif)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── 1. CABEÇALHO DO MODAL ─── */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: "1px solid #1e293b",
            backgroundColor: "#0f172a",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                backgroundColor: "rgba(6, 182, 212, 0.12)",
                border: "1px solid rgba(6, 182, 212, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#22d3ee",
              }}
            >
              <ArrowDownToLine size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#f8fafc" }}>
                {title}
              </h3>
              <p style={{ margin: "2px 0 0 0", fontSize: "0.78rem", color: "#94a3b8" }}>
                Passo {step} de 3: {step === 1 ? "Escolher Componente" : step === 2 ? "Selecionar Colunas" : "Resolução de Conflitos"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-slate-800 rounded-lg p-1.5 text-slate-400 hover:text-white transition-colors"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Fechar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* ─── 2. STEPPER VISUAL HORIZONTAL ─── */}
        <div
          className="grid grid-cols-3 border-b border-slate-800 text-xs text-center font-medium"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            borderBottom: "1px solid #1e293b",
            fontSize: "0.8rem",
            fontWeight: 500,
            backgroundColor: "#0b1120",
          }}
        >
          {/* Passo 1 */}
          <div
            className={`py-3 transition-colors ${
              step === 1
                ? "text-cyan-400 bg-cyan-500/10 border-b-2 border-cyan-400 font-semibold"
                : step > 1
                ? "text-slate-300 border-b-2 border-slate-700"
                : "text-slate-500 border-b-2 border-transparent"
            }`}
            style={{
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              color: step === 1 ? "#22d3ee" : step > 1 ? "#cbd5e1" : "#64748b",
              backgroundColor: step === 1 ? "rgba(6, 182, 212, 0.08)" : "transparent",
              borderBottom: step === 1 ? "2px solid #06b6d4" : "2px solid transparent",
            }}
          >
            <span
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                fontSize: "0.7rem",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: step === 1 ? "#06b6d4" : step > 1 ? "#10b981" : "#334155",
                color: step === 1 || step > 1 ? "#0f172a" : "#94a3b8",
                fontWeight: 700,
              }}
            >
              {step > 1 ? <Check size={11} /> : "1"}
            </span>
            <span>1. Origem</span>
          </div>

          {/* Passo 2 */}
          <div
            className={`py-3 transition-colors ${
              step === 2
                ? "text-cyan-400 bg-cyan-500/10 border-b-2 border-cyan-400 font-semibold"
                : step > 2
                ? "text-slate-300 border-b-2 border-slate-700"
                : "text-slate-500 border-b-2 border-transparent"
            }`}
            style={{
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              color: step === 2 ? "#22d3ee" : step > 2 ? "#cbd5e1" : "#64748b",
              backgroundColor: step === 2 ? "rgba(6, 182, 212, 0.08)" : "transparent",
              borderBottom: step === 2 ? "2px solid #06b6d4" : "2px solid transparent",
            }}
          >
            <span
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                fontSize: "0.7rem",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: step === 2 ? "#06b6d4" : step > 2 ? "#10b981" : "#334155",
                color: step === 2 || step > 2 ? "#0f172a" : "#94a3b8",
                fontWeight: 700,
              }}
            >
              {step > 2 ? <Check size={11} /> : "2"}
            </span>
            <span>2. Colunas</span>
          </div>

          {/* Passo 3 */}
          <div
            className={`py-3 transition-colors ${
              step === 3
                ? "text-cyan-400 bg-cyan-500/10 border-b-2 border-cyan-400 font-semibold"
                : "text-slate-500 border-b-2 border-transparent"
            }`}
            style={{
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              color: step === 3 ? "#22d3ee" : "#64748b",
              backgroundColor: step === 3 ? "rgba(6, 182, 212, 0.08)" : "transparent",
              borderBottom: step === 3 ? "2px solid #06b6d4" : "2px solid transparent",
            }}
          >
            <span
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                fontSize: "0.7rem",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: step === 3 ? "#06b6d4" : "#334155",
                color: step === 3 ? "#0f172a" : "#94a3b8",
                fontWeight: 700,
              }}
            >
              3
            </span>
            <span>3. Conflitos</span>
          </div>
        </div>

        {/* ─── CORPO PRINCIPAL DO MODAL ─── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
            backgroundColor: "#0f172a",
          }}
        >
          {/* ─── PASSO 1: ESCOLHER COMPONENTE ─── */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Barra de Busca de Componentes */}
              <div style={{ position: "relative", width: "100%" }}>
                <Search
                  size={16}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#64748b",
                  }}
                />
                <input
                  type="text"
                  placeholder="Filtrar componente ou célula..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-800/80 border-slate-700 text-slate-100 placeholder-slate-500 rounded-lg px-3 py-2 text-sm"
                  style={{
                    width: "100%",
                    padding: "9px 12px 9px 36px",
                    backgroundColor: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                    color: "#f8fafc",
                    fontSize: "0.85rem",
                    outline: "none",
                  }}
                />
              </div>

              {componentsByCell.length === 0 ? (
                <div
                  style={{
                    padding: "48px 24px",
                    textAlign: "center",
                    color: "#94a3b8",
                    border: "1px dashed #334155",
                    borderRadius: "12px",
                  }}
                >
                  <Database size={32} style={{ margin: "0 auto 8px auto", color: "#64748b" }} />
                  <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "#cbd5e1" }}>
                    Nenhum outro componente com schema encontrado no Job.
                  </p>
                  <p style={{ margin: "4px 0 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                    Conecte fontes de dados ou defina schemas em outras células antes de importar.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {componentsByCell.map((group) => {
                    const filteredComponents = group.components.filter(
                      (c) =>
                        c.nodeLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        group.cellName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        c.componentType.toLowerCase().includes(searchQuery.toLowerCase())
                    );

                    if (filteredComponents.length === 0) return null;

                    return (
                      <div
                        key={group.cellId}
                        style={{
                          border: "1px solid #1e293b",
                          borderRadius: "10px",
                          overflow: "hidden",
                          backgroundColor: "#0b1120",
                        }}
                      >
                        {/* Header da Célula */}
                        <div
                          style={{
                            padding: "8px 14px",
                            backgroundColor: "rgba(30, 41, 59, 0.4)",
                            borderBottom: "1px solid #1e293b",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <Layers size={14} color="#38bdf8" />
                          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1" }}>
                            {group.cellName}
                          </span>
                          <span
                            style={{
                              marginLeft: "auto",
                              fontSize: "0.7rem",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              backgroundColor: "rgba(51, 65, 85, 0.5)",
                              color: "#94a3b8",
                            }}
                          >
                            {filteredComponents.length} componente(s)
                          </span>
                        </div>

                        {/* Grid Responsivo de Componentes */}
                        <div
                          className="grid grid-cols-2 gap-2.5 max-h-72 overflow-y-auto p-1"
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                            gap: "10px",
                            padding: "10px",
                            maxHeight: "280px",
                            overflowY: "auto",
                          }}
                        >
                          {filteredComponents.map((comp) => (
                            <button
                              key={comp.nodeId}
                              type="button"
                              onClick={() => handleSelectComponent(comp)}
                              className="import-schema-card bg-slate-800/60 hover:bg-slate-800 border border-slate-700/80 hover:border-cyan-500/50 rounded-lg p-3 transition-all cursor-pointer flex flex-col justify-between"
                              style={{
                                backgroundColor: "rgba(30, 41, 59, 0.6)",
                                border: "1px solid rgba(51, 65, 85, 0.8)",
                                borderRadius: "8px",
                                padding: "12px",
                                cursor: "pointer",
                                textAlign: "left",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                gap: "8px",
                                color: "#f1f5f9",
                                transition: "all 0.15s ease",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                                <div
                                  style={{
                                    padding: "6px",
                                    borderRadius: "6px",
                                    backgroundColor: "rgba(15, 23, 42, 0.6)",
                                    color: "#38bdf8",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <Table2 size={16} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: "0.85rem",
                                      fontWeight: 600,
                                      color: "#f8fafc",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {comp.nodeLabel}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "0.72rem",
                                      color: "#94a3b8",
                                      fontFamily: "monospace",
                                      marginTop: "2px",
                                    }}
                                  >
                                    {comp.componentType}
                                  </div>
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  marginTop: "4px",
                                  paddingTop: "6px",
                                  borderTop: "1px solid rgba(51, 65, 85, 0.4)",
                                }}
                              >
                                <span
                                  className="bg-slate-700/50 text-slate-300 text-xs px-2 py-0.5 rounded font-mono"
                                  style={{
                                    backgroundColor: "rgba(51, 65, 85, 0.5)",
                                    color: "#cbd5e1",
                                    fontSize: "0.72rem",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                  }}
                                >
                                  {comp.schema.length} colunas
                                </span>
                                <ArrowRight size={14} color="#06b6d4" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── PASSO 2: SELEÇÃO DE COLUNAS ─── */}
          {step === 2 && selectedComponent && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Info de Origem */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  backgroundColor: "rgba(30, 41, 59, 0.5)",
                  border: "1px solid #1e293b",
                  fontSize: "0.8rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#94a3b8" }}>Origem:</span>
                  <span style={{ fontWeight: 600, color: "#38bdf8" }}>{selectedComponent.nodeLabel}</span>
                  <span style={{ color: "#64748b" }}>({selectedComponent.cellName})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#818cf8",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Alterar componente
                </button>
              </div>

              {/* Toolbar de Filtro e Seleção Rápida */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                }}
              >
                <div style={{ position: "relative", flex: 1 }}>
                  <Search
                    size={14}
                    style={{
                      position: "absolute",
                      left: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#64748b",
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Filtrar colunas por nome ou tipo..."
                    value={colSearchQuery}
                    onChange={(e) => setColSearchQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 10px 6px 30px",
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: "6px",
                      color: "#f8fafc",
                      fontSize: "0.8rem",
                      outline: "none",
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={handleSelectAllColumns}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200"
                    style={{
                      padding: "4px 10px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      borderRadius: "6px",
                      border: "1px solid #334155",
                      backgroundColor: "#1e293b",
                      color: "#e2e8f0",
                      cursor: "pointer",
                    }}
                  >
                    Marcar Todas
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAllColumns}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200"
                    style={{
                      padding: "4px 10px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      borderRadius: "6px",
                      border: "1px solid #334155",
                      backgroundColor: "#1e293b",
                      color: "#94a3b8",
                      cursor: "pointer",
                    }}
                  >
                    Desmarcar Todas
                  </button>
                </div>
              </div>

              {/* Tabela Estruturada de Colunas com Scroll */}
              <div
                style={{
                  border: "1px solid #1e293b",
                  borderRadius: "8px",
                  overflow: "hidden",
                  backgroundColor: "#0b1120",
                  maxHeight: "320px",
                  overflowY: "auto",
                }}
              >
                {filteredColumns.map((col) => {
                  const isChecked = selectedColIds.has(col.id);
                  return (
                    <div
                      key={col.id}
                      onClick={() => handleToggleColumn(col.id)}
                      className="import-schema-col-row flex items-center gap-3 px-3 py-2 hover:bg-slate-800/50 rounded border-b border-slate-800 last:border-0"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 14px",
                        borderBottom: "1px solid #1e293b",
                        cursor: "pointer",
                        backgroundColor: isChecked ? "rgba(6, 182, 212, 0.08)" : "transparent",
                        transition: "background-color 0.15s ease",
                      }}
                    >
                      {/* Checkbox e Nome da Coluna */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {isChecked ? (
                          <CheckSquare size={16} color="#06b6d4" />
                        ) : (
                          <Square size={16} color="#64748b" />
                        )}
                        <span
                          className="font-mono text-sm text-slate-200"
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.85rem",
                            fontWeight: 500,
                            color: isChecked ? "#f8fafc" : "#cbd5e1",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          {col.name}
                          {col.isPrimaryKey && (
                            <span title="Chave Primária (PK)">
                              <Key size={12} color="#f59e0b" />
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Metadados: Badge de Tipo e Nullable */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          className="bg-cyan-950/40 text-cyan-400 border border-cyan-800/50 text-xs px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: "rgba(6, 182, 212, 0.12)",
                            color: "#22d3ee",
                            border: "1px solid rgba(6, 182, 212, 0.3)",
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontFamily: "monospace",
                          }}
                        >
                          {col.type}
                        </span>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            color: col.nullable ? "#94a3b8" : "#f59e0b",
                            backgroundColor: "rgba(255, 255, 255, 0.04)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          {col.nullable ? "nullable" : "not null"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Contador de Seleção */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                  padding: "0 4px",
                }}
              >
                <span>Total de colunas: {selectedComponent.schema.length}</span>
                <span style={{ fontWeight: 600, color: selectedColIds.size > 0 ? "#22d3ee" : "#64748b" }}>
                  {selectedColIds.size} de {selectedComponent.schema.length} selecionada(s)
                </span>
              </div>
            </div>
          )}

          {/* ─── PASSO 3: RESOLUÇÃO DE CONFLITOS ─── */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  backgroundColor: "rgba(30, 41, 59, 0.4)",
                  border: "1px solid #1e293b",
                  fontSize: "0.82rem",
                  color: "#cbd5e1",
                }}
              >
                Defina como proceder quando uma coluna importada tiver o mesmo nome de uma coluna existente no componente atual ({currentSchema.length} coluna(s) existentes e {selectedColIds.size} coluna(s) selecionadas):
              </div>

              {/* Opções de Estratégia em Radio-Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* Opção: Overwrite */}
                <label
                  onClick={() => setStrategy("overwrite")}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "14px",
                    borderRadius: "10px",
                    border: strategy === "overwrite" ? "1px solid #06b6d4" : "1px solid #334155",
                    backgroundColor: strategy === "overwrite" ? "rgba(6, 182, 212, 0.08)" : "rgba(30, 41, 59, 0.5)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === "overwrite"}
                    onChange={() => setStrategy("overwrite")}
                    style={{ marginTop: "3px", accentColor: "#06b6d4" }}
                  />
                  <div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f8fafc" }}>
                      Sobrescrever colunas existentes (Overwrite)
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: "3px", lineHeight: "1.4" }}>
                      Atualiza o tipo e definições das colunas existentes com mesmo nome e adiciona as novas colunas selecionadas.
                    </div>
                  </div>
                </label>

                {/* Opção: Skip */}
                <label
                  onClick={() => setStrategy("skip")}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "14px",
                    borderRadius: "10px",
                    border: strategy === "skip" ? "1px solid #06b6d4" : "1px solid #334155",
                    backgroundColor: strategy === "skip" ? "rgba(6, 182, 212, 0.08)" : "rgba(30, 41, 59, 0.5)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === "skip"}
                    onChange={() => setStrategy("skip")}
                    style={{ marginTop: "3px", accentColor: "#06b6d4" }}
                  />
                  <div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f8fafc" }}>
                      Ignorar duplicadas (Skip)
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: "3px", lineHeight: "1.4" }}>
                      Mantém intactas as colunas existentes e importa apenas as colunas que ainda não existirem no schema atual.
                    </div>
                  </div>
                </label>

                {/* Opção: Rename */}
                <label
                  onClick={() => setStrategy("rename")}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "14px",
                    borderRadius: "10px",
                    border: strategy === "rename" ? "1px solid #06b6d4" : "1px solid #334155",
                    backgroundColor: strategy === "rename" ? "rgba(6, 182, 212, 0.08)" : "rgba(30, 41, 59, 0.5)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === "rename"}
                    onChange={() => setStrategy("rename")}
                    style={{ marginTop: "3px", accentColor: "#06b6d4" }}
                  />
                  <div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f8fafc" }}>
                      Renomear novas colunas com sufixo (ex: _imported)
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: "3px", lineHeight: "1.4" }}>
                      Preserva as colunas existentes e renomeia as colunas importadas conflitantes adicionando um sufixo (ex: nome_copy).
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ─── 6. RODAPÉ DO MODAL ─── */}
        <div
          className="border-t border-slate-800 p-4 bg-slate-900/80 flex justify-between items-center"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderTop: "1px solid #1e293b",
            backgroundColor: "#0b1120",
          }}
        >
          {/* Botão Voltar */}
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((prev) => (prev - 1) as 1 | 2 | 3)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid #334155",
                backgroundColor: "#1e293b",
                color: "#cbd5e1",
                fontSize: "0.8rem",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <ArrowLeft size={14} />
              <span>Voltar</span>
            </button>
          ) : (
            <div />
          )}

          {/* Botões Cancelar e Avançar / Importar */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white"
              style={{
                padding: "8px 14px",
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: "0.8rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>

            {step === 1 && (
              <button
                type="button"
                disabled={!selectedComponent}
                onClick={() => setStep(2)}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium px-4 py-2 rounded-lg text-sm shadow-lg shadow-cyan-900/30"
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#0891b2",
                  color: "#ffffff",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: selectedComponent ? "pointer" : "not-allowed",
                  opacity: selectedComponent ? 1 : 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 4px 14px rgba(6, 182, 212, 0.3)",
                }}
              >
                <span>Avançar</span>
                <ArrowRight size={14} />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={selectedColIds.size === 0}
                onClick={() => setStep(3)}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium px-4 py-2 rounded-lg text-sm shadow-lg shadow-cyan-900/30"
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#0891b2",
                  color: "#ffffff",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: selectedColIds.size > 0 ? "pointer" : "not-allowed",
                  opacity: selectedColIds.size > 0 ? 1 : 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 4px 14px rgba(6, 182, 212, 0.3)",
                }}
              >
                <span>Avançar ({selectedColIds.size} selecionadas)</span>
                <ArrowRight size={14} />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={handleConfirmImport}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium px-4 py-2 rounded-lg text-sm shadow-lg shadow-cyan-900/30"
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#0891b2",
                  color: "#ffffff",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 4px 14px rgba(6, 182, 212, 0.4)",
                }}
              >
                <Check size={14} />
                <span>Importar {selectedColIds.size} coluna(s)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
};
