"""Testes Unitários do Motor Auto-Doc e Geração de Data Lineage Mermaid."""

import pytest
from src.core.application.autodoc.generator import AutoDocGenerator
from src.core.application.autodoc.html_exporter import HtmlDocExporter
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.types import PortId, SemanticVersion


def test_autodoc_generation_with_cells_and_tmap():
    draft = PipelineDraft(
        id="pipe-100",
        project_id="proj-alpha",
        name="Pipeline de Contratos e Acordos",
        description="Pipeline crítico de faturamento e acordos comerciais.",
        revision=2,
        cells=[
            {
                "id": "cell_ingest",
                "name": "Ingestão Raw",
                "order": 1,
                "description": "Lê contratos brutos do banco transacional",
                "tags": ["#financeiro", "#dados-sensiveis"],
                "node_ids": ["src_node"]
            },
            {
                "id": "cell_process",
                "name": "Processamento",
                "order": 2,
                "description": "Limpeza e cálculo de impostos",
                "preconditions": ["cell_ingest"],
                "node_ids": ["tmap_node", "tgt_node"]
            }
        ]
    )
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("src_node", "core.database.source", ver, config={"query": "SELECT * FROM contracts", "connection_ref": "db_main"})
    draft.add_node(
        "tmap_node",
        "core.transform.tmap",
        ver,
        config={
            "mappings": [
                {"target_column": "id_contrato", "expression": "raw_id", "data_type": "BIGINT"},
                {"target_column": "valor_liquido", "expression": "valor_bruto * 0.85", "data_type": "DECIMAL(10,2)"}
            ]
        }
    )
    draft.add_node("tgt_node", "connector.custom.mysql_agreements", ver, config={"table_name": "tb_agreements", "batch_size": 500})

    draft.connect_ports(PortId("src_node", "main"), PortId("tmap_node", "input"))
    draft.connect_ports(PortId("tmap_node", "main"), PortId("tgt_node", "input"))

    generator = AutoDocGenerator()
    telemetry = {
        "avg_duration_ms": 1420,
        "total_records_processed": 50000,
        "success_rate_percent": 99.8,
        "last_executed_at": "2026-10-07 19:30:00"
    }

    markdown = generator.generate_markdown(
        draft=draft,
        telemetry_metrics=telemetry,
        business_tags=["#enterprise"]
    )

    # Asserções de conteúdo estrutural
    assert "# 📘 Documentação Técnica: Pipeline de Contratos e Acordos" in markdown
    assert "```mermaid" in markdown
    assert "flowchart LR" in markdown
    assert "subgraph sub_cell_ingest" in markdown
    assert "subgraph sub_cell_process" in markdown
    assert "`#financeiro`" in markdown
    assert "`#dados-sensiveis`" in markdown
    assert "id_contrato" in markdown
    assert "valor_liquido" in markdown
    assert "99.8%" in markdown
    assert "50,000 linhas" in markdown

    # Teste do Exportador HTML
    html_out = HtmlDocExporter.export_standalone_html(
        title=draft.name,
        markdown_content=markdown
    )

    assert "<!DOCTYPE html>" in html_out
    assert "mermaid.min.js" in html_out
    assert "class=\"mermaid-card\"" in html_out
    assert "Pipeline de Contratos e Acordos" in html_out
    assert "@media print" in html_out
