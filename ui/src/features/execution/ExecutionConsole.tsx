import React, { useState } from "react";
import { CompiledPlans, ExecutionDetail, LogEntry } from "../../types";
import { MetricsTable } from "./MetricsTable";
import {
  Activity,
  Terminal,
  FileCode,
  XCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Crosshair,
  RefreshCw,
  Info,
} from "lucide-react";

export interface ProblemItem {
  code: string;
  message: string;
  node_id?: string;
  node_label?: string;
  severity: "error" | "warning";
  suggestion?: string;
}

interface ExecutionConsoleProps {
  execution: ExecutionDetail | null;
  logs: LogEntry[];
  compiledPlans: CompiledPlans | null;
  onCancelExecution: () => void;
  problems?: ProblemItem[];
  activeTab?: "metrics" | "logs" | "plans" | "problems";
  onTabChange?: (tab: "metrics" | "logs" | "plans" | "problems") => void;
  onFocusNode?: (nodeId: string) => void;
  onRevalidate?: () => void;
}

export const ExecutionConsole: React.FC<ExecutionConsoleProps> = ({
  execution,
  logs,
  compiledPlans,
  onCancelExecution,
  problems = [],
  activeTab: externalActiveTab,
  onTabChange,
  onFocusNode,
  onRevalidate,
}) => {
  const [internalActiveTab, setInternalActiveTab] = useState<"metrics" | "logs" | "plans" | "problems">("metrics");
  const [isExpanded, setIsExpanded] = useState(true);

  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = (tab: "metrics" | "logs" | "plans" | "problems") => {
    if (onTabChange) onTabChange(tab);
    setInternalActiveTab(tab);
  };

  const isRunning =
    execution && (execution.status === "running" || execution.status === "queued");

  const errorCount = problems.filter((p) => p.severity === "error").length;
  const warningCount = problems.filter((p) => p.severity === "warning").length;

  return (
    <div
      className="execution-console"
      id="execution-console"
      style={{
        height: isExpanded ? "270px" : "40px",
      }}
    >
      <div className="console-tabs">
        <div className="tab-list">
          {/* Problemas & Diagnóstico */}
          <button
            type="button"
            className={`tab-btn ${activeTab === "problems" ? "active" : ""}`}
            id="tab-btn-problems"
            onClick={() => {
              setActiveTab("problems");
              setIsExpanded(true);
            }}
            style={{
              color: errorCount > 0 ? "var(--status-danger)" : warningCount > 0 ? "#f59e0b" : undefined,
            }}
          >
            {errorCount > 0 ? (
              <AlertCircle size={14} color="var(--status-danger)" />
            ) : warningCount > 0 ? (
              <AlertTriangle size={14} color="#f59e0b" />
            ) : (
              <CheckCircle2 size={14} color="var(--status-success)" />
            )}
            <span>Problemas & Diagnóstico</span>
            {problems.length > 0 && (
              <span
                className="badge"
                style={{
                  marginLeft: 5,
                  fontSize: "0.68rem",
                  padding: "1px 6px",
                  background: errorCount > 0 ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
                  color: errorCount > 0 ? "var(--status-danger)" : "#f59e0b",
                  borderColor: errorCount > 0 ? "var(--status-danger)" : "#f59e0b",
                }}
              >
                {problems.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === "metrics" ? "active" : ""}`}
            id="tab-btn-metrics"
            onClick={() => {
              setActiveTab("metrics");
              setIsExpanded(true);
            }}
          >
            <Activity size={14} />
            <span>Métricas de Execução</span>
            {execution && (
              <span
                className={`badge ${
                  isRunning
                    ? "badge-running"
                    : execution.status === "succeeded"
                    ? "badge-success"
                    : ""
                }`}
                style={{ marginLeft: 4 }}
              >
                {execution.status}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === "logs" ? "active" : ""}`}
            id="tab-btn-logs"
            onClick={() => {
              setActiveTab("logs");
              setIsExpanded(true);
            }}
          >
            <Terminal size={14} />
            <span>Logs Estruturados ({logs.length})</span>
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === "plans" ? "active" : ""}`}
            id="tab-btn-plans"
            onClick={() => {
              setActiveTab("plans");
              setIsExpanded(true);
            }}
          >
            <FileCode size={14} />
            <span>Planos Compilados</span>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onRevalidate && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRevalidate}
              style={{ padding: "3px 8px", fontSize: "0.72rem", gap: 4 }}
              title="Executar Diagnóstico e Validação do Grafo"
            >
              <RefreshCw size={12} />
              <span>Revalidar</span>
            </button>
          )}

          {isRunning && (
            <button
              type="button"
              className="btn btn-danger"
              id="btn-cancel-execution"
              onClick={onCancelExecution}
              style={{ padding: "4px 10px", fontSize: "0.75rem" }}
            >
              <XCircle size={13} />
              <span>Cancelar Execução</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{ padding: "4px 8px" }}
            title={isExpanded ? "Recolher Painel" : "Expandir Painel"}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="console-body" style={{ overflowY: "auto", maxHeight: "220px" }}>
          {/* PROBLEMAS & DIAGNÓSTICO TAB */}
          {activeTab === "problems" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
              {problems.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    borderRadius: 8,
                    padding: "16px 20px",
                    color: "var(--text-primary)",
                  }}
                >
                  <CheckCircle2 size={24} color="var(--status-success)" />
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--status-success)", fontSize: "0.88rem" }}>
                      Grafo Acíclico Válido (Nenhum Erro Estrutural)
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2 }}>
                      Todas as fontes, transformações do tMap e saídas estão conectadas e prontas para execução.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: errorCount > 0 ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
                      border: `1px solid ${errorCount > 0 ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
                      padding: "8px 12px",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", fontWeight: 600 }}>
                      <AlertCircle size={16} color={errorCount > 0 ? "var(--status-danger)" : "#f59e0b"} />
                      <span>
                        {errorCount > 0
                          ? `${errorCount} erro(s) encontrado(s) no job atual:`
                          : `${warningCount} aviso(s) de validação:`}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {problems.map((prob, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          background: "var(--bg-card)",
                          border: `1px solid ${prob.severity === "error" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
                          borderRadius: 6,
                          padding: "8px 12px",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span
                              className="badge"
                              style={{
                                fontSize: "0.68rem",
                                padding: "1px 5px",
                                background: prob.severity === "error" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
                                color: prob.severity === "error" ? "var(--status-danger)" : "#f59e0b",
                                borderColor: prob.severity === "error" ? "var(--status-danger)" : "#f59e0b",
                              }}
                            >
                              {prob.severity === "error" ? "ERRO" : "AVISO"}
                            </span>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--accent-cyan)", fontWeight: 600 }}>
                              {prob.code}
                            </span>
                            {prob.node_id && (
                              <span style={{ fontSize: "0.75rem", color: "var(--accent-purple)", fontWeight: 500 }}>
                                Nó: <b>{prob.node_label || prob.node_id}</b>
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--text-primary)", marginTop: 2 }}>
                            {prob.message}
                          </div>
                          {prob.suggestion && (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                              <Info size={11} color="var(--accent-blue)" />
                              <span><b>Sugestão:</b> {prob.suggestion}</span>
                            </div>
                          )}
                        </div>

                        {prob.node_id && onFocusNode && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => onFocusNode(prob.node_id!)}
                            style={{
                              fontSize: "0.72rem",
                              padding: "4px 8px",
                              gap: 4,
                              whiteSpace: "nowrap",
                              alignSelf: "center",
                            }}
                            title="Selecionar e configurar este nó no Canvas"
                          >
                            <Crosshair size={12} />
                            <span>Localizar Nó</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "metrics" && (
            <MetricsTable tasks={execution?.tasks || []} />
          )}

          {activeTab === "logs" && (
            <div id="logs-container" style={{ display: "flex", flexDirection: "column" }}>
              {logs.length === 0 ? (
                <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
                  Nenhum log estruturado emitido para esta sessão.
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="log-line">
                    <span className="log-time">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`log-level-${log.level.toLowerCase()}`}>
                      [{log.level}]
                    </span>
                    {log.node_id && (
                      <span style={{ color: "var(--accent-purple)" }}>
                        ({log.node_id})
                      </span>
                    )}
                    <span className="log-msg">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "plans" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!compiledPlans ? (
                <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
                  Nenhum plano compilado disponível. Publique uma versão e clique em "Compilar".
                </div>
              ) : (
                <>
                  {compiledPlans.optimizations_applied?.length > 0 && (
                    <div style={{ background: "rgba(59, 130, 246, 0.1)", padding: 8, borderRadius: 6 }}>
                      <div style={{ fontWeight: 600, color: "var(--accent-cyan)", marginBottom: 4 }}>
                        Otimizações Aplicadas (Pushdown & Regras Semânticas):
                      </div>
                      {compiledPlans.optimizations_applied.map((opt, i) => (
                        <div key={i} style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                          • <b>{opt.rule}</b>: {opt.description} (Nós: {opt.affected_nodes.join(", ")})
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                      Plano Físico Compilado (Physical Plan):
                    </div>
                    <pre
                      style={{
                        background: "var(--bg-app)",
                        padding: 10,
                        borderRadius: 6,
                        overflowX: "auto",
                      }}
                    >
                      {JSON.stringify(compiledPlans.physical_plan, null, 2)}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
