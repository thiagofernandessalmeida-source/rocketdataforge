import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Play,
  Square,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AlertTriangle,
  Layers,
  GitBranch,
} from "lucide-react";
import { buildJobFlowModel } from "./jobFlowModel";
import { computeJobFlowLayout } from "./jobFlowLayout";
import { FlowCellNode } from "./FlowCellNode";
import { FlowLinksOverlay } from "./FlowLinksOverlay";
import { FlowLegend } from "./FlowLegend";
import {
  getExpandedCellsPreference,
  setExpandedCellsPreference,
} from "./flowStorageUtils";

interface JobFlowViewProps {
  jobId: string;
  jobName: string;
  cells: any[];
  onSwitchView: (view: "canvas" | "flow") => void;
  onFocusNode: (nodeId: string, cellId: string) => void;
  onOpenCellInCanvas?: (cellId: string) => void;
  onExecuteJob?: () => void;
  onCancelJob?: () => void;
  onRunSingleCell?: (cellId: string) => void;
  onStopSingleCell?: (cellId: string) => void;
  isJobRunning?: boolean;
}

export const JobFlowView: React.FC<JobFlowViewProps> = ({
  jobId,
  jobName,
  cells = [],
  onSwitchView,
  onFocusNode,
  onOpenCellInCanvas,
  onExecuteJob,
  onCancelJob,
  onRunSingleCell,
  onStopSingleCell,
  isJobRunning = false,
}) => {
  // 1. Estado de expansão das células (persistido por jobId via localStorage)
  const [expandedCellIds, setExpandedCellIds] = useState<Set<string>>(() =>
    getExpandedCellsPreference(jobId)
  );

  useEffect(() => {
    setExpandedCellIds(getExpandedCellsPreference(jobId));
  }, [jobId]);

  const updateExpandedCells = useCallback(
    (newSet: Set<string>) => {
      setExpandedCellIds(newSet);
      setExpandedCellsPreference(jobId, newSet);
    },
    [jobId]
  );

  const toggleExpand = useCallback(
    (cellId: string) => {
      const next = new Set(expandedCellIds);
      if (next.has(cellId)) {
        next.delete(cellId);
      } else {
        next.add(cellId);
      }
      updateExpandedCells(next);
    },
    [expandedCellIds, updateExpandedCells]
  );

  const expandAll = useCallback(() => {
    const allIds = new Set(cells.map((c) => c.id));
    updateExpandedCells(allIds);
  }, [cells, updateExpandedCells]);

  const collapseAll = useCallback(() => {
    updateExpandedCells(new Set());
  }, [updateExpandedCells]);

  // 2. Modelo do fluxo e layout colunar puro
  const flowModel = useMemo(() => buildJobFlowModel(cells), [cells]);
  const layout = useMemo(
    () => computeJobFlowLayout(flowModel, expandedCellIds),
    [flowModel, expandedCellIds]
  );

  // 3. Pan e Zoom do Viewport
  const [scale, setScale] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

  // Ajustar à tela (Fit view)
  const fitView = useCallback(() => {
    if (!viewportRef.current || layout.totalWidth <= 0 || layout.totalHeight <= 0) return;
    const { clientWidth, clientHeight } = viewportRef.current;
    const padding = 80;

    const scaleX = (clientWidth - padding) / layout.totalWidth;
    const scaleY = (clientHeight - padding) / layout.totalHeight;
    const newScale = Math.min(1.2, Math.max(0.3, Math.min(scaleX, scaleY)));

    const scaledWidth = layout.totalWidth * newScale;
    const scaledHeight = layout.totalHeight * newScale;

    const newPanX = Math.max(20, (clientWidth - scaledWidth) / 2);
    const newPanY = Math.max(20, (clientHeight - scaledHeight) / 2);

    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  }, [layout.totalWidth, layout.totalHeight]);

  // Auto fit na primeira carga
  useEffect(() => {
    fitView();
  }, [fitView]);

  // Manipulação de Pan com mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    // Se clicar em um botão ou card, não inicia o pan do fundo
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest(".flow-cell-card") || target.closest(".btn")) {
      return;
    }
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Zoom com a roda do mouse
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setScale((prev) => Math.min(2.0, Math.max(0.25, prev * zoomFactor)));
  };

  const handleOpenInCanvas = useCallback(
    (cellId: string) => {
      if (onOpenCellInCanvas) {
        onOpenCellInCanvas(cellId);
      } else {
        onSwitchView("canvas");
      }
    },
    [onOpenCellInCanvas, onSwitchView]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--bg-app, #090d16)",
        position: "relative",
        overflow: "hidden",
        userSelect: isPanning ? "none" : "auto",
      }}
    >
      {/* ── Top Bar: Controles Globais da View de Fluxo ── */}
      <div
        style={{
          height: "44px",
          background: "var(--bg-surface, #0f172a)",
          borderBottom: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          zIndex: 40,
          flexShrink: 0,
        }}
      >
        {/* Esquerda: Nome do Job e Alternador Canvas | Fluxo */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <GitBranch size={16} color="var(--accent-cyan, #38bdf8)" />
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "var(--text-primary, #f8fafc)",
              }}
            >
              {jobName}
            </span>
          </div>

          {/* Seletor "Canvas | Fluxo" */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: "4px",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))",
              padding: "1px",
              gap: 2,
            }}
            role="group"
            aria-label="Modo de visualização"
          >
            <button
              type="button"
              className="icon-btn"
              style={{
                fontSize: "0.72rem",
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                color: "var(--text-muted, #94a3b8)",
                background: "transparent",
                borderRadius: 3,
                cursor: "pointer",
                border: "none",
              }}
              title="Alternar para visão de Canvas com células empilhadas"
              aria-label="Visão Canvas"
              aria-pressed={false}
              onClick={() => onSwitchView("canvas")}
            >
              <Layers size={12} />
              <span>Canvas</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              style={{
                fontSize: "0.72rem",
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                color: "var(--accent-cyan, #38bdf8)",
                background: "rgba(34, 211, 238, 0.12)",
                fontWeight: 600,
                borderRadius: 3,
                cursor: "pointer",
                border: "none",
              }}
              title="Visão de Fluxo macro com interdependências e ordens"
              aria-label="Visão Fluxo"
              aria-pressed={true}
            >
              <GitBranch size={12} />
              <span>Fluxo</span>
            </button>
          </div>
        </div>

        {/* Centro: Controles de Expansão e Ajuste de Tela */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            style={{
              fontSize: "0.72rem",
              padding: "4px 8px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--text-secondary, #cbd5e1)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: 4,
              cursor: "pointer",
            }}
            title="Expandir todas as células no fluxo"
            aria-label="Expandir tudo"
            onClick={expandAll}
          >
            <Maximize2 size={12} />
            <span>Expandir tudo</span>
          </button>
          <button
            type="button"
            style={{
              fontSize: "0.72rem",
              padding: "4px 8px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--text-secondary, #cbd5e1)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: 4,
              cursor: "pointer",
            }}
            title="Recolher todas as células para ícones compactos"
            aria-label="Recolher tudo"
            onClick={collapseAll}
          >
            <Minimize2 size={12} />
            <span>Recolher tudo</span>
          </button>
          <button
            type="button"
            style={{
              fontSize: "0.72rem",
              padding: "4px 8px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--text-secondary, #cbd5e1)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: 4,
              cursor: "pointer",
            }}
            title="Ajustar e centralizar o fluxo na tela"
            aria-label="Ajustar à tela"
            onClick={fitView}
          >
            <RotateCcw size={12} />
            <span>Ajustar à tela</span>
          </button>

          {/* Zoom In / Out */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: 4,
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              padding: "1px",
              marginLeft: 4,
            }}
          >
            <button
              type="button"
              style={{ padding: "3px 6px", background: "transparent", border: "none", color: "var(--text-muted, #94a3b8)", cursor: "pointer" }}
              title="Aumentar zoom"
              aria-label="Aumentar zoom"
              onClick={() => setScale((s) => Math.min(2.0, s * 1.15))}
            >
              <ZoomIn size={12} />
            </button>
            <span style={{ fontSize: "0.66rem", padding: "0 4px", color: "var(--text-muted, #94a3b8)", fontFamily: "monospace" }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              style={{ padding: "3px 6px", background: "transparent", border: "none", color: "var(--text-muted, #94a3b8)", cursor: "pointer" }}
              title="Diminuir zoom"
              aria-label="Diminuir zoom"
              onClick={() => setScale((s) => Math.max(0.25, s * 0.85))}
            >
              <ZoomOut size={12} />
            </button>
          </div>
        </div>

        {/* Direita: Ações de Execução do Job */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isJobRunning ? (
            <button
              type="button"
              className="btn btn-danger"
              style={{
                fontSize: "0.75rem",
                padding: "5px 12px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(239, 68, 68, 0.2)",
                color: "var(--status-danger, #ef4444)",
                borderColor: "var(--status-danger, #ef4444)",
                borderRadius: 4,
                cursor: "pointer",
              }}
              title="Cancelar execução de todo o job"
              onClick={onCancelJob}
            >
              <Square size={12} fill="currentColor" />
              Cancelar Job
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              style={{
                fontSize: "0.75rem",
                padding: "5px 12px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--accent-cyan, #38bdf8)",
                color: "#0f172a",
                fontWeight: 700,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
              title="Executar todo o job respeitando ordem e pré-condições"
              onClick={onExecuteJob}
            >
              <Play size={12} fill="currentColor" />
              Executar Job
            </button>
          )}
        </div>
      </div>

      {/* ── Barra de Avisos (Ciclos, referências quebradas ou inconsistências) ── */}
      {flowModel.warnings.length > 0 && (
        <div
          style={{
            background: "rgba(234, 179, 8, 0.12)",
            borderBottom: "1px solid rgba(234, 179, 8, 0.3)",
            padding: "4px 16px",
            fontSize: "0.72rem",
            color: "#eab308",
            display: "flex",
            alignItems: "center",
            gap: 8,
            zIndex: 35,
            flexShrink: 0,
          }}
          role="alert"
        >
          <AlertTriangle size={13} />
          <span style={{ fontWeight: 600 }}>Avisos no Fluxo:</span>
          <span>{flowModel.warnings.join(" | ")}</span>
        </div>
      )}

      {/* ── Viewport com Pan e Zoom ── */}
      <div
        ref={viewportRef}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          cursor: isPanning ? "grabbing" : "grab",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Camada Transformada (Scale + Pan) */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: "0 0",
            width: `${layout.totalWidth}px`,
            height: `${layout.totalHeight}px`,
            position: "absolute",
            left: 0,
            top: 0,
            transition: isPanning ? "none" : "transform 0.05s ease-out",
          }}
        >
          {/* Cabeçalhos de Coluna (ORDEM n / ORDEM n (paralelo)) */}
          {layout.columns.map((col) => (
            <div
              key={`col-${col.order}`}
              style={{
                position: "absolute",
                left: `${col.x}px`,
                top: "14px",
                width: `${col.width}px`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                fontSize: "0.7rem",
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--accent-cyan, #38bdf8)",
                background: "rgba(56, 189, 248, 0.06)",
                border: "1px solid rgba(56, 189, 248, 0.2)",
                borderRadius: "4px",
                padding: "3px 0",
                zIndex: 15,
                userSelect: "none",
              }}
            >
              <span>{col.title}</span>
            </div>
          ))}

          {/* Camada SVG de Arestas / Ligações */}
          <FlowLinksOverlay
            routes={layout.routes}
            links={flowModel.links}
            width={layout.totalWidth}
            height={layout.totalHeight}
          />

          {/* Cards / Ícones das Células */}
          {layout.nodes.map((node) => (
            <FlowCellNode
              key={node.id}
              layoutNode={node}
              onToggleExpand={toggleExpand}
              onOpenInCanvas={handleOpenInCanvas}
              onFocusNode={onFocusNode}
              onRunSingleCell={onRunSingleCell}
              onStopSingleCell={onStopSingleCell}
            />
          ))}
        </div>

        {/* Legenda Flutuante */}
        <FlowLegend />
      </div>
    </div>
  );
};
