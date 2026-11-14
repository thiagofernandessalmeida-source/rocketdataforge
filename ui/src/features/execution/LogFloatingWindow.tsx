import React from "react";
import { Terminal, Minimize2, Maximize2, Minus, X, GripHorizontal, ArrowDownLeft } from "lucide-react";
import { useDraggableResizable } from "../designer/hooks/useDraggableResizable";
import { LogViewerContent } from "./LogViewerContent";

export interface LogFloatingWindowProps {
  onClose: () => void;
  onFocusNode?: (nodeId: string, cellId?: string) => void;
}

/**
 * Janela flutuante de logs gerais dentro da aplicação Web (fallback quando fora do Electron).
 * Utiliza useDraggableResizable com persistência segura em localStorage.
 */
export const LogFloatingWindow: React.FC<LogFloatingWindowProps> = ({
  onClose,
  onFocusNode,
}) => {
  const {
    pos,
    size,
    minimized,
    setMinimized,
    maximized,
    setMaximized,
    onMouseDownHeader,
    onStartResize,
    handleToggleMaximize,
    containerRef,
  } = useDraggableResizable({
    defaultWidth: 840,
    defaultHeight: 560,
    minWidth: 420,
    minHeight: 280,
    storageKey: "cellflow_floating_logs_layout",
  });

  return (
    <div
      ref={containerRef}
      className={`floating-node-config floating-logs-window ${maximized ? "is-maximized" : ""}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? 44 : size.h,
        zIndex: 4500,
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.75)",
        border: "1px solid #334155",
        background: "#090d16",
      }}
    >
      {/* ─── Cabeçalho Arrastável ─── */}
      <div
        className="floating-node-header"
        style={{
          borderTopColor: "var(--accent-purple)",
          background: "#0f172a",
          cursor: "grab",
        }}
        onMouseDown={onMouseDownHeader}
        onDoubleClick={handleToggleMaximize}
        title="Arraste para mover • Duplo clique para maximizar/restaurar • No navegador, a janela fica dentro do app"
      >
        <div className="floating-node-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GripHorizontal size={14} color="var(--text-dim)" />
          <Terminal size={14} color="var(--accent-purple)" />
          <span className="floating-node-label" style={{ color: "#f8fafc", fontWeight: 600 }}>
            CellFlow - Log Geral (Sessão)
          </span>
          <span
            style={{
              fontSize: "0.65rem",
              color: "#94a3b8",
              background: "rgba(255, 255, 255, 0.06)",
              padding: "1px 6px",
              borderRadius: 4,
            }}
            title="No navegador, a janela fica dentro do app. No Electron, ela pode ser movida para outro monitor."
          >
            Navegador (Dentro do App)
          </span>
        </div>

        <div className="floating-node-actions" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* Reacoplar / Fechar */}
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="Reacoplar à barra lateral"
          >
            <ArrowDownLeft size={13} />
          </button>
          {/* Maximizar */}
          <button
            type="button"
            className="icon-btn"
            onClick={handleToggleMaximize}
            title={maximized ? "Restaurar tamanho" : "Maximizar janela"}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {/* Minimizar */}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? "Restaurar" : "Minimizar"}
          >
            <Minus size={13} />
          </button>
          {/* Fechar */}
          <button type="button" className="icon-btn danger" onClick={onClose} title="Fechar">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ─── Corpo: LogViewerContent ─── */}
      {!minimized && (
        <div style={{ flex: 1, minHeight: 0, height: "calc(100% - 44px)", display: "flex", flexDirection: "column" }}>
          <LogViewerContent
            onFocusNode={onFocusNode}
            onExpandPopOut={undefined}
          />
        </div>
      )}

      {/* ─── Alças de Redimensionamento em 8 direções ─── */}
      {!minimized && !maximized && (
        <>
          <div
            className="floating-resize-edge floating-resize-e"
            onMouseDown={(e) => onStartResize("e", e)}
            title="Arrastar borda para alterar largura"
          />
          <div
            className="floating-resize-edge floating-resize-w"
            onMouseDown={(e) => onStartResize("w", e)}
            title="Arrastar borda para alterar largura"
          />
          <div
            className="floating-resize-edge floating-resize-s"
            onMouseDown={(e) => onStartResize("s", e)}
            title="Arrastar borda para alterar altura"
          />
          <div
            className="floating-resize-edge floating-resize-n"
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, cursor: "ns-resize" }}
            onMouseDown={(e) => onStartResize("n", e)}
            title="Arrastar borda para alterar altura"
          />
          <div
            className="floating-resize-corner floating-resize-sw"
            onMouseDown={(e) => onStartResize("sw", e)}
            title="Arrastar canto para redimensionar"
          />
          <div
            className="floating-resize-corner floating-resize-se"
            onMouseDown={(e) => onStartResize("se", e)}
            title="Arrastar canto para redimensionar"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="6" x2="6" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="10" x2="10" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
};
