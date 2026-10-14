import React, { useState, useRef, useEffect, useCallback } from "react";
import { Node } from "reactflow";
import { X, Minimize2, Maximize2, Minus, GripHorizontal } from "lucide-react";
import { CanvasNodeData } from "../../types";
import { PropertyPanel } from "./PropertyPanel";
import { ConnectionEntry, ContextVariable, SchemaColumn, Environment, QueryEntry } from "../../store/jobStore";

interface FloatingNodeConfigProps {
  node: Node<CanvasNodeData>;
  onUpdateConfig: (nodeId: string, config: Record<string, any>) => void;
  onUpdateLabel?: (nodeId: string, label: string) => void;
  onUpdateSchema?: (nodeId: string, schema: SchemaColumn[]) => void;
  onUpdateNodeId?: (oldId: string, newId: string, cellId?: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
  connections?: ConnectionEntry[];
  queryBank?: QueryEntry[];
  contextVariables?: ContextVariable[];
  activeEnvironment?: Environment;
  allNodes?: Node<CanvasNodeData>[];
  edges?: any[];
}

/**
 * Floating draggable & resizable window for node configuration.
 * Opened on double-click of a canvas node.
 * Supports multi-directional edge & corner resizing with visible corner grip.
 */
export const FloatingNodeConfig: React.FC<FloatingNodeConfigProps> = ({
  node,
  onUpdateConfig,
  onUpdateLabel,
  onUpdateSchema,
  onUpdateNodeId,
  onDeleteNode,
  onClose,
  connections,
  queryBank,
  contextVariables,
  activeEnvironment,
  allNodes,
  edges,
}) => {
  // Initial size and position: generous, comfortable default
  const defaultW = Math.min(520, window.innerWidth - 60);
  const defaultH = Math.min(680, window.innerHeight - 100);
  const [pos, setPos] = useState({
    x: Math.max(30, Math.round(window.innerWidth / 2 - defaultW / 2)),
    y: Math.max(40, Math.round(window.innerHeight / 2 - defaultH / 2)),
  });
  const [size, setSize] = useState({ w: defaultW, h: defaultH });
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const prevLayout = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } }>({
    pos: { x: Math.max(30, Math.round(window.innerWidth / 2 - defaultW / 2)), y: 60 },
    size: { w: defaultW, h: defaultH },
  });

  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Drag to move ───────────────────────────────────────────────
  const onMouseDownHeader = useCallback((e: React.MouseEvent) => {
    // Only drag on left click and not on action buttons
    if (e.button !== 0 || (e.target as HTMLElement).closest(".floating-node-actions")) return;
    dragging.current = true;
    dragOffset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - size.w, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [size.w]);

  // ── Maximize toggle ───────────────────────────────────────────
  const handleToggleMaximize = useCallback(() => {
    if (minimized) setMinimized(false);
    if (!maximized) {
      prevLayout.current = { pos, size };
      const maxW = Math.min(1080, window.innerWidth - 60);
      const maxH = window.innerHeight - 80;
      setPos({ x: Math.max(20, Math.round((window.innerWidth - maxW) / 2)), y: 40 });
      setSize({ w: maxW, h: maxH });
      setMaximized(true);
    } else {
      setPos(prevLayout.current.pos);
      setSize(prevLayout.current.size);
      setMaximized(false);
    }
  }, [maximized, minimized, pos, size]);

  // ── Multi-directional Resizing ────────────────────────────────
  const onStartResize = useCallback(
    (direction: "se" | "sw" | "s" | "e" | "w", e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (maximized) setMaximized(false);
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = size.w;
      const startH = size.h;
      const startPosX = pos.x;

      const onMove = (ev: MouseEvent) => {
        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;

        let newW = startW;
        let newH = startH;
        let newX = startPosX;

        if (direction === "se" || direction === "e") {
          newW = Math.max(360, Math.min(window.innerWidth - startPosX - 20, startW + deltaX));
        }
        if (direction === "sw" || direction === "w") {
          const potentialW = startW - deltaX;
          if (potentialW >= 360) {
            newW = Math.min(startPosX + startW - 20, potentialW);
            newX = startPosX + (startW - newW);
          } else {
            newW = 360;
            newX = startPosX + startW - 360;
          }
        }
        if (direction === "se" || direction === "sw" || direction === "s") {
          newH = Math.max(300, Math.min(window.innerHeight - pos.y - 20, startH + deltaY));
        }

        setSize({ w: Math.round(newW), h: Math.round(newH) });
        if (direction === "sw" || direction === "w") {
          setPos((p) => ({ ...p, x: Math.round(newX) }));
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };

      document.body.style.userSelect = "none";
      if (direction === "se") document.body.style.cursor = "nwse-resize";
      else if (direction === "sw") document.body.style.cursor = "nesw-resize";
      else if (direction === "s") document.body.style.cursor = "ns-resize";
      else document.body.style.cursor = "ew-resize";

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [maximized, pos.x, pos.y, size.w, size.h]
  );

  const handleDelete = (nodeId: string) => {
    onDeleteNode(nodeId);
    onClose();
  };

  const catColor: Record<string, string> = {
    source: "var(--cat-source)",
    transform: "var(--cat-transform)",
    target: "var(--cat-target)",
    control: "var(--cat-control)",
  };
  const headerColor = catColor[node.data.category] ?? "var(--accent-cyan)";

  return (
    <div
      ref={containerRef}
      className={`floating-node-config ${maximized ? "is-maximized" : ""}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? 44 : size.h,
      }}
    >
      {/* Drag handle / header */}
      <div
        className="floating-node-header"
        style={{ borderTopColor: headerColor }}
        onMouseDown={onMouseDownHeader}
        onDoubleClick={handleToggleMaximize}
        title="Arraste para mover • Duplo clique para maximizar/restaurar"
      >
        <div className="floating-node-title">
          <GripHorizontal size={14} color="var(--text-dim)" />
          <span
            className="floating-node-label"
            style={{ color: headerColor }}
          >
            {node.data.label || node.id}
          </span>
          <span className="floating-node-type">{node.data.componentType}</span>
        </div>
        <div className="floating-node-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={handleToggleMaximize}
            title={maximized ? "Restaurar tamanho" : "Maximizar janela"}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? "Restaurar" : "Minimizar"}
          >
            <Minus size={13} />
          </button>
          <button type="button" className="icon-btn danger" onClick={onClose} title="Fechar">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body — PropertyPanel inside fully constrained body */}
      {!minimized && (
        <div className="floating-node-body">
          <PropertyPanel
            selectedNode={node}
            onUpdateConfig={onUpdateConfig}
            onUpdateLabel={onUpdateLabel}
            onUpdateSchema={onUpdateSchema}
            onUpdateNodeId={onUpdateNodeId}
            onDeleteNode={handleDelete}
            connections={connections}
            queryBank={queryBank}
            contextVariables={contextVariables}
            activeEnvironment={activeEnvironment}
            allNodes={allNodes}
            edges={edges}
            onPopOut={undefined}
          />
        </div>
      )}

      {/* Multi-directional Resize Handles */}
      {!minimized && !maximized && (
        <>
          {/* Right edge */}
          <div
            className="floating-resize-edge floating-resize-e"
            onMouseDown={(e) => onStartResize("e", e)}
            title="Arrastar borda para alterar largura"
          />
          {/* Left edge */}
          <div
            className="floating-resize-edge floating-resize-w"
            onMouseDown={(e) => onStartResize("w", e)}
            title="Arrastar borda para alterar largura"
          />
          {/* Bottom edge */}
          <div
            className="floating-resize-edge floating-resize-s"
            onMouseDown={(e) => onStartResize("s", e)}
            title="Arrastar borda para alterar altura"
          />
          {/* Bottom-left corner */}
          <div
            className="floating-resize-corner floating-resize-sw"
            onMouseDown={(e) => onStartResize("sw", e)}
            title="Arrastar canto para redimensionar"
          />
          {/* Bottom-right corner (prominent visual grip) */}
          <div
            className="floating-resize-corner floating-resize-se"
            onMouseDown={(e) => onStartResize("se", e)}
            title="Arrastar canto para aumentar ou diminuir a janela"
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
