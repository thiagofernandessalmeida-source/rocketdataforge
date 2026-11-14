import React from "react";
import { Node } from "reactflow";
import { X, Minimize2, Maximize2, Minus, GripHorizontal } from "lucide-react";
import { CanvasNodeData } from "../../types";
import { PropertyPanel } from "./PropertyPanel";
import { ConnectionEntry, ContextVariable, SchemaColumn, Environment, QueryEntry } from "../../store/jobStore";
import { useDraggableResizable } from "./hooks/useDraggableResizable";

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
    defaultWidth: 520,
    defaultHeight: 680,
    minWidth: 360,
    minHeight: 300,
    maxWidth: 1080,
  });

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
