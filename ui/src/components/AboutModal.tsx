import React from "react";
import {
  X,
  Rocket,
  Cpu,
  Database,
  GitBranch,
  Terminal,
  ShieldCheck,
  Zap,
  BookOpen,
  Keyboard,
  ExternalLink,
} from "lucide-react";

interface AboutModalProps {
  onClose: () => void;
  gitBranch?: string;
  gitCommit?: string;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  onClose,
  gitBranch = "master",
  gitCommit = "",
}) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-container"
        style={{ maxWidth: 640, padding: 0, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Hero */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.18) 0%, rgba(59,130,246,0.12) 100%)",
            padding: "24px 28px",
            borderBottom: "1px solid var(--border-subtle)",
            position: "relative",
          }}
        >
          <button
            className="icon-btn"
            onClick={onClose}
            style={{ position: "absolute", top: 16, right: 16 }}
          >
            <X size={16} />
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 20px rgba(6,182,212,0.35)",
              }}
            >
              <Rocket size={26} color="#0f172a" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                  RocketDataForge
                </h2>
                <span className="badge badge-revision" style={{ background: "rgba(6,182,212,0.2)", borderColor: "var(--accent-cyan)" }}>
                  v1.2.0
                </span>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                Plataforma Unificada de Engenharia, Integração e Orquestração de Dados
              </p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: "24px 28px", maxHeight: "65vh", overflowY: "auto" }}>
          {/* Tech Stack Specs */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
              Motores e Arquitetura do Sistema
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <Zap size={18} color="var(--accent-cyan)" />
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Polars Streaming Engine</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Processamento vetorial de alta velocidade</div>
                </div>
              </div>

              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <Cpu size={18} color="#f59e0b" />
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>DuckDB Analytical Engine</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Joins relacionais e queries em memória</div>
                </div>
              </div>

              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <Terminal size={18} color="#10b981" />
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>FastAPI Control Plane</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>REST API assíncrona com Uvicorn</div>
                </div>
              </div>

              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <GitBranch size={18} color="#8b5cf6" />
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Git Version Control</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    Branch: <code>{gitBranch}</code> {gitCommit ? `(${gitCommit})` : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Atalhos de Teclado */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 10, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <Keyboard size={14} /> Atalhos de Teclado & Produtividade
            </div>
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "8px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.78rem" }}>
                <span>Salvar Job / Rascunho</span>
                <kbd style={{ background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>Ctrl + S</kbd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.78rem" }}>
                <span>Alternar Barra Lateral (Repositório / Paleta)</span>
                <kbd style={{ background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>Ctrl + B</kbd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.78rem" }}>
                <span>Renomear Componente no Canvas</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Duplo-clique no título</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.78rem" }}>
                <span>Abrir Janela Flutuante de Configuração</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Duplo-clique no nó</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "0.78rem" }}>
                <span>Ver Documentação Rápida do Componente</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Repousar mouse (Hover)</span>
              </div>
            </div>
          </div>

          {/* Rodapé institucional */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border-subtle)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <span>RocketDataForge &copy; 2026 Natura &amp; Co.</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent-cyan)" }}>
              <ShieldCheck size={14} /> Enterprise Ready
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
