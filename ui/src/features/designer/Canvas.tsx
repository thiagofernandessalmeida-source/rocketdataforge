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
import { CanvasNodeData, ComponentDefinition } from "../../types";
import {
  getFlowType,
  generateFlowName,
  FLOW_CONFIG,
} from "./utils/flowNaming";

const nodeTypes: NodeTypes = {
  genericNode: GenericNode,
};

const edgeTypes: EdgeTypes = {
  flowEdge: FlowEdge,
  default: FlowEdge,
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

function generateRocketNodeId(typeId: string, existingNodes: Node<CanvasNodeData>[]): string {
  let prefix = "node";
  if (typeId.includes("postgresql.output") || typeId.includes("postgres.output")) prefix = "postgres_sink";
  else if (typeId.includes("postgresql") || typeId.includes("postgres") || typeId.includes("database.source")) prefix = "postgres_source";
  else if (typeId.includes("duckdb.output")) prefix = "duckdb_sink";
  else if (typeId.includes("duckdb")) prefix = "duckdb_source";
  else if (typeId.includes("oracle.output")) prefix = "oracle_sink";
  else if (typeId.includes("oracle")) prefix = "oracle_source";
  else if (typeId.includes("sqlserver.output")) prefix = "sqlserver_sink";
  else if (typeId.includes("sqlserver")) prefix = "sqlserver_source";
  else if (typeId.includes("mysql.output")) prefix = "mysql_sink";
  else if (typeId.includes("mysql")) prefix = "mysql_source";
  else if (typeId.includes("file.source.csv") || typeId.includes(".csv")) prefix = "csv_source";
  else if (typeId.includes("file.source.parquet") || typeId.includes(".parquet")) prefix = "parquet_source";
  else if (typeId.includes("file.source.json") || typeId.includes(".json")) prefix = "json_source";
  else if (typeId.includes("file.source.excel") || typeId.includes(".excel")) prefix = "excel_source";
  else if (typeId.includes("file.target")) prefix = "file_sink";
  else if (typeId.includes("file.source")) prefix = "file_source";
  else if (typeId.includes("tmap") || typeId.includes("mapper")) prefix = "data_mapper";
  else if (typeId.includes("filter")) prefix = "filter";
  else if (typeId.includes("select")) prefix = "project";
  else if (typeId.includes("join")) prefix = "join";
  else if (typeId.includes("aggregate")) prefix = "aggregate";
  else if (typeId.includes("sort")) prefix = "sort";
  else if (typeId.includes("deduplicate")) prefix = "dedup";
  else if (typeId.includes("lookup")) prefix = "lookup";
  else if (typeId.includes("union")) prefix = "union";
  else if (typeId.includes("pivot")) prefix = "pivot";
  else {
    const last = typeId.split(".").pop() || "node";
    prefix = last.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  }

  let count = 1;
  const existingIds = new Set(existingNodes.map((n) => n.id.toLowerCase()));
  while (existingIds.has(`${prefix}_${count}`.toLowerCase())) {
    count++;
  }
  return `${prefix}_${count}`;
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
          type: "flowEdge",
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

      const newNodeId = generateRocketNodeId(comp.type_id, nodes);

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
    [setNodes, onSelectNode, screenToFlowPosition, nodes]
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
