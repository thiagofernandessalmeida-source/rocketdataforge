import React from "react";
import {
  Rocket,
  Save,
  CheckSquare,
  UploadCloud,
  Upload,
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
  FolderGit2,
  LayoutGrid,
  SlidersHorizontal,
  Terminal,
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
  repoVisible?: boolean;
  paletteVisible?: boolean;
  propertiesVisible?: boolean;
  consoleVisible?: boolean;
  onToggleRepo?: () => void;
  onTogglePalette?: () => void;
  onToggleProperties?: () => void;
  onToggleConsole?: () => void;
  leftSidebarVisible?: boolean;
  rightSidebarVisible?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onOpenAbout: () => void;
  onSaveDraft: () => void;
  onValidate: () => void;
  onPublish: () => void;
  onCompile: () => void;
  onRun: () => void;
  onExport: () => void;
  onImport?: () => void;
  onOpenDiagnostics?: () => void;
  problemCount?: number;
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
  repoVisible = true,
  paletteVisible = true,
  propertiesVisible = true,
  consoleVisible = true,
  onToggleRepo,
  onTogglePalette,
  onToggleProperties,
  onToggleConsole,
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
  onImport,
  onOpenDiagnostics,
  problemCount = 0,
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
          <span className="brand-logo">
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
          </span>
        </button>

        <div className="pipeline-meta">
          <span className="pipeline-title" title={pipelineName}>
            {pipelineName.length > 25 ? pipelineName.slice(0, 23) + "…" : pipelineName}
          </span>
          <span className="badge badge-revision" title="Revisão Atual do Draft">
            rev {revision}
          </span>
          {isValid === true && (
            <button
              type="button"
              className="badge badge-success"
              style={{
                cursor: "pointer",
                background: "rgba(16, 185, 129, 0.15)",
                color: "var(--status-success)",
                borderColor: "var(--status-success)",
                fontWeight: 600,
              }}
              onClick={onOpenDiagnostics}
              title="Grafo Válido — Clique para abrir o Painel de Diagnóstico"
            >
              ✓ DAG Válido
            </button>
          )}
          {isValid === false && (
            <button
              type="button"
              className="badge"
              style={{
                background: "rgba(239,68,68,0.2)",
                color: "var(--status-danger)",
                borderColor: "var(--status-danger)",
                cursor: "pointer",
                fontWeight: 600,
                boxShadow: "0 0 6px rgba(239,68,68,0.35)",
              }}
              onClick={onOpenDiagnostics}
              title="Erros estruturais no Grafo — Clique para abrir o Painel de Diagnóstico"
            >
              ⚠ Erros no Grafo {problemCount > 0 ? `(${problemCount})` : ""}
            </button>
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

        {/* Sidebar & Panel Visibility Toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: 6, background: "rgba(0,0,0,0.25)", padding: "2px 4px", borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
          <button
            className="icon-btn"
            style={{
              padding: "4px 6px",
              background: repoVisible ? "rgba(0,229,255,0.12)" : "transparent",
              borderColor: repoVisible ? "var(--accent-cyan)" : "transparent",
              color: repoVisible ? "var(--accent-cyan)" : "var(--text-muted)",
            }}
            onClick={onToggleRepo || onToggleLeftSidebar}
            title={repoVisible ? "Ocultar Repositório de Jobs" : "Exibir Repositório de Jobs"}
            id="toggle-repo-btn"
          >
            <FolderGit2 size={14} />
          </button>

          <button
            className="icon-btn"
            style={{
              padding: "4px 6px",
              background: paletteVisible ? "rgba(79,142,247,0.12)" : "transparent",
              borderColor: paletteVisible ? "var(--accent-blue)" : "transparent",
              color: paletteVisible ? "var(--accent-blue)" : "var(--text-muted)",
            }}
            onClick={onTogglePalette}
            title={paletteVisible ? "Ocultar Paleta de Componentes" : "Exibir Paleta de Componentes"}
            id="toggle-palette-btn"
          >
            <LayoutGrid size={14} />
          </button>

          <button
            className="icon-btn"
            style={{
              padding: "4px 6px",
              background: consoleVisible ? "rgba(34,197,94,0.12)" : "transparent",
              borderColor: consoleVisible ? "var(--status-success)" : "transparent",
              color: consoleVisible ? "var(--status-success)" : "var(--text-muted)",
            }}
            onClick={onToggleConsole}
            title={consoleVisible ? "Ocultar Console de Execução" : "Exibir Console de Execução"}
            id="toggle-console-btn"
          >
            <Terminal size={14} />
          </button>

          <button
            className="icon-btn"
            style={{
              padding: "4px 6px",
              background: propertiesVisible ? "rgba(155,114,247,0.12)" : "transparent",
              borderColor: propertiesVisible ? "var(--accent-purple)" : "transparent",
              color: propertiesVisible ? "var(--accent-purple)" : "var(--text-muted)",
            }}
            onClick={onToggleProperties || onToggleRightSidebar}
            title={propertiesVisible ? "Ocultar Painel de Propriedades" : "Exibir Painel de Propriedades"}
            id="toggle-properties-btn"
          >
            <SlidersHorizontal size={14} />
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
          <span>Salvar</span>
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
          <span>Validar</span>
        </button>

        {/* Export */}
        <button
          type="button"
          className="btn btn-secondary"
          id="btn-export"
          onClick={onExport}
          disabled={loadingAction !== null}
          title="Exportar Job (.rdf.json)"
        >
          {loadingAction === "export" ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
          <span>Exportar</span>
        </button>

        {/* Import */}
        {onImport && (
          <button
            type="button"
            className="btn btn-secondary"
            id="btn-import"
            onClick={onImport}
            disabled={loadingAction !== null}
            title="Importar Job (.rdf.json / .json)"
          >
            <Upload size={14} />
            <span>Importar</span>
          </button>
        )}

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
          <span>Publicar</span>
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
          <span>Compilar</span>
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
          <span>Executar</span>
        </button>
      </div>
    </header>
  );
};
