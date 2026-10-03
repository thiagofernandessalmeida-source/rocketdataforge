import React, { useState, useMemo } from "react";
import {
  X, Plus, Trash2, Search, Copy, Check, Edit3,
  BookOpen, Tag, Database, Clock, TrendingUp, ChevronDown,
  Save, Play,
} from "lucide-react";
import { jobStore, QueryEntry, QueryDialect, ConnectionEntry } from "../../store/jobStore";
import { useJobStore } from "../../store/useJobStore";

interface QueryBankProps {
  onClose: () => void;
  /** If provided, shows an "Insert" button to put SQL into a node */
  onInsertQuery?: (sql: string) => void;
}

const DIALECTS: { id: QueryDialect; label: string; color: string }[] = [
  { id: "sql", label: "SQL Genérico", color: "#64748b" },
  { id: "postgresql", label: "PostgreSQL", color: "#336791" },
  { id: "oracle", label: "Oracle", color: "#c74634" },
  { id: "sqlserver", label: "SQL Server", color: "#0078d4" },
  { id: "mysql", label: "MySQL", color: "#4479a1" },
  { id: "redshift", label: "Redshift", color: "#8c4fff" },
  { id: "bigquery", label: "BigQuery", color: "#4285f4" },
  { id: "snowflake", label: "Snowflake", color: "#29b5e8" },
  { id: "databricks", label: "Databricks", color: "#ff3621" },
  { id: "python", label: "Python", color: "#3776ab" },
  { id: "jinja", label: "Jinja Template", color: "#b41717" },
];

function dialectLabel(d: QueryDialect) {
  return DIALECTS.find((x) => x.id === d)?.label ?? d;
}
function dialectColor(d: QueryDialect) {
  return DIALECTS.find((x) => x.id === d)?.color ?? "#64748b";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

// ─── Empty Template ──────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  description: "",
  sql: "",
  dialect: "sql" as QueryDialect,
  tags: [] as string[],
  connectionRef: "",
};

// ─── Main Component ───────────────────────────────────────────

export const QueryBankModal: React.FC<QueryBankProps> = ({ onClose, onInsertQuery }) => {
  const state = useJobStore();
  const [search, setSearch] = useState("");
  const [filterDialect, setFilterDialect] = useState<QueryDialect | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    state.queryBank[0]?.id ?? null
  );
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM });
  const [tagInput, setTagInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const selectedQuery = state.queryBank.find((q) => q.id === selectedId);

  // ── Filtered list ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...state.queryBank];
    if (filterDialect !== "all") list = list.filter((q) => q.dialect === filterDialect);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (q) =>
          q.name.toLowerCase().includes(s) ||
          q.description?.toLowerCase().includes(s) ||
          q.sql.toLowerCase().includes(s) ||
          q.tags.some((t) => t.toLowerCase().includes(s))
      );
    }
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [state.queryBank, search, filterDialect]);

  // ── Actions ───────────────────────────────────────────────
  const startNew = () => {
    setForm({ ...EMPTY_FORM });
    setTagInput("");
    setIsNew(true);
    setEditing(true);
    setSelectedId(null);
  };

  const startEdit = (q: QueryEntry) => {
    setForm({
      name: q.name,
      description: q.description ?? "",
      sql: q.sql,
      dialect: q.dialect,
      tags: [...q.tags],
      connectionRef: q.connectionRef ?? "",
    });
    setTagInput("");
    setIsNew(false);
    setEditing(true);
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.sql.trim()) return;
    if (isNew) {
      const entry = jobStore.saveQuery({
        name: form.name.trim(),
        description: form.description || undefined,
        sql: form.sql,
        dialect: form.dialect,
        tags: form.tags,
        connectionRef: form.connectionRef || undefined,
      });
      setSelectedId(entry.id);
    } else if (selectedId) {
      jobStore.updateQuery(selectedId, {
        name: form.name.trim(),
        description: form.description || undefined,
        sql: form.sql,
        dialect: form.dialect,
        tags: form.tags,
        connectionRef: form.connectionRef || undefined,
      });
    }
    setEditing(false);
    setIsNew(false);
  };

  const handleDelete = (id: string) => {
    jobStore.deleteQuery(id);
    if (selectedId === id) {
      setSelectedId(state.queryBank.find((q) => q.id !== id)?.id ?? null);
    }
    setEditing(false);
  };

  const handleCopy = (sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInsert = (q: QueryEntry) => {
    jobStore.incrementQueryUsage(q.id);
    onInsertQuery?.(q.sql);
    onClose();
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) {
      setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  };

  const cancelEdit = () => {
    setEditing(false);
    setIsNew(false);
    if (isNew) setSelectedId(state.queryBank[0]?.id ?? null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container qbank-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <BookOpen size={18} color="var(--accent-cyan)" />
            <span>Banco de Queries</span>
            <span className="qbank-count-badge">{state.queryBank.length}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-secondary" onClick={startNew}>
              <Plus size={13} /> Nova Query
            </button>
            <button className="modal-close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="qbank-body">
          {/* ── Left panel: list + filters ── */}
          <div className="qbank-list-panel">
            {/* Search */}
            <div className="palette-search-wrap" style={{ margin: "10px 12px 8px" }}>
              <Search size={13} className="palette-search-icon" />
              <input
                className="palette-search"
                placeholder="Buscar queries..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Dialect filter */}
            <div className="qbank-dialect-filter">
              <button
                className={`qbank-dialect-btn ${filterDialect === "all" ? "active" : ""}`}
                onClick={() => setFilterDialect("all")}
              >
                Todas
              </button>
              {DIALECTS.filter((d) => state.queryBank.some((q) => q.dialect === d.id)).map((d) => (
                <button
                  key={d.id}
                  className={`qbank-dialect-btn ${filterDialect === d.id ? "active" : ""}`}
                  style={{ "--dialect-color": d.color } as React.CSSProperties}
                  onClick={() => setFilterDialect(d.id)}
                >
                  <span className="qbank-dialect-dot" style={{ background: d.color }} />
                  {d.label}
                </button>
              ))}
            </div>

            {/* Query list */}
            <div className="qbank-list">
              {filtered.length === 0 && (
                <div className="conn-list-empty" style={{ marginTop: 24 }}>
                  <BookOpen size={28} opacity={0.15} />
                  <span>
                    {state.queryBank.length === 0
                      ? "Nenhuma query salva ainda"
                      : "Nenhuma query encontrada"}
                  </span>
                  {state.queryBank.length === 0 && (
                    <button className="btn btn-secondary" onClick={startNew}>
                      <Plus size={12} /> Criar primeira query
                    </button>
                  )}
                </div>
              )}
              {filtered.map((q) => (
                <div
                  key={q.id}
                  className={`qbank-list-item ${selectedId === q.id && !isNew ? "active" : ""}`}
                  onClick={() => {
                    setSelectedId(q.id);
                    setEditing(false);
                    setIsNew(false);
                  }}
                >
                  <div className="qbank-item-top">
                    <span
                      className="qbank-dialect-pill"
                      style={{ background: dialectColor(q.dialect) + "22", color: dialectColor(q.dialect), borderColor: dialectColor(q.dialect) + "44" }}
                    >
                      {dialectLabel(q.dialect)}
                    </span>
                    {q.usageCount > 0 && (
                      <span className="qbank-usage-badge" title={`Usado ${q.usageCount}x`}>
                        <TrendingUp size={10} /> {q.usageCount}x
                      </span>
                    )}
                  </div>
                  <div className="qbank-item-name">{q.name}</div>
                  {q.description && (
                    <div className="qbank-item-desc">{q.description}</div>
                  )}
                  <div className="qbank-item-meta">
                    <Clock size={10} /> {relativeTime(q.updatedAt)}
                    {q.tags.length > 0 && (
                      <span className="qbank-item-tags">
                        <Tag size={10} /> {q.tags.slice(0, 2).join(", ")}{q.tags.length > 2 ? `+${q.tags.length - 2}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right panel: detail / edit ── */}
          <div className="qbank-detail">
            {editing ? (
              /* ── Edit / New form ── */
              <div className="qbank-form">
                <div className="qbank-form-header">
                  <span className="qbank-form-title">
                    {isNew ? "Nova Query" : "Editar Query"}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-success" onClick={handleSave} disabled={!form.name.trim() || !form.sql.trim()}>
                      <Save size={13} /> Salvar
                    </button>
                    <button className="btn btn-secondary" onClick={cancelEdit}>Cancelar</button>
                  </div>
                </div>

                <div className="qbank-form-body">
                  <div className="form-group">
                    <label className="form-label">Nome da Query *</label>
                    <input
                      className="form-input"
                      value={form.name}
                      placeholder="ex: Vendas por Região - Mensal"
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Descrição</label>
                    <input
                      className="form-input"
                      value={form.description}
                      placeholder="O que essa query faz..."
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />
                  </div>

                  <div className="conn-form-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Dialeto SQL</label>
                      <select
                        className="form-select"
                        value={form.dialect}
                        onChange={(e) => setForm((f) => ({ ...f, dialect: e.target.value as QueryDialect }))}
                      >
                        {DIALECTS.map((d) => (
                          <option key={d.id} value={d.id}>{d.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Conexão (referência)</label>
                      <select
                        className="form-select"
                        value={form.connectionRef}
                        onChange={(e) => setForm((f) => ({ ...f, connectionRef: e.target.value }))}
                      >
                        <option value="">-- Nenhuma --</option>
                        {state.connections.map((c: ConnectionEntry) => (
                          <option key={c.id} value={c.name.toLowerCase().replace(/\s+/g, "_")}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">SQL / Código *</label>
                    <textarea
                      className="form-textarea qbank-sql-editor"
                      value={form.sql}
                      placeholder={"SELECT *\nFROM tabela\nWHERE condicao = 1\nORDER BY data DESC"}
                      onChange={(e) => setForm((f) => ({ ...f, sql: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Tags</label>
                    <div className="qbank-tag-input-row">
                      <input
                        className="form-input"
                        value={tagInput}
                        placeholder="Adicionar tag..."
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                      />
                      <button className="btn btn-secondary" onClick={addTag} style={{ flexShrink: 0 }}>
                        <Plus size={13} />
                      </button>
                    </div>
                    <div className="qbank-tags">
                      {form.tags.map((t) => (
                        <span key={t} className="qbank-tag">
                          #{t}
                          <button onClick={() => removeTag(t)} className="qbank-tag-rm">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedQuery ? (
              /* ── Query detail view ── */
              <div className="qbank-detail-view">
                <div className="qbank-detail-header">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        className="qbank-dialect-pill"
                        style={{ background: dialectColor(selectedQuery.dialect) + "22", color: dialectColor(selectedQuery.dialect), borderColor: dialectColor(selectedQuery.dialect) + "44" }}
                      >
                        {dialectLabel(selectedQuery.dialect)}
                      </span>
                      {selectedQuery.connectionRef && (
                        <span className="qbank-conn-ref">
                          <Database size={11} /> {selectedQuery.connectionRef}
                        </span>
                      )}
                    </div>
                    <h3 className="qbank-detail-name">{selectedQuery.name}</h3>
                    {selectedQuery.description && (
                      <p className="qbank-detail-desc">{selectedQuery.description}</p>
                    )}
                  </div>
                  <div className="qbank-detail-actions">
                    {onInsertQuery && (
                      <button
                        className="btn btn-primary"
                        onClick={() => handleInsert(selectedQuery)}
                        title="Inserir SQL no campo ativo"
                      >
                        <Play size={13} /> Usar no Node
                      </button>
                    )}
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleCopy(selectedQuery.sql)}
                      title="Copiar SQL"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copiado!" : "Copiar"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => startEdit(selectedQuery)}
                    >
                      <Edit3 size={13} /> Editar
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => handleDelete(selectedQuery.id)}
                      title="Excluir query"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Tags */}
                {selectedQuery.tags.length > 0 && (
                  <div className="qbank-tags" style={{ padding: "0 20px 0" }}>
                    {selectedQuery.tags.map((t) => (
                      <span key={t} className="qbank-tag readonly">#{t}</span>
                    ))}
                  </div>
                )}

                {/* Meta */}
                <div className="qbank-detail-meta">
                  <span><Clock size={11} /> Criado: {new Date(selectedQuery.createdAt).toLocaleString("pt-BR")}</span>
                  <span><Clock size={11} /> Editado: {relativeTime(selectedQuery.updatedAt)}</span>
                  {selectedQuery.usageCount > 0 && (
                    <span><TrendingUp size={11} /> Usado {selectedQuery.usageCount}x</span>
                  )}
                </div>

                {/* SQL code block */}
                <div className="qbank-sql-preview">
                  <div className="qbank-sql-preview-header">
                    <span>SQL</span>
                    <button className="icon-btn" onClick={() => handleCopy(selectedQuery.sql)} title="Copiar">
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </div>
                  <pre className="qbank-sql-code">{selectedQuery.sql}</pre>
                </div>
              </div>
            ) : (
              <div className="conn-detail-placeholder">
                <BookOpen size={48} opacity={0.1} />
                <p>Selecione uma query ou crie uma nova</p>
                <p className="conn-detail-hint">Salve queries reutilizáveis para usar em qualquer job</p>
                <button className="btn btn-secondary" onClick={startNew}>
                  <Plus size={13} /> Nova Query
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
