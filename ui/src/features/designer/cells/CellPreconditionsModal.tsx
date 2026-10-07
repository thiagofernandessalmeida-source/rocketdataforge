import React, { useState } from "react";
import { X, Plus, Trash2, ShieldCheck, AlertTriangle, ArrowRight } from "lucide-react";
import { CanvasCellData, CellPrecondition } from "../../../store/jobStore";

interface CellPreconditionsModalProps {
  cell: CanvasCellData;
  allCells: CanvasCellData[];
  onSave: (preconditions: CellPrecondition[], operator: "AND" | "OR") => void;
  onClose: () => void;
}

export const CellPreconditionsModal: React.FC<CellPreconditionsModalProps> = ({
  cell,
  allCells,
  onSave,
  onClose,
}) => {
  const [operator, setOperator] = useState<"AND" | "OR">(cell.preconditionOperator || "AND");
  const [preconditions, setPreconditions] = useState<CellPrecondition[]>(
    cell.preconditions ? [...cell.preconditions] : []
  );

  // Only cells with strictly lower execution order can be targeted (same order = parallel execution)
  const availableTargetCells = allCells.filter(
    (c) => c.id !== cell.id && (c.order < cell.order || c.order === undefined)
  );
  const sameOrderCells = allCells.filter(
    (c) => c.id !== cell.id && c.order === cell.order
  );

  // Check if any configured precondition has an order conflict (e.g. same order as this cell)
  const orderConflicts = preconditions
    .map((p, idx) => {
      const target = allCells.find((c) => c.id === p.targetCellId || c.name === p.targetCellId);
      if (target && target.order === cell.order) {
        return { index: idx, message: `Mesma ordem de execução (#${cell.order}): paralelismo não permite dependência entre si.` };
      }
      if (target && target.order > cell.order) {
        return { index: idx, message: `Ordem posterior (#${target.order} > #${cell.order}): não pode depender de célula futura.` };
      }
      return null;
    })
    .filter(Boolean);

  const hasOrderConflicts = orderConflicts.length > 0;

  const handleAddPrecondition = () => {
    if (availableTargetCells.length === 0) return;
    const defaultTarget = availableTargetCells[0];
    const newPre: CellPrecondition = {
      id: `prec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      targetCellId: defaultTarget.id,
      expectedStatus: "OK",
    };
    setPreconditions([...preconditions, newPre]);
  };

  const handleUpdatePrecondition = (
    index: number,
    updates: Partial<CellPrecondition>
  ) => {
    const next = [...preconditions];
    next[index] = { ...next[index], ...updates };
    setPreconditions(next);
  };

  const handleRemovePrecondition = (index: number) => {
    setPreconditions(preconditions.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (hasOrderConflicts) return;
    onSave(preconditions, operator);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-box"
        style={{ width: 580, maxWidth: "95vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={18} color="var(--accent-cyan)" />
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
              Pré-condições de Execução — {cell.name}
            </h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="modal-body" style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 16px 0" }}>
            Defina as regras de dependência para que esta célula seja executada.
            Se as condições não forem satisfeitas, a célula será ignorada (skipped) sem quebrar o job.
          </p>

          {/* Logic Operator Selector */}
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label" style={{ marginBottom: 6 }}>
              Operador Lógico entre Condições
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={`btn ${operator === "AND" ? "btn-primary" : "btn-secondary"}`}
                style={{ flex: 1, fontSize: "0.78rem" }}
                onClick={() => setOperator("AND")}
              >
                AND (Todas devem ser atendidas)
              </button>
              <button
                type="button"
                className={`btn ${operator === "OR" ? "btn-primary" : "btn-secondary"}`}
                style={{ flex: 1, fontSize: "0.78rem" }}
                onClick={() => setOperator("OR")}
              >
                OR (Pelo menos uma atendida)
              </button>
            </div>
          </div>

          {/* Preconditions List */}
          <div className="form-group">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <label className="form-label" style={{ margin: 0 }}>
                Dependências ({preconditions.length})
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: "0.72rem", padding: "4px 8px" }}
                onClick={handleAddPrecondition}
                disabled={availableTargetCells.length === 0}
              >
                <Plus size={12} /> Adicionar Regra
              </button>
            </div>

            {sameOrderCells.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "rgba(6,182,212,0.08)",
                  border: "1px solid rgba(6,182,212,0.25)",
                  fontSize: "0.75rem",
                  color: "var(--accent-cyan)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>💡</span>
                <span>
                  <strong>Regra de Paralelismo:</strong> As células {sameOrderCells.map((c) => `"${c.name}"`).join(", ")} possuem a mesma ordem de execução (#{cell.order}) e rodarão em paralelo; por isso não podem ser definidas como pré-condição.
                </span>
              </div>
            )}

            {preconditions.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  borderRadius: 6,
                  border: "1px dashed var(--border-subtle)",
                  textAlign: "center",
                  fontSize: "0.78rem",
                  color: "var(--text-muted)",
                }}
              >
                Sem pré-condições. Esta célula executará imediatamente quando sua ordem for atingida.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {preconditions.map((prec, idx) => {
                  const conflict = orderConflicts.find((c) => c?.index === idx);
                  return (
                    <div
                      key={prec.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        padding: "8px 12px",
                        background: conflict ? "rgba(239,68,68,0.08)" : "var(--bg-card)",
                        borderRadius: 6,
                        border: conflict
                          ? "1px solid var(--status-danger)"
                          : "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--text-muted)",
                            minWidth: 20,
                          }}
                        >
                          #{idx + 1}
                        </span>

                        {/* Target Cell Dropdown */}
                        <div style={{ flex: 2 }}>
                          <select
                            className="form-select"
                            style={{ width: "100%", fontSize: "0.78rem", padding: "4px 8px" }}
                            value={prec.targetCellId}
                            onChange={(e) =>
                              handleUpdatePrecondition(idx, {
                                targetCellId: e.target.value,
                              })
                            }
                          >
                            {availableTargetCells.map((tc) => (
                              <option key={tc.id} value={tc.id}>
                                {tc.name} (#{tc.order})
                              </option>
                            ))}
                            {/* If current value is invalid or same order, show it marked */}
                            {!availableTargetCells.some((tc) => tc.id === prec.targetCellId) && (
                              <option value={prec.targetCellId}>
                                {allCells.find((c) => c.id === prec.targetCellId)?.name || prec.targetCellId} (Conflito de Ordem)
                              </option>
                            )}
                          </select>
                        </div>

                        <ArrowRight size={14} color="var(--text-muted)" />

                        {/* Expected Status Dropdown */}
                        <div style={{ flex: 1.5 }}>
                          <select
                            className="form-select"
                            style={{
                              width: "100%",
                              fontSize: "0.78rem",
                              padding: "4px 8px",
                              color:
                                prec.expectedStatus === "OK"
                                  ? "var(--status-success)"
                                  : "var(--status-danger)",
                              fontWeight: 600,
                            }}
                            value={prec.expectedStatus}
                            onChange={(e) =>
                              handleUpdatePrecondition(idx, {
                                expectedStatus: e.target.value as "OK" | "ERROR",
                              })
                            }
                          >
                            <option value="OK">Status: OK (Sucesso)</option>
                            <option value="ERROR">Status: ERROR (Catch/Fallback)</option>
                          </select>
                        </div>

                        {/* Remove Button */}
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="Remover regra"
                          onClick={() => handleRemovePrecondition(idx)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {conflict && (
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--status-danger)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 2,
                          }}
                        >
                          <AlertTriangle size={12} />
                          <span>{conflict.message}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="modal-footer"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={hasOrderConflicts}
            title={hasOrderConflicts ? "Resolva os conflitos de ordem antes de salvar" : "Salvar regras"}
          >
            Salvar Regras
          </button>
        </div>
      </div>
    </div>
  );
};
