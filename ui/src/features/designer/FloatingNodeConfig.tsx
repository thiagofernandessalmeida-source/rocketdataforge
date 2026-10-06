import React, { useState, useRef, useEffect, useCallback } from "react";
import { Node } from "reactflow";
import { X, Minimize2, GripHorizontal } from "lucide-react";
import { CanvasNodeData } from "../../types";
import { PropertyPanel } from "./PropertyPanel";
import { ConnectionEntry, ContextVariable, SchemaColumn, Environment, QueryEntry } from "../../store/jobStore";

interface FloatingNodeConfigProps {
  node: Node<CanvasNodeData>;
  onUpdateConfig: (nodeId: string, config: Record<string, any>) => void;
  onUpdateLabel?: (nodeId: string, label: string) => void;
  onUpdateSchema?: (nodeId: string, schema: SchemaColumn[]) => void;
  onUpdateNodeId?: (oldId: string, newId: string) => void;
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
 * Floating draggable window for node configuration.
 * Opened on double-click of a canvas node.
 * Implements drag-to-reposition via mouse events.
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
  // Initial position: centered horizontally, near top
  const [pos, setPos] = useState({ x: window.innerWidth / 2 - 180, y: 80 });
  const [size, setSize] = useState({ w: 420, h: 600 });
  const [minimized, setMinimized] = useState(false);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Drag handlers ─────────────────────────────────────────────
  const onMouseDownHeader = useCallback((e: React.MouseEvent) => {
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
      className="floating-node-config"
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
            className="icon-btn"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? "Restaurar" : "Minimizar"}
          >
            <Minimize2 size={13} />
          </button>
          <button className="icon-btn danger" onClick={onClose} title="Fechar">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body — reuse PropertyPanel without the outer wrapper */}
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
            // No pop-out in a floating window (avoid infinite nesting)
            onPopOut={undefined}
          />
        </div>
      )}

      {/* Resize handle (bottom-right) */}
      {!minimized && (
        <div
          className="floating-resize-handle"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = size.w;
            const startH = size.h;
            const onMove = (ev: MouseEvent) => {
              setSize({
                w: Math.max(320, startW + (ev.clientX - startX)),
                h: Math.max(400, startH + (ev.clientY - startY)),
              });
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            e.preventDefault();
          }}
        />
      )}
    </div>
  );
};
