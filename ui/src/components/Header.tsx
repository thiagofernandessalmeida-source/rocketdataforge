import React from "react";
import {
  Rocket,
  Save,
  CheckSquare,
  UploadCloud,
  Play,
  Download,
  Loader2,
  Cpu,
  Database,
  Globe,
  ChevronDown,
  BookOpen,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Info,
} from "lucide-react";
import { Environment } from "../store/jobStore";

const ENV_LABELS: Record<Environment, { label: string; color: string }> = {
  dev: { label: "DEV", color: "#10b981" },
  hml: { label: "HML", color: "#f59e0b" },
  prd: { label: "PRD", color: "#ef4444" },
};

interface HeaderProps {
  pipelineName: string;
  revision: number;
  publishedVersionId: string | null;
  isValid: boolean | null;
  loadingAction: string | null;
  activeEnvironment: Environment;
  connectionsCount: number;
  gitStatus?: { branch: string; clean: boolean; commit_hash: string; commit_message: string };
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  onOpenAbout: () => void;
  onSaveDraft: () => void;
  onValidate: () => void;
  onPublish: () => void;
  onCompile: () => void;
  onRun: () => void;
  onExport: () => void;
  onOpenConnections: () => void;
  onOpenContextVars: () => void;
  onOpenQueryBank: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  pipelineName,
  revision,
  publishedVersionId,
  isValid,
  loadingAction,
  activeEnvironment,
  connectionsCount,
  gitStatus,
  leftSidebarVisible,
  rightSidebarVisible,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onOpenAbout,
  onSaveDraft,
  onValidate,
  onPublish,
  onCompile,
  onRun,
  onExport,
  onOpenConnections,
  onOpenContextVars,
  onOpenQueryBank,
}) => {
  const env = ENV_LABELS[activeEnvironment];

  return (
    <header className="top-header" id="main-header">
      {/* Brand & App Info Menu */}
      <div className="brand-section">
        <button
          className="brand-logo-btn"
          onClick={onOpenAbout}
          title="Sobre o RocketDataForge — Versão e Detalhes"
          style={{
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 6,
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div className="brand-logo">
            <Rocket size={20} color="var(--accent-cyan)" />
            <span>RocketDataForge</span>
            <span
              style={{
                fontSize: "0.68rem",
                color: "var(--accent-cyan)",
                background: "rgba(6,182,212,0.12)",
                padding: "1px 5px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
              }}
            >
              v1.2.0
            </span>
            <ChevronDown size={11} color="var(--text-muted)" />
          </div>
        </button>

        <div className="pipeline-meta">
          <span className="pipeline-title" title={pipelineName}>
            {pipelineName.length > 25 ? pipelineName.slice(0, 23) + "…" : pipelineName}
          </span>
          <span className="badge badge-revision" title="Revisão Atual do Draft">
            rev {revision}
          </span>
          {isValid === true && <span className="badge badge-success">DAG Válido</span>}
          {isValid === false && (
            <span
              className="badge"
              style={{
                background: "rgba(239,68,68,0.15)",
                color: "var(--status-danger)",
                borderColor: "var(--status-danger)",
              }}
            >
              Erros no Grafo
            </span>
          )}
        </div>
      </div>

      {/* Center — Git Branch Indicator & Config Buttons */}
      <div className="header-center">
        {/* Git Branch Badge */}
        {gitStatus && (
          <div
            className="git-branch-badge"
            onClick={onOpenAbout}
            title={`Branch Git ativa: ${gitStatus.branch}\nCommit: ${gitStatus.commit_hash} - ${gitStatus.commit_message}\nStatus: ${gitStatus.clean ? "Sem alterações pendentes" : "Modificações locais pendentes"}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <GitBranch size={13} color="var(--accent-cyan)" />
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
              {gitStatus.branch}
            </span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: gitStatus.clean ? "var(--status-success)" : "#f59e0b",
                boxShadow: gitStatus.clean
                  ? "0 0 6px var(--status-success)"
                  : "0 0 6px #f59e0b",
              }}
              title={gitStatus.clean ? "Branch sincronizada" : "Modificações locais"}
            />
          </div>
        )}

        {/* Environment Badge */}
        <button
          className="env-badge-btn"
          style={{ "--env-color": env.color } as any}
          onClick={onOpenContextVars}
          title="Variáveis de Contexto & Ambientes"
        >
          <span className="env-dot" style={{ background: env.color }} />
          <span className="env-label" style={{ color: env.color }}>
            {env.label}
          </span>
          <Globe size={12} opacity={0.7} />
        </button>

        {/* Connections Button */}
        <button
          className="btn btn-secondary header-conn-btn"
          onClick={onOpenConnections}
          title="Gerenciar Conexões de Banco de Dados"
          id="btn-connections"
        >
          <Database size={14} />
          <span>Conexões</span>
          {connectionsCount > 0 && (
            <span className="conn-count-badge">{connectionsCount}</span>
          )}
        </button>

        {/* Query Bank Button */}
        <button
          className="btn btn-secondary header-conn-btn"
          onClick={onOpenQueryBank}
          title="Banco de Queries — Salve e reutilize SQL"
          id="btn-query-bank"
        >
          <BookOpen size={14} />
          <span>Queries</span>
        </button>

        {/* Sidebar Visibility Toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: 6 }}>
          <button
            className="icon-btn"
            style={{
              padding: "5px 7px",
              background: !leftSidebarVisible ? "rgba(6,182,212,0.15)" : undefined,
              borderColor: !leftSidebarVisible ? "var(--accent-cyan)" : undefined,
            }}
            onClick={onToggleLeftSidebar}
            title={
              leftSidebarVisible
                ? "Ocultar barra lateral esquerda (Ctrl+B)"
                : "Exibir barra lateral esquerda (Ctrl+B)"
            }
          >
            {leftSidebarVisible ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} color="var(--accent-cyan)" />}
          </button>

          <button
            className="icon-btn"
            style={{
              padding: "5px 7px",
              background: !rightSidebarVisible ? "rgba(6,182,212,0.15)" : undefined,
              borderColor: !rightSidebarVisible ? "var(--accent-cyan)" : undefined,
            }}
            onClick={onToggleRightSidebar}
            title={
              rightSidebarVisible
                ? "Ocultar painel de propriedades"
                : "Exibir painel de propriedades"
            }
          >
            {rightSidebarVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} color="var(--accent-cyan)" />}
          </button>
        </div>
      </div>

      {/* Right — Pipeline Actions */}
      <div className="header-actions">
        {/* Save */}
        <button
          type="button"
          className="btn btn-secondary"
          id="btn-save-draft"
          onClick={onSaveDraft}
          disabled={loadingAction !== null}
          title="Salvar Job (Ctrl+S)"
        >
          {loadingAction === "save" ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          Salvar
        </button>

        {/* Validate */}
        <button
          type="button"
          className="btn btn-secondary"
          id="btn-validate"
          onClick={onValidate}
          disabled={loadingAction !== null}
        >
          {loadingAction === "validate" ? <Loader2 size={14} className="spin" /> : <CheckSquare size={14} />}
          Validar
        </button>

        {/* Export */}
        <button
          type="button"
          className="btn btn-secondary"
          id="btn-export"
          onClick={onExport}
          disabled={loadingAction !== null}
        >
          {loadingAction === "export" ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
          Exportar
        </button>

        <div className="header-divider" />

        {/* Publish */}
        <button
          type="button"
          className="btn btn-primary"
          id="btn-publish"
          onClick={onPublish}
          disabled={loadingAction !== null}
        >
          {loadingAction === "publish" ? <Loader2 size={14} className="spin" /> : <UploadCloud size={14} />}
          Publicar
        </button>

        {/* Compile */}
        <button
          type="button"
          className="btn btn-secondary"
          id="btn-compile"
          onClick={onCompile}
          disabled={loadingAction !== null || !publishedVersionId}
          title={!publishedVersionId ? "Publique antes de compilar" : "Compilar Planos"}
        >
          {loadingAction === "compile" ? <Loader2 size={14} className="spin" /> : <Cpu size={14} />}
          Compilar
        </button>

        {/* Run */}
        <button
          type="button"
          className="btn btn-success"
          id="btn-run-pipeline"
          onClick={onRun}
          disabled={loadingAction !== null || !publishedVersionId}
          title={!publishedVersionId ? "Publique antes de executar" : "Executar Pipeline"}
        >
          {loadingAction === "run" ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          Executar
        </button>
      </div>
    </header>
  );
};
