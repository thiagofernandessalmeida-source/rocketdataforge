import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { GitMerge, X, Plus, Check, Play, Table as TableIcon, GitBranch, Sliders, Eye, Clock, Code } from "lucide-react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  NodeTypes,
  EdgeTypes,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";

import { GenericNode } from "./nodes/GenericNode";
import { FlowEdge } from "./edges/FlowEdge";
import { TriggerEdge } from "./edges/TriggerEdge";
import { CanvasNodeData, ComponentDefinition } from "../../types";
import {
  getFlowType,
  generateFlowName,
  FLOW_CONFIG,
} from "./utils/flowNaming";
import { jobStore, generateRocketNodeId } from "../../store/jobStore";
import { api } from "../../api/client";
import { DataPreviewDrawer } from "./preview/DataPreviewDrawer";
import { ScheduleModal } from "./scheduler/ScheduleModal";
import { ExportCodegenModal } from "./codegen/ExportCodegenModal";


const nodeTypes: NodeTypes = {
  genericNode: GenericNode,
};

const edgeTypes: EdgeTypes = {
  flowEdge: FlowEdge,
  triggerEdge: TriggerEdge,
  default: FlowEdge,
};

export interface CanvasProps {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  onNodesChange: any;
  onEdgesChange: any;
  setNodes: React.Dispatch<React.SetStateAction<Node<CanvasNodeData>[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onSelectNode: (node: Node<CanvasNodeData> | null) => void;
  onDoubleClickNode?: (node: Node<CanvasNodeData>) => void;
  onNodeDragStop?: (event: React.MouseEvent, node: Node) => void;
  allNodes?: Node<CanvasNodeData>[];
  cellId?: string;
}

export { generateRocketNodeId };

export const Canvas: React.FC<CanvasProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
  onDoubleClickNode,
  onNodeDragStop,
  allNodes,
  cellId,
}) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

interface TMapOutputChoice {
  id: string;
  name: string;
  columnsCount: number;
  alreadyConnected: boolean;
  connectedTo?: string;
}

  // Estado para interceptar e escolher schema ao conectar aresta de saída do Data Mapper (tMap)
  const [pendingTMapConnection, setPendingTMapConnection] = useState<{
    connection: Connection;
    srcNode: Node<CanvasNodeData>;
    tgtNode: Node<CanvasNodeData>;
    availableOutputs: TMapOutputChoice[];
  } | null>(null);
  const [selectedOutputChoice, setSelectedOutputChoice] = useState<string>("out1");
  const [isCreatingNewOutput, setIsCreatingNewOutput] = useState<boolean>(false);
  const [customOutputName, setCustomOutputName] = useState<string>("");

  // ─── Menu de Contexto, Live Preview & Linhagem (Spec 005) ────────
  const [nodeContextMenu, setNodeContextMenu] = useState<{
    node: Node<CanvasNodeData>;
    x: number;
    y: number;
  } | null>(null);

  const [previewDrawer, setPreviewDrawer] = useState<{
    isOpen: boolean;
    nodeId: string;
    nodeLabel: string;
    executionId?: string | null;
  }>({
    isOpen: false,
    nodeId: "",
    nodeLabel: "",
    executionId: null,
  });

  const [isExecutingPartial, setIsExecutingPartial] = useState(false);

  const [highlightedLineage, setHighlightedLineage] = useState<{
    nodes: Set<string>;
    edges: Set<string>;
    targetColumn?: string;
  } | null>(null);

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const currentDraftDef = useMemo(() => ({
    metadata: { name: cellId || "pipeline_main", id: cellId || "pipeline_main" },
    spec: {
      nodes: nodes.map((n) => ({
        id: n.id,
        component: { type: n.data?.componentType || "generic", version: "1.0.0" },
        config: n.data?.config || {},
      })),
      edges: edges.map((e) => ({
        from: e.source,
        to: e.target,
      })),
    },
  }), [nodes, edges, cellId]);


  const handleRunToNode = useCallback(async (targetNodeId: string) => {
    setIsExecutingPartial(true);
    const targetNode = nodes.find((n) => n.id === targetNodeId);
    try {
      const draftDef = {
        metadata: { name: "partial_exec_canvas" },
        spec: {
          nodes: nodes.map((n) => ({
            id: n.id,
            component: { type: n.data?.componentType || "generic", version: "1.0.0" },
            config: n.data?.config || {},
          })),
          edges: edges.map((e) => ({
            from: e.sourceHandle ? `${e.source}.${e.sourceHandle}` : `${e.source}.output`,
            to: e.targetHandle ? `${e.target}.${e.targetHandle}` : `${e.target}.input`,
          })),
        },
      };

      const res = await api.executePartial({
        target_node_id: targetNodeId,
        draft_definition: draftDef,
      });

      setPreviewDrawer({
        isOpen: true,
        nodeId: targetNodeId,
        nodeLabel: targetNode?.data?.label || targetNodeId,
        executionId: res.execution_id,
      });
    } catch (err: any) {
      console.error("Erro ao disparar execução parcial:", err);
    } finally {
      setIsExecutingPartial(false);
    }
  }, [nodes, edges]);

  const handleInspectLineage = useCallback(async (nodeId: string, column?: string) => {
    try {
      const pipeId = (allNodes?.[0]?.data as any)?.pipelineId || cellId || "current_pipeline";
      const report = await api.getColumnLineage(pipeId, column, nodeId);
      if (report && report.nodes) {
        const edgeKeys = new Set(
          edges
            .filter((e) => report.nodes.includes(e.source) && report.nodes.includes(e.target))
            .map((e) => e.id)
        );
        setHighlightedLineage({
          nodes: new Set(report.nodes),
          edges: edgeKeys,
          targetColumn: column || "todas as colunas",
        });
        return;
      }
    } catch (_) {}

    // Fallback: travessia reversa upstream local
    const upstream = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const inEdges = edges.filter((e) => e.target === curr);
      for (const e of inEdges) {
        if (!upstream.has(e.source)) {
          upstream.add(e.source);
          queue.push(e.source);
        }
      }
    }
    const edgeKeys = new Set(
      edges.filter((e) => upstream.has(e.source) && upstream.has(e.target)).map((e) => e.id)
    );
    setHighlightedLineage({
      nodes: upstream,
      edges: edgeKeys,
      targetColumn: column || "todas as colunas",
    });
  }, [edges, allNodes, cellId]);

  useEffect(() => {
    const handleLineageEvent = (e: any) => {
      const { nodeId, column } = e.detail || {};
      if (nodeId) {
        handleInspectLineage(nodeId, column);
      }
    };
    window.addEventListener("rdf-inspect-lineage", handleLineageEvent);
    return () => window.removeEventListener("rdf-inspect-lineage", handleLineageEvent);
  }, [handleInspectLineage]);

  const renderedNodes = useMemo(() => {
    if (!highlightedLineage) return nodes;
    return nodes.map((n) => {
      const isHighlighted = highlightedLineage.nodes.has(n.id);
      return {
        ...n,
        style: {
          ...n.style,
          opacity: isHighlighted ? 1 : 0.35,
          boxShadow: isHighlighted ? "0 0 20px rgba(56, 189, 248, 0.75)" : undefined,
          borderColor: isHighlighted ? "#38bdf8" : undefined,
          transition: "all 0.3s ease",
        },
      };
    });
  }, [nodes, highlightedLineage]);

  const renderedEdges = useMemo(() => {
    if (!highlightedLineage) return edges;
    return edges.map((e) => {
      const isHighlighted = highlightedLineage.edges.has(e.id);
      return {
        ...e,
        animated: isHighlighted ? true : e.animated,
        style: {
          ...e.style,
          stroke: isHighlighted ? "#38bdf8" : "#334155",
          strokeWidth: isHighlighted ? 3 : 1.5,
          opacity: isHighlighted ? 1 : 0.25,
          transition: "all 0.3s ease",
        },
      };
    });
  }, [edges, highlightedLineage]);

  const onConnect = useCallback(
    (params: Connection) => {
      const srcNode = nodes.find((n) => n.id === params.source);
      const tgtNode = nodes.find((n) => n.id === params.target);
      if (!srcNode || !tgtNode) return;

      const srcType = (srcNode.data?.componentType || "").toLowerCase();
      const isSrcTMap = srcType.includes("tmap") || srcType.includes("mapper");
      const isTrigger = params.sourceHandle === "trigger" || params.targetHandle === "trigger";

      // Se a conexão estiver partindo de um nó Data Mapper (e não for trigger), abre o seletor de schema de saída
      if (isSrcTMap && !isTrigger) {
        const rawOutputs = (srcNode.data?.config?.outputs as Array<{ id: string; name?: string; columns?: any[]; targetId?: string }>) || [];
        const currentEdgesFromSrc = edges.filter((e) => e.source === srcNode.id);

        let outputsList: TMapOutputChoice[] = rawOutputs.map((o) => {
          const outName = o.name || o.id;
          const matchingEdge = currentEdgesFromSrc.find(
            (e) => e.data?.flowName === outName || e.data?.flowName === o.id || (typeof e.label === "string" && e.label === outName)
          );
          const tgt = matchingEdge ? nodes.find((n) => n.id === matchingEdge.target) : null;
          return {
            id: o.id,
            name: outName,
            columnsCount: (o.columns || []).length,
            alreadyConnected: Boolean(matchingEdge),
            connectedTo: tgt?.data?.label || matchingEdge?.target,
          };
        });

        if (outputsList.length === 0) {
          outputsList = [
            {
              id: "out1",
              name: "out1",
              columnsCount: 0,
              alreadyConnected: false,
              connectedTo: undefined,
            },
          ];
        }

        const firstUnconnected = outputsList.find((o) => !o.alreadyConnected) || outputsList[0];
        setSelectedOutputChoice(firstUnconnected.id);
        setIsCreatingNewOutput(false);
        setCustomOutputName(`out${outputsList.length + 1}`);

        setPendingTMapConnection({
          connection: params,
          srcNode,
          tgtNode,
          availableOutputs: outputsList,
        });
        return;
      }

      setEdges((eds) => {
        const flowType = getFlowType(
          srcNode,
          tgtNode,
          eds,
          params.targetHandle,
          params.sourceHandle
        );
        const flowName = generateFlowName(flowType, eds);
        const meta = FLOW_CONFIG[flowType];

        const edgeData = {
          ...params,
          id: `e_${flowName}_${Date.now()}`,
          type: flowType === "trigger" ? "triggerEdge" : "flowEdge",
          label: flowName,
          animated: true,
          style: { stroke: meta.strokeColor, strokeWidth: 2 },
          data: {
            flowName,
            flowType,
            sourceLabel: srcNode?.data?.label || srcNode?.id || params.source,
            targetLabel: tgtNode?.data?.label || tgtNode?.id || params.target,
          },
        };

        return addEdge(edgeData, eds);
      });
    },
    [nodes, edges, setEdges]
  );

  const handleConfirmTMapConnection = useCallback(() => {
    if (!pendingTMapConnection) return;
    const { connection, srcNode, tgtNode, availableOutputs } = pendingTMapConnection;

    let chosenOutputName = selectedOutputChoice.trim();
    if (isCreatingNewOutput) {
      chosenOutputName = customOutputName.trim() || `out${availableOutputs.length + 1}`;
    }

    const meta = FLOW_CONFIG["out"];
    const edgeData = {
      ...connection,
      id: `e_${chosenOutputName}_${Date.now()}`,
      type: "flowEdge",
      label: chosenOutputName,
      animated: true,
      style: { stroke: meta.strokeColor, strokeWidth: 2 },
      data: {
        flowName: chosenOutputName,
        flowType: "out",
        sourceLabel: srcNode?.data?.label || srcNode?.id || connection.source,
        targetLabel: tgtNode?.data?.label || tgtNode?.id || connection.target,
      },
    };

    setEdges((eds) => addEdge(edgeData, eds));

    // Atualiza o config.outputs do nó Data Mapper com o targetId e targetLabel
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== srcNode.id) return n;
        const currentCfg = (n.data?.config || {}) as any;
        const currentOutputs = (currentCfg.outputs || []) as any[];

        let updatedOutputs: any[];
        const existingIdx = currentOutputs.findIndex(
          (o) => o.id === chosenOutputName || o.name === chosenOutputName
        );

        if (existingIdx >= 0) {
          updatedOutputs = [...currentOutputs];
          updatedOutputs[existingIdx] = {
            ...updatedOutputs[existingIdx],
            targetId: tgtNode.id,
            targetLabel: tgtNode.data?.label || tgtNode.id,
          };
        } else {
          updatedOutputs = [
            ...currentOutputs,
            {
              id: chosenOutputName,
              name: chosenOutputName,
              targetId: tgtNode.id,
              targetLabel: tgtNode.data?.label || tgtNode.id,
              filter_expression: "",
              catch_output_reject: false,
              catch_lookup_reject: false,
              schema_type: "Built-in",
              is_reject: false,
              columns: [],
            },
          ];
        }

        return {
          ...n,
          data: {
            ...n.data,
            config: {
              ...currentCfg,
              outputs: updatedOutputs,
            },
          },
        };
      })
    );

    setPendingTMapConnection(null);
  }, [pendingTMapConnection, selectedOutputChoice, isCreatingNewOutput, customOutputName, setEdges, setNodes]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      // Try both MIME types for compatibility
      const rawData =
        event.dataTransfer.getData("application/reactflow") ||
        event.dataTransfer.getData("text/plain");

      if (!rawData) {
        console.warn("[RDF] onDrop: no data in transfer", [...event.dataTransfer.types]);
        return;
      }

      let comp: ComponentDefinition;
      try {
        comp = JSON.parse(rawData);
        if (!comp || !comp.type_id) {
          console.warn("[RDF] onDrop: missing type_id in data", comp);
          return;
        }
      } catch {
        console.warn("[RDF] onDrop: failed to parse", rawData);
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Garantir unicidade global de ID consultando todas as células do Job
      const pool = new Map<string, Node<CanvasNodeData>>();
      const activeJob = jobStore.getActiveJob();
      if (activeJob?.cells) {
        activeJob.cells.forEach((c: any) => {
          (c.nodes || []).forEach((n: any) => pool.set(n.id.toLowerCase(), n));
        });
      }
      if (activeJob?.nodes) {
        activeJob.nodes.forEach((n: any) => pool.set(n.id.toLowerCase(), n));
      }
      if (allNodes && allNodes.length > 0) {
        allNodes.forEach((n) => pool.set(n.id.toLowerCase(), n));
      }
      nodes.forEach((n) => pool.set(n.id.toLowerCase(), n));
      const combinedNodes = Array.from(pool.values());

      const newNodeId = generateRocketNodeId(comp.type_id, combinedNodes);

      const newNode: Node<CanvasNodeData> = {
        id: newNodeId,
        type: "genericNode",
        position,
        data: {
          label: comp.name,
          componentType: comp.type_id,
          componentVersion: comp.version,
          category: comp.category,
          config: {},
          ports: comp.ports,
          cellId,
        },
      };

      setNodes((nds) => nds.concat(newNode));
      onSelectNode(newNode);
    },
    [setNodes, onSelectNode, screenToFlowPosition, nodes, allNodes, cellId]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<CanvasNodeData>) => {
      onSelectNode(node);
    },
    [onSelectNode]
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node<CanvasNodeData>) => {
      onDoubleClickNode?.(node);
    },
    [onDoubleClickNode]
  );

  const onPaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <div className="canvas-container" ref={reactFlowWrapper} id="pipeline-canvas">
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          setNodeContextMenu({ node: node as Node<CanvasNodeData>, x: event.clientX, y: event.clientY });
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDragStop={onNodeDragStop}
        deleteKeyCode={null}
        fitView
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          color="#2a3148"
        />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const cat = (n.data as CanvasNodeData)?.category;
            if (cat === "source") return "#10b981";
            if (cat === "transform") return "#3b82f6";
            if (cat === "target") return "#f59e0b";
            return "#8b5cf6";
          }}
          maskColor="rgba(8, 9, 13, 0.7)"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
          }}
        />
      </ReactFlow>

      {/* Seletor de Saída (Schema) ao conectar aresta do Data Mapper (tMap) */}
      {pendingTMapConnection && (
        <div className="tmap-output-picker-overlay" onClick={() => setPendingTMapConnection(null)}>
          <div className="tmap-output-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tmap-output-picker-header">
              <div className="tmap-output-picker-title">
                <GitMerge size={16} color="var(--accent-cyan)" />
                <span>Conectar Saída do Data Mapper</span>
              </div>
              <button
                className="icon-btn btn-xs"
                onClick={() => setPendingTMapConnection(null)}
                title="Fechar"
              >
                <X size={14} />
              </button>
            </div>

            <div className="tmap-output-picker-body">
              <p className="tmap-output-picker-prompt">
                Qual saída (schema) de <strong>{pendingTMapConnection.srcNode.data?.label || pendingTMapConnection.srcNode.id}</strong> você deseja conectar ao componente <strong>{pendingTMapConnection.tgtNode.data?.label || pendingTMapConnection.tgtNode.id}</strong>?
              </p>

              <div className="tmap-output-picker-list">
                {pendingTMapConnection.availableOutputs.map((out) => {
                  const isSelected = !isCreatingNewOutput && selectedOutputChoice === out.id;
                  return (
                    <div
                      key={out.id}
                      className={`tmap-output-picker-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setIsCreatingNewOutput(false);
                        setSelectedOutputChoice(out.id);
                      }}
                    >
                      <div className="tmap-output-picker-item-left">
                        <input
                          type="radio"
                          className="tmap-output-picker-item-radio"
                          checked={isSelected}
                          onChange={() => {
                            setIsCreatingNewOutput(false);
                            setSelectedOutputChoice(out.id);
                          }}
                        />
                        <span className="tmap-output-picker-tag">{out.name}</span>
                        <span className="tmap-output-picker-item-desc">
                          {out.columnsCount > 0
                            ? `${out.columnsCount} ${out.columnsCount === 1 ? "coluna mapeada" : "colunas mapeadas"}`
                            : "Schema vazio"}
                        </span>
                      </div>
                      <div className="tmap-output-picker-status">
                        {out.alreadyConnected ? (
                          <span className="tmap-output-picker-status connected">
                            (Conectado a {out.connectedTo})
                          </span>
                        ) : (
                          <span className="tmap-output-picker-status">Disponível</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Opção para criar nova saída */}
                <div
                  className={`tmap-output-picker-item ${isCreatingNewOutput ? "selected" : ""}`}
                  onClick={() => setIsCreatingNewOutput(true)}
                >
                  <div className="tmap-output-picker-item-left">
                    <input
                      type="radio"
                      className="tmap-output-picker-item-radio"
                      checked={isCreatingNewOutput}
                      onChange={() => setIsCreatingNewOutput(true)}
                    />
                    <span
                      className="tmap-output-picker-tag"
                      style={{ background: "rgba(0, 212, 255, 0.15)", color: "var(--accent-cyan)", borderColor: "rgba(0, 212, 255, 0.4)" }}
                    >
                      <Plus size={10} style={{ display: "inline", marginRight: 2 }} />
                      Nova Saída
                    </span>
                    <span className="tmap-output-picker-item-desc">
                      Criar novo schema de saída no Data Mapper
                    </span>
                  </div>
                </div>
              </div>

              {isCreatingNewOutput && (
                <div className="tmap-output-picker-custom-input">
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Nome da Saída:
                  </span>
                  <input
                    type="text"
                    value={customOutputName}
                    placeholder="ex: out2, reject, dados_filtrados"
                    autoFocus
                    onChange={(e) => setCustomOutputName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmTMapConnection();
                    }}
                  />
                </div>
              )}
            </div>

            <div className="tmap-output-picker-footer">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPendingTMapConnection(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleConfirmTMapConnection}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <Check size={14} />
                <span>Conectar Fluxo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Banner de Destaque Visual de Linhagem (T-4.3) ─── */}
      {highlightedLineage && (
        <div
          className="lineage-highlight-badge"
          id="lineage-highlight-badge"
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #38bdf8",
            borderRadius: 20,
            padding: "6px 18px",
            boxShadow: "0 4px 24px rgba(56, 189, 248, 0.35)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            zIndex: 800,
            backdropFilter: "blur(8px)",
          }}
        >
          <GitBranch size={16} color="#38bdf8" />
          <span style={{ fontSize: "0.82rem", color: "#f8fafc", fontWeight: 600 }}>
            Linhagem Ativa:{" "}
            <span style={{ color: "#38bdf8" }}>{highlightedLineage.targetColumn}</span> (
            {highlightedLineage.nodes.size} nós ancestrais destacados)
          </span>
          <button
            className="btn btn-xs"
            onClick={() => setHighlightedLineage(null)}
            style={{
              background: "rgba(255, 255, 255, 0.12)",
              border: "none",
              color: "#94a3b8",
              borderRadius: 10,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontWeight: 600,
            }}
          >
            Limpar Destaque
          </button>
        </div>
      )}

      {/* ─── Menu de Contexto do Nó (T-4.1) ───────────────── */}
      {nodeContextMenu && (
        <>
          <div
            className="ctx-overlay"
            style={{ position: "fixed", inset: 0, zIndex: 998 }}
            onClick={() => setNodeContextMenu(null)}
          />
          <div
            className="rdf-node-context-menu"
            id="rdf-node-context-menu"
            style={{
              position: "fixed",
              top: nodeContextMenu.y,
              left: nodeContextMenu.x,
              background: "rgba(15, 23, 42, 0.97)",
              border: "1px solid rgba(56, 189, 248, 0.25)",
              borderRadius: 8,
              boxShadow: "0 8px 30px rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(12px)",
              padding: "6px 0",
              zIndex: 999,
              minWidth: 230,
              fontFamily: "Inter, sans-serif",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "6px 14px",
                fontSize: "0.75rem",
                color: "#64748b",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              Componente: {nodeContextMenu.node.data?.label || nodeContextMenu.node.id}
            </div>

            {/* Ação 1: Executar até este nó (T-4.1) */}
            <button
              id="ctx-btn-run-to-node"
              className="ctx-menu-item"
              onClick={() => {
                const targetId = nodeContextMenu.node.id;
                setNodeContextMenu(null);
                handleRunToNode(targetId);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 14px",
                border: "none",
                background: "transparent",
                color: "#10b981",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(16, 185, 129, 0.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Play size={14} fill="#10b981" />
              <span>Executar até este nó</span>
            </button>

            {/* Ação 2: Visualizar Prévia de Dados (T-4.2) */}
            <button
              id="ctx-btn-preview-data"
              className="ctx-menu-item"
              onClick={() => {
                const targetNode = nodeContextMenu.node;
                setNodeContextMenu(null);
                setPreviewDrawer({
                  isOpen: true,
                  nodeId: targetNode.id,
                  nodeLabel: targetNode.data?.label || targetNode.id,
                  executionId: (targetNode.data as any)?.lastExecutionId || null,
                });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 14px",
                border: "none",
                background: "transparent",
                color: "#38bdf8",
                fontSize: "0.82rem",
                fontWeight: 500,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(56, 189, 248, 0.12)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <TableIcon size={14} />
              <span>Visualizar Prévia de Dados</span>
            </button>

            {/* Ação 3: Inspecionar Linhagem (T-4.3) */}
            <button
              id="ctx-btn-inspect-lineage"
              className="ctx-menu-item"
              onClick={() => {
                const targetId = nodeContextMenu.node.id;
                setNodeContextMenu(null);
                handleInspectLineage(targetId);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 14px",
                border: "none",
                background: "transparent",
                color: "#cbd5e1",
                fontSize: "0.82rem",
                fontWeight: 500,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <GitBranch size={14} color="#a855f7" />
              <span>Inspecionar Linhagem (Upstream)</span>
            </button>

            {/* Ação 4: Configurar Propriedades */}
            <button
              className="ctx-menu-item"
              onClick={() => {
                const targetNode = nodeContextMenu.node;
                setNodeContextMenu(null);
                onDoubleClickNode?.(targetNode);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 14px",
                border: "none",
                background: "transparent",
                color: "#94a3b8",
                fontSize: "0.82rem",
                cursor: "pointer",
                textAlign: "left",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                marginTop: 4,
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Sliders size={14} />
              <span>Configurar Propriedades</span>
            </button>
          </div>
        </>
      )}

      {/* ─── Botão de Exportação Autônoma (Spec 006 - Fase 3 / T-3.5) ─── */}
      <button
        type="button"
        className="btn-export-codegen"
        id="btn-export-codegen"
        onClick={() => setIsExportModalOpen(true)}
        title="Exportar como Código Autônomo (Python DuckDB/Polars ou Airflow DAG)"
        style={{
          position: "absolute",
          top: 14,
          right: 154,
          background: "rgba(15, 23, 42, 0.92)",
          border: "1px solid rgba(99, 102, 241, 0.4)",
          borderRadius: 8,
          padding: "6px 12px",
          boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          zIndex: 800,
          color: "#a5b4fc",
          cursor: "pointer",
          fontSize: "0.8rem",
          fontWeight: 500,
          backdropFilter: "blur(6px)",
        }}
      >
        <Code size={14} color="#818cf8" />
        <span>Exportar Código</span>
      </button>

      {/* ─── Botão de Agendamentos e Automação Cron (Spec 006 - Fase 1) ─── */}
      <button
        type="button"
        className="btn-open-schedules"
        id="btn-open-schedules"
        onClick={() => setIsScheduleModalOpen(true)}
        title="Gerenciador de Agendamentos e Automação Cron"
        style={{
          position: "absolute",
          top: 14,
          right: 20,
          background: "rgba(15, 23, 42, 0.92)",
          border: "1px solid rgba(99, 102, 241, 0.4)",
          borderRadius: 8,
          padding: "6px 12px",
          boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          zIndex: 800,
          color: "#a5b4fc",
          cursor: "pointer",
          fontSize: "0.8rem",
          fontWeight: 500,
          backdropFilter: "blur(6px)",
        }}
      >
        <Clock size={14} color="#818cf8" />
        <span>Agendamentos</span>
      </button>

      {/* ─── Modal de Agendamentos (T-1.4) ─── */}
      <ScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        pipelineId={cellId || "pipeline_main"}
        pipelineName="Pipeline Atual"
      />

      {/* ─── Modal de Exportação de Código Autônomo (T-3.5) ─── */}
      <ExportCodegenModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        pipelineId={cellId || "pipeline_main"}
        pipelineName="Pipeline Atual"
        draftDefinition={currentDraftDef}
      />

      {/* ─── Gaveta de Prévia de Dados Virtualizada (T-4.2) ─── */}
      <DataPreviewDrawer
        isOpen={previewDrawer.isOpen}
        onClose={() => setPreviewDrawer((prev) => ({ ...prev, isOpen: false }))}
        executionId={previewDrawer.executionId}
        nodeId={previewDrawer.nodeId}
        nodeLabel={previewDrawer.nodeLabel}
        pipelineId={cellId}
        onRunToNode={handleRunToNode}
        isExecuting={isExecutingPartial}
      />
    </div>
  );
};

