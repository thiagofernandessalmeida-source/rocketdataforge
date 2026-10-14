import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  useReactFlow,
  ReactFlowProvider,
} from "reactflow";

import { Header } from "./components/Header";
import { MenuBar } from "./components/MenuBar";
import { ToastContainer, ToastMessage } from "./components/Toast";
import { Palette } from "./features/designer/Palette";
import { Canvas } from "./features/designer/Canvas";
import { MultiCanvasContainer } from "./features/designer/cells/MultiCanvasContainer";
import { PropertyPanel } from "./features/designer/PropertyPanel";
import { FloatingNodeConfig } from "./features/designer/FloatingNodeConfig";
import { ExecutionConsole, ProblemItem } from "./features/execution/ExecutionConsole";
import { JobRepository } from "./features/repository/JobRepository";
import { JobTabBar } from "./features/repository/JobTabBar";
import { ConnectionManager } from "./features/connections/ConnectionManager";
import { ContextVariablesModal } from "./features/context/ContextVariablesModal";
import { QueryBankModal } from "./features/querybank/QueryBankModal";
import { PolicySimulatorModal } from "./features/security/PolicySimulatorModal";
import { AutoDocModal } from "./features/autodoc/AutoDocModal";
import { AboutModal } from "./components/AboutModal";
import { WorkspaceModal } from "./features/workspace/WorkspaceModal";
import { WorkspaceLauncher } from "./features/workspace/WorkspaceLauncher";
import { api, getBaseApiUrl } from "./api/client";
import { EXPANDED_CATALOG } from "./catalog/components";
import {
  jobStore,
  JobData,
  SchemaColumn,
  CanvasCellData,
  CellExecutionMetrics,
  evaluateCellPreconditions,
  detectCellCycles,
  validateParallelCellConsistency,
  WorkspaceInfo,
  fetchCurrentWorkspaceInfo,
  hydrateFromActiveWorkspace,
} from "./store/jobStore";
import { useJobStore } from "./store/useJobStore";
import { telemetryStore } from "./store/telemetryStore";
import {
  CanvasNodeData,
  CompiledPlans,
  ComponentDefinition,
  ExecutionDetail,
  LogEntry,
} from "./types";

// ─── Empty Canvas State ───────────────────────────────────────
const EMPTY_CANVAS = { nodes: [] as Node<CanvasNodeData>[], edges: [] as Edge[] };

export const analyzeGraphProblems = (
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): ProblemItem[] => {
  const problems: ProblemItem[] = [];
  if (nodes.length === 0) {
    return [
      {
        code: "ERR_EMPTY_GRAPH",
        message: "Nenhum componente foi adicionado ao Canvas.",
        severity: "error",
        suggestion: "Arraste componentes da paleta à esquerda para montar seu fluxo de dados.",
      },
    ];
  }

  // Check disconnected / orphan nodes
  for (const node of nodes) {
    const isSource =
      node.data?.category === "source" ||
      node.data?.componentType?.includes("source") ||
      node.data?.componentType === "csv_source";
    const isTarget =
      node.data?.category === "target" ||
      node.data?.componentType?.includes("sink") ||
      node.data?.componentType?.includes("target");
    const incoming = edges.filter((e) => e.target === node.id);
    const outgoing = edges.filter((e) => e.source === node.id);
    const label = node.data?.label || node.id;

    if (incoming.length === 0 && outgoing.length === 0 && nodes.length > 1) {
      problems.push({
        code: "WARN_ORPHAN_NODE",
        message: `O componente "${label}" está isolado (sem nenhuma conexão de entrada ou saída).`,
        node_id: node.id,
        node_label: label,
        severity: "warning",
        suggestion: "Conecte a porta de entrada ou saída deste componente a outro nó.",
      });
    }

    if (isTarget && incoming.length === 0) {
      problems.push({
        code: "ERR_TARGET_NO_INPUT",
        message: `O componente de saída "${label}" não possui fluxo de dados de entrada conectado.`,
        node_id: node.id,
        node_label: label,
        severity: "error",
        suggestion: "Conecte a saída de uma transformação (como o Data Mapper / tMap) na entrada deste componente.",
      });
    }

    if (isSource && outgoing.length === 0 && nodes.length > 1) {
      problems.push({
        code: "ERR_SOURCE_NO_OUTPUT",
        message: `A fonte de dados "${label}" não está enviando dados para nenhum outro nó.`,
        node_id: node.id,
        node_label: label,
        severity: "warning",
        suggestion: "Conecte a saída desta fonte no Data Mapper (tMap) ou em outro componente de fluxo.",
      });
    }

    // Config validation
    const cfg = node.data?.config || {};
    const compType = (node.data?.componentType || "").toLowerCase();
    if (
      (compType.includes("file") ||
        compType.includes("csv") ||
        compType.includes("parquet") ||
        compType.includes("json")) &&
      (!cfg.path || !String(cfg.path).trim())
    ) {
      problems.push({
        code: "ERR_MISSING_FILE_PATH",
        message: `O componente "${label}" requer um caminho de arquivo (Path) configurado.`,
        node_id: node.id,
        node_label: label,
        severity: "error",
        suggestion: "Abra as propriedades do nó e selecione ou digite o caminho do arquivo (ex: Top Movies dataset.csv).",
      });
    }
  }

  // Check cycles using Kahn's algorithm
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  nodes.forEach((n) => {
    inDegree[n.id] = 0;
    adj[n.id] = [];
  });
  edges.forEach((e) => {
    if (adj[e.source] && inDegree[e.target] !== undefined) {
      adj[e.source].push(e.target);
      inDegree[e.target] = (inDegree[e.target] || 0) + 1;
    }
  });

  const queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
  let visited = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    visited++;
    (adj[u] || []).forEach((v) => {
      inDegree[v]--;
      if (inDegree[v] === 0) queue.push(v);
    });
  }

  if (visited < nodes.length) {
    const cycleNodes = Object.keys(inDegree).filter((id) => inDegree[id] > 0);
    problems.push({
      code: "ERR_CYCLIC_DEPENDENCY",
      message: `Ciclo circular detectado no pipeline envolvendo: ${cycleNodes.map((id) => nodes.find((n) => n.id === id)?.data?.label || id).join(", ")}.`,
      severity: "error",
      suggestion: "Remova a conexão que fecha um loop circular entre esses componentes.",
    });
  }

  return problems;
};

export const analyzeJobProblems = (
  job: JobData | null | undefined,
  fallbackNodes: Node<CanvasNodeData>[],
  fallbackEdges: Edge[]
): ProblemItem[] => {
  if (!job) {
    return analyzeGraphProblems(fallbackNodes, fallbackEdges);
  }

  const hasCells = Boolean(job.cells && job.cells.length > 0);
  if (!hasCells) {
    const effectiveNodes = job.nodes && job.nodes.length > 0 ? job.nodes : fallbackNodes;
    const effectiveEdges = job.edges && job.edges.length > 0 ? job.edges : fallbackEdges;
    return analyzeGraphProblems(effectiveNodes, effectiveEdges);
  }

  // Multi-canvas job with cells
  const totalNodesCount = (job.cells || []).reduce((acc, c) => acc + (c.nodes?.length || 0), 0);
  if (totalNodesCount === 0) {
    return [
      {
        code: "ERR_EMPTY_GRAPH",
        message: "Nenhum componente foi adicionado ao Canvas.",
        severity: "error",
        suggestion: "Arraste componentes da paleta à esquerda para dentro de uma célula do fluxo.",
      },
    ];
  }

  const problems: ProblemItem[] = [];

  // Check cell cycle dependencies
  const cycles = detectCellCycles(job.cells || []);
  if (cycles) {
    problems.push({
      code: "ERR_CYCLIC_DEPENDENCY",
      message: `Ciclo circular detectado na ordem de execução das células (${cycles.join(" -> ")}).`,
      severity: "error",
      suggestion: "Ajuste as pré-condições das células para remover o ciclo de dependência.",
    });
  }

  // Check cell parallelism consistency
  const orderErrors = validateParallelCellConsistency(job.cells || []);
  if (orderErrors && orderErrors.length > 0) {
    orderErrors.forEach((err) => {
      problems.push({
        code: "ERR_CELL_PRECONDITION_ORDER",
        message: err,
        severity: "error",
        suggestion: "Ajuste as pré-condições para apontar somente para células com ordem estritamente anterior.",
      });
    });
  }

  // Analyze each cell's internal DAG
  (job.cells || []).forEach((cell) => {
    const cellNodes = cell.nodes || [];
    const cellEdges = cell.edges || [];
    if (cellNodes.length === 0) {
      problems.push({
        code: "WARN_EMPTY_CELL",
        message: `A célula "${cell.name}" está vazia (sem nenhum componente configurado).`,
        severity: "warning",
        suggestion: "Adicione componentes à célula ou exclua-a caso não seja necessária.",
      });
      return;
    }
    const cellProblems = analyzeGraphProblems(cellNodes, cellEdges);
    cellProblems.forEach((p) => {
      if (p.code === "ERR_EMPTY_GRAPH") return;
      problems.push({
        ...p,
        message: `[${cell.name}] ${p.message}`,
      });
    });
  });

  return problems;
};

export const App: React.FC = () => {
  const storeState = useJobStore();

  // ─── Global State ──────────────────────────────────────────
  const [components] = useState<ComponentDefinition[]>(EXPANDED_CATALOG);

  // ─── Per-Tab Canvas State (Map<jobId, {nodes, edges}>) ─────
  const [canvasMap, setCanvasMap] = useState<
    Record<string, { nodes: Node<CanvasNodeData>[]; edges: Edge[] }>
  >({});

  const activeJobId = storeState.activeTabId;
  const activeJob = activeJobId ? storeState.jobs.find((j) => j.id === activeJobId) : null;
  const pipelineName = activeJob?.name ?? "CellFlow Data Studio";
  const activeCanvas = activeJobId ? canvasMap[activeJobId] ?? EMPTY_CANVAS : EMPTY_CANVAS;

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>(activeCanvas.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(activeCanvas.edges);
  const [selectedNode, setSelectedNode] = useState<Node<CanvasNodeData> | null>(null);

  // ─── Sync canvas when switching tabs ───────────────────────
  const prevTabRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevTabRef.current;
    const curr = activeJobId;

    // Save current canvas to map before switching
    if (prev && prev !== curr) {
      setCanvasMap((m) => ({
        ...m,
        [prev]: { nodes, edges },
      }));
    }

    // Load target tab's canvas
    if (curr) {
      const saved = canvasMap[curr];
      if (saved) {
        setNodes(saved.nodes);
        setEdges(saved.edges);
      } else {
        // Check localStorage job data
        const job = jobStore.getJob(curr);
        if (job && job.nodes.length > 0) {
          setNodes(job.nodes);
          setEdges(job.edges);
          setCanvasMap((m) => ({ ...m, [curr]: { nodes: job.nodes, edges: job.edges } }));
        } else {
          setNodes([]);
          setEdges([]);
        }
      }
      setSelectedNode(null);
    }

    prevTabRef.current = curr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId]);

  // ─── Execution State ───────────────────────────────────────
  const [pipelineId, setPipelineId] = useState<string>("");
  const [revision, setRevision] = useState<number>(1);
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [consoleTab, setConsoleTab] = useState<"metrics" | "logs" | "plans" | "problems">("metrics");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [execution, setExecution] = useState<ExecutionDetail | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [compiledPlans, setCompiledPlans] = useState<CompiledPlans | null>(null);
  const pollingRef = useRef<any>(null);
  const cancelOrchestrationRef = useRef<boolean>(false);
  const activeCellExecutionsRef = useRef<Map<string, string>>(new Map());
  const activeCellAbortRef = useRef<Map<string, () => void>>(new Map());

  // ─── Real-time graph problem analysis ──────────────────────
  useEffect(() => {
    const totalCount = activeJob?.cells?.length
      ? activeJob.cells.reduce((acc, c) => acc + (c.nodes?.length || 0), 0)
      : nodes.length;

    if (totalCount > 0) {
      const clientProblems = analyzeJobProblems(activeJob, nodes, edges);
      setProblems(clientProblems);
      const hasErrors = clientProblems.some((p) => p.severity === "error");
      if (hasErrors) {
        setIsValid(false);
      } else {
        setIsValid(true);
      }
    } else {
      setProblems([]);
      setIsValid(null);
    }
  }, [activeJob, nodes, edges]);

  // ─── UI Modals & Sidebars ───────────────────────────────────
  const [showConnManager, setShowConnManager] = useState(false);
  const [showContextVars, setShowContextVars] = useState(false);
  const [showQueryBank, setShowQueryBank] = useState(false);
  const [showPolicySimulator, setShowPolicySimulator] = useState(false);
  const [showAutoDoc, setShowAutoDoc] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [showLauncher, setShowLauncher] = useState<boolean>(() => {
    return localStorage.getItem("cellflow_launcher_dont_ask") !== "true";
  });
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [floatingNode, setFloatingNode] = useState<Node<CanvasNodeData> | null>(null);

  const handleLauncherComplete = useCallback(async (ws: WorkspaceInfo) => {
    setWorkspaceInfo(ws);
    setShowLauncher(false);
    await hydrateFromActiveWorkspace().catch(() => {});
    const st = jobStore.getState();
    if (!st.activeTabId && st.jobs.length > 0) {
      jobStore.setActiveTab(st.jobs[0].id);
    }
  }, []);
  
  // Independent visibility toggles for each panel
  const [repoVisible, setRepoVisible] = useState(true);
  const [paletteVisible, setPaletteVisible] = useState(true);
  const [propertiesVisible, setPropertiesVisible] = useState(true);
  const [consoleVisible, setConsoleVisible] = useState(true);

  const [gitStatus, setGitStatus] = useState<
    { branch: string; clean: boolean; commit_hash: string; commit_message: string } | undefined
  >(undefined);

  // ─── Fetch Workspace Info & Git Status on Mount ────────────
  useEffect(() => {
    api.getGitStatus().then(setGitStatus).catch(() => {});
    fetchCurrentWorkspaceInfo().then((ws) => {
      if (ws) setWorkspaceInfo(ws);
    }).catch(() => {});
    hydrateFromActiveWorkspace().catch(() => {});
  }, []);

  const handleOpenWorkspaceFolder = useCallback(async () => {
    try {
      const clean = (workspaceInfo?.path || "").replace(/^["']|["']$/g, "").trim();
      await fetch(`${getBaseApiUrl()}/workspaces/local/open-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: clean }),
      });
    } catch (_) {}
  }, [workspaceInfo?.path]);

  // ─── Toast helpers ─────────────────────────────────────────
  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // ─── Init backend (optional, falls back gracefully) ────────
  const ensureBackend = useCallback(async (targetName?: string): Promise<string> => {
    let workspaces = await api.listWorkspaces().catch(() => []);
    let wsId = workspaces[0]?.id;
    if (!wsId) {
      const newWs = await api.createWorkspace("Default Workspace");
      wsId = newWs.id;
    }
    let projects = await api.listProjects(wsId).catch(() => []);
    let projId = projects[0]?.id;
    if (!projId) {
      const newProj = await api.createProject(wsId, "Analytics Core", "analytics-core");
      projId = newProj.id;
    }

    const jobName = targetName || (activeJobId ? (jobStore.getJob(activeJobId)?.name ?? "New Pipeline") : "New Pipeline");

    // If seeking the main job pipeline and we already have a cached pipelineId
    if (!targetName && pipelineId) {
      try {
        const existing = await api.getDraft(pipelineId);
        if (existing) {
          setRevision(existing.revision);
          return pipelineId;
        }
      } catch (_) {}
    }

    // Reuse existing pipeline by name in project if present
    const existingPipelines = await api.listPipelinesForProject(projId).catch(() => [] as any[]);
    const match = existingPipelines.find((p: any) => p.name === jobName);
    if (match) {
      const draft = await api.getDraft(match.id);
      if (!targetName) {
        setPipelineId(match.id);
        setRevision(draft.revision);
      }
      return match.id;
    }

    // No match found: create a new pipeline
    const draft = await api.createPipeline(projId, jobName);
    if (!targetName) {
      setPipelineId(draft.id);
      setRevision(draft.revision);
    }
    return draft.id;
  }, [pipelineId, activeJobId]);

  useEffect(() => {
    ensureBackend().catch(() => {});
  }, [ensureBackend]);


  // ─── Open Job from Repository ──────────────────────────────
  const handleOpenJob = useCallback((jobId: string) => {
    // Save current canvas first
    if (activeJobId && activeJobId !== jobId) {
      setCanvasMap((m) => ({ ...m, [activeJobId]: { nodes, edges } }));
    }
    jobStore.openTab(jobId);
  }, [activeJobId, nodes, edges]);

  // ─── Node Handlers ─────────────────────────────────────────
  const handleUpdateConfig = useCallback(
    (nodeId: string, newConfig: Record<string, any>) => {
      const targetCellId = (selectedNode?.data as any)?.cellId || (floatingNode?.data as any)?.cellId || activeJob?.activeCellId;
      setSelectedNode((sel) =>
        sel?.id === nodeId ? { ...sel, data: { ...sel.data, config: newConfig } } : sel
      );
      setFloatingNode((fl) =>
        fl?.id === nodeId ? { ...fl, data: { ...fl.data, config: newConfig } } : fl
      );
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
        )
      );
      if (activeJobId) {
        const j = jobStore.getJob(activeJobId);
        if (j?.cells && j.cells.length > 0) {
          let updated = false;
          if (targetCellId) {
            const cell = j.cells.find((c) => c.id === targetCellId);
            if (cell && cell.nodes.some((n) => n.id === nodeId)) {
              const updatedNodes = cell.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
              );
              jobStore.saveCellGraph(activeJobId, cell.id, updatedNodes, cell.edges);
              updated = true;
            }
          }
          if (!updated) {
            const firstCell = j.cells.find((c) => c.nodes.some((n) => n.id === nodeId));
            if (firstCell) {
              const updatedNodes = firstCell.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
              );
              jobStore.saveCellGraph(activeJobId, firstCell.id, updatedNodes, firstCell.edges);
            }
          }
        }
      }
    },
    [setNodes, activeJobId, selectedNode, floatingNode, activeJob]
  );

  const handleUpdateSchema = useCallback(
    (nodeId: string, schema: SchemaColumn[]) => {
      const targetCellId = (selectedNode?.data as any)?.cellId || (floatingNode?.data as any)?.cellId || activeJob?.activeCellId;
      setSelectedNode((sel) =>
        sel?.id === nodeId ? { ...sel, data: { ...sel.data, schema } } : sel
      );
      setFloatingNode((fl) =>
        fl?.id === nodeId ? { ...fl, data: { ...fl.data, schema } } : fl
      );
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, schema } } : n
        )
      );
      if (activeJobId) {
        const j = jobStore.getJob(activeJobId);
        if (j?.cells && j.cells.length > 0) {
          let updated = false;
          if (targetCellId) {
            const cell = j.cells.find((c) => c.id === targetCellId);
            if (cell && cell.nodes.some((n) => n.id === nodeId)) {
              const updatedNodes = cell.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, schema } } : n
              );
              jobStore.saveCellGraph(activeJobId, cell.id, updatedNodes, cell.edges);
              updated = true;
            }
          }
          if (!updated) {
            const firstCell = j.cells.find((c) => c.nodes.some((n) => n.id === nodeId));
            if (firstCell) {
              const updatedNodes = firstCell.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, schema } } : n
              );
              jobStore.saveCellGraph(activeJobId, firstCell.id, updatedNodes, firstCell.edges);
            }
          }
        }
      }
    },
    [setNodes, activeJobId, selectedNode, floatingNode, activeJob]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const targetCellId = (selectedNode?.data as any)?.cellId || (floatingNode?.data as any)?.cellId || activeJob?.activeCellId;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
      if (activeJobId) {
        const j = jobStore.getJob(activeJobId);
        if (j?.cells && j.cells.length > 0) {
          let updated = false;
          if (targetCellId) {
            const cell = j.cells.find((c) => c.id === targetCellId);
            if (cell && cell.nodes.some((n) => n.id === nodeId)) {
              const updatedNodes = cell.nodes.filter((n) => n.id !== nodeId);
              const updatedEdges = cell.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
              jobStore.saveCellGraph(activeJobId, cell.id, updatedNodes, updatedEdges);
              updated = true;
            }
          }
          if (!updated) {
            const firstCell = j.cells.find((c) => c.nodes.some((n) => n.id === nodeId));
            if (firstCell) {
              const updatedNodes = firstCell.nodes.filter((n) => n.id !== nodeId);
              const updatedEdges = firstCell.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
              jobStore.saveCellGraph(activeJobId, firstCell.id, updatedNodes, updatedEdges);
            }
          }
        }
      }
      showToast("info", `Nó '${nodeId}' removido.`);
    },
    [setNodes, setEdges, showToast, activeJobId, selectedNode, floatingNode, activeJob]
  );

  const handleUpdateLabel = useCallback(
    (nodeId: string, newLabel: string) => {
      const targetCellId = (selectedNode?.data as any)?.cellId || (floatingNode?.data as any)?.cellId || activeJob?.activeCellId;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n
        )
      );
      setSelectedNode((prev) => (prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, label: newLabel } } : prev));
      setFloatingNode((prev) => (prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, label: newLabel } } : prev));
      if (activeJobId) {
        const j = jobStore.getJob(activeJobId);
        if (j?.cells && j.cells.length > 0) {
          let updated = false;
          if (targetCellId) {
            const cell = j.cells.find((c) => c.id === targetCellId);
            if (cell && cell.nodes.some((n) => n.id === nodeId)) {
              const updatedNodes = cell.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n
              );
              jobStore.saveCellGraph(activeJobId, cell.id, updatedNodes, cell.edges);
              updated = true;
            }
          }
          if (!updated) {
            const firstCell = j.cells.find((c) => c.nodes.some((n) => n.id === nodeId));
            if (firstCell) {
              const updatedNodes = firstCell.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n
              );
              jobStore.saveCellGraph(activeJobId, firstCell.id, updatedNodes, firstCell.edges);
            }
          }
        }
      }
    },
    [setNodes, activeJobId, selectedNode, floatingNode, activeJob]
  );

  const handleUpdateNodeId = useCallback(
    (oldId: string, newId: string, specificCellId?: string) => {
      const trimmed = newId.trim();
      if (!trimmed) {
        showToast("error", "O ID do componente não pode ser vazio.");
        return;
      }
      if (trimmed === oldId) return;

      const targetCellId = specificCellId || (selectedNode?.data as any)?.cellId || (floatingNode?.data as any)?.cellId || activeJob?.activeCellId;
      const currentJob = activeJobId ? jobStore.getJob(activeJobId) : null;
      const hasMultiCells = Boolean(currentJob?.cells && currentJob.cells.length > 0);

      // Coleta todos os nós existentes em todas as células do Job para validação estrita de unicidade
      const allJobNodes = hasMultiCells
        ? (currentJob?.cells || []).flatMap((c) => c.nodes || [])
        : nodes;

      // Se já existe outro nó no Job com o novo ID (case-insensitive)
      const idAlreadyExists = allJobNodes.some(
        (n) => n.id.toLowerCase() === trimmed.toLowerCase()
      );
      if (idAlreadyExists) {
        showToast("error", `Já existe um nó com o ID '${trimmed}'. Escolha um ID único.`);
        return;
      }

      setNodes((nds) =>
        nds.map((n) => (n.id === oldId ? { ...n, id: trimmed } : n))
      );
      setEdges((eds) =>
        eds.map((e) => {
          let updated = { ...e };
          if (e.source === oldId) updated.source = trimmed;
          if (e.target === oldId) updated.target = trimmed;
          return updated;
        })
      );

      if (activeJobId && currentJob?.cells && currentJob.cells.length > 0) {
        let updatedCell = false;
        // Atualiza APENAS na célula alvo do nó sendo editado
        if (targetCellId) {
          const targetCell = currentJob.cells.find((c) => c.id === targetCellId);
          if (targetCell && targetCell.nodes.some((n) => n.id === oldId)) {
            const updatedNodes = targetCell.nodes.map((n) =>
              n.id === oldId ? { ...n, id: trimmed } : n
            );
            const updatedEdges = targetCell.edges.map((e) => {
              let updated = { ...e };
              if (e.source === oldId) updated.source = trimmed;
              if (e.target === oldId) updated.target = trimmed;
              return updated;
            });
            jobStore.saveCellGraph(activeJobId, targetCell.id, updatedNodes, updatedEdges);
            updatedCell = true;
          }
        }

        // Se targetCellId não foi informado ou não continha o nó, atualiza apenas na primeira célula encontrada
        if (!updatedCell) {
          const firstCell = currentJob.cells.find((c) => c.nodes.some((n) => n.id === oldId));
          if (firstCell) {
            const updatedNodes = firstCell.nodes.map((n) =>
              n.id === oldId ? { ...n, id: trimmed } : n
            );
            const updatedEdges = firstCell.edges.map((e) => {
              let updated = { ...e };
              if (e.source === oldId) updated.source = trimmed;
              if (e.target === oldId) updated.target = trimmed;
              return updated;
            });
            jobStore.saveCellGraph(activeJobId, firstCell.id, updatedNodes, updatedEdges);
          }
        }
      }

      setSelectedNode((prev) => (prev && prev.id === oldId ? { ...prev, id: trimmed } : prev));
      setFloatingNode((prev) => (prev && prev.id === oldId ? { ...prev, id: trimmed } : prev));
      showToast("success", `ID do nó atualizado: '${oldId}' -> '${trimmed}'`);
    },
    [nodes, setNodes, setEdges, showToast, activeJobId, selectedNode, floatingNode, activeJob]
  );

  // ─── Save Job Locally ──────────────────────────────────────
  const handleSaveLocal = useCallback(() => {
    if (!activeJobId) {
      showToast("error", "Nenhum job aberto. Abra ou crie um job no Repositório.");
      return;
    }
    const currentJob = jobStore.getJob(activeJobId);
    const hasCells = Boolean(currentJob?.cells && currentJob.cells.length > 0);
    const effectiveNodes = hasCells
      ? (currentJob?.cells || []).flatMap((c) => c.nodes || [])
      : nodes;
    const effectiveEdges = hasCells
      ? (currentJob?.cells || []).flatMap((c) => c.edges || [])
      : edges;
    jobStore.saveJob(activeJobId, effectiveNodes, effectiveEdges);
    setCanvasMap((m) => ({ ...m, [activeJobId]: { nodes: effectiveNodes, edges: effectiveEdges } }));
    showToast("success", `Job salvo localmente!`);
  }, [activeJobId, nodes, edges, showToast]);

  // ─── Keyboard Shortcuts ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveLocal();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setRepoVisible((v) => !v);
      }
      if (e.ctrlKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setConsoleVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSaveLocal]);

  // ─── Serialize Canvas ──────────────────────────────────────
  const serializeCanvas = (customPipelineId?: string) => {
    const currentConnections = jobStore.getState().connections;
    const activePid = customPipelineId || pipelineId;
    const currentJob = activeJobId ? jobStore.getJob(activeJobId) : undefined;
    const hasCells = Boolean(currentJob?.cells && currentJob.cells.length > 0);
    const sourceNodes = hasCells
      ? (currentJob?.cells || []).flatMap((c) => c.nodes || [])
      : nodes;
    const sourceEdges = hasCells
      ? (currentJob?.cells || []).flatMap((c) => c.edges || [])
      : edges;

    const specNodes = sourceNodes.map((n) => {
      const cfg = { ...(n.data.config || {}) };
      if (cfg.connection_ref) {
        const refNormalized = String(cfg.connection_ref).toLowerCase().trim();
        const conn = currentConnections.find(
          (c) =>
            c.name.toLowerCase().replace(/\s+/g, "_") === refNormalized ||
            c.id === cfg.connection_ref ||
            c.name.toLowerCase().trim() === refNormalized
        );
        if (conn && conn.config) {
          cfg.connection_details = {
            type: conn.type,
            host: conn.config.host,
            port: conn.config.port,
            database: conn.config.database,
            username: conn.config.username,
            password: conn.config.password,
            sslMode: conn.config.sslMode,
            ...conn.config,
          };
          if (conn.type === "duckdb") {
            if (!cfg.database_path) {
              cfg.database_path = conn.config.database_path || conn.config.database || ":memory:";
            }
          }
        }
      }
      if (cfg.database_path && typeof cfg.database_path === "string") {
        cfg.database_path = cfg.database_path.trim().replace(/^["']|["']$/g, "");
      }
      if (cfg.path && typeof cfg.path === "string") {
        cfg.path = cfg.path.trim().replace(/^["']|["']$/g, "");
      }
      if (n.data.schema && Array.isArray(n.data.schema) && n.data.schema.length > 0) {
        cfg.schema_columns = n.data.schema.map((c: any) => c.name);
        cfg.schema_definitions = n.data.schema;
      }
      return {
        id: n.id,
        component: { type: n.data.componentType, version: n.data.componentVersion || "1.0.0" },
        config: cfg,
      };
    });
    const specEdges = sourceEdges.map((e) => {
      const fromPort =
        e.data?.flowName ||
        (typeof e.label === "string" ? e.label : "") ||
        e.sourceHandle ||
        "main";
      return {
        id: e.id,
        from: `${e.source}.${fromPort}`,
        to: `${e.target}.${e.targetHandle || "input"}`,
      };
    });
    const layoutNodes = sourceNodes.map((n) => ({
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
    }));
    const pipelineName = activeJobId ? (jobStore.getJob(activeJobId)?.name ?? "Pipeline") : "Pipeline";
    const specCells = currentJob?.cells?.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || "",
      order: c.order,
      preconditions: c.preconditions || [],
      precondition_operator: c.preconditionOperator || "AND",
      nodes: c.nodes,
      edges: c.edges,
    }));

    return {
      definition: {
        metadata: { id: activePid, name: pipelineName },
        spec: {
          nodes: specNodes,
          edges: specEdges,
          ...(specCells && specCells.length > 0 ? { cells: specCells } : {}),
        },
      },
      layout: { viewport: { x: 0, y: 0, zoom: 1.0 }, nodes: layoutNodes },
    };
  };

  // ─── Backend Actions ───────────────────────────────────────
  const handleSaveDraft = async () => {
    handleSaveLocal(); // Always save locally first
    setLoadingAction("save");
    try {
      const activePid = await ensureBackend();
      const { definition, layout } = serializeCanvas(activePid);
      const updated = await api.updateDraft(activePid, revision, definition, layout);
      setRevision(updated.revision);
      showToast("success", `Draft salvo! Revisão: rev ${updated.revision}`);
    } catch (_) {
      // Silent — local save already happened
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFocusNode = useCallback(
    (nodeId: string) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (target) {
        setSelectedNode(target);
        setPropertiesVisible(true);
      }
    },
    [nodes]
  );

  const handleOpenDiagnostics = useCallback(() => {
    setConsoleVisible(true);
    setConsoleTab("problems");
  }, []);

  const handleValidate = async () => {
    setLoadingAction("validate");
    try {
      const currentJob = activeJobId ? jobStore.getJob(activeJobId) : activeJob;
      const clientProblems = analyzeJobProblems(currentJob, nodes, edges);
      let allProblems = [...clientProblems];
      let isServerValid = true;

      try {
        const activePid = await ensureBackend();
        const { definition, layout } = serializeCanvas(activePid);

        // Always fetch the current revision to avoid optimistic concurrency conflicts
        let currentRevision = revision;
        try {
          const fresh = await api.getDraft(activePid);
          currentRevision = fresh.revision;
          setRevision(fresh.revision);
        } catch (_) {
          // Keep local revision if fetch fails
        }

        // Try to save the draft; if it fails, still proceed to validate
        try {
          const updated = await api.updateDraft(activePid, currentRevision, definition, layout);
          setRevision(updated.revision);
        } catch (updateErr: any) {
          console.warn("Draft update failed, proceeding to validate anyway:", updateErr.message);
          // If 409, try one more time with a fresh revision
          if (updateErr.message?.includes("409")) {
            try {
              const fresh2 = await api.getDraft(activePid).catch(() => null);
              if (fresh2) {
                const updated2 = await api.updateDraft(activePid, fresh2.revision, definition, layout);
                setRevision(updated2.revision);
              }
            } catch (_) {}
          }
        }

        const report = await api.validateDraft(activePid);
        isServerValid = report.is_valid;
        if (report.errors && report.errors.length > 0) {
          report.errors.forEach((err) => {
            if (!allProblems.some((p) => p.code === err.code && p.node_id === err.node_id)) {
              allProblems.push({
                code: err.code || "ERR_VALIDATION",
                message: err.message,
                node_id: err.node_id,
                severity: "error",
              });
            }
          });
        }
      } catch (err: any) {
        allProblems.push({
          code: "ERR_SERVER_VALIDATE",
          message: `Falha na verificação remota: ${err.message}`,
          severity: "warning",
          suggestion: "Verifique a integridade das conexões e parâmetros configurados nos nós.",
        });
      }

      setProblems(allProblems);
      const hasErrors = allProblems.some((p) => p.severity === "error");
      setIsValid(!hasErrors && isServerValid);

      if (hasErrors || allProblems.length > 0) {
        setConsoleVisible(true);
        setConsoleTab("problems");
        if (hasErrors) {
          showToast(
            "error",
            `${allProblems.filter((p) => p.severity === "error").length} erro(s) encontrados. Verifique a aba Problemas & Diagnóstico.`
          );
        } else {
          showToast("info", "Avisos de validação detectados. Verifique a aba Problemas.");
        }
      } else {
        showToast("success", "Grafo DAG validado com sucesso! Nenhum erro detectado.");
      }
    } catch (err: any) {
      setIsValid(false);
      showToast("error", `Falha na validação: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };


  const handlePublish = async () => {
    setLoadingAction("publish");
    try {
      const activePid = await ensureBackend();
      const { definition, layout } = serializeCanvas(activePid);
      const updated = await api.updateDraft(activePid, revision, definition, layout);
      setRevision(updated.revision);
      const tag = `1.0.${updated.revision}`;
      const version = await api.publishVersion(activePid, tag);
      setPublishedVersionId(version.id);
      showToast("success", `Versão v${tag} publicada!`);
    } catch (err: any) {
      showToast("error", `Falha ao publicar: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCompile = async () => {
    setLoadingAction("compile");
    try {
      let vId = publishedVersionId;
      if (!vId) {
        const activePid = await ensureBackend();
        const { definition, layout } = serializeCanvas(activePid);
        const updated = await api.updateDraft(activePid, revision, definition, layout);
        setRevision(updated.revision);
        const tag = `1.0.${updated.revision}`;
        const version = await api.publishVersion(activePid, tag);
        vId = version.id;
        setPublishedVersionId(version.id);
      }
      const plans = await api.compileVersion(vId);
      setCompiledPlans(plans);
      showToast("success", "Planos compilados! (Logical, Optimized, Physical)");
    } catch (err: any) {
      showToast("error", `Falha na compilação: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  // ─── Isolated Cell Execution (Real Backend Execution) ─────
  const handleExecuteCellIsolated = useCallback(
    async (cell: CanvasCellData): Promise<boolean> => {
      if (!cell.nodes || cell.nodes.length === 0) {
        showToast("error", `A célula "${cell.name}" não possui componentes adicionados.`);
        return false;
      }

      try {
        const cellPipelineName = `${activeJob?.name || "Pipeline"} - ${cell.name}`;
        const activePid = await ensureBackend(cellPipelineName);
        const currentConnections = jobStore.getState().connections;

        const cellSpecNodes = cell.nodes.map((n) => {
          const cfg = { ...(n.data.config || {}) };
          if (cfg.connection_ref) {
            const refNormalized = String(cfg.connection_ref).toLowerCase().trim();
            const conn = currentConnections.find(
              (c) =>
                c.name.toLowerCase().replace(/\s+/g, "_") === refNormalized ||
                c.id === cfg.connection_ref ||
                c.name.toLowerCase().trim() === refNormalized
            );
            if (conn && conn.config) {
              cfg.connection_details = {
                type: conn.type,
                host: conn.config.host,
                port: conn.config.port,
                database: conn.config.database,
                username: conn.config.username,
                password: conn.config.password,
                sslMode: conn.config.sslMode,
                ...conn.config,
              };
              if (conn.type === "duckdb") {
                if (!cfg.database_path) {
                  cfg.database_path = conn.config.database_path || conn.config.database || ":memory:";
                }
              }
            }
          }
          if (cfg.database_path && typeof cfg.database_path === "string") {
            cfg.database_path = cfg.database_path.trim().replace(/^["']|["']$/g, "");
          }
          if (cfg.path && typeof cfg.path === "string") {
            cfg.path = cfg.path.trim().replace(/^["']|["']$/g, "");
          }
          if (n.data.schema && Array.isArray(n.data.schema) && n.data.schema.length > 0) {
            cfg.schema_columns = n.data.schema.map((c: any) => c.name);
            cfg.schema_definitions = n.data.schema;
          }
          return {
            id: n.id,
            component: { type: n.data.componentType, version: n.data.componentVersion || "1.0.0" },
            config: cfg,
          };
        });

        const cellSpecEdges = (cell.edges || []).map((e) => {
          const fromPort =
            e.data?.flowName ||
            (typeof e.label === "string" ? e.label : "") ||
            e.sourceHandle ||
            "main";
          return {
            id: e.id,
            from: `${e.source}.${fromPort}`,
            to: `${e.target}.${e.targetHandle || "input"}`,
          };
        });

        const cellLayoutNodes = cell.nodes.map((n) => ({
          id: n.id,
          position: { x: n.position.x, y: n.position.y },
        }));

        const definition = {
          metadata: { id: activePid, name: cellPipelineName },
          spec: {
            nodes: cellSpecNodes,
            edges: cellSpecEdges,
          },
        };

        const layout = { viewport: { x: 0, y: 0, zoom: 1.0 }, nodes: cellLayoutNodes };

        let freshRev = 1;
        try {
          const fresh = await api.getDraft(activePid);
          freshRev = fresh.revision;
        } catch (_) {}

        const updated = await api.updateDraft(activePid, freshRev, definition, layout);
        setRevision(updated.revision);

        const versionTag = `cell-${cell.id}-${Date.now().toString().slice(-6)}`;
        const pubVersion = await api.publishVersion(activePid, versionTag);

        const execRes = await api.executeVersion(pubVersion.id);
        activeCellExecutionsRef.current.set(cell.id, execRes.execution_id);
        setConsoleVisible(true);
        setConsoleTab("metrics");

        // Inicializa estado de execução para feedback visual imediato
        const initialExec: ExecutionDetail = {
          execution_id: execRes.execution_id,
          pipeline_version_id: pubVersion.id,
          status: "running",
          attempt: 1,
          started_at: new Date().toISOString(),
          tasks: (cell.nodes || []).map((n) => ({
            node_id: n.id,
            status: "running",
            rows_in: 0,
            rows_out: 0,
            duration_ms: 0,
          })),
        };
        setExecution(initialExec);

        // Marca nós como queued na store de telemetria
        if (cell.nodes && cell.nodes.length > 0) {
          telemetryStore.setNodesQueued(cell.nodes.map((n) => n.id));
        }

        showToast("info", `Executando célula "${cell.name}" no backend...`);

        let abortFn: (() => void) | null = null;
        let execResult: { detail: ExecutionDetail; logs: LogEntry[]; cancelled?: boolean };

        try {
          execResult = await new Promise<{ detail: ExecutionDetail; logs: LogEntry[]; cancelled?: boolean }>(
            (resolve, reject) => {
              let consecutivePollErrors = 0;
              const timer = setInterval(async () => {
                try {
                  const detail = await api.getExecution(execRes.execution_id);
                  const execLogs = await api.getExecutionLogs(execRes.execution_id).catch(() => []);
                  consecutivePollErrors = 0;
                  
                  // Atualiza telemetria em tempo real no console e nós do canvas
                  setExecution(detail);
                  if (detail.tasks && detail.tasks.length > 0) {
                    telemetryStore.batchUpdate(detail.tasks);
                  }
                  if (execLogs && execLogs.length > 0) {
                    setLogs(execLogs);
                  }

                  if (["succeeded", "failed", "cancelled"].includes(detail.status)) {
                    clearInterval(timer);
                    const cellNodeIds = (cell.nodes || []).map((n) => n.id);
                    if (detail.status === "failed") {
                      telemetryStore.finalizeUnfinishedNodes(cellNodeIds, "failed");
                    } else if (detail.status === "cancelled") {
                      telemetryStore.finalizeUnfinishedNodes(cellNodeIds, "cancelled");
                    }
                    resolve({ detail, logs: execLogs, cancelled: detail.status === "cancelled" });
                  }
                } catch (pollErr) {
                  consecutivePollErrors++;
                  // Tolera falhas transitórias de conexão durante consultas pesadas
                  if (consecutivePollErrors > 20) {
                    clearInterval(timer);
                    reject(pollErr);
                  }
                }
              }, 350);

              abortFn = () => {
                clearInterval(timer);
                const cellNodeIds = (cell.nodes || []).map((n) => n.id);
                telemetryStore.finalizeUnfinishedNodes(cellNodeIds, "cancelled");
                resolve({
                  detail: {
                    execution_id: execRes.execution_id,
                    pipeline_version_id: pubVersion.id,
                    status: "cancelled",
                    attempt: 1,
                    started_at: new Date().toISOString(),
                    finished_at: new Date().toISOString(),
                    tasks: [],
                  },
                  logs: [],
                  cancelled: true,
                });
              };
              activeCellAbortRef.current.set(cell.id, abortFn);
            }
          );
        } finally {
          activeCellExecutionsRef.current.delete(cell.id);
          activeCellAbortRef.current.delete(cell.id);
        }

        if (execResult.cancelled || execResult.detail.status === "cancelled") {
          if (activeJobId) {
            jobStore.setCellStatus(activeJobId, cell.id, "cancelled");
          }
          showToast("info", `Célula "${cell.name}" cancelada.`);
          return false;
        }

        const isSuccess = execResult.detail.status === "succeeded";
        const totalRowsIn = (execResult.detail.tasks || []).reduce((sum, t) => sum + (t.rows_in || 0), 0);
        const totalRowsOut = (execResult.detail.tasks || []).reduce((sum, t) => sum + (t.rows_out || 0), 0);
        const totalDuration = (execResult.detail.tasks || []).reduce((max, t) => Math.max(max, t.duration_ms || 0), 0);

        const cellMetrics: CellExecutionMetrics = {
          durationMs: totalDuration,
          rowsIn: totalRowsIn,
          rowsOut: totalRowsOut,
          tasks: (execResult.detail.tasks || []).map((t) => ({
            node_id: t.node_id,
            status: t.status,
            rows_in: t.rows_in ?? 0,
            rows_out: t.rows_out ?? 0,
            duration_ms: t.duration_ms ?? 0,
            error_message: t.error_message,
          })),
        };

        setExecution(execResult.detail);
        setLogs(execResult.logs);

        if (activeJobId) {
          jobStore.setCellExecutionResults(
            activeJobId,
            cell.id,
            isSuccess ? "success" : "failed",
            cellMetrics,
            execResult.logs,
            true
          );
        }

        if (isSuccess) {
          showToast("success", `Célula "${cell.name}" executada com SUCESSO! (${totalRowsOut} linhas geradas)`);
        } else {
          setConsoleVisible(true);
          setConsoleTab("logs");
          showToast("error", `Célula "${cell.name}" falhou durante a execução. Inspecione métricas e logs.`);
        }

        return isSuccess;
      } catch (err: any) {
        console.error(`Erro ao executar célula "${cell.name}":`, err);
        showToast("error", `Falha ao executar célula "${cell.name}": ${err.message}`);

        const errorLog: LogEntry = {
          timestamp: new Date().toISOString(),
          level: "ERROR",
          execution_id: "error",
          node_id: cell.nodes?.[0]?.id || cell.id,
          message: `Falha na execução da célula "${cell.name}": ${err.message}`,
        };

        const errorDetail: ExecutionDetail = {
          execution_id: `err-${Date.now()}`,
          pipeline_version_id: "error",
          status: "failed",
          attempt: 1,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          tasks: (cell.nodes || []).map((n) => ({
            node_id: n.id,
            status: "failed",
            rows_in: 0,
            rows_out: 0,
            duration_ms: 0,
            error_message: err.message,
          })),
        };

        setExecution(errorDetail);
        setLogs((prev) => [errorLog, ...prev]);
        setConsoleVisible(true);
        setConsoleTab("logs");

        const cellNodeIds = (cell.nodes || []).map((n) => n.id);
        telemetryStore.finalizeUnfinishedNodes(cellNodeIds, "failed", err.message);

        if (activeJobId) {
          const failMetrics: CellExecutionMetrics = {
            durationMs: 0,
            rowsIn: 0,
            rowsOut: 0,
            tasks: (cell.nodes || []).map((n) => ({
              node_id: n.id,
              status: "failed",
              rows_in: 0,
              rows_out: 0,
              duration_ms: 0,
              error_message: err.message,
            })),
          };
          jobStore.setCellExecutionResults(
            activeJobId,
            cell.id,
            "failed",
            failMetrics,
            [errorLog],
            true
          );
        }

        return false;
      }
    },
    [activeJob, activeJobId, ensureBackend, revision, showToast]
  );

  const handleStopCellIsolated = useCallback(
    async (cell: CanvasCellData) => {
      const execId = activeCellExecutionsRef.current.get(cell.id);
      if (execId) {
        try {
          await api.cancelExecution(execId);
        } catch (_) {}
        activeCellExecutionsRef.current.delete(cell.id);
      }
      const abortFn = activeCellAbortRef.current.get(cell.id);
      if (abortFn) {
        abortFn();
        activeCellAbortRef.current.delete(cell.id);
      }
      const cellNodeIds = (cell.nodes || []).map((n) => n.id);
      telemetryStore.finalizeUnfinishedNodes(cellNodeIds, "cancelled");
      if (activeJobId) {
        jobStore.setCellStatus(activeJobId, cell.id, "cancelled");
      }
      showToast("info", `Execução da célula "${cell.name}" interrompida pelo usuário.`);
    },
    [activeJobId, showToast]
  );

  const handleStopActiveCell = useCallback(async () => {
    if (!activeJob || !activeJob.cells) return;
    const targetCell =
      activeJob.cells.find((c) => c.id === activeJob.activeCellId) || activeJob.cells[0];
    if (targetCell) {
      await handleStopCellIsolated(targetCell);
    }
  }, [activeJob, handleStopCellIsolated]);

  const handleRunActiveCell = useCallback(async () => {
    if (!activeJob || !activeJob.cells || activeJob.cells.length === 0) return;
    const targetCell =
      activeJob.cells.find((c) => c.id === activeJob.activeCellId) || activeJob.cells[0];
    if (targetCell) {
      jobStore.setCellStatus(activeJob.id, targetCell.id, "running");
      await handleExecuteCellIsolated(targetCell);
    }
  }, [activeJob, handleExecuteCellIsolated]);

  const handleStopJob = useCallback(async () => {
    cancelOrchestrationRef.current = true;

    // 1. Cancel all active cell executions in backend
    for (const [, execId] of activeCellExecutionsRef.current.entries()) {
      try {
        await api.cancelExecution(execId);
      } catch (_) {}
    }
    activeCellExecutionsRef.current.clear();

    // 2. Abort all cell polling timers
    for (const abortFn of activeCellAbortRef.current.values()) {
      abortFn();
    }
    activeCellAbortRef.current.clear();

    // 3. If legacy execution is active, cancel it
    if (execution && execution.execution_id) {
      try {
        await api.cancelExecution(execution.execution_id);
      } catch (_) {}
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    // 4. Update multi-canvas job statuses to cancelled / skipped
    if (activeJob && activeJob.cells) {
      activeJob.cells.forEach((c) => {
        if (c.status === "running") {
          jobStore.setCellStatus(activeJob.id, c.id, "cancelled");
        } else if (c.status === "queued") {
          jobStore.setCellStatus(activeJob.id, c.id, "skipped");
        }
      });
    }

    telemetryStore.reset();

    setLoadingAction(null);
    showToast("info", "Execução do Job parada pelo usuário.");
  }, [activeJob, execution, showToast]);

  const handleRun = async () => {
    // Multi-canvas job orchestration
    if (activeJob && activeJob.cells && activeJob.cells.length > 0) {
      cancelOrchestrationRef.current = false;
      setLoadingAction("run");
      setConsoleVisible(true);
      setConsoleTab("metrics");
      const sortedCells = [...activeJob.cells].sort((a, b) => a.order - b.order);

      const cycles = detectCellCycles(sortedCells);
      if (cycles) {
        showToast("error", `Impossível executar: Ciclo detectado nas dependências (${cycles.join(", ")})`);
        setLoadingAction(null);
        return;
      }

      const orderErrors = validateParallelCellConsistency(sortedCells);
      if (orderErrors && orderErrors.length > 0) {
        showToast("error", `Impossível executar: ${orderErrors[0]}`);
        setLoadingAction(null);
        return;
      }

      showToast("info", `Iniciando orquestração completa do Job (${sortedCells.length} células)...`);

      sortedCells.forEach((c) => jobStore.setCellStatus(activeJob.id, c.id, "queued"));
      const allNodeIds = sortedCells.flatMap((c) => (c.nodes || []).map((n) => n.id));
      telemetryStore.setNodesQueued(allNodeIds);
      const completedStatuses: Record<string, "success" | "failed" | "skipped" | "cancelled"> = {};

      const orderGroups = new Map<number, CanvasCellData[]>();
      sortedCells.forEach((c) => {
        const group = orderGroups.get(c.order) || [];
        group.push(c);
        orderGroups.set(c.order, group);
      });

      const sortedOrders = Array.from(orderGroups.keys()).sort((a, b) => a - b);

      try {
        for (const orderNum of sortedOrders) {
          if (cancelOrchestrationRef.current) {
            showToast("info", "Orquestração interrompida pelo usuário.");
            break;
          }

          const parallelCells = orderGroups.get(orderNum) || [];
          await Promise.all(
            parallelCells.map(async (cell) => {
              if (cancelOrchestrationRef.current) {
                jobStore.setCellStatus(activeJob.id, cell.id, "skipped");
                completedStatuses[cell.id] = "skipped";
                completedStatuses[cell.name] = "skipped";
                return;
              }

              const canRun = evaluateCellPreconditions(cell, completedStatuses as any, sortedCells);
              if (!canRun) {
                jobStore.setCellStatus(activeJob.id, cell.id, "skipped");
                completedStatuses[cell.id] = "skipped";
                completedStatuses[cell.name] = "skipped";
                return;
              }

              jobStore.setCellStatus(activeJob.id, cell.id, "running");
              const ok = await handleExecuteCellIsolated(cell);
              if (cancelOrchestrationRef.current) {
                jobStore.setCellStatus(activeJob.id, cell.id, "cancelled");
                completedStatuses[cell.id] = "cancelled";
                completedStatuses[cell.name] = "cancelled";
                return;
              }
              const finalStatus = ok ? "success" : "failed";
              completedStatuses[cell.id] = finalStatus;
              completedStatuses[cell.name] = finalStatus;
            })
          );
        }

        if (cancelOrchestrationRef.current) {
          showToast("info", "Orquestração do Job cancelada pelo usuário.");
        } else {
          const totalFailed = Object.values(completedStatuses).filter((s) => s === "failed").length;
          const totalSuccess = Object.values(completedStatuses).filter((s) => s === "success").length;
          const totalSkipped = Object.values(completedStatuses).filter((s) => s === "skipped").length;

          if (totalFailed > 0) {
            showToast(
              "error",
              `Orquestração finalizada com falhas: ${totalSuccess} sucesso, ${totalFailed} falhas, ${totalSkipped} puladas.`
            );
          } else {
            showToast("success", `Orquestração de todas as células (${totalSuccess}) finalizada com SUCESSO!`);
          }
        }
      } finally {
        setLoadingAction(null);
      }
      return;
    }

    // Default legacy single-canvas execution
    setLoadingAction("run");
    try {
      let vId = publishedVersionId;
      if (!vId) {
        const activePid = await ensureBackend();
        const { definition, layout } = serializeCanvas(activePid);
        const updated = await api.updateDraft(activePid, revision, definition, layout);
        setRevision(updated.revision);
        const tag = `1.0.${updated.revision}`;
        const version = await api.publishVersion(activePid, tag);
        vId = version.id;
        setPublishedVersionId(version.id);
        showToast("info", `Versão v${tag} auto-publicada.`);
      }
      const res = await api.executeVersion(vId);
      telemetryStore.setNodesQueued(nodes.map((n) => n.id));
      showToast("info", `Execução iniciada: ${res.execution_id}`);
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(async () => {
        try {
          const detail = await api.getExecution(res.execution_id);
          const execLogs = await api.getExecutionLogs(res.execution_id);
          setExecution(detail);
          setLogs(execLogs);
          if (detail.tasks && detail.tasks.length > 0) {
            telemetryStore.batchUpdate(detail.tasks);
          }
          if (detail.tasks) {
            setNodes((nds) =>
              nds.map((n) => {
                const task = detail.tasks.find((t) => t.node_id === n.id);
                if (task)
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      status: task.status,
                      metrics: { rowsIn: task.rows_in, rowsOut: task.rows_out, durationMs: task.duration_ms },
                    },
                  };
                return n;
              })
            );
          }
          if (["succeeded", "failed", "cancelled"].includes(detail.status)) {
            clearInterval(pollingRef.current);
            setLoadingAction(null);
            const nodeIds = nodes.map((n) => n.id);
            if (detail.status === "failed") {
              telemetryStore.finalizeUnfinishedNodes(nodeIds, "failed");
            } else if (detail.status === "cancelled") {
              telemetryStore.finalizeUnfinishedNodes(nodeIds, "cancelled");
            }
            if (detail.status === "succeeded") showToast("success", "Execução finalizada com SUCESSO!");
            else if (detail.status === "cancelled") showToast("info", "Execução CANCELADA.");
            else showToast("error", "Execução FALHOU. Verifique os logs.");
          }
        } catch (_) {
          clearInterval(pollingRef.current);
          setLoadingAction(null);
        }
      }, 600);
    } catch (err: any) {
      showToast("error", `Falha ao executar: ${err.message}`);
      setLoadingAction(null);
    }
  };

  const handleCancelExecution = async () => {
    await handleStopJob();
  };

  const handleExport = async () => {
    if (!activeJobId) {
      showToast("error", "Nenhum job aberto para exportar.");
      return;
    }
    setLoadingAction("export");
    try {
      handleSaveLocal();
      const job = jobStore.getJob(activeJobId);
      if (!job) {
        showToast("error", "Job ativo não encontrado.");
        return;
      }

      // Prepara bundle completo e autocontido para portabilidade entre máquinas
      const currentNodes = nodes.length > 0 ? nodes : job.nodes;
      const currentEdges = edges.length > 0 ? edges : job.edges;
      const globalConnections = storeState.connections || [];
      const contextVars = storeState.contextVariables || [];

      // Se houver pipelineId e backend ativo, busca também a definição YAML para embutir no bundle
      let backendYaml: string | undefined = undefined;
      if (pipelineId) {
        try {
          const bundle = await api.exportPipeline(pipelineId);
          if (bundle?.pipeline_yaml) backendYaml = bundle.pipeline_yaml;
        } catch (_) {}
      }

      const exportBundle = {
        schemaVersion: "rdf.job/v2",
        exportedAt: new Date().toISOString(),
        job: {
          ...job,
          nodes: currentNodes,
          edges: currentEdges,
        },
        nodes: currentNodes,
        edges: currentEdges,
        cells: job.cells || [],
        nodeSchemas: job.nodeSchemas || {},
        connections: globalConnections,
        contextVariables: contextVars,
        backendYaml,
      };

      const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${job.name.replace(/\s+/g, "_")}.rdf.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("success", `Job "${job.name}" exportado com sucesso (.rdf.json completo)!`);
    } catch (err: any) {
      showToast("error", `Falha na exportação: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const headerFileInputRef = useRef<HTMLInputElement>(null);

  const handleImportJobFile = useCallback(
    async (file: File, targetFolderId?: string) => {
      try {
        const text = await file.text();
        const json = JSON.parse(text);

        // Suporta tanto .rdf.json v2, v1, quanto arquivos de layout (layout.json) ou specs
        const rawJob = json.job || json;
        const jobName =
          json.name ||
          rawJob.name ||
          file.name.replace(/\.(rdf\.)?json$/i, "") ||
          "Job Importado";
        const importedNodes = json.nodes || rawJob.nodes || [];
        const importedEdges = json.edges || rawJob.edges || [];
        const nodeSchemas = json.nodeSchemas || rawJob.nodeSchemas || {};
        const environment = json.environment || rawJob.environment || "dev";
        const viewport = json.viewport || rawJob.viewport;

        // Salva estado da aba atual se existir
        if (activeJobId) {
          setCanvasMap((m) => ({ ...m, [activeJobId]: { nodes, edges } }));
        }

        const newJob = jobStore.importJob(
          {
            name: jobName,
            nodes: importedNodes,
            edges: importedEdges,
            nodeSchemas,
            environment,
            viewport,
            ...(json.cells ? { cells: json.cells } : {}),
            ...(json.connections ? { connections: json.connections } : {}),
          },
          targetFolderId
        );

        // Usa os nós e arestas verdadeiramente normalizados e curados gerados pelo store
        const activeCell = newJob.cells?.[0];
        const resolvedNodes = (activeCell?.nodes && activeCell.nodes.length > 0) ? activeCell.nodes : newJob.nodes;
        const resolvedEdges = (activeCell?.edges && activeCell.edges.length > 0) ? activeCell.edges : newJob.edges;

        // Atualiza o canvas ativo e abre a aba do job importado
        setNodes(resolvedNodes);
        setEdges(resolvedEdges);
        setCanvasMap((m) => ({
          ...m,
          [newJob.id]: { nodes: resolvedNodes, edges: resolvedEdges },
        }));
        jobStore.openTab(newJob.id);
        setSelectedNode(null);

        showToast(
          "success",
          `Job "${newJob.name}" importado e restaurado com sucesso! (${resolvedNodes.length} componentes recuperados, ${resolvedEdges.length} conexões)`
        );
      } catch (err: any) {
        showToast("error", `Falha ao importar o job: ${err.message}`);
      }
    },
    [activeJobId, nodes, edges, setNodes, setEdges, showToast]
  );

  const handleTriggerHeaderImport = () => {
    if (headerFileInputRef.current) {
      headerFileInputRef.current.value = "";
      headerFileInputRef.current.click();
    }
  };

  const handleCreateNewJob = () => {
    const rootFolder = storeState.folders.find((f) => f.parentId === null) || storeState.folders[0];
    if (!rootFolder) return;
    const job = jobStore.createJob("Novo Job", rootFolder.id);
    handleOpenJob(job.id);
    showToast("success", `Job "${job.name}" criado com sucesso!`);
  };

  return (
    <div className="app-container">
      <input
        type="file"
        ref={headerFileInputRef}
        accept=".json,.rdf.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportJobFile(f);
        }}
      />

      <Header
        pipelineName={pipelineName}
        revision={revision}
        publishedVersionId={publishedVersionId}
        isValid={isValid}
        loadingAction={loadingAction}
        activeEnvironment={storeState.activeEnvironment}
        connectionsCount={storeState.connections.length}
        gitStatus={gitStatus}
        repoVisible={repoVisible}
        paletteVisible={paletteVisible}
        propertiesVisible={propertiesVisible}
        consoleVisible={consoleVisible}
        onToggleRepo={() => setRepoVisible((v) => !v)}
        onTogglePalette={() => setPaletteVisible((v) => !v)}
        onToggleProperties={() => setPropertiesVisible((v) => !v)}
        onToggleConsole={() => setConsoleVisible((v) => !v)}
        onOpenAbout={() => setShowAboutModal(true)}
        onSaveDraft={handleSaveDraft}
        onValidate={handleValidate}
        onPublish={handlePublish}
        onCompile={handleCompile}
        onRun={handleRun}
        onStopJob={handleStopJob}
        onExport={handleExport}
        onImport={handleTriggerHeaderImport}
        onOpenDiagnostics={handleOpenDiagnostics}
        problemCount={problems.length}
        onOpenConnections={() => setShowConnManager(true)}
        onOpenContextVars={() => setShowContextVars(true)}
        onOpenQueryBank={() => setShowQueryBank(true)}
        workspaceName={workspaceInfo?.name}
        workspacePath={workspaceInfo?.path}
        onOpenWorkspace={() => setShowWorkspaceModal(true)}
      />

      {/* MenuBar Desktop - Menus Suspensos e Ações Rápidas */}
      <MenuBar
        activeJobName={activeJob?.name}
        activeCellName={activeJob?.cells?.find((c) => c.id === activeJob.activeCellId)?.name}
        hasActiveJob={Boolean(activeJobId)}
        hasActiveCell={Boolean(activeJob?.cells && activeJob.cells.length > 0)}
        loadingAction={loadingAction}
        publishedVersionId={publishedVersionId}
        repoVisible={repoVisible}
        paletteVisible={paletteVisible}
        propertiesVisible={propertiesVisible}
        consoleVisible={consoleVisible}
        onToggleRepo={() => setRepoVisible((v) => !v)}
        onTogglePalette={() => setPaletteVisible((v) => !v)}
        onToggleProperties={() => setPropertiesVisible((v) => !v)}
        onToggleConsole={() => setConsoleVisible((v) => !v)}
        onNewJob={handleCreateNewJob}
        onSaveDraft={handleSaveDraft}
        onImport={handleTriggerHeaderImport}
        onExport={handleExport}
        onPublish={handlePublish}
        onRunFullJob={handleRun}
        onRunSelectedCell={handleRunActiveCell}
        onStopSelectedCell={handleStopActiveCell}
        activeCellIsRunning={Boolean(
          activeJob?.cells?.find((c) => c.id === activeJob.activeCellId)?.status === "running" ||
            activeJob?.cells?.[0]?.status === "running"
        )}
        onCompile={handleCompile}
        onCancelExecution={handleStopJob}
        onResetSelectedCellStatus={() => {
          if (activeJobId && activeJob?.activeCellId) {
            const targetCell = activeJob.cells?.find((c) => c.id === activeJob.activeCellId);
            if (targetCell && targetCell.status === "running") {
              handleStopCellIsolated(targetCell);
            }
            jobStore.resetCellStatus(activeJobId, activeJob.activeCellId);
            showToast("info", "Status da célula ativa resetado.");
          }
        }}
        onResetAllCellsStatus={() => {
          if (activeJobId) {
            handleStopJob();
            jobStore.resetAllCellsStatus(activeJobId);
            telemetryStore.reset();
            showToast("info", "Status de todas as células resetado.");
          }
        }}
        onAddCell={() => {
          if (activeJobId) {
            const newCell = jobStore.createCell(activeJobId);
            if (newCell) showToast("success", `Nova célula "${newCell.name}" criada.`);
          }
        }}
        onDuplicateActiveCell={() => {
          if (activeJobId && activeJob?.activeCellId) {
            const dup = jobStore.duplicateCell(activeJobId, activeJob.activeCellId);
            if (dup) showToast("success", `Célula duplicada como "${dup.name}".`);
          }
        }}
        onValidate={handleValidate}
        onOpenDiagnostics={handleOpenDiagnostics}
        onOpenConnections={() => setShowConnManager(true)}
        onOpenContextVars={() => setShowContextVars(true)}
        onOpenQueryBank={() => setShowQueryBank(true)}
        onOpenPolicySimulator={() => setShowPolicySimulator(true)}
        onOpenAutoDoc={() => setShowAutoDoc(true)}
        onOpenAbout={() => setShowAboutModal(true)}
        onOpenWorkspace={() => setShowWorkspaceModal(true)}
        onOpenWorkspaceFolder={handleOpenWorkspaceFolder}
      />

      <div className="studio-body">
        {/* Left — Job Repository */}
        {repoVisible && (
          <JobRepository
            onOpenJob={handleOpenJob}
            onImportJob={handleImportJobFile}
          />
        )}

        {/* Center — Canvas Area with Tabs */}
        <div className="canvas-area">
          <JobTabBar onActivateTab={() => {}} />

          {activeJobId ? (
            <div className="canvas-with-palette">
              {paletteVisible && <Palette components={components} />}

              {activeJob ? (
                <MultiCanvasContainer
                  job={activeJob}
                  onSelectNode={setSelectedNode}
                  onDoubleClickNode={(node) => {
                    setFloatingNode(node);
                    setSelectedNode(null);
                  }}
                  onRunEntireJob={handleRun}
                  onStopJob={handleStopJob}
                  onExecuteCellIsolated={handleExecuteCellIsolated}
                  onStopCellIsolated={handleStopCellIsolated}
                  showToast={showToast}
                />
              ) : (
                <ReactFlowProvider>
                  <Canvas
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    setNodes={setNodes}
                    setEdges={setEdges}
                    onSelectNode={setSelectedNode}
                    onDoubleClickNode={(node) => {
                      setFloatingNode(node);
                      setSelectedNode(null);
                    }}
                    allNodes={nodes}
                    cellId={undefined}
                  />
                </ReactFlowProvider>
              )}
            </div>
          ) : (
            <WelcomeScreen
              onOpenJob={handleOpenJob}
              onImportJob={handleImportJobFile}
            />
          )}

          {consoleVisible && (
            <ExecutionConsole
              execution={execution}
              logs={logs}
              compiledPlans={compiledPlans}
              onCancelExecution={handleCancelExecution}
              problems={problems}
              activeTab={consoleTab}
              onTabChange={setConsoleTab}
              onFocusNode={handleFocusNode}
              onRevalidate={handleValidate}
            />
          )}
        </div>

        {/* Right — Properties Panel */}
        {propertiesVisible && (
          <PropertyPanel
            selectedNode={selectedNode}
            onUpdateConfig={handleUpdateConfig}
            onUpdateLabel={handleUpdateLabel}
            onUpdateSchema={handleUpdateSchema}
            onUpdateNodeId={handleUpdateNodeId}
            onDeleteNode={handleDeleteNode}
            connections={jobStore.getConnectionsForJob(activeJobId ?? undefined)}
            queryBank={storeState.queryBank}
            contextVariables={jobStore.getVarsForJob(activeJobId ?? "")}
            activeEnvironment={activeJob?.environment ?? storeState.activeEnvironment}
            allNodes={activeJob?.cells ? activeJob.cells.flatMap((c) => c.nodes) : nodes}
            edges={activeJob?.cells ? activeJob.cells.flatMap((c) => c.edges) : edges}
            onPopOut={(node) => {
              setFloatingNode(node);
              setSelectedNode(null);
            }}
          />
        )}
      </div>

      {/* Modals */}
      {showAboutModal && (
        <AboutModal
          onClose={() => setShowAboutModal(false)}
          gitBranch={gitStatus?.branch}
          gitCommit={gitStatus?.commit_hash}
        />
      )}
      {showConnManager && (
        <ConnectionManager
          onClose={() => setShowConnManager(false)}
          activeJobId={activeJobId}
          activeJobName={activeJob?.name}
        />
      )}
      {showContextVars && (
        <ContextVariablesModal
          onClose={() => setShowContextVars(false)}
          activeJobId={activeJobId}
        />
      )}
      {showQueryBank && (
        <QueryBankModal
          onClose={() => setShowQueryBank(false)}
          onInsertQuery={(q) => {
            if (selectedNode) {
              const currentCfg = selectedNode.data.config || {};
              handleUpdateConfig(selectedNode.id, {
                ...currentCfg,
                query: q.sql,
                ...(q.connectionRef ? { connection_ref: q.connectionRef } : {}),
              });
              if (q.schema && q.schema.length > 0) {
                handleUpdateSchema(selectedNode.id, q.schema);
              }
              showToast("success", `Query '${q.name}' importada para o nó '${selectedNode.data.label || selectedNode.id}'.`);
              setShowQueryBank(false);
            } else {
              showToast("info", "Selecione um nó no canvas para aplicar a query diretamente.");
            }
          }}
        />
      )}
      {showPolicySimulator && (
        <PolicySimulatorModal
          onClose={() => setShowPolicySimulator(false)}
          currentUser="analyst_maria"
        />
      )}
      {showAutoDoc && (
        <AutoDocModal
          onClose={() => setShowAutoDoc(false)}
          pipelineId={pipelineId}
          pipelineName={activeJob?.name || pipelineName}
          cellsCount={activeJob?.cells?.length || 0}
        />
      )}
      {showWorkspaceModal && (
        <WorkspaceModal
          onClose={() => setShowWorkspaceModal(false)}
          onWorkspaceChanged={(ws) => {
            setWorkspaceInfo(ws);
            showToast("success", `Espaço de trabalho ativo: "${ws.name}"`);
          }}
        />
      )}
      {showLauncher && (
        <WorkspaceLauncher
          onWorkspaceSelected={handleLauncherComplete}
        />
      )}

      {/* Floating Node Config Window (double-click on node) */}
      {floatingNode && (
        <FloatingNodeConfig
          node={
            (activeJob?.cells
              ? activeJob.cells.flatMap((c) => c.nodes).find((n) => n.id === floatingNode.id)
              : nodes.find((n) => n.id === floatingNode.id)) || floatingNode
          }
          onUpdateConfig={handleUpdateConfig}
          onUpdateLabel={handleUpdateLabel}
          onUpdateSchema={handleUpdateSchema}
          onUpdateNodeId={handleUpdateNodeId}
          onDeleteNode={handleDeleteNode}
          onClose={() => setFloatingNode(null)}
          connections={jobStore.getConnectionsForJob(activeJobId ?? undefined)}
          queryBank={storeState.queryBank}
          contextVariables={jobStore.getVarsForJob(activeJobId ?? "")}
          activeEnvironment={activeJob?.environment ?? storeState.activeEnvironment}
          allNodes={activeJob?.cells ? activeJob.cells.flatMap((c) => c.nodes) : nodes}
          edges={activeJob?.cells ? activeJob.cells.flatMap((c) => c.edges) : edges}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

// ─── Welcome Screen ───────────────────────────────────────────
const WelcomeScreen: React.FC<{
  onOpenJob: (id: string) => void;
  onImportJob?: (file: File) => void;
}> = ({ onOpenJob, onImportJob }) => {
  const state = useJobStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNewJob = () => {
    const rootFolder = state.folders.find((f) => f.parentId === null);
    if (!rootFolder) return;
    const job = jobStore.createJob("Novo Job", rootFolder.id);
    onOpenJob(job.id);
  };

  const handleTriggerImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  return (
    <div className="welcome-screen">
      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.rdf.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && onImportJob) onImportJob(f);
        }}
      />
      <div className="welcome-content">
        <div className="welcome-logo" style={{ marginBottom: 6 }}>
          <img
            src="./cellflow-logo.png"
            alt="CellFlow Data Studio"
            style={{
              width: 320,
              maxWidth: "85vw",
              height: "auto",
              filter: "drop-shadow(0 0 25px rgba(6, 182, 212, 0.4))",
              display: "block",
              margin: "0 auto",
            }}
          />
        </div>
        <p
          className="welcome-subtitle"
          style={{
            fontSize: "1.1rem",
            fontWeight: 500,
            letterSpacing: "0.03em",
            color: "var(--accent-cyan)",
            margin: "0 0 12px 0",
          }}
        >
          Build smart. Flow fast
        </p>

        <div className="welcome-actions">
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn btn-primary welcome-btn" onClick={handleNewJob}>
              + Criar Novo Job
            </button>
            <button
              className="btn btn-secondary welcome-btn"
              onClick={handleTriggerImport}
              style={{
                background: "rgba(6, 182, 212, 0.12)",
                borderColor: "var(--accent-cyan)",
                color: "var(--accent-cyan)",
              }}
            >
              📥 Importar Job (.rdf.json)
            </button>
          </div>
          {state.jobs.length > 0 && (
            <div className="welcome-recent">
              <div className="welcome-recent-label">Jobs Recentes</div>
              {state.jobs.slice(-5).reverse().map((job) => (
                <button
                  key={job.id}
                  className="welcome-recent-item"
                  onClick={() => onOpenJob(job.id)}
                >
                  ⚡ {job.name}
                  <span className="welcome-recent-date">
                    {new Date(job.updatedAt).toLocaleDateString("pt-BR")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="welcome-features">
          <div className="welcome-feature">🔌 {state.connections.length} Conexões</div>
          <div className="welcome-feature">⚡ {state.jobs.length} Jobs</div>
          <div className="welcome-feature">🌍 {state.contextVariables.length} Variáveis</div>
        </div>
      </div>
    </div>
  );
};
