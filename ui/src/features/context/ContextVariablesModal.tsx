import React, { useState } from "react";
import {
  X, Plus, Trash2, Globe, Eye, EyeOff, Shield, Check,
  ChevronDown, Lock, Layers,
} from "lucide-react";
import {
  jobStore,
  ContextVariable,
  ContextVarType,
  ContextVarScope,
  Environment,
} from "../../store/jobStore";
import { useJobStore } from "../../store/useJobStore";

interface ContextVariablesProps {
  onClose: () => void;
  /** If provided, shows Local tab for this specific job */
  activeJobId?: string | null;
}

const ENVIRONMENTS: { id: Environment; label: string; color: string }[] = [
  { id: "dev", label: "Desenvolvimento", color: "#10b981" },
  { id: "hml", label: "Homologação", color: "#f59e0b" },
  { id: "prd", label: "Produção", color: "#ef4444" },
];

const VAR_TYPES: { id: ContextVarType; label: string }[] = [
  { id: "string", label: "String" },
  { id: "number", label: "Número" },
  { id: "boolean", label: "Booleano" },
  { id: "secret", label: "Segredo 🔒" },
];

const EMPTY_VALUES: Record<Environment, string> = { dev: "", hml: "", prd: "" };

type NewVarState = {
  key: string;
  type: ContextVarType;
  isSecret: boolean;
  scope: ContextVarScope;
  values: Record<Environment, string>;
  description: string;
};

export const ContextVariablesModal: React.FC<ContextVariablesProps> = ({
  onClose,
  activeJobId,
}) => {
  const state = useJobStore();
  const [activeEnv, setActiveEnv] = useState<Environment>(state.activeEnvironment);
  const [activeScope, setActiveScope] = useState<ContextVarScope>("global");
  const [showSecrets, setShowSecrets] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newVar, setNewVar] = useState<NewVarState | null>(null);

  // Filter by scope
  const visibleVars = state.contextVariables.filter((cv) => {
    if (activeScope === "global") return cv.scope === "global";
    // local: show vars for this job
    return cv.scope === "local" && cv.jobId === (activeJobId ?? "__none__");
  });

  const startNew = () => {
    setNewVar({
      key: "",
      type: "string",
      isSecret: false,
      scope: activeScope,
      values: { ...EMPTY_VALUES },
      description: "",
    });
  };

  const commitNew = () => {
    if (!newVar?.key?.trim()) return;
    jobStore.saveContextVar({
      key: newVar.key.trim().toUpperCase().replace(/\s+/g, "_"),
      type: newVar.type,
      isSecret: newVar.isSecret,
      scope: newVar.scope,
      jobId: newVar.scope === "local" ? (activeJobId ?? undefined) : undefined,
      values: newVar.values,
      description: newVar.description || undefined,
    });
    setNewVar(null);
  };

  const updateValue = (cvId: string, env: Environment, val: string) => {
    const cv = state.contextVariables.find((v) => v.id === cvId);
    if (!cv) return;
    jobStore.updateContextVar(cvId, {
      values: { ...cv.values, [env]: val } as Record<Environment, string>,
    });
  };

  const setGlobalEnv = (env: Environment) => {
    setActiveEnv(env);
    jobStore.setEnvironment(env);
  };

  const maskValue = (val: string) => "•".repeat(Math.min(val.length || 8, 12));

  const activeJob = activeJobId
    ? state.jobs.find((j) => j.id === activeJobId)
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container ctx-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Globe size={18} color="var(--accent-cyan)" />
            <span>Variáveis de Contexto</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowSecrets((s) => !s)}
              title={showSecrets ? "Ocultar segredos" : "Exibir segredos"}
            >
              {showSecrets ? <EyeOff size={13} /> : <Eye size={13} />}
              {showSecrets ? "Ocultar" : "Mostrar"} Segredos
            </button>
            <button className="modal-close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scope Tabs: Global | Local */}
        <div className="ctx-scope-bar">
          <button
            className={`ctx-scope-tab ${activeScope === "global" ? "active" : ""}`}
            onClick={() => setActiveScope("global")}
          >
            <Globe size={13} />
            Globais
            <span className="ctx-scope-count">
              {state.contextVariables.filter((v) => v.scope === "global").length}
            </span>
          </button>
          <button
            className={`ctx-scope-tab ${activeScope === "local" ? "active" : ""}`}
            onClick={() => setActiveScope("local")}
            disabled={!activeJobId}
            title={!activeJobId ? "Abra um job para ver variáveis locais" : "Variáveis locais deste job"}
          >
            <Lock size={13} />
            Locais (Job)
            <span className="ctx-scope-count">
              {state.contextVariables.filter((v) => v.scope === "local" && v.jobId === activeJobId).length}
            </span>
          </button>
          {activeScope === "local" && activeJob && (
            <span className="ctx-scope-job-name">
              → {activeJob.name}
            </span>
          )}

          {/* Scope description */}
          <div className="ctx-scope-hint">
            {activeScope === "global"
              ? "Disponíveis em todos os jobs de qualquer ambiente"
              : "Visíveis apenas neste job específico"}
          </div>
        </div>

        {/* Environment Switcher */}
        <div className="ctx-env-bar">
          <span className="ctx-env-label">Ambiente Ativo:</span>
          <div className="ctx-env-tabs">
            {ENVIRONMENTS.map((env) => (
              <button
                key={env.id}
                className={`ctx-env-tab ${activeEnv === env.id ? "active" : ""}`}
                style={{ "--env-color": env.color } as React.CSSProperties}
                onClick={() => setGlobalEnv(env.id)}
              >
                <span className="ctx-env-dot" style={{ background: env.color }} />
                {env.label}
                {state.activeEnvironment === env.id && (
                  <span className="ctx-env-active-badge">Ativo</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Variable Table */}
        <div className="ctx-table-wrapper">
          <table className="ctx-table">
            <thead>
              <tr>
                <th>Variável</th>
                <th>Tipo</th>
                <th style={{ color: "#10b981" }}>DEV</th>
                <th style={{ color: "#f59e0b" }}>HML</th>
                <th style={{ color: "#ef4444" }}>PRD</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visibleVars.map((cv) => (
                <tr key={cv.id} className={editingId === cv.id ? "editing" : ""}>
                  <td>
                    <div className="ctx-var-name">
                      {cv.isSecret && <Shield size={12} color="var(--accent-purple)" />}
                      {cv.scope === "local" && (
                        <span title="Variável local" style={{ display: "flex" }}>
                          <Lock size={11} color="var(--text-muted)" />
                        </span>
                      )}
                      <code className="ctx-key">{"${" + cv.key + "}"}</code>
                    </div>
                    {cv.description && (
                      <div className="ctx-var-desc">{cv.description}</div>
                    )}
                  </td>
                  <td>
                    <span className="ctx-type-badge">{cv.type}</span>
                  </td>
                  {(["dev", "hml", "prd"] as Environment[]).map((env) => (
                    <td key={env}>
                      {editingId === cv.id ? (
                        <input
                          className="form-input ctx-val-input"
                          type={cv.isSecret && !showSecrets ? "password" : "text"}
                          value={cv.values[env] ?? ""}
                          onChange={(e) => updateValue(cv.id, env, e.target.value)}
                        />
                      ) : (
                        <span className="ctx-val">
                          {cv.isSecret && !showSecrets
                            ? maskValue(cv.values[env] ?? "")
                            : cv.values[env] || <span className="ctx-empty">—</span>}
                        </span>
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="ctx-row-actions">
                      {editingId === cv.id ? (
                        <button
                          className="icon-btn success"
                          onClick={() => setEditingId(null)}
                          title="Concluir edição"
                        >
                          <Check size={13} />
                        </button>
                      ) : (
                        <button
                          className="icon-btn"
                          onClick={() => setEditingId(cv.id)}
                          title="Editar valores"
                        >
                          ✏️
                        </button>
                      )}
                      <button
                        className="icon-btn danger"
                        onClick={() => jobStore.deleteContextVar(cv.id)}
                        title="Excluir variável"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Empty state */}
              {visibleVars.length === 0 && !newVar && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--text-dim)" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      {activeScope === "global"
                        ? <><Globe size={28} opacity={0.15} /><span>Nenhuma variável global</span></>
                        : <><Lock size={28} opacity={0.15} /><span>Nenhuma variável local para este job</span></>
                      }
                    </div>
                  </td>
                </tr>
              )}

              {/* New Variable Row */}
              {newVar && (
                <tr className="ctx-new-row">
                  <td>
                    <input
                      className="form-input ctx-val-input"
                      value={newVar.key}
                      placeholder="NOME_VARIAVEL"
                      autoFocus
                      style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase" }}
                      onChange={(e) =>
                        setNewVar((p) => ({ ...p!, key: e.target.value.toUpperCase() }))
                      }
                    />
                    <input
                      className="form-input ctx-val-input"
                      value={newVar.description}
                      placeholder="Descrição (opcional)"
                      style={{ marginTop: 4, fontSize: "0.75rem" }}
                      onChange={(e) =>
                        setNewVar((p) => ({ ...p!, description: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="form-select ctx-val-input"
                      value={newVar.type}
                      onChange={(e) =>
                        setNewVar((p) => ({
                          ...p!,
                          type: e.target.value as ContextVarType,
                          isSecret: e.target.value === "secret",
                        }))
                      }
                    >
                      {VAR_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                  {(["dev", "hml", "prd"] as Environment[]).map((env) => (
                    <td key={env}>
                      <input
                        className="form-input ctx-val-input"
                        type={newVar.type === "secret" && !showSecrets ? "password" : "text"}
                        value={newVar.values[env]}
                        placeholder={`valor ${env}`}
                        onChange={(e) =>
                          setNewVar((p) => ({
                            ...p!,
                            values: { ...p!.values, [env]: e.target.value } as Record<Environment, string>,
                          }))
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <div className="ctx-row-actions">
                      <button className="icon-btn success" onClick={commitNew}><Check size={13} /></button>
                      <button className="icon-btn danger" onClick={() => setNewVar(null)}><X size={13} /></button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="ctx-footer">
          <button className="btn btn-secondary" onClick={startNew}>
            <Plus size={13} /> Nova Variável {activeScope === "local" ? "Local" : "Global"}
          </button>
          <div className="ctx-usage-hint">
            Use <code>{"${NOME_VARIAVEL}"}</code> nas configs dos componentes — resolvido no ambiente ativo.{" "}
            <strong>Globais</strong> valem em todos os jobs. <strong>Locais</strong> valem apenas neste job.
          </div>
        </div>
      </div>
    </div>
  );
};
