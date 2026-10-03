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
import { ToastContainer, ToastMessage } from "./components/Toast";
import { Palette } from "./features/designer/Palette";
import { Canvas } from "./features/designer/Canvas";
import { PropertyPanel } from "./features/designer/PropertyPanel";
import { FloatingNodeConfig } from "./features/designer/FloatingNodeConfig";
import { ExecutionConsole } from "./features/execution/ExecutionConsole";
import { JobRepository } from "./features/repository/JobRepository";
import { JobTabBar } from "./features/repository/JobTabBar";
import { ConnectionManager } from "./features/connections/ConnectionManager";
import { ContextVariablesModal } from "./features/context/ContextVariablesModal";
import { QueryBankModal } from "./features/querybank/QueryBankModal";
import { AboutModal } from "./components/AboutModal";
import { api } from "./api/client";
import { EXPANDED_CATALOG } from "./catalog/components";
import { jobStore, SchemaColumn } from "./store/jobStore";
import { useJobStore } from "./store/useJobStore";
import {
  CanvasNodeData,
  CompiledPlans,
  ComponentDefinition,
  ExecutionDetail,
  LogEntry,
} from "./types";

// ─── Empty Canvas State ───────────────────────────────────────
const EMPTY_CANVAS = { nodes: [] as Node<CanvasNodeData>[], edges: [] as Edge[] };

export const App: React.FC = () => {
  const storeState = useJobStore();

  // ─── Global State ──────────────────────────────────────────
  const [components] = useState<ComponentDefinition[]>(EXPANDED_CATALOG);

  // ─── Per-Tab Canvas State (Map<jobId, {nodes, edges}>) ─────
  const [canvasMap, setCanvasMap] = useState<
    Record<string, { nodes: Node<CanvasNodeData>[]; edges: Edge[] }>
  >({});

  const activeJobId = storeState.activeTabId;
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
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [execution, setExecution] = useState<ExecutionDetail | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [compiledPlans, setCompiledPlans] = useState<CompiledPlans | null>(null);
  const pollingRef = useRef<any>(null);

  // ─── UI Modals & Sidebars ───────────────────────────────────
  const [showConnManager, setShowConnManager] = useState(false);
  const [showContextVars, setShowContextVars] = useState(false);
  const [showQueryBank, setShowQueryBank] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [floatingNode, setFloatingNode] = useState<Node<CanvasNodeData> | null>(null);
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true);
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true);
  const [gitStatus, setGitStatus] = useState<
    { branch: string; clean: boolean; commit_hash: string; commit_message: string } | undefined
  >(undefined);

  // ─── Fetch Git Status on Mount ─────────────────────────────
  useEffect(() => {
    api.getGitStatus().then(setGitStatus).catch(() => {});
  }, []);

  // ─── Toast helpers ─────────────────────────────────────────
  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // ─── Init backend (optional, falls back gracefully) ────────
  const ensureBackend = useCallback(async (): Promise<string> => {
    if (pipelineId) return pipelineId;
    let workspaces = await api.listWorkspaces();
    let wsId = workspaces[0]?.id;
    if (!wsId) {
      const newWs = await api.createWorkspace("Default Workspace");
      wsId = newWs.id;
    }
    let projects = await api.listProjects(wsId);
    let projId = projects[0]?.id;
    if (!projId) {
      const newProj = await api.createProject(wsId, "Analytics Core", "analytics-core");
      projId = newProj.id;
    }
    const jobName = activeJobId ? (jobStore.getJob(activeJobId)?.name ?? "New Pipeline") : "New Pipeline";
    const draft = await api.createPipeline(projId, jobName);
    setPipelineId(draft.id);
    setRevision(draft.revision);
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
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const updated = { ...n, data: { ...n.data, config: newConfig } };
            // Only update selectedNode if NOT editing in floating window
            // to avoid re-render cascade that causes textarea focus loss.
            setSelectedNode((sel) =>
              sel?.id === nodeId ? updated : sel
            );
            // Also update floating node if that's what's being edited
            setFloatingNode((fl) =>
              fl?.id === nodeId ? updated : fl
            );
            return updated;
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const handleUpdateSchema = useCallback(
    (nodeId: string, schema: SchemaColumn[]) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, schema } } : n
        )
      );
    },
    [setNodes]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
      showToast("info", `Nó '${nodeId}' removido.`);
    },
    [setNodes, setEdges, showToast]
  );

  const handleUpdateLabel = useCallback(
    (nodeId: string, newLabel: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n
        )
      );
      setSelectedNode((prev) => (prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, label: newLabel } } : prev));
      setFloatingNode((prev) => (prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, label: newLabel } } : prev));
    },
    [setNodes]
  );

  // ─── Save Job Locally ──────────────────────────────────────
  const handleSaveLocal = useCallback(() => {
    if (!activeJobId) {
      showToast("error", "Nenhum job aberto. Abra ou crie um job no Repositório.");
      return;
    }
    jobStore.saveJob(activeJobId, nodes, edges);
    setCanvasMap((m) => ({ ...m, [activeJobId]: { nodes, edges } }));
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
        setLeftSidebarVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSaveLocal]);

  // ─── Serialize Canvas ──────────────────────────────────────
  const serializeCanvas = (customPipelineId?: string) => {
    const currentConnections = jobStore.getState().connections;
    const activePid = customPipelineId || pipelineId;
    const specNodes = nodes.map((n) => {
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
          };
        }
      }
      if (cfg.path && typeof cfg.path === "string") {
        cfg.path = cfg.path.trim().replace(/^["']|["']$/g, "");
      }
      return {
        id: n.id,
        component: { type: n.data.componentType, version: n.data.componentVersion || "1.0.0" },
        config: cfg,
      };
    });
    const specEdges = edges.map((e) => ({
      id: e.id,
      from: `${e.source}.${e.sourceHandle || "main"}`,
      to: `${e.target}.${e.targetHandle || "input"}`,
    }));
    const layoutNodes = nodes.map((n) => ({
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
    }));
    const pipelineName = activeJobId ? (jobStore.getJob(activeJobId)?.name ?? "Pipeline") : "Pipeline";
    return {
      definition: {
        metadata: { id: activePid, name: pipelineName },
        spec: { nodes: specNodes, edges: specEdges },
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

  const handleValidate = async () => {
    setLoadingAction("validate");
    try {
      const activePid = await ensureBackend();
      const { definition, layout } = serializeCanvas(activePid);
      const updated = await api.updateDraft(activePid, revision, definition, layout);
      setRevision(updated.revision);
      const report = await api.validateDraft(activePid);
      setIsValid(report.is_valid);
      if (report.is_valid) showToast("success", "DAG validado com sucesso!");
      else showToast("error", `Erros: ${report.errors.map((e) => e.message).join(" | ")}`);
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

  const handleRun = async () => {
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
      showToast("info", `Execução iniciada: ${res.execution_id}`);
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(async () => {
        try {
          const detail = await api.getExecution(res.execution_id);
          const execLogs = await api.getExecutionLogs(res.execution_id);
          setExecution(detail);
          setLogs(execLogs);
          if (detail.tasks) {
            setNodes((nds) =>
              nds.map((n) => {
                const task = detail.tasks.find((t) => t.node_id === n.id);
                if (task) return { ...n, data: { ...n.data, status: task.status, metrics: { rowsIn: task.rows_in, rowsOut: task.rows_out, durationMs: task.duration_ms } } };
                return n;
              })
            );
          }
          if (["succeeded", "failed", "cancelled"].includes(detail.status)) {
            clearInterval(pollingRef.current);
            setLoadingAction(null);
            if (detail.status === "succeeded") showToast("success", "Execução finalizada com SUCESSO!");
            else if (detail.status === "cancelled") showToast("info", "Execução CANCELADA.");
            else showToast("error", "Execução FALHOU. Verifique os logs.");
          }
        } catch (_) { clearInterval(pollingRef.current); setLoadingAction(null); }
      }, 600);
    } catch (err: any) {
      showToast("error", `Falha ao executar: ${err.message}`);
      setLoadingAction(null);
    }
  };

  const handleCancelExecution = async () => {
    if (!execution) return;
    try {
      await api.cancelExecution(execution.execution_id);
      showToast("info", "Cancelamento enviado.");
    } catch (err: any) {
      showToast("error", `Falha ao cancelar: ${err.message}`);
    }
  };

  const handleExport = async () => {
    if (!pipelineId) {
      // Export local job
      if (!activeJobId) return;
      handleSaveLocal();
      const job = jobStore.getJob(activeJobId);
      if (!job) return;
      const blob = new Blob([JSON.stringify({ job, nodes, edges }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${job.name.replace(/\s+/g, "_")}.rdf.json`; a.click();
      URL.revokeObjectURL(url);
      showToast("success", "Job exportado como .rdf.json");
      return;
    }
    setLoadingAction("export");
    try {
      const bundle = await api.exportPipeline(pipelineId);
      const blobYaml = new Blob([bundle.pipeline_yaml], { type: "text/yaml" });
      const a1 = document.createElement("a");
      a1.href = URL.createObjectURL(blobYaml); a1.download = "pipeline.yaml"; a1.click();
      const blobLayout = new Blob([bundle.layout_json], { type: "application/json" });
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(blobLayout); a2.download = "layout.json"; a2.click();
      showToast("success", "Bundle exportado: pipeline.yaml + layout.json");
    } catch (err: any) {
      showToast("error", `Falha na exportação: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const activeJob = activeJobId ? storeState.jobs.find((j) => j.id === activeJobId) : null;
  const pipelineName = activeJob?.name ?? "RocketDataForge";

  return (
    <div className="app-container">
      <Header
        pipelineName={pipelineName}
        revision={revision}
        publishedVersionId={publishedVersionId}
        isValid={isValid}
        loadingAction={loadingAction}
        activeEnvironment={storeState.activeEnvironment}
        connectionsCount={storeState.connections.length}
        gitStatus={gitStatus}
        leftSidebarVisible={leftSidebarVisible}
        rightSidebarVisible={rightSidebarVisible}
        onToggleLeftSidebar={() => setLeftSidebarVisible((v) => !v)}
        onToggleRightSidebar={() => setRightSidebarVisible((v) => !v)}
        onOpenAbout={() => setShowAboutModal(true)}
        onSaveDraft={handleSaveDraft}
        onValidate={handleValidate}
        onPublish={handlePublish}
        onCompile={handleCompile}
        onRun={handleRun}
        onExport={handleExport}
        onOpenConnections={() => setShowConnManager(true)}
        onOpenContextVars={() => setShowContextVars(true)}
        onOpenQueryBank={() => setShowQueryBank(true)}
      />

      <div className="studio-body">
        {/* Left — Job Repository (Talend-style) */}
        {leftSidebarVisible && <JobRepository onOpenJob={handleOpenJob} />}

        {/* Center — Canvas Area with Tabs */}
        <div className="canvas-area">
          <JobTabBar onActivateTab={() => {}} />

          {activeJobId ? (
            <div className="canvas-with-palette">
              {leftSidebarVisible && <Palette components={components} />}

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
                    setSelectedNode(null); // deselect from sidebar when opening float
                  }}
                />
              </ReactFlowProvider>
            </div>
          ) : (
            <WelcomeScreen onOpenJob={handleOpenJob} />
          )}

          <ExecutionConsole
            execution={execution}
            logs={logs}
            compiledPlans={compiledPlans}
            onCancelExecution={handleCancelExecution}
          />
        </div>

        {/* Right — Properties Panel */}
        {rightSidebarVisible && (
          <PropertyPanel
            selectedNode={selectedNode}
            onUpdateConfig={handleUpdateConfig}
            onUpdateLabel={handleUpdateLabel}
            onUpdateSchema={handleUpdateSchema}
            onDeleteNode={handleDeleteNode}
            connections={storeState.connections}
            contextVariables={jobStore.getVarsForJob(activeJobId ?? "")}
            activeEnvironment={activeJob?.environment ?? storeState.activeEnvironment}
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
        <ConnectionManager onClose={() => setShowConnManager(false)} />
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
        />
      )}

      {/* Floating Node Config Window (double-click on node) */}
      {floatingNode && (
        <FloatingNodeConfig
          node={floatingNode}
          onUpdateConfig={handleUpdateConfig}
          onUpdateLabel={handleUpdateLabel}
          onUpdateSchema={handleUpdateSchema}
          onDeleteNode={handleDeleteNode}
          onClose={() => setFloatingNode(null)}
          connections={storeState.connections}
          contextVariables={jobStore.getVarsForJob(activeJobId ?? "")}
          activeEnvironment={activeJob?.environment ?? storeState.activeEnvironment}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

// ─── Welcome Screen ───────────────────────────────────────────
const WelcomeScreen: React.FC<{ onOpenJob: (id: string) => void }> = ({ onOpenJob }) => {
  const state = useJobStore();

  const handleNewJob = () => {
    const rootFolder = state.folders.find((f) => f.parentId === null);
    if (!rootFolder) return;
    const job = jobStore.createJob("Novo Job", rootFolder.id);
    onOpenJob(job.id);
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg viewBox="0 0 60 60" width="64" height="64">
            <defs>
              <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00f2fe" />
                <stop offset="100%" stopColor="#4facfe" />
              </linearGradient>
            </defs>
            <path d="M30 5 L45 20 L40 25 L35 20 L35 40 Q35 50 25 55 L22 50 Q28 47 28 40 L28 20 L23 25 L18 20 Z" fill="url(#rg)" />
            <circle cx="30" cy="30" r="4" fill="url(#rg)" opacity="0.4" />
          </svg>
        </div>
        <h1 className="welcome-title">RocketDataForge</h1>
        <p className="welcome-subtitle">
          Plataforma profissional de ETL — evolução do Talend Open Studio
        </p>

        <div className="welcome-actions">
          <button className="btn btn-primary welcome-btn" onClick={handleNewJob}>
            + Criar Novo Job
          </button>
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
