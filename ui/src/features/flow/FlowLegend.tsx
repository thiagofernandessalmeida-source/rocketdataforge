import React, { useState } from "react";
import { Info, ChevronUp, ChevronDown } from "lucide-react";

export const FlowLegend: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        background: "var(--bg-surface, #0f172a)",
        border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))",
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
        fontSize: "0.68rem",
        color: "var(--text-muted, #94a3b8)",
        zIndex: 30,
        overflow: "hidden",
        minWidth: collapsed ? "auto" : "210px",
      }}
      role="region"
      aria-label="Legenda do Fluxo"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: collapsed ? "none" : "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
          cursor: "pointer",
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "var(--text-primary, #f8fafc)" }}>
          <Info size={12} color="var(--accent-cyan, #38bdf8)" />
          <span>Legenda do Fluxo</span>
        </div>
        <button
          type="button"
          style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir legenda" : "Recolher legenda"}
        >
          {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Tipos de Célula */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "rgba(56, 189, 248, 0.2)",
                border: "1px solid #38bdf8",
                color: "#38bdf8",
                fontSize: "0.6rem",
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              C
            </div>
            <span>Célula Canvas (Componentes)</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "rgba(245, 158, 11, 0.2)",
                border: "1px solid #f59e0b",
                color: "#f59e0b",
                fontSize: "0.6rem",
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              P
            </div>
            <span>Célula Python (Script)</span>
          </div>

          <div style={{ height: "1px", background: "var(--border-subtle, rgba(255, 255, 255, 0.08))", margin: "2px 0" }} />

          {/* Tipos de Ligação */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="24" height="8">
              <line x1="0" y1="4" x2="24" y2="4" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Pré-condição OK (Contínuo)</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="24" height="8">
              <line x1="0" y1="4" x2="24" y2="4" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
            </svg>
            <span>Pré-condição ERRO (Tracejado)</span>
          </div>
        </div>
      )}
    </div>
  );
};
