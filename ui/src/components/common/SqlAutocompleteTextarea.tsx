import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Database,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  Key,
  Sparkles,
  Variable,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  AlignLeft,
  Trash2,
  Code2,
} from "lucide-react";
import { ContextVariable } from "../../store/jobStore";
import { tokenizeSql, lintSql, formatSql, SqlToken, SqlLintIssue } from "./sqlParser";

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
  height?: number | string;
  title?: string;
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
  rows = 10,
  height,
  title = "Editor SQL",
}) => {
  const [local, setLocal] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cursorPosInfo, setCursorPosInfo] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevValueRef = useRef(value);
  const popupRef = useRef<HTMLDivElement>(null);

  // Altura padrão ampliada: 240px (conforme solicitado pelo usuário para facilitar a visualização)
  const baseHeight = height || style?.minHeight || (rows ? rows * 22 : 240);

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

  // ─── Tokenização e Linter de Sintaxe em Tempo Real ────────────────
  const tokens = useMemo(() => tokenizeSql(local), [local]);
  const lintResult = useMemo(() => lintSql(local), [local]);

  const lines = useMemo(() => {
    return local.split("\n");
  }, [local]);

  // Sincroniza scroll entre textarea, camada de destaque e régua de números
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const top = e.currentTarget.scrollTop;
    const left = e.currentTarget.scrollLeft;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = top;
      highlightRef.current.scrollLeft = left;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = top;
    }
  };

  const updateCursorPosition = () => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart || 0;
    const textBefore = local.substring(0, pos);
    const lineList = textBefore.split("\n");
    setCursorPosInfo({
      line: lineList.length,
      col: lineList[lineList.length - 1].length + 1,
    });
  };

  /**
   * Avalia o texto ao redor do cursor e monta as sugestões de autocomplete
   */
  const computeSuggestions = useCallback(
    (val: string, cursorPos: number, forced: boolean = false): SuggestionItem[] => {
      if (!val && !forced) return [];
      const textBefore = val.slice(0, cursorPos);

      // Cenário 1: Notação Ponto (ex: `postgres_source_1.` ou `row6.`)
      const dotRegex = /(?:(\{\{?))?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]*)$/;
      const dotMatch = textBefore.match(dotRegex);

      if (dotMatch) {
        const hasBraces = Boolean(dotMatch[1]);
        const nodeRef = dotMatch[2].toLowerCase();
        const colPrefix = (dotMatch[3] || "").toLowerCase();
        const matchStart = cursorPos - dotMatch[3].length;

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

      // Cenário 2: Início de interpolação `{{` ou forçado (Ctrl+Space)
      const braceRegex = /\{\{([a-zA-Z0-9_]*)$/;
      const braceMatch = textBefore.match(braceRegex);

      if (braceMatch || forced) {
        const tokenQuery = (braceMatch ? braceMatch[1] : "").toLowerCase();
        const matchStart = braceMatch ? cursorPos - braceMatch[1].length : cursorPos;
        const res: SuggestionItem[] = [];

        sources.forEach((s) => {
          const matchId = s.id.toLowerCase().includes(tokenQuery);
          const matchLabel = s.label.toLowerCase().includes(tokenQuery);
          const matchFlow = s.flowNames?.some((f) => f.toLowerCase() === tokenQuery);

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
              postInsertShowNext: true,
            });

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
    updateCursorPosition();
  };

  /**
   * Manipula teclas:
   * - Tecla TAB: indenta o código (2 espaços) ou navega sugestões sem sair do componente!
   * - Tecla SHIFT+TAB: desindenta o código
   * - Ctrl+Space: abre autocomplete
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ── 1. Indentação com a Tecla TAB (Corrige a perda de foco) ────────
    if (e.key === "Tab") {
      // Se popup de autocomplete estiver aberto, seleciona o item
      if (isOpen && suggestions.length > 0) {
        e.preventDefault();
        const chosen = suggestions[selectedIndex];
        if (chosen) handleApplySuggestion(chosen);
        return;
      }

      // Previne sair do campo de texto e ir para outro componente visual da janela!
      e.preventDefault();
      e.stopPropagation();

      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      if (!e.shiftKey) {
        // Tab normal: Indentar
        if (start === end) {
          // Cursor simples sem seleção: insere 2 espaços na posição
          const newVal = val.slice(0, start) + "  " + val.slice(end);
          commitValue(newVal);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            updateCursorPosition();
          }, 0);
        } else {
          // Seleção de múltiplas linhas
          const lineStart = val.lastIndexOf("\n", start - 1) + 1;
          const lineEnd = val.indexOf("\n", end);
          const effectiveEnd = lineEnd === -1 ? val.length : lineEnd;
          const selectedBlock = val.slice(lineStart, effectiveEnd);

          const blockLines = selectedBlock.split("\n");
          const indentedLines = blockLines.map((line) => "  " + line);
          const indentedBlock = indentedLines.join("\n");

          const newVal = val.slice(0, lineStart) + indentedBlock + val.slice(effectiveEnd);
          commitValue(newVal);

          setTimeout(() => {
            textarea.selectionStart = start + 2;
            textarea.selectionEnd = end + blockLines.length * 2;
            updateCursorPosition();
          }, 0);
        }
      } else {
        // Shift + Tab: Desindentar (Unindent)
        const lineStart = val.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = val.indexOf("\n", end);
        const effectiveEnd = lineEnd === -1 ? val.length : lineEnd;
        const selectedBlock = val.slice(lineStart, effectiveEnd);

        const blockLines = selectedBlock.split("\n");
        let removedTotal = 0;
        let firstLineRemoved = 0;

        const unindentedLines = blockLines.map((line, idx) => {
          let count = 0;
          if (line.startsWith("  ")) count = 2;
          else if (line.startsWith(" ") || line.startsWith("\t")) count = 1;

          if (idx === 0) firstLineRemoved = count;
          removedTotal += count;
          return line.slice(count);
        });

        const unindentedBlock = unindentedLines.join("\n");
        const newVal = val.slice(0, lineStart) + unindentedBlock + val.slice(effectiveEnd);
        commitValue(newVal);

        setTimeout(() => {
          textarea.selectionStart = Math.max(lineStart, start - firstLineRemoved);
          textarea.selectionEnd = Math.max(lineStart, end - removedTotal);
          updateCursorPosition();
        }, 0);
      }
      return;
    }

    // ── 2. Disparo de Autocomplete com Ctrl + Space ──
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      const cursorPos = textareaRef.current?.selectionEnd || 0;
      checkAndOpenSuggestions(local, cursorPos, true);
      return;
    }

    // ── 3. Navegação do Menu Flutuante ──
    if (isOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const chosen = suggestions[selectedIndex];
        if (chosen) handleApplySuggestion(chosen);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    }
  };

  // Formatar SQL (Beautifier)
  const handleFormatSql = () => {
    const formatted = formatSql(local);
    commitValue(formatted);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 10);
  };

  // Copiar SQL
  const handleCopySql = () => {
    navigator.clipboard.writeText(local);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Limpar SQL
  const handleClearSql = () => {
    commitValue("");
    setTimeout(() => textareaRef.current?.focus(), 10);
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

  // Renderizador de tokens com realce de sintaxe
  const renderTokens = () => {
    return tokens.map((token: SqlToken, idx: number) => {
      let color = "#e2e8f0";
      let fontWeight: string | number = 400;
      let fontStyle = "normal";

      switch (token.type) {
        case "keyword":
          color = "#818cf8"; // Índigo neon
          fontWeight = 600;
          break;
        case "function":
          color = "#38bdf8"; // Azul celeste
          fontWeight = 500;
          break;
        case "string":
          color = "#34d399"; // Verde esmeralda
          break;
        case "number":
          color = "#fbbf24"; // Âmbar
          break;
        case "comment":
          color = "#64748b"; // Cinza ardósia
          fontStyle = "italic";
          break;
        case "operator":
          color = "#f43f5e"; // Rosa vibrante
          fontWeight = 500;
          break;
        case "variable":
          color = "#c084fc"; // Púrpura neon
          fontWeight = 500;
          break;
        case "punctuation":
          color = "#94a3b8";
          break;
        default:
          color = "#cbd5e1";
      }

      return (
        <span key={idx} style={{ color, fontWeight, fontStyle }}>
          {token.text}
        </span>
      );
    });
  };

  const editorContainer = (isModal: boolean) => (
    <div
      className={`rdf-sql-editor-container ${className || ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#080b14",
        border: "1px solid rgba(99, 102, 241, 0.28)",
        borderRadius: 8,
        overflow: "hidden",
        width: "100%",
        boxShadow: isModal ? "0 25px 60px rgba(0,0,0,0.8)" : "0 4px 14px rgba(0,0,0,0.25)",
        ...(isModal ? { height: "100%" } : { minHeight: baseHeight }),
        ...(!isModal ? style : {}),
      }}
    >
      {/* ─── Barra Superior do Editor: Título, Linter Badge e Ações ─── */}
      <div
        className="sql-editor-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: "linear-gradient(180deg, #13192b 0%, #0c101d 100%)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: "0.74rem",
              fontWeight: 600,
              color: "#a5b4fc",
            }}
          >
            <Code2 size={13} color="#818cf8" />
            <span>{title}</span>
          </div>

          {/* Badge de Interpretação / Linter */}
          {local.trim().length > 0 && (
            <div style={{ display: "flex", alignItems: "center" }}>
              {lintResult.isValid ? (
                <span
                  title="Sintaxe SQL analisada sem erros"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: "0.68rem",
                    padding: "1px 7px",
                    borderRadius: 10,
                    background: "rgba(16, 185, 129, 0.15)",
                    border: "1px solid rgba(16, 185, 129, 0.35)",
                    color: "#34d399",
                    fontWeight: 500,
                  }}
                >
                  <CheckCircle2 size={11} />
                  <span>Sintaxe Válida</span>
                </span>
              ) : (
                <span
                  title={lintResult.issues[0]?.message}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: "0.68rem",
                    padding: "1px 7px",
                    borderRadius: 10,
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    color: "#fca5a5",
                    fontWeight: 500,
                  }}
                >
                  <AlertTriangle size={11} color="#ef4444" />
                  <span>
                    Erro: {lintResult.issues[0]?.message.length > 32
                      ? `${lintResult.issues[0]?.message.slice(0, 32)}...`
                      : lintResult.issues[0]?.message}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Botões de Ação */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={handleFormatSql}
            className="btn-format-sql"
            title="Formatar e indentar código SQL automaticamente"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.68rem",
              padding: "3px 8px",
              background: "rgba(99, 102, 241, 0.12)",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              color: "#c7d2fe",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            <AlignLeft size={11} />
            <span>Formatar</span>
          </button>

          <button
            type="button"
            onClick={handleCopySql}
            className="btn-copy-sql"
            title="Copiar código SQL"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.68rem",
              padding: "3px 8px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#cbd5e1",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            {copied ? <Check size={11} color="#34d399" /> : <Copy size={11} />}
            <span>{copied ? "Copiado!" : "Copiar"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsMaximized(!isMaximized)}
            className="btn-maximize-sql"
            title={isMaximized ? "Minimizar editor" : "Maximizar editor (visualização expandida)"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.68rem",
              padding: "3px 8px",
              background: isMaximized ? "rgba(99, 102, 241, 0.25)" : "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#cbd5e1",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            <span>{isMaximized ? "Minimizar" : "Expandir"}</span>
          </button>

          {local.length > 0 && (
            <button
              type="button"
              onClick={handleClearSql}
              className="btn-clear-sql"
              title="Limpar código"
              style={{
                display: "flex",
                alignItems: "center",
                padding: "3px 6px",
                background: "transparent",
                border: "none",
                color: "#64748b",
                borderRadius: 5,
                cursor: "pointer",
              }}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ─── Área Central de Edição: Régua de Linhas + Camada de Highlight + Textarea ─── */}
      <div
        style={{
          display: "flex",
          position: "relative",
          flex: 1,
          overflow: "hidden",
          minHeight: isModal ? 480 : Math.max(160, (Number(baseHeight) || 240) - 75),
        }}
      >
        {/* Régua de Números de Linha */}
        <div
          ref={gutterRef}
          style={{
            width: 38,
            flexShrink: 0,
            background: "rgba(0, 0, 0, 0.35)",
            borderRight: "1px solid rgba(255, 255, 255, 0.06)",
            padding: "10px 6px 10px 0",
            textAlign: "right",
            fontFamily: "Consolas, Menlo, Monaco, monospace",
            fontSize: "0.78rem",
            lineHeight: "1.5",
            color: "#475569",
            userSelect: "none",
            overflow: "hidden",
          }}
        >
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Canvas de Código com Destaque de Sintaxe e Textarea Transparente */}
        <div style={{ position: "relative", flex: 1, height: "100%", overflow: "hidden" }}>
          {/* Camada Colorida (Visual de Sintaxe) */}
          <div
            ref={highlightRef}
            className="sql-highlight-layer"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              padding: "10px 12px",
              margin: 0,
              fontFamily: "Consolas, Menlo, Monaco, monospace",
              fontSize: "0.78rem",
              lineHeight: "1.5",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              pointerEvents: "none",
              overflow: "hidden",
              color: "#cbd5e1",
            }}
          >
            {renderTokens()}
          </div>

          {/* Textarea Nativo (Captura de Eventos, Seleção e Tecla Tab) */}
          <textarea
            ref={textareaRef}
            className="sql-code-editor-textarea"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              padding: "10px 12px",
              margin: 0,
              fontFamily: "Consolas, Menlo, Monaco, monospace",
              fontSize: "0.78rem",
              lineHeight: "1.5",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "transparent",
              color: "transparent",
              caretColor: "#38bdf8",
              border: "none",
              outline: "none",
              resize: isModal ? "none" : "vertical",
              overflow: "auto",
            }}
            value={local}
            placeholder={placeholder}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            onSelect={updateCursorPosition}
            onClick={() => {
              updateCursorPosition();
              if (isOpen) setIsOpen(false);
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />

          {/* Menu Flutuante de Autocomplete (Smart Studio) */}
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
                border: "1px solid #38bdf8",
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
                  color: "#38bdf8",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
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
                <span style={{ fontSize: "0.6rem", color: "#64748b" }}>
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
                        borderLeft: isSelected ? "3px solid #38bdf8" : "3px solid transparent",
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
                              color: isSelected ? "#38bdf8" : "#f1f5f9",
                              fontFamily: "Consolas, Menlo, Monaco, monospace",
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
                                color: "#64748b",
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
                            border: `1px solid ${item.badgeColor || "rgba(255, 255, 255, 0.1)"}`,
                            color: item.badgeColor || "#94a3b8",
                            fontFamily: "Consolas, Menlo, Monaco, monospace",
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
                  borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                  fontSize: "0.62rem",
                  color: "#64748b",
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
      </div>

      {/* ─── Barra de Status do Rodapé: Linter Feedback & Dicas de Teclado ─── */}
      <div
        className="sql-editor-statusbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 12px",
          background: "#05070e",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          fontSize: "0.68rem",
          color: "#64748b",
          userSelect: "none",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {/* Lado esquerdo: Linter status & issue */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {lintResult.issues.length > 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: lintResult.issues[0].severity === "error" ? "#fca5a5" : "#fcd34d",
              }}
            >
              {lintResult.issues[0].severity === "error" ? (
                <AlertTriangle size={12} color="#ef4444" />
              ) : (
                <AlertCircle size={12} color="#f59e0b" />
              )}
              <span>{lintResult.issues[0].message}</span>
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#34d399" }}>
              <CheckCircle2 size={12} />
              <span>Sintaxe SQL Válida</span>
            </span>
          )}
        </div>

        {/* Lado direito: cursor info e atalhos */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span>Tab:</span>
            <span style={{ color: "#a5b4fc" }}>Indentar (2 espaços)</span>
          </span>

          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span>Ctrl+Space:</span>
            <span style={{ color: "#38bdf8" }}>Autocomplete</span>
          </span>

          <span style={{ fontFamily: "Consolas, Menlo, Monaco, monospace", color: "#94a3b8" }}>
            Ln {cursorPosInfo.line}, Col {cursorPosInfo.col}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {editorContainer(false)}

      {/* ─── Modal de Visualização Expandida / Tela Cheia ───────────── */}
      {isMaximized && (
        <div
          className="modal-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(5, 7, 15, 0.85)",
            backdropFilter: "blur(10px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => setIsMaximized(false)}
        >
          <div
            className="modal-content"
            style={{
              width: "100%",
              maxWidth: 1040,
              height: "82vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: 12,
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {editorContainer(true)}
          </div>
        </div>
      )}
    </>
  );
};
