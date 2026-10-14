import React, { useState, useEffect } from "react";
import {
  HardDrive,
  FolderOpen,
  Check,
  RefreshCw,
  Folder,
  ArrowRight,
  Database,
  Layers,
  Sparkles,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import {
  WorkspaceInfo,
  fetchCurrentWorkspaceInfo,
  switchWorkspace,
} from "../../store/jobStore";
import { getBaseApiUrl } from "../../api/client";

interface WorkspaceLauncherProps {
  onWorkspaceSelected: (ws: WorkspaceInfo) => void;
}

export const WorkspaceLauncher: React.FC<WorkspaceLauncherProps> = ({
  onWorkspaceSelected,
}) => {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rememberDefault, setRememberDefault] = useState<boolean>(() => {
    return localStorage.getItem("cellflow_launcher_remember_default") === "true";
  });

  useEffect(() => {
    let isMounted = true;
    fetchCurrentWorkspaceInfo().then((info) => {
      if (!isMounted) return;
      if (info) {
        const clean = (info.path || "").replace(/^["']|["']$/g, "").trim();
        setWorkspace(info);
        setWorkspacePath(clean);
        setWorkspaceName(info.name ? info.name.replace(/^["']|["']$/g, "") : "");
        setRecentWorkspaces(
          (info.recentWorkspaces || [clean]).map((p) => p.replace(/^["']|["']$/g, "").trim())
        );
      }
      setIsLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleBrowse = async () => {
    setIsBrowsing(true);
    setErrorMsg(null);
    try {
      const initial = (workspacePath || workspace?.path || "").replace(/^["']|["']$/g, "").trim();

      // 1. Se estiver no Electron Desktop, usa dialog nativo direto do Electron
      if ((window as any).electronAPI?.openDirectory) {
        const selected = await (window as any).electronAPI.openDirectory(initial);
        if (selected) {
          const clean = selected.replace(/^["']|["']$/g, "").trim();
          setWorkspacePath(clean);
          const parts = clean.split(/[\\/]/).filter(Boolean);
          const folderName = parts[parts.length - 1] || "";
          if (folderName) setWorkspaceName(folderName);
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
        setWorkspacePath(clean);
        const parts = clean.split(/[\\/]/).filter(Boolean);
        const folderName = parts[parts.length - 1] || "";
        if (folderName) {
          setWorkspaceName(folderName);
        }
      }
    } catch (err: any) {
      setErrorMsg("Não foi possível abrir o seletor nativo do sistema operacional.");
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleLaunch = async () => {
    const cleanPath = (workspacePath || "").replace(/^["']|["']$/g, "").trim();
    if (!cleanPath) {
      setErrorMsg("Informe ou selecione o caminho da pasta do workspace.");
      return;
    }

    setIsLaunching(true);
    setErrorMsg(null);

    try {
      localStorage.setItem("cellflow_launcher_remember_default", rememberDefault ? "true" : "false");
      if (rememberDefault) {
        localStorage.setItem("cellflow_launcher_dont_ask", "true");
      }

      const res = await switchWorkspace(cleanPath, workspaceName.trim() || undefined);
      if (res.success && res.workspace) {
        onWorkspaceSelected(res.workspace);
      } else {
        setErrorMsg(res.error || "Falha ao conectar no workspace selecionado.");
        setIsLaunching(false);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Erro inesperado ao inicializar workspace.");
      setIsLaunching(false);
    }
  };

  const handleSelectRecent = (path: string) => {
    const clean = (path || "").replace(/^["']|["']$/g, "").trim();
    setWorkspacePath(clean);
    const parts = clean.split(/[\\/]/).filter(Boolean);
    const folderName = parts[parts.length - 1] || "";
    if (folderName) setWorkspaceName(folderName);
    setErrorMsg(null);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at 50% 30%, #0d1527 0%, #060911 100%)",
        padding: 20,
        fontFamily: "var(--font-sans, system-ui, -apple-system, sans-serif)",
      }}
    >
      {/* Background ambient lighting */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 500,
          height: 300,
          background: "radial-gradient(circle, rgba(0, 229, 255, 0.08) 0%, transparent 70%)",
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 620,
          background: "rgba(15, 23, 42, 0.95)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(0, 229, 255, 0.25)",
          borderRadius: 14,
          boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 229, 255, 0.12)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Top Header Banner */}
        <div
          style={{
            padding: "24px 28px 18px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
            background: "linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "linear-gradient(135deg, rgba(0, 229, 255, 0.25) 0%, rgba(99, 102, 241, 0.25) 100%)",
                border: "1px solid rgba(0, 229, 255, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 15px rgba(0, 229, 255, 0.3)",
              }}
            >
              <HardDrive size={22} color="#00e5ff" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    color: "var(--accent-cyan, #00e5ff)",
                  }}
                >
                  CellFlow Data Studio
                </span>
                <span
                  style={{
                    fontSize: "0.62rem",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "rgba(255, 255, 255, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                >
                  Enterprise Edition
                </span>
              </div>
              <h1
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 600,
                  color: "#f8fafc",
                  margin: "4px 0 0",
                  letterSpacing: -0.3,
                }}
              >
                Selecionar Espaço de Trabalho (Workspace)
              </h1>
            </div>
          </div>
          <p
            style={{
              fontSize: "0.78rem",
              color: "rgba(148, 163, 184, 0.9)",
              margin: "12px 0 0",
              lineHeight: 1.45,
            }}
          >
            O Studio armazena seus Jobs, Pipelines, Conexões, Banco de Queries e bancos DuckDB no diretório de workspace.
            Você pode selecionar um workspace existente versionado via Git ou criar um novo.
          </p>
        </div>

        {/* Content Body */}
        <div style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
          {errorMsg && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#fca5a5",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: "0.78rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Path Input Field with Browse Button */}
          <div className="form-group" style={{ margin: 0 }}>
            <label
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.76rem",
                fontWeight: 600,
                color: "#e2e8f0",
                marginBottom: 6,
              }}
            >
              <span>Pasta Raiz do Workspace</span>
              {workspacePath && (
                <span style={{ fontSize: "0.7rem", color: "var(--accent-cyan, #00e5ff)", fontWeight: 500 }}>
                  {workspaceName || "harmonizacao_brasil"}
                </span>
              )}
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="form-input"
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.82rem",
                  background: "rgba(10, 15, 29, 0.85)",
                  borderColor: "rgba(255, 255, 255, 0.15)",
                  color: "#e2e8f0",
                  padding: "8px 12px",
                  borderRadius: 6,
                }}
                value={workspacePath}
                placeholder="Ex: C:\Natura\harmonizacao_brasil"
                onChange={(e) => {
                  const clean = e.target.value.replace(/^["']|["']$/g, "").trim();
                  setWorkspacePath(clean);
                  const parts = clean.split(/[\\/]/).filter(Boolean);
                  const folderName = parts[parts.length - 1] || "";
                  if (folderName) setWorkspaceName(folderName);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleLaunch()}
                autoFocus
              />

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBrowse}
                disabled={isBrowsing}
                title="Abrir janela do sistema operacional para navegar até o workspace"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 14px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  background: "rgba(30, 41, 59, 0.8)",
                  borderColor: "rgba(255, 255, 255, 0.2)",
                  color: "#f1f5f9",
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                }}
              >
                {isBrowsing ? (
                  <RefreshCw size={14} className="spin" />
                ) : (
                  <FolderOpen size={14} color="#00e5ff" />
                )}
                <span>{isBrowsing ? "Aguardando SO..." : "Procurar..."}</span>
              </button>
            </div>

            <div
              style={{
                fontSize: "0.7rem",
                color: "rgba(148, 163, 184, 0.8)",
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>📁</span>
              <span>
                Estrutura padrão automática: <code>jobs/</code>, <code>connections/</code>, <code>queries/</code>, <code>data/</code>.
              </span>
            </div>
          </div>

          {/* Recent Workspaces Dropdown / List */}
          {recentWorkspaces && recentWorkspaces.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  fontSize: "0.74rem",
                  fontWeight: 600,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Workspaces Recentes
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: 140,
                  overflowY: "auto",
                  paddingRight: 4,
                }}
              >
                {recentWorkspaces.map((pathItem, idx) => {
                  const isSelected = pathItem.trim().toLowerCase() === workspacePath.trim().toLowerCase();
                  const parts = pathItem.split(/[\\/]/).filter(Boolean);
                  const shortName = parts[parts.length - 1] || pathItem;

                  return (
                    <div
                      key={pathItem + idx}
                      onClick={() => handleSelectRecent(pathItem)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 10px",
                        borderRadius: 6,
                        background: isSelected ? "rgba(0, 229, 255, 0.1)" : "rgba(255, 255, 255, 0.03)",
                        border: `1px solid ${isSelected ? "rgba(0, 229, 255, 0.4)" : "rgba(255, 255, 255, 0.07)"}`,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                        <Folder size={13} color={isSelected ? "#00e5ff" : "#64748b"} />
                        <span
                          style={{
                            fontSize: "0.78rem",
                            fontWeight: isSelected ? 600 : 400,
                            color: isSelected ? "#00e5ff" : "#e2e8f0",
                          }}
                        >
                          {shortName}
                        </span>
                        <span
                          style={{
                            fontSize: "0.68rem",
                            fontFamily: "var(--font-mono, monospace)",
                            color: "rgba(148, 163, 184, 0.6)",
                            textOverflow: "ellipsis",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        >
                          ({pathItem})
                        </span>
                      </div>

                      {isSelected && (
                        <span
                          style={{
                            fontSize: "0.64rem",
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: "rgba(0, 229, 255, 0.15)",
                            color: "#00e5ff",
                            fontWeight: 600,
                          }}
                        >
                          Selecionado
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Remember choice checkbox */}
          <div style={{ paddingTop: 4 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: "0.75rem",
                color: "#cbd5e1",
              }}
            >
              <input
                type="checkbox"
                checked={rememberDefault}
                onChange={(e) => setRememberDefault(e.target.checked)}
                style={{
                  accentColor: "#00e5ff",
                  cursor: "pointer",
                  width: 14,
                  height: 14,
                }}
              />
              <span>Usar este workspace como padrão (o Studio abrirá diretamente na próxima execução)</span>
            </label>
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div
          style={{
            padding: "16px 28px 20px",
            borderTop: "1px solid rgba(255, 255, 255, 0.07)",
            background: "rgba(10, 15, 29, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: "0.72rem", color: "rgba(148, 163, 184, 0.7)" }}>
            💡 Você pode alternar o workspace a qualquer momento no menu superior do Studio.
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isLaunching || isLoading || !workspacePath.trim()}
              onClick={handleLaunch}
              style={{
                padding: "8px 22px",
                fontSize: "0.85rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "linear-gradient(135deg, #00e5ff 0%, #00b4d8 100%)",
                color: "#020617",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                boxShadow: "0 0 20px rgba(0, 229, 255, 0.35)",
              }}
            >
              {isLaunching ? (
                <RefreshCw size={15} className="spin" />
              ) : (
                <ArrowRight size={15} />
              )}
              <span>{isLaunching ? "Carregando Workspace..." : "Abrir Workspace"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
