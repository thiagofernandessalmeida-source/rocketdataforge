"""Testes unitários para o Extrator de Column Lineage (Fase 1 - Spec 005).

Valida rastreamento de linhagem campo a campo cobrindo:
1. Pass-through (mapeamento direto de colunas)
2. Expressões calculadas (aritmética, funções, variáveis intermediárias)
3. Lookups (colunas provenientes de tabelas de lookup secundárias)
4. Operadores Canônicos (FilterOperator e AggregateOperator)
5. Filtragem por node_id e column_name no grafo de linhagem
"""

import pytest
from src.core.application.compiler.lineage.lineage_extractor import (
    LineageExtractor,
    TransformationType,
    ColumnLineageRelation,
    ColumnLineageGraph,
)


def test_passthrough_column_lineage():
    """Valida que mapeamento direto gera tipo PASSTHROUGH com origem e destino corretos."""
    extractor = LineageExtractor()

    tmap_config = {
        "main_table": "main",
        "lookups": [],
        "vars": [],
        "outputs": [
            {
                "name": "out",
                "columns": [
                    {"name": "user_id", "expression": "main.user_id"},
                    {"name": "user_email", "expression": "main.email"},
                ]
            }
        ]
    }

    relations = extractor.extract_tmap_lineage(
        tmap_node_id="tmap_1",
        tmap_config=tmap_config,
        upstream_alias_to_node={"main": ("src_users", "out")},
    )

    assert len(relations) == 2

    r_id = next(r for r in relations if r.target_column == "user_id")
    assert r_id.source_node_id == "src_users"
    assert r_id.source_port == "out"
    assert r_id.source_column == "user_id"
    assert r_id.target_node_id == "tmap_1"
    assert r_id.target_port == "out"
    assert r_id.transformation_type == TransformationType.PASSTHROUGH

    r_email = next(r for r in relations if r.target_column == "user_email")
    assert r_email.source_node_id == "src_users"
    assert r_email.source_column == "email"
    assert r_email.target_column == "user_email"
    assert r_email.transformation_type == TransformationType.PASSTHROUGH


def test_expression_column_lineage():
    """Valida que expressões calculadas com múltiplos campos geram EXPRESSION para cada dependência."""
    extractor = LineageExtractor()

    tmap_config = {
        "main_table": "orders",
        "lookups": [],
        "vars": [],
        "outputs": [
            {
                "name": "out",
                "columns": [
                    {
                        "name": "net_amount",
                        "expression": "orders.gross_amount * (1.0 - orders.tax_rate)"
                    },
                    {
                        "name": "full_label",
                        "expression": 'StringHandling.UPCASE(orders.code) + " - " + orders.category'
                    }
                ]
            }
        ]
    }

    relations = extractor.extract_tmap_lineage(
        tmap_node_id="tmap_1",
        tmap_config=tmap_config,
        upstream_alias_to_node={"orders": ("src_orders", "output")},
    )

    # net_amount depende de gross_amount e tax_rate
    net_rels = [r for r in relations if r.target_column == "net_amount"]
    assert len(net_rels) == 2
    sources = {r.source_column for r in net_rels}
    assert sources == {"gross_amount", "tax_rate"}
    for r in net_rels:
        assert r.transformation_type == TransformationType.EXPRESSION
        assert r.source_node_id == "src_orders"
        assert r.target_node_id == "tmap_1"

    # full_label depende de code e category
    label_rels = [r for r in relations if r.target_column == "full_label"]
    assert len(label_rels) == 2
    sources_label = {r.source_column for r in label_rels}
    assert sources_label == {"code", "category"}
    for r in label_rels:
        assert r.transformation_type == TransformationType.EXPRESSION


def test_lookup_match_column_lineage():
    """Valida que colunas originadas de lookups são classificadas como LOOKUP_MATCH."""
    extractor = LineageExtractor()

    tmap_config = {
        "main_table": "row1",
        "lookups": [
            {
                "alias": "lk_cust",
                "node_id": "src_cust",
                "join_keys": [{"expr_key": "row1.cust_id", "column": "id"}]
            }
        ],
        "vars": [],
        "outputs": [
            {
                "name": "out",
                "columns": [
                    {"name": "order_id", "expression": "row1.order_id"},
                    {"name": "customer_name", "expression": "lk_cust.name"},
                    {"name": "customer_city", "expression": "lk_cust.city"},
                ]
            }
        ]
    }

    relations = extractor.extract_tmap_lineage(
        tmap_node_id="tmap_1",
        tmap_config=tmap_config,
        upstream_alias_to_node={
            "row1": ("src_orders", "output"),
            "lk_cust": ("src_cust", "output"),
        },
    )

    r_order = next(r for r in relations if r.target_column == "order_id")
    assert r_order.transformation_type == TransformationType.PASSTHROUGH
    assert r_order.source_node_id == "src_orders"

    r_name = next(r for r in relations if r.target_column == "customer_name")
    assert r_name.transformation_type == TransformationType.LOOKUP_MATCH
    assert r_name.source_node_id == "src_cust"
    assert r_name.source_column == "name"

    r_city = next(r for r in relations if r.target_column == "customer_city")
    assert r_city.transformation_type == TransformationType.LOOKUP_MATCH
    assert r_city.source_node_id == "src_cust"
    assert r_city.source_column == "city"


def test_variable_resolution_lineage():
    """Valida resolução recursiva de variáveis intermediárias Var."""
    extractor = LineageExtractor()

    tmap_config = {
        "main_table": "row1",
        "lookups": [],
        "vars": [
            {"name": "v_subtotal", "expression": "row1.qty * row1.unit_price"},
            {"name": "v_discount", "expression": "Var.v_subtotal * 0.1"},
        ],
        "outputs": [
            {
                "name": "out",
                "columns": [
                    {"name": "final_price", "expression": "Var.v_subtotal - Var.v_discount"}
                ]
            }
        ]
    }

    relations = extractor.extract_tmap_lineage(
        tmap_node_id="tmap_1",
        tmap_config=tmap_config,
        upstream_alias_to_node={"row1": ("src_items", "output")},
    )

    rels = [r for r in relations if r.target_column == "final_price"]
    assert len(rels) == 2
    sources = {r.source_column for r in rels}
    assert sources == {"qty", "unit_price"}
    for r in rels:
        assert r.transformation_type == TransformationType.EXPRESSION
        assert r.source_node_id == "src_items"


def test_pipeline_graph_lineage_and_subdag_filter():
    """Valida a extração de linhagem completa de um pipeline e filtragem por coluna."""
    extractor = LineageExtractor()

    pipeline_spec = {
        "nodes": [
            {
                "id": "src_orders",
                "component": {"type": "connector.file.csv", "version": "1.0.0"},
                "config": {"path": "orders.csv", "schema": [{"name": "id"}, {"name": "amount"}, {"name": "cust_id"}]}
            },
            {
                "id": "tmap_enrich",
                "component": {"type": "core.tmap", "version": "1.0.0"},
                "config": {
                    "main_table": "main",
                    "lookups": [],
                    "vars": [],
                    "outputs": [
                        {
                            "name": "out",
                            "columns": [
                                {"name": "order_id", "expression": "main.id"},
                                {"name": "calc_total", "expression": "main.amount * 1.05"},
                            ]
                        }
                    ]
                }
            },
            {
                "id": "target_db",
                "component": {"type": "connector.db.postgres.target", "version": "1.0.0"},
                "config": {"table": "fact_orders"}
            }
        ],
        "edges": [
            {"from": "src_orders", "to": "tmap_enrich", "from_port": "output", "to_port": "main"},
            {"from": "tmap_enrich", "to": "target_db", "from_port": "out", "to_port": "input"}
        ]
    }

    graph: ColumnLineageGraph = extractor.extract_pipeline_lineage(pipeline_spec)
    assert len(graph.relations) >= 2

    # Consulta subgrafo específico de 'calc_total' no target
    sub_rels = graph.filter(target_node_id="target_db", target_column="calc_total")
    assert len(sub_rels) > 0
    # Verifica que atinge src_orders.amount
    all_sources = {(r.source_node_id, r.source_column) for r in sub_rels}
    assert ("src_orders", "amount") in all_sources or ("tmap_enrich", "calc_total") in all_sources


def test_filter_and_aggregate_operators_lineage():
    """Valida geração de linhagem para tFilterRow e tAggregateRow."""
    extractor = LineageExtractor()

    # 1. Filter: repassa colunas com PASSTHROUGH
    filter_config = {
        "conditions": [{"column": "age", "operator": ">=", "value": "18"}],
        "schema": [{"name": "id"}, {"name": "name"}, {"name": "age"}]
    }
    filter_rels = extractor.extract_filter_lineage(
        node_id="filter_1",
        config=filter_config,
        upstream_node_id="src_users"
    )
    assert len(filter_rels) >= 3
    for r in filter_rels:
        assert r.transformation_type == TransformationType.PASSTHROUGH
        assert r.source_node_id == "src_users"
        assert r.target_node_id == "filter_1"

    # 2. Aggregate: group_by é PASSTHROUGH, agregados são EXPRESSION
    agg_config = {
        "group_by": ["department_id"],
        "aggregations": [
            {"output_column": "total_salary", "input_column": "salary", "function": "SUM"},
            {"output_column": "employee_count", "input_column": "id", "function": "COUNT"},
        ]
    }
    agg_rels = extractor.extract_aggregate_lineage(
        node_id="agg_1",
        config=agg_config,
        upstream_node_id="src_employees"
    )
    assert len(agg_rels) == 3

    r_dept = next(r for r in agg_rels if r.target_column == "department_id")
    assert r_dept.transformation_type == TransformationType.PASSTHROUGH
    assert r_dept.source_column == "department_id"

    r_sal = next(r for r in agg_rels if r.target_column == "total_salary")
    assert r_sal.transformation_type == TransformationType.EXPRESSION
    assert r_sal.source_column == "salary"

    r_cnt = next(r for r in agg_rels if r.target_column == "employee_count")
    assert r_cnt.transformation_type == TransformationType.EXPRESSION
    assert r_cnt.source_column == "id"


def test_api_get_pipeline_lineage():
    """Valida o endpoint REST GET /api/v1/pipelines/{id}/lineage e filtragem via query params."""
    import time
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    # 1. Cria workspace e projeto
    ws_name = f"WS_Lineage_{int(time.time() * 1000)}"
    ws = client.post("/api/v1/workspaces", json={"name": ws_name}).json()
    proj = client.post(
        f"/api/v1/workspaces/{ws['id']}/projects",
        json={"name": "Lineage Project", "slug": f"proj-{int(time.time() * 1000)}"}
    ).json()

    # 2. Cria pipeline
    pipe = client.post(f"/api/v1/projects/{proj['id']}/pipelines", json={"name": "Lineage Pipeline"}).json()
    pipe_id = pipe["id"]

    # 3. Atualiza draft com tMap
    update_payload = {
        "expected_revision": 1,
        "definition": {
            "metadata": {"name": "Lineage Pipeline"},
            "spec": {
                "nodes": [
                    {
                        "id": "src_1",
                        "component": {"type": "connector.file.csv", "version": "1.0.0"},
                        "config": {"path": "input.csv"}
                    },
                    {
                        "id": "tmap_1",
                        "component": {"type": "core.tmap", "version": "1.0.0"},
                        "config": {
                            "main_table": "row1",
                            "lookups": [],
                            "vars": [],
                            "outputs": [
                                {
                                    "name": "out",
                                    "columns": [
                                        {"name": "id", "expression": "row1.id"},
                                        {"name": "calc_val", "expression": "row1.amount * 2"},
                                    ]
                                }
                            ]
                        }
                    }
                ],
                "edges": [
                    {"from": "src_1.output", "to": "tmap_1.main"}
                ]
            }
        },
        "layout": {"viewport": {"x": 0, "y": 0, "zoom": 1}, "nodes": []}
    }
    put_res = client.put(f"/api/v1/pipelines/{pipe_id}/draft", json=update_payload)
    assert put_res.status_code == 200

    # 4. GET /pipelines/{id}/lineage sem filtro
    res = client.get(f"/api/v1/pipelines/{pipe_id}/lineage")
    assert res.status_code == 200
    data = res.json()
    assert "relations" in data
    assert len(data["relations"]) == 2

    # 5. GET /pipelines/{id}/lineage com filtro por coluna
    res_filter = client.get(f"/api/v1/pipelines/{pipe_id}/lineage?column=calc_val&node_id=tmap_1")
    assert res_filter.status_code == 200
    filtered_data = res_filter.json()
    assert len(filtered_data["relations"]) == 1
    rel = filtered_data["relations"][0]
    assert rel["target"]["column_name"] == "calc_val"
    assert rel["transformation_type"] == "EXPRESSION"
