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
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";

import { GenericNode } from "./nodes/GenericNode";
import { CanvasNodeData, ComponentDefinition } from "../../types";

const nodeTypes: NodeTypes = {
  genericNode: GenericNode,
};

interface CanvasProps {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  onNodesChange: any;
  onEdgesChange: any;
  setNodes: React.Dispatch<React.SetStateAction<Node<CanvasNodeData>[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onSelectNode: (node: Node<CanvasNodeData> | null) => void;
  onDoubleClickNode?: (node: Node<CanvasNodeData>) => void;
}

export const Canvas: React.FC<CanvasProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
  onDoubleClickNode,
}) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (params: Connection) => {
      // Cria a aresta com estilo customizado e cor ativa
      const edgeData = {
        ...params,
        animated: true,
        style: { stroke: "var(--accent-cyan)", strokeWidth: 2 },
      };
      setEdges((eds) => addEdge(edgeData, eds));
    },
    [setEdges]
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

      // Use ReactFlow's screenToFlowPosition to convert screen coords → canvas coords
      // This correctly accounts for zoom level, pan offset, and the wrapper bounds
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const prefix = comp.type_id.split(".").pop() || "node";
      const newNodeId = `${prefix}_${Date.now().toString(36)}`;

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
        },
      };

      setNodes((nds) => nds.concat(newNode));
      onSelectNode(newNode);
    },
    [setNodes, onSelectNode, screenToFlowPosition]
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
