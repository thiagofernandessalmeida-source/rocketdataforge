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
} from "lucide-react";

interface ExecutionConsoleProps {
  execution: ExecutionDetail | null;
  logs: LogEntry[];
  compiledPlans: CompiledPlans | null;
  onCancelExecution: () => void;
}

export const ExecutionConsole: React.FC<ExecutionConsoleProps> = ({
  execution,
  logs,
  compiledPlans,
  onCancelExecution,
}) => {
  const [activeTab, setActiveTab] = useState<"metrics" | "logs" | "plans">("metrics");
  const [isExpanded, setIsExpanded] = useState(true);

  const isRunning =
    execution && (execution.status === "running" || execution.status === "queued");

  return (
    <div
      className="execution-console"
      id="execution-console"
      style={{
        height: isExpanded ? "260px" : "40px",
      }}
    >
      <div className="console-tabs">
        <div className="tab-list">
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
            Métricas de Execução
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
            Logs Estruturados ({logs.length})
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
            Planos Compilados
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isRunning && (
            <button
              type="button"
              className="btn btn-danger"
              id="btn-cancel-execution"
              onClick={onCancelExecution}
              style={{ padding: "4px 10px", fontSize: "0.75rem" }}
            >
              <XCircle size={13} />
              Cancelar Execução
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
        <div className="console-body">
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
