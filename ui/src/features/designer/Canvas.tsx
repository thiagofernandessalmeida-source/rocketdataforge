import React, { useCallback, useRef } from "react";
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

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const srcNode = nodes.find((n) => n.id === params.source);
        const tgtNode = nodes.find((n) => n.id === params.target);
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
    [setEdges, nodes]
  );

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
    </div>
  );
};
