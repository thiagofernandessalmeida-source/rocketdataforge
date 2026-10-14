import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Database,
  Layers,
  Key,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  Sparkles,
  Zap,
  Variable,
  Check,
} from "lucide-react";
import { ContextVariable } from "../../store/jobStore";

export interface AutocompleteColumn {
  name: string;
  type?: string;
  nullable?: boolean;
  description?: string;
}

export interface AutocompleteSource {
  id: string;
  label: string;
  flowNames?: string[];
  isUpstream?: boolean;
  columns: AutocompleteColumn[];
}

export interface SqlAutocompleteTextareaProps {
  value: string;
  onChange: (val: string) => void;
  sources?: AutocompleteSource[];
  contextVariables?: ContextVariable[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  rows?: number;
}

interface SuggestionItem {
  id: string;
  kind: "column" | "node" | "context_var";
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  insertText: string;
  replaceStart: number;
  replaceEnd: number;
  postInsertShowNext?: boolean;
}

function getColumnIcon(type?: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("int") || t.includes("float") || t.includes("double") || t.includes("num") || t.includes("dec")) {
    return <Hash size={12} color="#f59e0b" />;
  }
  if (t.includes("date") || t.includes("time")) {
    return <Calendar size={12} color="#10b981" />;
  }
  if (t.includes("bool")) {
    return <ToggleLeft size={12} color="#8b5cf6" />;
  }
  if (t.includes("uuid") || t.includes("id") || t.includes("key")) {
    return <Key size={12} color="#06b6d4" />;
  }
  return <Type size={12} color="#38bdf8" />;
}

// ─── Mirror calculation for Caret Position ──────────────────────────────
function getCaretCoordinates(element: HTMLTextAreaElement, position: number) {
  const div = document.createElement("div");
  const styles = window.getComputedStyle(element);

  const propertiesToCopy = [
    "direction",
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderStyle",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "MozTabSize",
  ];

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.top = "0";
  div.style.left = "0";

  propertiesToCopy.forEach((prop) => {
    (div.style as any)[prop] = (styles as any)[prop];
  });

  const text = element.value.substring(0, position);
  div.textContent = text;

  const span = document.createElement("span");
  span.textContent = element.value.substring(position) || ".";
  div.appendChild(span);

  document.body.appendChild(div);

  const coordinates = {
    top: span.offsetTop - element.scrollTop,
    left: span.offsetLeft - element.scrollLeft,
    height: parseInt(styles.lineHeight, 10) || 18,
  };

  document.body.removeChild(div);
  return coordinates;
}

export const SqlAutocompleteTextarea: React.FC<SqlAutocompleteTextareaProps> = ({
  value,
  onChange,
  sources = [],
  contextVariables = [],
  placeholder,
  className,
  style,
  rows = 4,
}) => {
  const [local, setLocal] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevValueRef = useRef(value);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      setLocal(value);
      prevValueRef.current = value;
    }
  }, [value]);

  const commitValue = useCallback(
    (val: string) => {
      setLocal(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(val);
        prevValueRef.current = val;
      }, 250);
    },
    [onChange]
  );

  /**
   * Avalia o texto ao redor do cursor e monta as sugestões de autocomplete
   */
  const computeSuggestions = useCallback(
    (val: string, cursorPos: number, forced: boolean = false): SuggestionItem[] => {
      if (!val && !forced) return [];
      const textBefore = val.slice(0, cursorPos);

      // ── Cenário 1: Notação Ponto (ex: `postgres_source_1.` ou `row6.` ou `{{postgres_source_1.`)
      // Captura: grupo 1 = nome do nó/fluxo; grupo 2 = prefixo da coluna
      const dotRegex = /(?:(\{\{?))?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]*)$/;
      const dotMatch = textBefore.match(dotRegex);

      if (dotMatch) {
        const hasBraces = Boolean(dotMatch[1]);
        const nodeRef = dotMatch[2].toLowerCase();
        const colPrefix = (dotMatch[3] || "").toLowerCase();
        const matchStart = cursorPos - dotMatch[3].length;

        // Se for "context."
        if (nodeRef === "context") {
          const matchedVars = contextVariables.filter((cv) =>
            cv.key.toLowerCase().includes(colPrefix)
          );
          return matchedVars.map((cv) => ({
            id: `ctx-${cv.key}`,
            kind: "context_var",
            title: cv.key,
            subtitle: cv.description || "Variável de Contexto",
            badge: cv.type || "string",
            badgeColor: "#a855f7",
            insertText: hasBraces ? `${cv.key}}}` : cv.key,
            replaceStart: matchStart,
            replaceEnd: cursorPos,
          }));
        }

        // Busca o nó ou fluxo correspondente
        const targetSource = sources.find((s) => {
          if (s.id.toLowerCase() === nodeRef) return true;
          if (s.label.toLowerCase().replace(/\s+/g, "_") === nodeRef) return true;
          if (s.flowNames?.some((f) => f.toLowerCase() === nodeRef)) return true;
          return false;
        });

        if (targetSource) {
          const filteredCols = targetSource.columns.filter((c) =>
            c.name.toLowerCase().includes(colPrefix)
          );
          return filteredCols.map((c) => ({
            id: `col-${targetSource.id}-${c.name}`,
            kind: "column",
            title: c.name,
            subtitle: `Origem: ${targetSource.label || targetSource.id}`,
            badge: c.type || "String",
            badgeColor: "#06b6d4",
            insertText: hasBraces ? `${c.name}}}` : c.name,
            replaceStart: matchStart,
            replaceEnd: cursorPos,
          }));
        }
      }

      // ── Cenário 2: Início de interpolação `{{` ou solicitação forçada (Ctrl+Space)
      const braceRegex = /\{\{([a-zA-Z0-9_]*)$/;
      const braceMatch = textBefore.match(braceRegex);

      if (braceMatch || forced) {
        const tokenQuery = (braceMatch ? braceMatch[1] : "").toLowerCase();
        const matchStart = braceMatch ? cursorPos - braceMatch[1].length : cursorPos;
        const res: SuggestionItem[] = [];

        // Sugere nós iteradores disponíveis
        sources.forEach((s) => {
          const matchId = s.id.toLowerCase().includes(tokenQuery);
          const matchLabel = s.label.toLowerCase().includes(tokenQuery);
          const matchFlow = s.flowNames?.some((f) => f.toLowerCase().includes(tokenQuery));

          if (matchId || matchLabel || matchFlow || forced) {
            res.push({
              id: `node-${s.id}`,
              kind: "node",
              title: s.id,
              subtitle: `${s.label} (${s.columns.length} colunas)`,
              badge: s.isUpstream ? "Upstream" : "Componente",
              badgeColor: s.isUpstream ? "#10b981" : "#64748b",
              insertText: braceMatch ? `${s.id}.` : `{{${s.id}.`,
              replaceStart: matchStart,
              replaceEnd: cursorPos,
              postInsertShowNext: true, // Mantém aberto para escolher a coluna imediatamente!
            });

            // Adiciona aliases de fluxo caso existam (ex: row1, row6)
            s.flowNames?.forEach((flow) => {
              if (flow.toLowerCase() !== s.id.toLowerCase()) {
                res.push({
                  id: `flow-${flow}-${s.id}`,
                  kind: "node",
                  title: flow,
                  subtitle: `Fluxo de ${s.label || s.id} (${s.columns.length} colunas)`,
                  badge: "Fluxo",
                  badgeColor: "#8b5cf6",
                  insertText: braceMatch ? `${flow}.` : `{{${flow}.`,
                  replaceStart: matchStart,
                  replaceEnd: cursorPos,
                  postInsertShowNext: true,
                });
              }
            });
          }
        });

        // Contexto
        if (contextVariables.length > 0) {
          res.push({
            id: "node-context",
            kind: "node",
            title: "context",
            subtitle: `Variáveis de contexto (${contextVariables.length})`,
            badge: "Context",
            badgeColor: "#a855f7",
            insertText: braceMatch ? "context." : "{{context.",
            replaceStart: matchStart,
            replaceEnd: cursorPos,
            postInsertShowNext: true,
          });
        }

        return res;
      }

      return [];
    },
    [sources, contextVariables]
  );

  const checkAndOpenSuggestions = useCallback(
    (val: string, cursorPos: number, forced: boolean = false) => {
      const items = computeSuggestions(val, cursorPos, forced);
      if (items.length > 0) {
        setSuggestions(items);
        setSelectedIndex(0);

        if (textareaRef.current) {
          const coords = getCaretCoordinates(textareaRef.current, cursorPos);
          const rect = textareaRef.current.getBoundingClientRect();
          const top = Math.min(coords.top + coords.height + 4, rect.height - 40);
          const left = Math.min(Math.max(coords.left, 8), rect.width - 240);
          setPopupPos({ top, left });
        }
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    },
    [computeSuggestions]
  );

  const handleApplySuggestion = useCallback(
    (item: SuggestionItem) => {
      if (!textareaRef.current) return;
      const textarea = textareaRef.current;
      const text = textarea.value;

      const before = text.slice(0, item.replaceStart);
      const after = text.slice(item.replaceEnd);
      const nextValue = before + item.insertText + after;
      const nextCursorPos = item.replaceStart + item.insertText.length;

      commitValue(nextValue);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(nextCursorPos, nextCursorPos);
        if (item.postInsertShowNext) {
          // Reavalia para abrir imediatamente as colunas do nó recém-inserido
          checkAndOpenSuggestions(nextValue, nextCursorPos, true);
        } else {
          setIsOpen(false);
        }
      }, 10);
    },
    [commitValue, checkAndOpenSuggestions]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursorPos = e.target.selectionEnd;
    commitValue(val);
    checkAndOpenSuggestions(val, cursorPos, false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ── Disparo com Ctrl + Space ──
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      const cursorPos = textareaRef.current?.selectionEnd || 0;
      checkAndOpenSuggestions(local, cursorPos, true);
      return;
    }

    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const chosen = suggestions[selectedIndex];
      if (chosen) {
        handleApplySuggestion(chosen);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  // Fecha popup ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as HTMLElement) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as HTMLElement)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="rdf-sql-autocomplete-container" style={{ position: "relative", width: "100%" }}>
      <textarea
        ref={textareaRef}
        className={className ?? "form-textarea"}
        style={{
          width: "100%",
          fontFamily: "var(--font-mono)",
          fontSize: "0.78rem",
          lineHeight: "1.45",
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--bg-input, #0f1120)",
          color: "var(--text-primary, #eef2ff)",
          border: "1px solid var(--border-medium, #252c48)",
          resize: "vertical",
          ...style,
        }}
        rows={rows}
        value={local}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (isOpen) setIsOpen(false);
        }}
      />

      {/* Dica de atalho no rodapé do textarea */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.66rem",
          color: "var(--text-muted)",
          marginTop: 3,
          padding: "0 2px",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Sparkles size={10} color="var(--accent-cyan)" />
          <span>Auto-completar Inteligente:</span>
          <kbd
            style={{
              background: "rgba(255,255,255,0.06)",
              padding: "1px 4px",
              borderRadius: 3,
              border: "1px solid var(--border-subtle)",
              fontFamily: "var(--font-mono)",
              color: "var(--accent-cyan)",
            }}
          >
            Ctrl + Space
          </kbd>
          <span>ou digite</span>
          <code style={{ color: "#38bdf8" }}>row.</code>
          <span>/</span>
          <code style={{ color: "#38bdf8" }}>{"{{"}</code>
        </span>

        {sources.length > 0 && (
          <span style={{ color: "var(--text-secondary)" }}>
            {sources.length} componente(s) iterador(es)
          </span>
        )}
      </div>

      {/* ─── Menu Flutuante de Autocomplete (Smart Studio) ─────────── */}
      {isOpen && suggestions.length > 0 && (
        <div
          ref={popupRef}
          className="rdf-autocomplete-dropdown"
          style={{
            position: "absolute",
            top: popupPos.top,
            left: popupPos.left,
            zIndex: 9999,
            minWidth: 260,
            maxWidth: 360,
            maxHeight: 220,
            overflowY: "auto",
            background: "rgba(15, 17, 32, 0.98)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--accent-cyan)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.7), 0 0 12px rgba(0, 229, 255, 0.2)",
            borderRadius: 6,
            padding: "4px 0",
          }}
        >
          <div
            style={{
              padding: "4px 10px 6px",
              fontSize: "0.64rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--accent-cyan)",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>
              {suggestions[0]?.kind === "column"
                ? "Colunas Disponíveis (Iteração)"
                : "Componentes / Fluxos Iteradores"}
            </span>
            <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
              {suggestions.length} opções
            </span>
          </div>

          <div style={{ padding: "2px 0" }}>
            {suggestions.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "5px 10px",
                    cursor: "pointer",
                    background: isSelected ? "rgba(0, 229, 255, 0.16)" : "transparent",
                    borderLeft: isSelected ? "3px solid var(--accent-cyan)" : "3px solid transparent",
                    transition: "background 0.1s ease",
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleApplySuggestion(item);
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
                    {item.kind === "column" ? (
                      getColumnIcon(item.badge)
                    ) : item.kind === "context_var" ? (
                      <Variable size={12} color="#a855f7" />
                    ) : (
                      <Database size={12} color="#10b981" />
                    )}

                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.76rem",
                          fontWeight: isSelected ? 600 : 500,
                          color: isSelected ? "var(--accent-cyan)" : "var(--text-primary)",
                          fontFamily: "var(--font-mono)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div
                          style={{
                            fontSize: "0.64rem",
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  {item.badge && (
                    <span
                      style={{
                        fontSize: "0.62rem",
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "rgba(255, 255, 255, 0.05)",
                        border: `1px solid ${item.badgeColor || "var(--border-subtle)"}`,
                        color: item.badgeColor || "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        marginLeft: 8,
                        flexShrink: 0,
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div
            style={{
              padding: "4px 10px",
              borderTop: "1px solid var(--border-subtle)",
              fontSize: "0.62rem",
              color: "var(--text-muted)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>↑↓ Navegar • ↵ Selecionar</span>
            <span>Esc Fechar</span>
          </div>
        </div>
      )}
    </div>
  );
};
