import React, { useState, useCallback, useRef } from "react";
import { GitMerge, X, Plus, Check } from "lucide-react";
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
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
    </div>
  );
};
