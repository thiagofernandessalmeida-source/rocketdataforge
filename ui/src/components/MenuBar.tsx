import React, { useState, useRef, useEffect } from "react";
import {
  FileText,
  Save,
  Download,
  Upload,
  UploadCloud,
  Play,
  RotateCcw,
  RefreshCw,
  Cpu,
  Square,
  Plus,
  Copy,
  ShieldCheck,
  CheckSquare,
  AlertCircle,
  Database,
  Globe,
  BookOpen,
  FolderGit2,
  LayoutGrid,
  SlidersHorizontal,
  Terminal,
  Info,
  ChevronDown,
  Layers,
  Sparkles,
  Zap,
  HardDrive,
  FolderOpen,
  Code2,
} from "lucide-react";
import { jobStore } from "../store/jobStore";

export interface MenuBarProps {
  activeJobName?: string;
  activeCellName?: string;
  hasActiveJob: boolean;
  hasActiveCell: boolean;
  loadingAction: string | null;
  publishedVersionId: string | null;
  // Panel toggles
  repoVisible: boolean;
  paletteVisible: boolean;
  propertiesVisible: boolean;
  consoleVisible: boolean;
  onToggleRepo: () => void;
  onTogglePalette: () => void;
  onToggleProperties: () => void;
  onToggleConsole: () => void;
  // Actions
  onNewJob: () => void;
  onSaveDraft: () => void;
  onImport: () => void;
  onExport: () => void;
  onPublish: () => void;
  onRunFullJob: () => void;
  onRunSelectedCell: () => void;
  onStopSelectedCell?: () => void;
  activeCellIsRunning?: boolean;
  onCompile: () => void;
  onCancelExecution: () => void;
  onResetSelectedCellStatus: () => void;
  onResetAllCellsStatus: () => void;
  onAddCell: () => void;
  onDuplicateActiveCell: () => void;
  onValidate: () => void;
  onOpenDiagnostics: () => void;
  onOpenConnections: () => void;
  onOpenContextVars: () => void;
  onOpenQueryBank: () => void;
  onOpenPolicySimulator?: () => void;
  onOpenAutoDoc?: () => void;
  onOpenAbout: () => void;
  onOpenWorkspace?: () => void;
  onOpenWorkspaceFolder?: () => void;
}

type MenuKey = "arquivo" | "execucao" | "celulas" | "ferramentas" | "exibir" | "ajuda" | null;

export const MenuBar: React.FC<MenuBarProps> = ({
  activeJobName,
  activeCellName,
  hasActiveJob,
  hasActiveCell,
  loadingAction,
  publishedVersionId,
  repoVisible,
  paletteVisible,
  propertiesVisible,
  consoleVisible,
  onToggleRepo,
  onTogglePalette,
  onToggleProperties,
  onToggleConsole,
  onNewJob,
  onSaveDraft,
  onImport,
  onExport,
  onPublish,
  onRunFullJob,
  onRunSelectedCell,
  onStopSelectedCell,
  activeCellIsRunning,
  onCompile,
  onCancelExecution,
  onResetSelectedCellStatus,
  onResetAllCellsStatus,
  onAddCell,
  onDuplicateActiveCell,
  onValidate,
  onOpenDiagnostics,
  onOpenConnections,
  onOpenContextVars,
  onOpenQueryBank,
  onOpenPolicySimulator,
  onOpenAutoDoc,
  onOpenAbout,
  onOpenWorkspace,
  onOpenWorkspaceFolder,
}) => {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleMenuClick = (key: MenuKey) => {
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  const handleMenuHover = (key: MenuKey) => {
    if (openMenu !== null) {
      setOpenMenu(key);
    }
  };

  const closeAndRun = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <nav className="studio-menubar" ref={barRef} aria-label="Menu Principal">
      {/* Menu items */}
      <div className="menubar-items">
        {/* ARQUIVO */}
        <div className="menubar-item-wrapper">
          <button
            type="button"
            className={`menubar-btn ${openMenu === "arquivo" ? "active" : ""}`}
            onClick={() => handleMenuClick("arquivo")}
            onMouseEnter={() => handleMenuHover("arquivo")}
          >
            Arquivo
          </button>
          {openMenu === "arquivo" && (
            <div className="menubar-dropdown">
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onNewJob)}
              >
                <Plus size={14} />
                <span className="entry-label">Novo Job</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveJob || loadingAction !== null}
                onClick={() => closeAndRun(onSaveDraft)}
              >
                <Save size={14} />
                <span className="entry-label">Salvar Job</span>
                <span className="shortcut">Ctrl+S</span>
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onImport)}
              >
                <Upload size={14} />
                <span className="entry-label">Importar Job (.rdf.json)...</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveJob || loadingAction !== null}
                onClick={() => closeAndRun(onExport)}
              >
                <Download size={14} />
                <span className="entry-label">Exportar Job (.rdf.json)</span>
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveJob || loadingAction !== null}
                onClick={() => closeAndRun(onPublish)}
              >
                <UploadCloud size={14} />
                <span className="entry-label">Publicar Versão</span>
              </button>
              {(onOpenWorkspace || onOpenWorkspaceFolder) && <div className="dropdown-divider" />}
              {onOpenWorkspace && (
                <button
                  type="button"
                  className="dropdown-entry"
                  onClick={() => closeAndRun(onOpenWorkspace)}
                >
                  <HardDrive size={14} />
                  <span className="entry-label">Alternar Espaço de Trabalho (Workspace)...</span>
                </button>
              )}
              {onOpenWorkspaceFolder && (
                <button
                  type="button"
                  className="dropdown-entry"
                  onClick={() => closeAndRun(onOpenWorkspaceFolder)}
                >
                  <FolderOpen size={14} />
                  <span className="entry-label">Abrir Pasta do Workspace no Explorer</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* EXECUÇÃO */}
        <div className="menubar-item-wrapper">
          <button
            type="button"
            className={`menubar-btn ${openMenu === "execucao" ? "active" : ""}`}
            onClick={() => handleMenuClick("execucao")}
            onMouseEnter={() => handleMenuHover("execucao")}
          >
            Execução
          </button>
          {openMenu === "execucao" && (
            <div className="menubar-dropdown">
              <button
                type="button"
                className="dropdown-entry highlight"
                disabled={!hasActiveJob || loadingAction !== null}
                onClick={() => closeAndRun(onRunFullJob)}
              >
                <Play size={14} color="var(--status-success)" />
                <span className="entry-label">Executar Job Completo (Todas as Células)</span>
                <span className="shortcut">F5</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveCell || loadingAction !== null}
                onClick={() => closeAndRun(onRunSelectedCell)}
              >
                <Zap size={14} color="var(--accent-cyan)" />
                <span className="entry-label">
                  Executar Célula Selecionada {activeCellName ? `("${activeCellName}")` : ""}
                </span>
                <span className="shortcut">Ctrl+Enter</span>
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveJob || loadingAction !== null}
                onClick={() => closeAndRun(onCompile)}
              >
                <Cpu size={14} />
                <span className="entry-label">Compilar Planos (Logical, Optimized, Physical)</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                disabled={loadingAction === null}
                onClick={() => closeAndRun(onCancelExecution)}
              >
                <Square size={14} color="var(--status-danger)" />
                <span className="entry-label">Parar Execução do Job</span>
              </button>
            </div>
          )}
        </div>

        {/* CÉLULAS */}
        <div className="menubar-item-wrapper">
          <button
            type="button"
            className={`menubar-btn ${openMenu === "celulas" ? "active" : ""}`}
            onClick={() => handleMenuClick("celulas")}
            onMouseEnter={() => handleMenuHover("celulas")}
          >
            Células
          </button>
          {openMenu === "celulas" && (
            <div className="menubar-dropdown">
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveCell || !activeCellIsRunning || !onStopSelectedCell}
                onClick={() => onStopSelectedCell && closeAndRun(onStopSelectedCell)}
              >
                <Square size={14} color="var(--status-danger)" />
                <span className="entry-label">
                  Parar Execução da Célula {activeCellName ? `("${activeCellName}")` : ""}
                </span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveCell}
                onClick={() => closeAndRun(onResetSelectedCellStatus)}
              >
                <RotateCcw size={14} color="#f59e0b" />
                <span className="entry-label">
                  Resetar Status da Célula Selecionada {activeCellName ? `("${activeCellName}")` : ""}
                </span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveJob}
                onClick={() => closeAndRun(onResetAllCellsStatus)}
              >
                <RefreshCw size={14} color="#f59e0b" />
                <span className="entry-label">Resetar Status de Todas as Células</span>
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveJob}
                onClick={() => closeAndRun(onAddCell)}
              >
                <Plus size={14} />
                <span className="entry-label">Adicionar Nova Célula</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveCell}
                onClick={() => closeAndRun(onDuplicateActiveCell)}
              >
                <Copy size={14} />
                <span className="entry-label">Duplicar Célula Ativa</span>
              </button>
            </div>
          )}
        </div>

        {/* FERRAMENTAS */}
        <div className="menubar-item-wrapper">
          <button
            type="button"
            className={`menubar-btn ${openMenu === "ferramentas" ? "active" : ""}`}
            onClick={() => handleMenuClick("ferramentas")}
            onMouseEnter={() => handleMenuHover("ferramentas")}
          >
            Ferramentas
          </button>
          {openMenu === "ferramentas" && (
            <div className="menubar-dropdown">
              <button
                type="button"
                className="dropdown-entry"
                disabled={!hasActiveJob || loadingAction !== null}
                onClick={() => closeAndRun(onValidate)}
              >
                <CheckSquare size={14} color="var(--accent-cyan)" />
                <span className="entry-label">Validar Integridade do Grafo / DAG</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onOpenDiagnostics)}
              >
                <AlertCircle size={14} />
                <span className="entry-label">Diagnósticos e Problemas</span>
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onOpenConnections)}
              >
                <Database size={14} color="var(--accent-blue)" />
                <span className="entry-label">Gerenciador de Conexões</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onOpenContextVars)}
              >
                <Globe size={14} color="#10b981" />
                <span className="entry-label">Variáveis de Contexto & Ambientes</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onOpenQueryBank)}
              >
                <BookOpen size={14} color="#8b5cf6" />
                <span className="entry-label">Banco de Queries SQL</span>
              </button>
              <div className="dropdown-divider" />
              {onOpenPolicySimulator && (
                <button
                  type="button"
                  className="dropdown-entry"
                  onClick={() => closeAndRun(onOpenPolicySimulator)}
                >
                  <ShieldCheck size={14} color="#38bdf8" />
                  <span className="entry-label">Simulador de Políticas ABAC & Segurança</span>
                </button>
              )}
              {onOpenAutoDoc && (
                <button
                  type="button"
                  className="dropdown-entry"
                  onClick={() => closeAndRun(onOpenAutoDoc)}
                >
                  <Sparkles size={14} color="#a855f7" />
                  <span className="entry-label">Documentação Interativa (Auto-Doc & Linhagem)</span>
                </button>
              )}
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => {
                  const current = jobStore.isPythonCellsEnabled();
                  jobStore.setPythonCellsEnabled(!current);
                  setOpenMenu(null);
                }}
                title="Habilitar ou desabilitar a criação de Células Python no Job (Recurso Enterprise)"
              >
                <Code2 size={14} color="#f59e0b" />
                <span className="entry-label">
                  {jobStore.isPythonCellsEnabled()
                    ? "Desabilitar Células Python"
                    : "Habilitar Células Python"}
                </span>
                <span
                  className="badge"
                  style={{
                    fontSize: "0.62rem",
                    padding: "1px 5px",
                    borderRadius: 3,
                    background: jobStore.isPythonCellsEnabled()
                      ? "rgba(16, 185, 129, 0.15)"
                      : "rgba(255, 255, 255, 0.1)",
                    color: jobStore.isPythonCellsEnabled() ? "#10b981" : "#94a3b8",
                    border: `1px solid ${
                      jobStore.isPythonCellsEnabled()
                        ? "rgba(16, 185, 129, 0.3)"
                        : "rgba(255, 255, 255, 0.15)"
                    }`,
                    fontWeight: 600,
                  }}
                >
                  {jobStore.isPythonCellsEnabled() ? "Enterprise: Ativo" : "Enterprise: Inativo"}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* EXIBIR */}
        <div className="menubar-item-wrapper">
          <button
            type="button"
            className={`menubar-btn ${openMenu === "exibir" ? "active" : ""}`}
            onClick={() => handleMenuClick("exibir")}
            onMouseEnter={() => handleMenuHover("exibir")}
          >
            Exibir
          </button>
          {openMenu === "exibir" && (
            <div className="menubar-dropdown">
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onToggleRepo)}
              >
                <FolderGit2 size={14} />
                <span className="entry-label">Repositório de Jobs</span>
                <span className="check-mark">{repoVisible ? "✓" : ""}</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onTogglePalette)}
              >
                <LayoutGrid size={14} />
                <span className="entry-label">Paleta de Componentes</span>
                <span className="check-mark">{paletteVisible ? "✓" : ""}</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onToggleProperties)}
              >
                <SlidersHorizontal size={14} />
                <span className="entry-label">Painel de Propriedades</span>
                <span className="check-mark">{propertiesVisible ? "✓" : ""}</span>
              </button>
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onToggleConsole)}
              >
                <Terminal size={14} />
                <span className="entry-label">Console de Execução</span>
                <span className="check-mark">{consoleVisible ? "✓" : ""}</span>
              </button>
            </div>
          )}
        </div>

        {/* AJUDA */}
        <div className="menubar-item-wrapper">
          <button
            type="button"
            className={`menubar-btn ${openMenu === "ajuda" ? "active" : ""}`}
            onClick={() => handleMenuClick("ajuda")}
            onMouseEnter={() => handleMenuHover("ajuda")}
          >
            Ajuda
          </button>
          {openMenu === "ajuda" && (
            <div className="menubar-dropdown">
              <button
                type="button"
                className="dropdown-entry"
                onClick={() => closeAndRun(onOpenAbout)}
              >
                <Info size={14} />
                <span className="entry-label">Sobre o CellFlow Data Studio...</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right side — Quick Context & Reset Status Quick Access */}
      <div className="menubar-right">
        {activeJobName && (
          <div className="menubar-quick-info">
            <span className="text-muted">Job:</span>
            <span className="info-pill">{activeJobName}</span>
            {activeCellName && (
              <>
                <span className="text-muted" style={{ marginLeft: 6 }}>Célula:</span>
                <span className="info-pill highlight">{activeCellName}</span>
              </>
            )}
          </div>
        )}

        {hasActiveJob && (
          <div className="menubar-quick-actions">
            <button
              type="button"
              className="menubar-action-btn"
              onClick={onResetSelectedCellStatus}
              title={`Resetar status da célula ativa (${activeCellName || "selecionada"}) para idle`}
              disabled={!hasActiveCell}
            >
              <RotateCcw size={12} />
              <span>Reset Célula</span>
            </button>
            <button
              type="button"
              className="menubar-action-btn"
              onClick={onResetAllCellsStatus}
              title="Resetar status de todas as células do Job para idle"
            >
              <RefreshCw size={12} />
              <span>Reset Todas</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};
