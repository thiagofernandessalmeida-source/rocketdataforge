"""Gerador de DAGs do Apache Airflow (Spec 006 - Fase 3 / Tarefa T-3.4).

Compila o grafo visual de pipelines do RocketDataForge em um arquivo Python
contendo a definição completa de DAG do Apache Airflow com PythonOperators,
respeitando dependências bitshift (>>) e conformidade estrita com RNF-02 (Zero Plaintext Secrets).
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
import datetime
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple

import jinja2

from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.pipeline.version import PipelineVersion

SENSITIVE_KEY_PATTERN = re.compile(
    r"(password|pwd|secret|token|auth_token|api_key|private_key|key)",
    re.IGNORECASE
)


@dataclass
class AirflowOptions:
    """Configurações personalizadas para a geração da DAG."""
    dag_id: Optional[str] = None
    schedule_interval: Optional[str] = "0 0 * * *"
    start_date: str = "2026-01-01"
    owner: str = "rocketdataforge"
    retries: int = 1
    retry_delay_minutes: int = 5
    catchup: bool = False
    tags: List[str] = field(default_factory=lambda: ["rocketdataforge", "etl"])


@dataclass
class AirflowDagBundle:
    """Bundle de exportação contendo o arquivo .py da DAG e metadados."""
    dag_py: str
    dag_id: str
    schedule_interval: str
    generated_at: str


AIRFLOW_DAG_TEMPLATE = """# ==============================================================================
# Apache Airflow DAG: {{ dag_id }}
# Gerado por: RocketDataForge Airflow Generator (Spec 006)
# Data de Geração: {{ generated_at }}
# ==============================================================================

from datetime import datetime, timedelta
import logging
import os
import sys

from airflow import DAG
from airflow.operators.python import PythonOperator
import duckdb
import polars as pl

logger = logging.getLogger("airflow.task")

default_args = {
    "owner": {{ owner | tojson }},
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": {{ retries }},
    "retry_delay": timedelta(minutes={{ retry_delay_minutes }}),
}

# ------------------------------------------------------------------------------
# Funções de Execução por Nó (Callables)
# ------------------------------------------------------------------------------
{% for task in tasks %}
def execute_{{ task.safe_id }}(**context):
    \"\"\"Executa lógica do nó: {{ task.node_id }} ({{ task.component_type }}).\"\"\"
    logger.info("Executando tarefa Airflow: {{ task.node_id }}")
    {% if task.env_vars %}
    # Credenciais resolvidas com segurança via ambiente (RNF-02)
    {% for env_var, default_val in task.env_vars.items() %}
    {{ env_var.lower() }} = os.getenv("{{ env_var }}", {{ default_val | tojson }})
    {% endfor %}
    {% endif %}

    con = duckdb.connect(database=":memory:")
    try:
        {% if task.sql_query %}
        con.execute(\"\"\"
        {{ task.sql_query }}
        \"\"\")
        {% else %}
        logger.info("Passo {{ task.node_id }} concluído com sucesso.")
        {% endif %}
    finally:
        con.close()

{% endfor %}

# ------------------------------------------------------------------------------
# Definição da DAG e Encadeamento de Dependências
# ------------------------------------------------------------------------------
with DAG(
    dag_id={{ dag_id | tojson }},
    default_args=default_args,
    description="Pipeline exportado do RocketDataForge: {{ pipeline_name }}",
    schedule_interval={{ schedule_interval | tojson }},
    start_date=datetime.strptime({{ start_date | tojson }}, "%Y-%m-%d"),
    catchup={{ catchup }},
    tags={{ tags | tojson }},
) as dag:

    {% for task in tasks %}
    task_{{ task.safe_id }} = PythonOperator(
        task_id={{ task.node_id | tojson }},
        python_callable=execute_{{ task.safe_id }},
        dag=dag,
    )
    {% endfor %}

    # Dependências do Grafo (Topologia)
    {% if dependencies %}
    {% for dep in dependencies %}
    {{ dep }}
    {% endfor %}
    {% else %}
    # Nenhuma dependência direta entre tarefas
    {% endif %}
"""

AIRFLOW_JOB_DAG_TEMPLATE = """# ==============================================================================
# Apache Airflow DAG para Job Completo: {{ dag_id }}
# Gerado por: RocketDataForge Airflow Generator (Spec 006)
# Data de Geração: {{ generated_at }}
# Total de Células: {{ cells | length }}
# ==============================================================================

from datetime import datetime, timedelta
import logging
import os
import sys

from airflow import DAG
from airflow.operators.python import PythonOperator
import duckdb
import polars as pl

logger = logging.getLogger("airflow.task")

default_args = {
    "owner": {{ owner | tojson }},
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": {{ retries }},
    "retry_delay": timedelta(minutes={{ retry_delay_minutes }}),
}

# ------------------------------------------------------------------------------
# Funções de Execução por Célula (Callables)
# ------------------------------------------------------------------------------
{% for cell in cells %}
def execute_cell_{{ cell.safe_id }}(**context):
    \"\"\"Executa a célula '{{ cell.name }}' (Tipo: {{ cell.cell_type }}).\"\"\"
    logger.info("Executando etapa/célula Airflow: {{ cell.name }} (ID: {{ cell.id }})")
    {% if cell.cell_type == "PYTHON" %}
    {{ cell.code_snippet | indent(4) }}
    {% else %}
    con = duckdb.connect(database=":memory:")
    try:
        {% for step in cell.steps %}
        logger.info("  Passo: {{ step.node_id }} ({{ step.component_type }})")
        {% if step.env_vars %}
        {% for env_var, default_val in step.env_vars.items() %}
        {{ env_var.lower() }} = os.getenv("{{ env_var }}", {{ default_val | tojson }})
        {% endfor %}
        {% endif %}
        {% if step.python_code %}
        {{ step.python_code | indent(8) }}
        {% endif %}
        {% if step.sql_query %}
        con.execute(\"\"\"
        {{ step.sql_query }}
        \"\"\")
        {% endif %}
        {% endfor %}
    finally:
        con.close()
    {% endif %}

{% endfor %}

# ------------------------------------------------------------------------------
# Definição da DAG e Encadeamento de Dependências das Células
# ------------------------------------------------------------------------------
with DAG(
    dag_id={{ dag_id | tojson }},
    default_args=default_args,
    description="Job orquestrado exportado do RocketDataForge: {{ pipeline_name }}",
    schedule_interval={{ schedule_interval | tojson }},
    start_date=datetime.strptime({{ start_date | tojson }}, "%Y-%m-%d"),
    catchup={{ catchup }},
    tags={{ tags | tojson }},
) as dag:

    {% for cell in cells %}
    task_{{ cell.safe_id }} = PythonOperator(
        task_id={{ cell.safe_id | tojson }},
        python_callable=execute_cell_{{ cell.safe_id }},
        dag=dag,
    )
    {% endfor %}

    # Dependências entre tarefas/células
    {% if cell_dependencies %}
    {% for dep in cell_dependencies %}
    {{ dep }}
    {% endfor %}
    {% else %}
    # Execução sem dependências declaradas
    {% endif %}
"""


class AirflowGenerator:
    """Gerador de DAGs do Apache Airflow a partir de definições de pipeline."""

    def __init__(self):
        self._jinja_env = jinja2.Environment(
            trim_blocks=True,
            lstrip_blocks=True,
            autoescape=False
        )
        self._template = self._jinja_env.from_string(AIRFLOW_DAG_TEMPLATE)

    def generate(
        self,
        pipeline: Any,
        options: Optional[AirflowOptions] = None,
        scope: Optional[str] = None
    ) -> AirflowDagBundle:
        """Compila o pipeline na DAG do Airflow."""
        opts = options or AirflowOptions()
        canonical = self._normalize_pipeline_dict(pipeline)
        metadata = canonical.get("metadata", {})
        spec = canonical.get("spec", {})
        nodes = spec.get("nodes", [])
        edges = spec.get("edges", [])
        cells = spec.get("cells", [])

        pipeline_name = metadata.get("name") or "rocketdataforge_pipeline"
        default_dag_id = metadata.get("id") or "rdf_pipeline_dag"
        dag_id = opts.dag_id or re.sub(r"\W+", "_", default_dag_id).strip("_")

        chosen_scope = scope or canonical.get("export_scope") or metadata.get("export_scope")
        if not chosen_scope:
            chosen_scope = "job" if (cells and len(cells) > 0 and not nodes) else ("cell" if nodes else "job")

        if chosen_scope == "job" and cells and len(cells) > 0:
            return self._generate_multi_cell_dag(pipeline_name, dag_id, cells, opts)

        # Tarefas
        tasks = []
        for node in nodes:
            node_id = node["id"]
            safe_id = re.sub(r"\W+", "_", node_id).strip("_")
            component = node.get("component", {})
            comp_type = component.get("type", "unknown") if isinstance(component, dict) else str(component)
            raw_config = dict(node.get("config", {}) or {})

            # Sanitização de credenciais (RNF-02)
            env_vars = {}
            for k, v in raw_config.items():
                if SENSITIVE_KEY_PATTERN.search(k) and isinstance(v, (str, int)):
                    env_key = f"{safe_id.upper()}_{k.upper()}"
                    env_vars[env_key] = ""

            sql_query = None
            if "source" in comp_type and "path" in raw_config:
                sql_query = f"SELECT * FROM read_csv('{raw_config['path']}', auto_detect=TRUE) LIMIT 10;"
            elif "target" in comp_type and "path" in raw_config:
                sql_query = f"-- Escrita para {raw_config['path']}"
            elif raw_config.get("query"):
                sql_query = raw_config["query"]

            tasks.append({
                "node_id": node_id,
                "safe_id": safe_id,
                "component_type": comp_type,
                "env_vars": env_vars,
                "sql_query": sql_query
            })

        # Dependências bitshift baseadas em arestas
        dependencies = []
        node_ids = {n["id"]: re.sub(r"\W+", "_", n["id"]).strip("_") for n in nodes}
        for edge in edges:
            src = edge.get("from", "").split(".")[0]
            dst = edge.get("to", "").split(".")[0]
            if src in node_ids and dst in node_ids:
                src_safe = node_ids[src]
                dst_safe = node_ids[dst]
                dependencies.append(f"task_{src_safe} >> task_{dst_safe}")

        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

        dag_code = self._template.render(
            dag_id=dag_id,
            pipeline_name=pipeline_name,
            generated_at=now_str,
            owner=opts.owner,
            schedule_interval=opts.schedule_interval,
            start_date=opts.start_date,
            retries=opts.retries,
            retry_delay_minutes=opts.retry_delay_minutes,
            catchup=opts.catchup,
            tags=opts.tags,
            tasks=tasks,
            dependencies=dependencies
        )

        return AirflowDagBundle(
            dag_py=dag_code,
            dag_id=dag_id,
            schedule_interval=opts.schedule_interval or "None",
            generated_at=now_str
        )

    def _generate_multi_cell_dag(
        self,
        job_name: str,
        dag_id: str,
        raw_cells: List[Dict[str, Any]],
        opts: AirflowOptions
    ) -> AirflowDagBundle:
        """Compila uma DAG de job multi-célula orquestrando as células."""
        sorted_cells = sorted(raw_cells, key=lambda c: c.get("order", 0))

        compiled_cells = []
        cell_safe_map: Dict[str, str] = {}
        cell_order_list: List[str] = []

        for idx, cell in enumerate(sorted_cells):
            cell_id = cell.get("id") or cell.get("name") or f"cell_{idx+1}"
            safe_cell_id = re.sub(r"\W+", "_", cell_id).strip("_")
            cell_safe_map[cell_id] = safe_cell_id
            cell_order_list.append(safe_cell_id)

            cell_name = cell.get("name") or cell_id
            order = cell.get("order", idx + 1)
            cell_type = str(cell.get("cell_type") or cell.get("cellType") or "CANVAS").upper()
            code_snippet = cell.get("code_snippet") or cell.get("codeSnippet") or ""

            steps = []
            for n in cell.get("nodes", []):
                data = n.get("data", {}) if "data" in n else n
                comp_type = data.get("componentType") or n.get("component", {}).get("type", "generic")
                cfg = data.get("config") or n.get("config", {})
                steps.append({
                    "node_id": n.get("id"),
                    "component_type": comp_type,
                    "env_vars": {},
                    "sql_query": f"-- Passo de {comp_type} na célula {cell_name}"
                })

            compiled_cells.append({
                "id": cell_id,
                "safe_id": safe_cell_id,
                "name": cell_name,
                "order": order,
                "cell_type": cell_type,
                "code_snippet": code_snippet,
                "steps": steps
            })

        # Cria dependências entre células
        dependencies = []
        for cell in sorted_cells:
            cell_id = cell.get("id") or cell.get("name")
            curr_safe = cell_safe_map.get(cell_id)
            preconditions = cell.get("preconditions") or []
            if preconditions:
                for pre in preconditions:
                    target_id = pre.get("target_cell_id")
                    if target_id in cell_safe_map:
                        parent_safe = cell_safe_map[target_id]
                        dependencies.append(f"task_{parent_safe} >> task_{curr_safe}")

        # Se não houver pré-condições explícitas, encadeia por ordem sequencial
        if not dependencies and len(cell_order_list) > 1:
            for i in range(len(cell_order_list) - 1):
                dependencies.append(f"task_{cell_order_list[i]} >> task_{cell_order_list[i+1]}")

        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        template = self._jinja_env.from_string(AIRFLOW_JOB_DAG_TEMPLATE)
        dag_code = template.render(
            dag_id=dag_id,
            pipeline_name=job_name,
            generated_at=now_str,
            owner=opts.owner,
            retries=opts.retries,
            retry_delay_minutes=opts.retry_delay_minutes,
            schedule_interval=opts.schedule_interval,
            start_date=opts.start_date,
            catchup=opts.catchup,
            tags=opts.tags,
            cells=compiled_cells,
            cell_dependencies=dependencies
        )

        return AirflowDagBundle(
            dag_py=dag_code,
            dag_id=dag_id,
            schedule_interval=opts.schedule_interval or "None",
            generated_at=now_str
        )

    def _normalize_pipeline_dict(self, pipeline: Any) -> Dict[str, Any]:
        """Normaliza entrada para dicionário com estrutura canonical {metadata, spec}."""
        if isinstance(pipeline, PipelineDraft):
            return pipeline.to_canonical_dict()
        elif isinstance(pipeline, PipelineVersion):
            return pipeline.immutable_definition
        elif isinstance(pipeline, dict):
            if "spec" in pipeline:
                return pipeline
            elif "nodes" in pipeline or "cells" in pipeline:
                return {
                    "metadata": {"name": pipeline.get("name", "pipeline"), "id": pipeline.get("id", "pipeline")},
                    "spec": {
                        "nodes": pipeline.get("nodes", []),
                        "edges": pipeline.get("edges", []),
                        "cells": pipeline.get("cells", [])
                    }
                }
            return {"metadata": {}, "spec": {"nodes": [], "edges": []}}
        return {"metadata": {}, "spec": {"nodes": [], "edges": []}}
