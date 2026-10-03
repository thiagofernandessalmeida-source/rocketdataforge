import React from "react";
import { TaskRunDetail } from "../../types";
import { CheckCircle2, AlertCircle, Clock, ArrowDownRight, ArrowUpRight } from "lucide-react";

interface MetricsTableProps {
  tasks: TaskRunDetail[];
}

export const MetricsTable: React.FC<MetricsTableProps> = ({ tasks }) => {
  if (!tasks || tasks.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
        Nenhuma métrica de nós disponível. Dispare uma execução para visualizar o fluxo de dados em tempo real.
      </div>
    );
  }

  return (
    <table className="metrics-table" id="table-node-metrics">
      <thead>
        <tr>
          <th>Nó / Operador</th>
          <th>Status</th>
          <th>Linhas de Entrada (In)</th>
          <th>Linhas Emitidas (Out)</th>
          <th>Duração</th>
          <th>Mensagem de Erro</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.node_id}>
            <td style={{ fontWeight: 600, color: "var(--accent-cyan)" }}>{t.node_id}</td>
            <td>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color:
                    t.status === "succeeded"
                      ? "var(--status-success)"
                      : t.status === "failed"
                      ? "var(--status-danger)"
                      : "var(--accent-blue)",
                }}
              >
                {t.status === "succeeded" && <CheckCircle2 size={13} />}
                {t.status === "failed" && <AlertCircle size={13} />}
                {t.status === "running" && <Clock size={13} />}
                {t.status}
              </span>
            </td>
            <td>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ArrowDownRight size={13} color="var(--text-muted)" />
                {t.rows_in.toLocaleString()}
              </span>
            </td>
            <td>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ArrowUpRight size={13} color="var(--text-muted)" />
                {t.rows_out.toLocaleString()}
              </span>
            </td>
            <td>{t.duration_ms !== undefined ? `${t.duration_ms} ms` : "-"}</td>
            <td style={{ color: "var(--status-danger)", fontSize: "0.72rem" }}>
              {t.error_message || "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
