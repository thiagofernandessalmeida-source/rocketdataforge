import React, { useState, useEffect } from "react";
import {
  FolderGit2,
  HardDrive,
  FolderOpen,
  Check,
  Plus,
  RefreshCw,
  X,
  ExternalLink,
  Database,
  Layers,
  Sparkles,
  FileCode2,
  Folder,
} from "lucide-react";
import {
  WorkspaceInfo,
  fetchCurrentWorkspaceInfo,
  switchWorkspace,
  hydrateFromActiveWorkspace,
} from "../../store/jobStore";
import { getBaseApiUrl } from "../../api/client";

interface WorkspaceModalProps {
  onClose: () => void;
  onWorkspaceChanged?: (ws: WorkspaceInfo) => void;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  onClose,
  onWorkspaceChanged,
}) => {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");
  const [isSwitching, setIsSwitching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadInfo = async () => {
    setIsLoading(true);
    const info = await fetchCurrentWorkspaceInfo();
    if (info) {
      setWorkspace(info);
      setNewPath(info.path);
      setNewName(info.name);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadInfo();
  }, []);

  const handleOpenFolder = async () => {
    try {
      const clean = (workspace?.path || "").replace(/^["']|["']$/g, "").trim();
      await fetch(`${getBaseApiUrl()}/workspaces/local/open-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: clean }),
      });
    } catch (_) {}
  };

  const [isBrowsing, setIsBrowsing] = useState(false);

  const handleBrowseFolder = async () => {
    setIsBrowsing(true);
    try {
      const initial = (newPath || workspace?.path || "").replace(/^["']|["']$/g, "").trim();

      // 1. Se estiver no Electron Desktop, usa dialog nativo do Electron
      if ((window as any).electronAPI?.openDirectory) {
        const selected = await (window as any).electronAPI.openDirectory(initial);
        if (selected) {
          const clean = selected.replace(/^["']|["']$/g, "").trim();
          setNewPath(clean);
          const parts = clean.split(/[\\/]/).filter(Boolean);
          const folderName = parts[parts.length - 1] || "";
          if (folderName && !newName) {
            setNewName(folderName);
          }
        }
        setIsBrowsing(false);
        return;
      }

      // 2. Fallback via backend FastAPI
      const res = await fetch(`${getBaseApiUrl()}/workspaces/local/browse-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: initial }),
      });
      const data = await res.json();
      if (data && data.path) {
        const clean = data.path.replace(/^["']|["']$/g, "").trim();
        setNewPath(clean);
        const folderName = clean.split(/[\\/]/).filter(Boolean).pop() || "";
        if (folderName && !newName) {
          setNewName(folderName);
        }
      }
    } catch (_) {}
    setIsBrowsing(false);
  };

  const handleSwitch = async (targetPath: string, targetName?: string) => {
    if (!targetPath || !targetPath.trim()) return;
    setIsSwitching(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const res = await switchWorkspace(targetPath, targetName);
    setIsSwitching(false);

    if (res.success && res.workspace) {
      setWorkspace(res.workspace);
      setSuccessMsg(`Workspace alternado com sucesso para "${res.workspace.name}".`);
      onWorkspaceChanged?.(res.workspace);
      setTimeout(() => {
        onClose();
      }, 1200);
    } else {
      setErrorMsg(res.error || "Falha ao alternar workspace.");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="modal-container"
        style={{ maxWidth: 680, width: "95vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(0, 229, 255, 0.12)",
                border: "1px solid var(--accent-cyan)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <HardDrive size={18} color="var(--accent-cyan)" />
            </div>
            <div>
              <h2 className="modal-title" style={{ margin: 0, fontSize: "1rem" }}>
                Espaço de Trabalho (Workspace)
              </h2>
              <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                Local físico onde Jobs, Conexões, Queries e Bancos DuckDB são salvos
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {errorMsg && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid var(--status-danger)",
                color: "#fca5a5",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: "0.8rem",
              }}
            >
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                background: "rgba(34, 197, 94, 0.12)",
                border: "1px solid var(--status-success)",
                color: "#86efac",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: "0.8rem",
              }}
            >
              ✓ {successMsg}
            </div>
          )}

          {/* Active Workspace Card */}
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-medium)",
              borderRadius: 8,
              padding: 14,
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <span
                  style={{
                    fontSize: "0.68rem",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--accent-cyan)",
                    fontWeight: 600,
                  }}
                >
                  Workspace Ativo
                </span>
                <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                  {workspace?.name || "Carregando..."}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleOpenFolder}
                title="Abrir pasta no Windows Explorer"
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem" }}
              >
                <FolderOpen size={13} color="var(--accent-cyan)" />
                <span>Abrir no Explorer</span>
              </button>
            </div>

            <div
              style={{
                background: "rgba(0,0,0,0.3)",
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.74rem",
                color: "#93c5fd",
                wordBreak: "break-all",
                marginBottom: 12,
              }}
            >
              {workspace?.path || "..."}
            </div>

            {/* Metrics Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
                paddingTop: 8,
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Layers size={14} color="var(--cat-source)" />
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{workspace?.jobsCount ?? 0}</div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Jobs Salvos</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FolderGit2 size={14} color="var(--cat-conn)" />
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{workspace?.connectionsCount ?? 0}</div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Conexões</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Database size={14} color="#facc15" />
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>data/</div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>DuckDB & Arquivos</div>
                </div>
              </div>
            </div>
          </div>

          {/* Switch or Create Workspace Form */}
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: 14,
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Plus size={14} color="var(--accent-cyan)" />
              <span>Alternar ou Criar Novo Workspace</span>
            </div>

            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Caminho da Pasta no Disco</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="form-input"
                  value={newPath}
                  placeholder="Ex: C:\Natura\harmonizacao_brasil"
                  onChange={(e) => setNewPath(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleBrowseFolder}
                  disabled={isBrowsing}
                  title="Navegar no sistema operacional para escolher a pasta raiz"
                  style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "0 12px" }}
                >
                  <FolderOpen size={14} color="var(--accent-cyan)" />
                  <span>{isBrowsing ? "Aguardando..." : "Procurar..."}</span>
                </button>
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 4 }}>
                Se a pasta não existir, ela será criada automaticamente com as subpastas <code>jobs/</code>, <code>connections/</code>, <code>queries/</code> e <code>data/</code>.
              </div>
            </div>

            <div className="conn-form-row" style={{ alignItems: "flex-end" }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label">Nome de Identificação (opcional)</label>
                <input
                  className="form-input"
                  value={newName}
                  placeholder="Ex: Projetos Natura HML"
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="btn btn-primary"
                disabled={isSwitching || !newPath.trim()}
                onClick={() => handleSwitch(newPath, newName)}
                style={{ height: 34, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}
              >
                {isSwitching ? <RefreshCw size={13} className="spin" /> : <Check size={14} />}
                <span>Alternar Workspace</span>
              </button>
            </div>
          </div>

          {/* Recent Workspaces List */}
          {workspace?.recentWorkspaces && workspace.recentWorkspaces.length > 0 && (
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                Workspaces Recentes
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {workspace.recentWorkspaces.map((recPath) => {
                  const isActive = recPath === workspace.path;
                  return (
                    <div
                      key={recPath}
                      onClick={() => !isActive && handleSwitch(recPath)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        borderRadius: 6,
                        background: isActive ? "rgba(0, 229, 255, 0.08)" : "var(--bg-card)",
                        border: `1px solid ${isActive ? "var(--accent-cyan)" : "var(--border-subtle)"}`,
                        cursor: isActive ? "default" : "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                        <Folder size={14} color={isActive ? "var(--accent-cyan)" : "var(--text-muted)"} />
                        <span
                          style={{
                            fontSize: "0.76rem",
                            fontFamily: "var(--font-mono)",
                            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                            textOverflow: "ellipsis",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {recPath}
                        </span>
                      </div>

                      {isActive ? (
                        <span
                          className="badge"
                          style={{
                            fontSize: "0.65rem",
                            background: "rgba(0,229,255,0.15)",
                            borderColor: "var(--accent-cyan)",
                            color: "var(--accent-cyan)",
                          }}
                        >
                          Ativo
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          Abrir →
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
