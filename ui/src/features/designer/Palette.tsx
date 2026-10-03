import React, { useState } from "react";
import { ComponentCategory, ComponentDefinition } from "../../types";
import {
  Database,
  FileText,
  Filter,
  Layers,
  GitMerge,
  HardDrive,
  Cpu,
  Cloud,
  Globe,
  Search,
  ChevronDown,
  ChevronRight,
  BarChart2,
  SortAsc,
  Copy,
  Shuffle,
  ArrowLeftRight,
  Zap,
  Server,
  Key,
} from "lucide-react";

interface PaletteProps {
  components: ComponentDefinition[];
}

function getIcon(typeId: string) {
  if (typeId.includes("oracle")) return <Database size={16} color="#c74634" />;
  if (typeId.includes("sqlserver")) return <Database size={16} color="#0078d4" />;
  if (typeId.includes("mysql")) return <Database size={16} color="#4479a1" />;
  if (typeId.includes("postgresql")) return <Database size={16} color="#336791" />;
  if (typeId.includes("redshift")) return <Database size={16} color="#8c4fff" />;
  if (typeId.includes("databricks")) return <Zap size={16} color="#ff3621" />;
  if (typeId.includes("snowflake")) return <Database size={16} color="#29b5e8" />;
  if (typeId.includes("bigquery")) return <Database size={16} color="#4285f4" />;
  if (typeId.includes("mongodb")) return <Database size={16} color="#47a248" />;
  if (typeId.includes("s3")) return <Cloud size={16} color="#ff9900" />;
  if (typeId.includes("azure_blob")) return <Cloud size={16} color="#0078d4" />;
  if (typeId.includes("gcs")) return <Cloud size={16} color="#4285f4" />;
  if (typeId.includes("rest_api") || typeId.includes("rest_input")) return <Globe size={16} color="#10b981" />;
  if (typeId.includes("rest_output")) return <Globe size={16} color="#f59e0b" />;
  if (typeId.includes("scylla")) return <Layers size={16} color="#00e5ff" />;
  if (typeId.includes("kafka")) return <Server size={16} color="#e65100" />;
  if (typeId.includes("sqs")) return <Layers size={16} color="#ff9900" />;
  if (typeId.includes("sns")) return <Zap size={16} color="#e11d48" />;
  if (typeId.includes("sftp") || typeId.includes("ftp")) return <Key size={16} color="#94a3b8" />;
  if (typeId.includes("file.source")) return <FileText size={16} color="#10b981" />;
  if (typeId.includes("file.target")) return <HardDrive size={16} color="#f59e0b" />;
  if (typeId.includes("filter")) return <Filter size={16} color="#3b82f6" />;
  if (typeId.includes("select")) return <Layers size={16} color="#3b82f6" />;
  if (typeId.includes("join")) return <GitMerge size={16} color="#8b5cf6" />;
  if (typeId.includes("aggregate")) return <BarChart2 size={16} color="#06b6d4" />;
  if (typeId.includes("sort")) return <SortAsc size={16} color="#06b6d4" />;
  if (typeId.includes("deduplicate")) return <Copy size={16} color="#06b6d4" />;
  if (typeId.includes("map_expression")) return <Shuffle size={16} color="#8b5cf6" />;
  if (typeId.includes("lookup")) return <ArrowLeftRight size={16} color="#8b5cf6" />;
  if (typeId.includes("union")) return <Layers size={16} color="#8b5cf6" />;
  if (typeId.includes("pivot")) return <BarChart2 size={16} color="#8b5cf6" />;
  if (typeId.includes("database.target")) return <Database size={16} color="#f59e0b" />;
  return <Cpu size={16} color="#94a3b8" />;
}

const SUBCATEGORIES: Record<string, { pattern: string; label: string }[]> = {
  source: [
    { pattern: "file.source", label: "Arquivos" },
    { pattern: "connector.db", label: "Bancos de Dados" },
    { pattern: "connector.cloud", label: "Cloud Storage" },
    { pattern: "connector.streaming", label: "Streaming & Mensageria" },
    { pattern: "connector.cloud.aws_sqs", label: "Streaming & Mensageria" },
    { pattern: "connector.nosql", label: "NoSQL" },
    { pattern: "connector.api.rest_input", label: "APIs" },
  ],
  transform: [
    { pattern: "", label: "Transformações" },
  ],
  target: [
    { pattern: "core.file", label: "Arquivos" },
    { pattern: "connector.db", label: "Bancos de Dados" },
    { pattern: "connector.cloud.s3", label: "Cloud Storage" },
    { pattern: "connector.streaming", label: "Streaming & Mensageria" },
    { pattern: "connector.cloud.aws_", label: "Streaming & Mensageria" },
    { pattern: "connector.nosql", label: "NoSQL" },
    { pattern: "connector.api.rest_output", label: "APIs" },
  ],
};

export const Palette: React.FC<PaletteProps> = ({ components }) => {
  const [search, setSearch] = useState("");
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(
    new Set(["Arquivos", "Bancos de Dados", "Transformações"])
  );

  /**
   * BUG FIX — Drag ghost "copying image" issue (v2):
   *
   * Problems with previous approach:
   * 1. `position:fixed; top:-1000px` means offsetWidth=0 (no layout)
   * 2. `requestAnimationFrame` removes ghost before browser captures it
   *
   * Correct approach:
   * 1. Use `position:absolute; left:-9999px` so element IS laid out (has width)
   * 2. Force reflow via getBoundingClientRect() so browser paints it
   * 3. Keep ghost alive until `dragend` event — only then remove from DOM
   */
  const dragGhostRef = React.useRef<HTMLDivElement | null>(null);

  const onDragStart = (event: React.DragEvent, comp: ComponentDefinition) => {
    const data = JSON.stringify(comp);
    event.dataTransfer.setData("application/reactflow", data);
    event.dataTransfer.setData("text/plain", data);
    event.dataTransfer.effectAllowed = "move";

    // Remove any lingering ghost from previous drag
    if (dragGhostRef.current && document.body.contains(dragGhostRef.current)) {
      document.body.removeChild(dragGhostRef.current);
    }

    // Create ghost — use position:absolute so browser calculates layout
    const ghost = document.createElement("div");
    ghost.style.cssText = [
      "position: absolute",
      "left: -9999px",
      "top: 4px",
      "padding: 5px 13px",
      "background: #0d1424",
      "border: 1px solid #00e5ff",
      "border-radius: 6px",
      "color: #e2e8f0",
      "font-size: 12px",
      "font-family: Inter, sans-serif",
      "font-weight: 600",
      "white-space: nowrap",
      "pointer-events: none",
      "box-shadow: 0 4px 16px rgba(0,229,255,0.25)",
      "z-index: 99999",
    ].join(";");
    ghost.textContent = `⊕  ${comp.name}`;
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;

    // Force reflow so the browser paints the element before capturing it
    const rect = ghost.getBoundingClientRect();
    const w = rect.width || 120; // fallback width if still 0

    event.dataTransfer.setDragImage(ghost, w / 2, 16);
    // Ghost is kept alive until dragend (see onDragEnd)
  };

  const onDragEnd = () => {
    if (dragGhostRef.current && document.body.contains(dragGhostRef.current)) {
      document.body.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
    }
  };

  const toggleSub = (label: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const filtered = search.trim()
    ? components.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.description.toLowerCase().includes(search.toLowerCase())
      )
    : components;

  const categories: { key: ComponentCategory; label: string }[] = [
    { key: "source", label: "Fontes de Dados" },
    { key: "transform", label: "Transformações" },
    { key: "target", label: "Destinos (Targets)" },
  ];

  return (
    <div className="sidebar-palette" id="palette-sidebar">
      <div className="palette-header">
        <span>Componentes</span>
        <span className="badge">{components.length}</span>
      </div>

      {/* Search */}
      <div className="palette-search-wrap">
        <Search size={13} className="palette-search-icon" />
        <input
          className="palette-search"
          placeholder="Buscar componente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="palette-content">
        {search.trim() ? (
          // Flat search results
          <>
            <div className="palette-category-title">
              {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
            </div>
            {filtered.map((comp) => (
              <PaletteItem key={comp.type_id} comp={comp} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            ))}
            {filtered.length === 0 && (
              <div className="palette-empty">Nenhum componente encontrado</div>
            )}
          </>
        ) : (
          // Grouped by category
          categories.map((cat) => {
            const catItems = filtered.filter((c) => c.category === cat.key);
            if (catItems.length === 0) return null;

            if (cat.key === "transform") {
              return (
                <div key={cat.key}>
                  <SubcategorySection
                    label="Transformações"
                    items={catItems}
                    expanded={expandedSubs.has("Transformações")}
                    onToggle={() => toggleSub("Transformações")}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                </div>
              );
            }

            const subs = SUBCATEGORIES[cat.key] ?? [];
            return (
              <div key={cat.key}>
                <div className="palette-main-category">{cat.label}</div>
                {subs.map((sub) => {
                  const subItems = catItems.filter((c) =>
                    sub.pattern ? c.type_id.includes(sub.pattern) : true
                  );
                  // Exclude items already matched by previous subs
                  const exclusiveItems = subItems.filter(
                    (c) => !subs.slice(0, subs.indexOf(sub)).some((prev) => prev.pattern && c.type_id.includes(prev.pattern))
                  );
                  if (exclusiveItems.length === 0) return null;
                  return (
                    <SubcategorySection
                      key={sub.label}
                      label={sub.label}
                      items={exclusiveItems}
                      expanded={expandedSubs.has(sub.label)}
                      onToggle={() => toggleSub(sub.label)}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                    />
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const SubcategorySection: React.FC<{
  label: string;
  items: ComponentDefinition[];
  expanded: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent, comp: ComponentDefinition) => void;
  onDragEnd: () => void;
}> = ({ label, items, expanded, onToggle, onDragStart, onDragEnd }) => (
  <div className="palette-subcat">
    <button className="palette-subcat-header" onClick={onToggle}>
      {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      <span>{label}</span>
      <span className="palette-subcat-count">{items.length}</span>
    </button>
    {expanded && (
      <div className="palette-subcat-items">
        {items.map((comp) => (
          <PaletteItem key={comp.type_id} comp={comp} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        ))}
      </div>
    )}
  </div>
);

const PaletteItem: React.FC<{
  comp: ComponentDefinition;
  onDragStart: (e: React.DragEvent, comp: ComponentDefinition) => void;
  onDragEnd: () => void;
}> = ({ comp, onDragStart, onDragEnd }) => (
  <div
    className="palette-item"
    id={`palette-item-${comp.type_id.replace(/\./g, "-")}`}
    draggable
    onDragStart={(e) => onDragStart(e, comp)}
    onDragEnd={onDragEnd}
    title={`${comp.name}\n${comp.description}`}
  >
    <div className="palette-item-icon palette-item-nodrag">
      {getIcon(comp.type_id)}
    </div>
    <div className="palette-item-nodrag">
      <div className="palette-item-name">{comp.name}</div>
      <div className="palette-item-desc">{comp.description}</div>
    </div>
  </div>
);
