import React from "react";
import { Node } from "reactflow";
import { Settings, Terminal, X } from "lucide-react";
import { CanvasNodeData } from "../../types";
import { PropertyPanel, PropertyPanelProps } from "./PropertyPanel";
import { LogViewerContent } from "../execution/LogViewerContent";

export interface RightSidebarProps extends PropertyPanelProps {
  activeTab: "props" | "logs";
  onTabChange: (tab: "props" | "logs") => void;
  onClose?: () => void;
  onFocusNode?: (nodeId: string, cellId?: string) => void;
  unreadErrorsCount?: number;
  onOpenDetached?: () => void;
  isDetached?: boolean;
  onReattach?: () => void;
  onFocusDetached?: () => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  activeTab,
  onTabChange,
  onClose,
  onFocusNode,
  unreadErrorsCount = 0,
  onOpenDetached,
  isDetached = false,
  onReattach,
  onFocusDetached,
  ...propertyPanelProps
}) => {
  const onStartSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const computedW =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue("--props-w")) || 380;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const newW = Math.max(280, Math.min(850, computedW + delta));
      document.documentElement.style.setProperty("--props-w", `${newW}px`);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const hasSelectedNode = Boolean(propertyPanelProps.selectedNode);

  return (
    <div className="sidebar-properties right-sidebar-container" id="property-panel">
      {/* Alça de redimensionamento na borda esquerda */}
      <div
        className="sidebar-drag-resizer"
        onMouseDown={onStartSidebarResize}
        title="Clique e arraste para redimensionar largura do painel lateral"
      />

      {/* ─── Cabeçalho com Abas da Sidebar Direita ─── */}
      <div
        className="right-sidebar-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-surface-2, #0d121f)",
          padding: "0 6px",
          minHeight: 34,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* Aba Propriedades */}
          <button
            type="button"
            className={`tab-btn ${activeTab === "props" ? "active" : ""}`}
            onClick={() => onTabChange("props")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: activeTab === "props" ? "rgba(255, 255, 255, 0.06)" : "transparent",
              border: "none",
              borderBottom: activeTab === "props" ? "2px solid var(--accent-cyan)" : "2px solid transparent",
              color: activeTab === "props" ? "#f8fafc" : "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: activeTab === "props" ? 600 : 400,
              cursor: "pointer",
              position: "relative",
            }}
          >
            <Settings size={13} color={activeTab === "props" ? "var(--accent-cyan)" : "currentColor"} />
            <span>Propriedades</span>
            {/* Ponto discreto quando há nó selecionado e o usuário está na aba Logs */}
            {hasSelectedNode && activeTab !== "props" && (
              <span
                className="selected-node-indicator-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent-cyan)",
                  display: "inline-block",
                  boxShadow: "0 0 6px var(--accent-cyan)",
                }}
                title="Existe um componente selecionado no canvas"
              />
            )}
          </button>

          {/* Aba Logs */}
          <button
            type="button"
            className={`tab-btn ${activeTab === "logs" ? "active" : ""}`}
            onClick={() => onTabChange("logs")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: activeTab === "logs" ? "rgba(255, 255, 255, 0.06)" : "transparent",
              border: "none",
              borderBottom: activeTab === "logs" ? "2px solid var(--accent-purple)" : "2px solid transparent",
              color: activeTab === "logs" ? "#f8fafc" : "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: activeTab === "logs" ? 600 : 400,
              cursor: "pointer",
              position: "relative",
            }}
          >
            <Terminal size={13} color={activeTab === "logs" ? "var(--accent-purple)" : "currentColor"} />
            <span>Logs</span>
            {/* Selo com contagem de ERROR novos */}
            {unreadErrorsCount > 0 && (
              <span
                className="unread-error-badge"
                style={{
                  fontSize: "0.62rem",
                  fontWeight: 700,
                  background: "var(--status-danger, #ef4444)",
                  color: "#ffffff",
                  padding: "1px 5px",
                  borderRadius: 10,
                  minWidth: 14,
                  textAlign: "center",
                  lineHeight: "12px",
                }}
                title={`${unreadErrorsCount} novos erro(s)`}
              >
                {unreadErrorsCount > 99 ? "99+" : unreadErrorsCount}
              </span>
            )}
          </button>
        </div>

        {/* Botão de Fechar Painel Lateral */}
        {onClose && (
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            style={{ padding: 4 }}
            title="Recolher painel lateral"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ─── Conteúdo das Abas (Mantém ambos montados para não perder estado de seleção) ─── */}
      <div
        className="right-sidebar-body"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Aba Propriedades: permanece no DOM (display: none quando inativa) */}
        <div
          style={{
            display: activeTab === "props" ? "flex" : "none",
            flex: 1,
            flexDirection: "column",
            minHeight: 0,
            height: "100%",
            overflow: "hidden",
          }}
        >
          <PropertyPanel {...propertyPanelProps} />
        </div>

        {/* Aba Logs: permanece no DOM */}
        <div
          style={{
            display: activeTab === "logs" ? "flex" : "none",
            flex: 1,
            flexDirection: "column",
            minHeight: 0,
            height: "100%",
            overflow: "hidden",
          }}
        >
          <LogViewerContent
            onFocusNode={onFocusNode}
            onExpandPopOut={onOpenDetached}
            isDetached={isDetached}
            onReattach={onReattach}
            onFocusDetached={onFocusDetached}
          />
        </div>
      </div>
    </div>
  );
};
