import React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 70,
        right: 20,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: "var(--bg-card)",
            border: `1px solid ${
              t.type === "success"
                ? "var(--status-success)"
                : t.type === "error"
                ? "var(--status-danger)"
                : "var(--accent-blue)"
            }`,
            boxShadow: "var(--shadow-lg)",
            padding: "10px 14px",
            borderRadius: 8,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: "0.8rem",
            color: "var(--text-primary)",
            backdropFilter: "blur(12px)",
          }}
        >
          {t.type === "success" && <CheckCircle2 size={16} color="var(--status-success)" />}
          {t.type === "error" && <AlertCircle size={16} color="var(--status-danger)" />}
          {t.type === "info" && <Info size={16} color="var(--accent-blue)" />}

          <div style={{ flex: 1, lineHeight: 1.3 }}>{t.message}</div>

          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
