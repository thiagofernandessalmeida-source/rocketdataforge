"""Gerador de Documentação Técnica e Linhagem de Dados (Auto-Doc Pipeline).

Realiza parse estrutural do PipelineDraft, varrendo canvas-cells, nós, schemas,
queries transpiladas, variáveis de tMap, tags de negócio e telemetria, gerando
especificação em Markdown (MDX) e diagramas de Data Lineage em Mermaid.js.
"""

from typing import Any, Dict, List, Optional
from src.core.domain.pipeline.draft import PipelineDraft


class AutoDocGenerator:
    """Motor de geração de documentação técnica automática para pipelines."""

    def generate_mermaid_lineage(self, draft: PipelineDraft) -> str:
        """Gera o diagrama de linhagem de dados (Data Lineage) em sintaxe Mermaid.js,
        organizado por subgrafos representando as canvas-cells e suas conexões.
        """
        lines = ["flowchart LR"]
        lines.append("    %% Estilização do Diagrama de Linhagem")
        lines.append("    classDef sourceNode fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;")
        lines.append("    classDef transformNode fill:#1e293b,stroke:#a855f7,stroke-width:2px,color:#f8fafc;")
        lines.append("    classDef targetNode fill:#1e293b,stroke:#22c55e,stroke-width:2px,color:#f8fafc;")
        lines.append("    classDef defaultNode fill:#1e293b,stroke:#64748b,stroke-width:1px,color:#f8fafc;")

        # Mapeamento de nó para célula (se houver células configuradas)
        node_to_cell: Dict[str, str] = {}
        cell_dict: Dict[str, Dict[str, Any]] = {}
        for c in (draft.cells or []):
            cid = c.get("id") or c.get("name") or "cell"
            cell_dict[cid] = c
            for nid in c.get("node_ids", []):
                node_to_cell[nid] = cid

        # Agrupar nós por célula ou global
        cells_nodes: Dict[str, List[str]] = {}
        unassigned_nodes: List[str] = []

        for nid in draft.nodes.keys():
            if nid in node_to_cell:
                cid = node_to_cell[nid]
                cells_nodes.setdefault(cid, []).append(nid)
            else:
                unassigned_nodes.append(nid)

        # Renderizar subgrafos de células
        for cid, nids in cells_nodes.items():
            cell_info = cell_dict.get(cid, {})
            c_name = cell_info.get("name") or cid
            c_order = cell_info.get("order", 1)
            lines.append(f'    subgraph sub_{cid} ["📦 Célula {c_order}: {c_name}"]')
            for nid in nids:
                node = draft.nodes[nid]
                label = self._format_node_label(node)
                lines.append(f'        {nid}["{label}"]')
            lines.append("    end")

        # Renderizar nós sem célula associada
        if unassigned_nodes:
            if cells_nodes:
                lines.append('    subgraph sub_main ["⚙️ Fluxo Principal"]')
            for nid in unassigned_nodes:
                node = draft.nodes[nid]
                label = self._format_node_label(node)
                lines.append(f'        {nid}["{label}"]')
            if cells_nodes:
                lines.append("    end")

        # Renderizar conexões / Arestas
        for edge in draft.edges.values():
            from_nid = edge.from_port.node_id
            to_nid = edge.to_port.node_id
            from_port = edge.from_port.port_name
            to_port = edge.to_port.port_name
            edge_label = f"{from_port} ➔ {to_port}" if from_port != "main" or to_port != "input" else "dados"
            lines.append(f"    {from_nid} -->|{edge_label}| {to_nid}")

        # Aplicar classes CSS conforme categoria do componente
        for nid, node in draft.nodes.items():
            ctype = node.component_type.lower()
            if "source" in ctype or "input" in ctype:
                lines.append(f"    class {nid} sourceNode;")
            elif "target" in ctype or "output" in ctype or "sink" in ctype:
                lines.append(f"    class {nid} targetNode;")
            elif "transform" in ctype or "tmap" in ctype or "filter" in ctype or "join" in ctype or "select" in ctype:
                lines.append(f"    class {nid} transformNode;")
            else:
                lines.append(f"    class {nid} defaultNode;")

        return "\n".join(lines)

    def _format_node_label(self, node: Any) -> str:
        """Formata o texto do nó para o diagrama Mermaid com ícone e detalhe."""
        ctype = node.component_type
        cfg = node.config or {}
        detail = ""
        icon = "⚙️"
        if "source" in ctype.lower():
            icon = "📥"
            detail = cfg.get("table_name") or cfg.get("file_path") or cfg.get("connection_ref") or ""
        elif "target" in ctype.lower():
            icon = "📤"
            detail = cfg.get("table_name") or cfg.get("file_path") or cfg.get("connection_ref") or ""
        elif "tmap" in ctype.lower():
            icon = "🔀"
            detail = f"{len(cfg.get('mappings', []))} mapeamentos" if cfg.get("mappings") else ""
        elif "filter" in ctype.lower():
            icon = "🔍"
            detail = cfg.get("condition") or ""
        elif "join" in ctype.lower():
            icon = "🔗"
            detail = f"tipo: {cfg.get('join_type', 'inner')}"

        clean_type = ctype.split(".")[-1].replace("_", " ").title()
        if detail:
            clean_detail = str(detail).replace('"', "'")[:30]
            return f"{icon} {node.id}<br/><b>{clean_type}</b><br/><i>({clean_detail})</i>"
        return f"{icon} {node.id}<br/><b>{clean_type}</b>"

    def generate_markdown(
        self,
        draft: PipelineDraft,
        telemetry_metrics: Optional[Dict[str, Any]] = None,
        author: str = "RocketDataForge Engine",
        business_tags: Optional[List[str]] = None
    ) -> str:
        """Gera a documentação completa em Markdown / MDX estruturado."""
        tags = business_tags or []
        # Extrair tags embutidas nos parâmetros do draft ou nas células se houver
        if hasattr(draft, "parameters") and draft.parameters:
            tags.extend(draft.parameters.get("tags", []))
        for c in (draft.cells or []):
            tags.extend(c.get("tags", []))
        unique_tags = sorted(list(set(tags)))

        mermaid_lineage = self.generate_mermaid_lineage(draft)

        md = []
        md.append(f"# 📘 Documentação Técnica: {draft.name}")
        md.append("")
        md.append(f"> **Pipeline ID:** `{draft.id}` | **Projeto:** `{draft.project_id}` | **Revisão:** `v{draft.revision}`")
        md.append(f"> **Gerado por:** `{author}` | **Governança & Linhagem Auditada**")
        md.append("")

        if unique_tags:
            tag_badges = " ".join([f"`{t}`" for t in unique_tags])
            md.append(f"**Business & Governance Tags:** {tag_badges}")
            md.append("")

        md.append("## 1. Visão Geral do Pipeline")
        md.append(draft.description or "*Nenhuma descrição de negócio fornecida para este pipeline.*")
        md.append("")

        # Seção de Linhagem de Dados
        md.append("## 2. Diagrama de Linhagem de Dados (Data Lineage)")
        md.append("Abaixo está representada a rastreabilidade visual fim a fim das origens, transformações e destinos:")
        md.append("")
        md.append("```mermaid")
        md.append(mermaid_lineage)
        md.append("```")
        md.append("")

        # Seção de Canvas-Cells (se houver)
        if draft.cells:
            md.append("## 3. Orquestração Modular por Canvas-Cells")
            md.append("| Célula | Ordem | Descrição | Pré-condições | Tags |")
            md.append("| :--- | :---: | :--- | :--- | :--- |")
            for c in sorted(draft.cells, key=lambda x: x.get("order", 1)):
                cid = c.get("id") or c.get("name") or "célula"
                order = c.get("order", 1)
                desc = c.get("description") or "-"
                preconds = ", ".join(c.get("preconditions", [])) or "Nenhuma (Executa no disparo)"
                c_tags = ", ".join([f"`{t}`" for t in c.get("tags", [])]) or "-"
                md.append(f"| **{cid}** | `{order}` | {desc} | {preconds} | {c_tags} |")
            md.append("")

        # Seção de Componentes e Nós
        md.append("## 4. Dicionário de Nós e Configurações Técnicas")
        for nid, node in draft.nodes.items():
            md.append(f"### Nó: `{nid}` ({node.component_type})")
            cfg = node.config or {}
            md.append(f"- **Tipo Canônico:** `{node.component_type}` (v{node.component_version})")
            
            # Detalhes específicos de tMap
            if "tmap" in node.component_type.lower() and "mappings" in cfg:
                md.append("- **Mapeamentos & Expressões de Transformação:**")
                md.append("  | Coluna Destino | Expressão / Origem | Tipo |")
                md.append("  | :--- | :--- | :--- |")
                for m in cfg.get("mappings", []):
                    target_c = m.get("target_column") or m.get("target") or "-"
                    expr = m.get("expression") or m.get("source_column") or "-"
                    col_type = m.get("data_type") or "STRING"
                    md.append(f"  | `{target_c}` | `{expr}` | `{col_type}` |")
            elif "query" in cfg:
                md.append(f"- **Consulta SQL / Query:**")
                md.append(f"  ```sql\n  {cfg['query']}\n  ```")
            else:
                md.append("- **Parâmetros de Configuração:**")
                for k, v in cfg.items():
                    if k in ("password", "secret", "token"):
                        v = "******"
                    md.append(f"  - `{k}`: `{v}`")
            md.append("")

        # Seção de Métricas de Telemetria Histórica
        md.append("## 5. Telemetria e Qualidade Operacional")
        if telemetry_metrics:
            avg_duration = telemetry_metrics.get("avg_duration_ms", 0) / 1000.0
            total_records = telemetry_metrics.get("total_records_processed", 0)
            success_rate = telemetry_metrics.get("success_rate_percent", 100.0)
            last_run = telemetry_metrics.get("last_executed_at", "N/A")
            md.append("| Métrica | Valor Registrado |")
            md.append("| :--- | :--- |")
            md.append(f"| Tempo Médio de Execução | **{avg_duration:.2f}s** |")
            md.append(f"| Registros Processados | **{total_records:,} linhas** |")
            md.append(f"| Taxa de Sucesso (SLO) | **{success_rate:.1f}%** |")
            md.append(f"| Última Execução | `{last_run}` |")
        else:
            md.append("*Pipeline sem execuções registradas ainda ou telemetria em consolidação.*")
        md.append("")

        md.append("---")
        md.append("*Documento gerado automaticamente pelo RocketDataForge Auto-Doc Engine para fins de Governança de Dados, Auditoria e Compliance.*")

        return "\n".join(md)
