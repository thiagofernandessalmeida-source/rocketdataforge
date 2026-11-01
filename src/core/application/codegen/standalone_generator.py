"""Gerador de Código Autônomo Python (Spec 006 - Fase 3 / Tarefa T-3.2).

Produz um script Python 100% autônomo, executável e auto-contido utilizando
DuckDB e Polars com templates Jinja2. Não depende do servidor RocketDataForge para rodar.
Assegura que nenhuma credencial fique em texto puro no código gerado (RNF-02).
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
import datetime
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple

import jinja2

from src.core.application.security.masking import (
    MaskingRule,
    extract_masking_rules,
    get_sql_masking_expression,
)
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.pipeline.version import PipelineVersion

SENSITIVE_KEY_PATTERN = re.compile(
    r"(password|pwd|secret|token|auth_token|api_key|private_key|key)",
    re.IGNORECASE
)


@dataclass
class StandaloneCodeBundle:
    """Bundle de exportação contendo o script Python, requirements e variáveis de ambiente."""
    script_py: str
    requirements_txt: str
    env_example: str
    pipeline_name: str
    generated_at: str


STANDALONE_TEMPLATE = """# ==============================================================================
# Pipeline Autônomo: {{ pipeline_name }}
# Gerado por: RocketDataForge Autonomous Code Engine (Spec 006)
# Data de Geração: {{ generated_at }}
#
# Modo de Uso:
#   1. Instale as dependências: pip install -r requirements.txt
#   2. Configure o arquivo .env a partir de .env.example
#   3. Execute o pipeline: python {{ script_filename }}
# ==============================================================================

import os
import sys
import time
import logging
from pathlib import Path
import duckdb
import polars as pl

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("{{ safe_pipeline_id }}")

def run_pipeline() -> None:
    logger.info("Iniciando execução do pipeline autônomo '{{ pipeline_name }}'...")
    start_time = time.perf_counter()

    # Inicialização da sessão in-memory do DuckDB
    con = duckdb.connect(database=":memory:")

    try:
        {% for step in steps %}
        # ----------------------------------------------------------------------
        # Passo {{ loop.index }}: [{{ step.node_id }}] ({{ step.component_type }})
        # ----------------------------------------------------------------------
        logger.info("Executando nó: {{ step.node_id }} ({{ step.component_type }})...")
        {% if step.env_vars %}
        # Resolução de credenciais e variáveis via ambiente (RNF-02: Zero Plaintext)
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

        duration = time.perf_counter() - start_time
        logger.info(f"Pipeline '{{ pipeline_name }}' concluído com sucesso em {duration:.3f}s!")

    except Exception as e:
        logger.error(f"Falha na execução do pipeline '{{ pipeline_name }}': {e}", exc_info=True)
        con.close()
        sys.exit(1)
    finally:
        con.close()

if __name__ == "__main__":
    run_pipeline()
"""


STANDALONE_JOB_TEMPLATE = """# ==============================================================================
# Job Autônomo Completo: {{ pipeline_name }}
# Gerado por: RocketDataForge Autonomous Code Engine (Spec 006)
# Data de Geração: {{ generated_at }}
# Total de Células: {{ cells | length }}
#
# Modo de Uso:
#   1. Instale as dependências: pip install -r requirements.txt
#   2. Configure o arquivo .env a partir de .env.example
#   3. Execute o job: python {{ script_filename }}
# ==============================================================================

import os
import sys
import time
import logging
from pathlib import Path
import duckdb
import polars as pl

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("{{ safe_pipeline_id }}")

# Dicionário de resultados das etapas para avaliação de pré-condições
cell_execution_results = {}

{% for cell in cells %}
# ==============================================================================
# Célula {{ cell.order }}: [{{ cell.id }}] - {{ cell.name }} (Tipo: {{ cell.cell_type }})
# ==============================================================================
def execute_cell_{{ cell.safe_id }}(con: duckdb.DuckDBPyConnection) -> bool:
    \"\"\"Executa a etapa '{{ cell.name }}'.\"\"\"
    logger.info(">>> Iniciando Célula: {{ cell.name }} (ID: {{ cell.id }}, Ordem: {{ cell.order }})...")
    cell_start = time.perf_counter()

    {% if cell.preconditions %}
    # Verificação de Pré-condições da Célula
    {% for pre in cell.preconditions %}
    target_status = cell_execution_results.get("{{ pre.target_cell_id }}", "NOT_FOUND")
    if target_status != "{{ pre.expected_status }}":
        logger.warning(
            f"Pré-condição não satisfeita para '{{ cell.name }}': "
            f"Célula upstream '{{ pre.target_cell_id }}' está com status '{target_status}', esperado '{{ pre.expected_status }}'."
        )
        return False
    {% endfor %}
    {% endif %}

    {% if cell.cell_type == "PYTHON" %}
    # ─── Execução de Célula Python ──────────────────────────────────────────
    {{ cell.code_snippet | indent(4) }}

    {% else %}
    # ─── Execução de Nós da Célula Canvas no DuckDB / Polars ───────────────
    {% for step in cell.steps %}
    logger.info("  [Nó: {{ step.node_id }}] ({{ step.component_type }})...")
    {% if step.env_vars %}
    # Resolução de credenciais e variáveis via ambiente (RNF-02: Zero Plaintext)
    {% for env_var, default_val in step.env_vars.items() %}
    {{ env_var.lower() }} = os.getenv("{{ env_var }}", {{ default_val | tojson }})
    {% endfor %}
    {% endif %}

    {% if step.python_code %}
    {{ step.python_code | indent(4) }}
    {% endif %}

    {% if step.sql_query %}
    con.execute(\"\"\"
    {{ step.sql_query }}
    \"\"\")
    {% endif %}
    {% endfor %}
    {% endif %}

    cell_duration = time.perf_counter() - cell_start
    logger.info(f"<<< Célula '{{ cell.name }}' concluída com sucesso em {cell_duration:.3f}s!")
    return True

{% endfor %}

def run_job() -> None:
    logger.info("Iniciando orquestração do Job autônomo '{{ pipeline_name }}' ({{ cells | length }} células)...")
    start_time = time.perf_counter()

    con = duckdb.connect(database=":memory:")

    try:
        {% for cell in cells %}
        # ----------------------------------------------------------------------
        # Execução: Célula {{ cell.order }} ({{ cell.name }})
        # ----------------------------------------------------------------------
        ok_{{ cell.safe_id }} = execute_cell_{{ cell.safe_id }}(con)
        cell_execution_results["{{ cell.id }}"] = "OK" if ok_{{ cell.safe_id }} else "FAILED"
        if not ok_{{ cell.safe_id }}:
            raise RuntimeError(f"Célula '{{ cell.name }}' falhou ou pré-condição não foi atingida.")

        {% endfor %}
        total_duration = time.perf_counter() - start_time
        logger.info(f"Job '{{ pipeline_name }}' finalizado com sucesso em {total_duration:.3f}s!")

    except Exception as e:
        logger.error(f"Falha na execução do Job '{{ pipeline_name }}': {e}", exc_info=True)
        con.close()
        sys.exit(1)
    finally:
        con.close()

def run_pipeline() -> None:
    \"\"\"Alias para compatibilidade com executores padrão.\"\"\"
    run_job()

if __name__ == "__main__":
    run_job()
"""


class StandaloneGenerator:
    """Compilador de grafos de pipeline em código Python autônomo."""

    def __init__(self):
        self._jinja_env = jinja2.Environment(
            trim_blocks=True,
            lstrip_blocks=True,
            autoescape=False
        )
        self._template = self._jinja_env.from_string(STANDALONE_TEMPLATE)

    def generate(self, pipeline: Any, scope: Optional[str] = None) -> StandaloneCodeBundle:
        """Gera o script Python autônomo, requirements.txt e .env.example."""
        canonical = self._normalize_pipeline_dict(pipeline)
        metadata = canonical.get("metadata", {})
        spec = canonical.get("spec", {})
        nodes = spec.get("nodes", [])
        edges = spec.get("edges", [])
        cells = spec.get("cells", [])

        pipeline_name = metadata.get("name") or "rocketdataforge_job"
        pipeline_id = metadata.get("id") or "job_main"
        safe_pipeline_id = re.sub(r"\W+", "_", pipeline_id).strip("_")

        chosen_scope = scope or canonical.get("export_scope") or metadata.get("export_scope")
        if not chosen_scope:
            chosen_scope = "job" if (cells and len(cells) > 0 and not nodes) else ("cell" if nodes else "job")

        if chosen_scope == "job" and cells and len(cells) > 0:
            return self._generate_multi_cell_job(pipeline_name, safe_pipeline_id, cells, metadata)

        # Ordenação topológica dos nós
        sorted_nodes = self._topological_sort(nodes, edges)

        # Mapeamento nó -> passos de execução
        steps = []
        env_vars_collected: Dict[str, str] = {}
        target_tables: Dict[str, str] = {}

        for node in sorted_nodes:
            step, node_envs = self._compile_node_step(node, edges, target_tables)
            steps.append(step)
            env_vars_collected.update(node_envs)

        # Renderização do template Jinja2
        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        script_code = self._template.render(
            pipeline_name=pipeline_name,
            safe_pipeline_id=safe_pipeline_id,
            generated_at=now_str,
            script_filename=f"{safe_pipeline_id}.py",
            steps=steps
        )

        # Geração de requirements.txt
        reqs = self._generate_requirements(nodes)

        # Geração de .env.example
        env_example = self._generate_env_example(env_vars_collected, pipeline_name)

        return StandaloneCodeBundle(
            script_py=script_code,
            requirements_txt=reqs,
            env_example=env_example,
            pipeline_name=pipeline_name,
            generated_at=now_str
        )

    def _generate_multi_cell_job(
        self,
        job_name: str,
        safe_job_id: str,
        raw_cells: List[Dict[str, Any]],
        metadata: Dict[str, Any]
    ) -> StandaloneCodeBundle:
        """Gera um script Python autônomo orquestrando todas as células do Job."""
        sorted_cells = sorted(raw_cells, key=lambda c: c.get("order", 0))

        compiled_cells = []
        all_nodes_collected: List[Dict[str, Any]] = []
        env_vars_collected: Dict[str, str] = {}
        target_tables: Dict[str, str] = {}

        for idx, cell in enumerate(sorted_cells):
            cell_id = cell.get("id") or cell.get("name") or f"cell_{idx+1}"
            safe_cell_id = re.sub(r"\W+", "_", cell_id).strip("_")
            cell_name = cell.get("name") or cell_id
            order = cell.get("order", idx + 1)
            cell_type = str(cell.get("cell_type") or cell.get("cellType") or "CANVAS").upper()
            code_snippet = cell.get("code_snippet") or cell.get("codeSnippet") or ""
            preconditions = cell.get("preconditions") or []

            cell_nodes = [self._normalize_cell_node(n) for n in cell.get("nodes", [])]
            cell_edges = [self._normalize_cell_edge(e) for e in cell.get("edges", [])]
            all_nodes_collected.extend(cell_nodes)

            steps = []
            if cell_type == "CANVAS":
                sorted_nodes = self._topological_sort(cell_nodes, cell_edges)
                for node in sorted_nodes:
                    step, node_envs = self._compile_node_step(node, cell_edges, target_tables)
                    steps.append(step)
                    env_vars_collected.update(node_envs)

            compiled_cells.append({
                "id": cell_id,
                "safe_id": safe_cell_id,
                "name": cell_name,
                "order": order,
                "cell_type": cell_type,
                "code_snippet": code_snippet,
                "preconditions": preconditions,
                "steps": steps
            })

        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        template = self._jinja_env.from_string(STANDALONE_JOB_TEMPLATE)
        script_code = template.render(
            pipeline_name=job_name,
            safe_pipeline_id=safe_job_id,
            generated_at=now_str,
            script_filename=f"{safe_job_id}.py",
            cells=compiled_cells
        )

        reqs = self._generate_requirements(all_nodes_collected)
        env_example = self._generate_env_example(env_vars_collected, job_name)

        return StandaloneCodeBundle(
            script_py=script_code,
            requirements_txt=reqs,
            env_example=env_example,
            pipeline_name=job_name,
            generated_at=now_str
        )

    def _normalize_cell_node(self, node: Dict[str, Any]) -> Dict[str, Any]:
        """Normaliza nós de célula para o formato canônico."""
        if "component" in node and isinstance(node["component"], dict):
            return node
        data = node.get("data", {})
        comp_type = data.get("componentType") or "generic"
        cfg = dict(data.get("config", {}) or {})
        if data.get("schema") and isinstance(data["schema"], list):
            cfg.setdefault("schema_definitions", data["schema"])
        return {
            "id": node.get("id"),
            "component": {"type": comp_type, "version": data.get("componentVersion", "1.0.0")},
            "config": cfg
        }

    def _normalize_cell_edge(self, edge: Dict[str, Any]) -> Dict[str, Any]:
        """Normaliza arestas de célula para o formato canônico."""
        if "from" in edge and "to" in edge:
            return edge
        from_node = edge.get("source", "")
        from_port = (
            edge.get("data", {}).get("flowName") or
            edge.get("label") or
            edge.get("sourceHandle") or
            "main"
        )
        to_node = edge.get("target", "")
        to_port = edge.get("targetHandle") or (edge.get("data", {}).get("flowType") == "lkp" and "lookup") or "input"
        return {
            "id": edge.get("id"),
            "from": f"{from_node}.{from_port}" if from_port else from_node,
            "to": f"{to_node}.{to_port}" if to_port else to_node
        }

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

    def _topological_sort(self, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Ordena os nós respeitando as dependências do DAG."""
        node_map = {n["id"]: n for n in nodes}
        adj = defaultdict(list)
        in_degree = {n["id"]: 0 for n in nodes}

        for edge in edges:
            src = edge.get("from", "").split(".")[0]
            dst = edge.get("to", "").split(".")[0]
            if src in node_map and dst in node_map:
                adj[src].append(dst)
                in_degree[dst] = in_degree.get(dst, 0) + 1

        queue = deque([n_id for n_id, deg in in_degree.items() if deg == 0])
        ordered_ids = []

        while queue:
            curr = queue.popleft()
            ordered_ids.append(curr)
            for neighbor in adj[curr]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # Se houver nós restantes (caso de ciclos ou desconexos)
        for n_id in node_map:
            if n_id not in ordered_ids:
                ordered_ids.append(n_id)

        return [node_map[nid] for nid in ordered_ids if nid in node_map]

    def _compile_node_step(
        self,
        node: Dict[str, Any],
        edges: List[Dict[str, Any]],
        target_tables: Dict[str, str]
    ) -> Tuple[Dict[str, Any], Dict[str, str]]:
        """Compila um nó do grafo em um passo executável com SQL ou Python."""
        node_id = node["id"]
        safe_id = re.sub(r"\W+", "_", node_id).strip("_")
        component = node.get("component", {})
        comp_type = component.get("type", "unknown") if isinstance(component, dict) else str(component)
        raw_config = dict(node.get("config", {}) or {})

        # Identifica nós upstream que apontam para este nó
        upstream_nodes = [
            e.get("from", "").split(".")[0]
            for e in edges
            if e.get("to", "").split(".")[0] == node_id
        ]
        upstream_table = target_tables.get(upstream_nodes[0]) if upstream_nodes else None

        # Sanitiza credenciais e parâmetros sensíveis (RNF-02)
        env_vars = {}
        sanitized_config = {}
        for k, v in raw_config.items():
            if SENSITIVE_KEY_PATTERN.search(k) and isinstance(v, (str, int)):
                env_key = f"{safe_id.upper()}_{k.upper()}"
                env_vars[env_key] = ""  # Não expõe o segredo
                sanitized_config[k] = f'os.getenv("{env_key}", "")'
            else:
                sanitized_config[k] = v

        step = {
            "node_id": node_id,
            "component_type": comp_type,
            "env_vars": env_vars,
            "sql_query": None,
            "python_code": None
        }

        view_name = f"view_{safe_id}"
        target_tables[node_id] = view_name

        # Extrai regras de mascaramento se houverem
        masking_rules = extract_masking_rules(raw_config)

        # 1. Componentes de Arquivo (Origem)
        if comp_type in ("core.file.source", "connector.file.csv", "connector.file.parquet", "connector.file.json"):
            path = raw_config.get("path", "")
            fmt = str(raw_config.get("format", "csv")).lower()

            # Se houver regras de mascaramento, projeta com as expressões
            if masking_rules:
                mask_cols_sql = []
                schema = raw_config.get("schema") or raw_config.get("schema_definitions") or []
                all_cols = [c["name"] for c in schema if isinstance(c, dict) and "name" in c]
                rule_objs = [
                    MaskingRule(r["column_name"], r["masking_type"], salt=r.get("salt"))
                    for r in masking_rules
                ]
                rule_map = {r.column_name: r for r in rule_objs}

                if all_cols:
                    for col in all_cols:
                        if col in rule_map:
                            expr = get_sql_masking_expression(col, rule_map[col])
                            mask_cols_sql.append(f'{expr} AS "{col}"')
                        else:
                            mask_cols_sql.append(f'"{col}"')
                    projection_sql = ", ".join(mask_cols_sql)
                else:
                    projection_sql = "*"

                if fmt in ("parquet", "pq"):
                    step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS SELECT {projection_sql} FROM read_parquet('{path}');"
                else:
                    step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS SELECT {projection_sql} FROM read_csv('{path}', auto_detect=TRUE);"
            else:
                if fmt in ("parquet", "pq"):
                    step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{path}');"
                else:
                    step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_csv('{path}', auto_detect=TRUE);"

        # 2. Componentes de Arquivo (Destino)
        elif comp_type in ("core.file.target", "connector.file.target"):
            path = raw_config.get("path", "")
            fmt = str(raw_config.get("format", "parquet")).lower()
            source_view = upstream_table or "view_previous"

            # Garante que o diretório pai existe
            step["python_code"] = (
                f"out_path = Path({path!r})\n"
                f"out_path.parent.mkdir(parents=True, exist_ok=True)\n"
            )

            if fmt in ("parquet", "pq"):
                step["sql_query"] = f"COPY {source_view} TO '{path}' (FORMAT PARQUET);"
            else:
                step["sql_query"] = f"COPY {source_view} TO '{path}' (FORMAT CSV, HEADER);"

        # 3. Componentes DuckDB Source
        elif comp_type in ("core.duckdb.source", "connector.db.duckdb"):
            query = raw_config.get("query") or f"SELECT * FROM {raw_config.get('table', 'my_table')}"
            step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS {query};"

        # 4. Componentes de Banco Relacional (PostgreSQL / Oracle / MySQL)
        elif "postgres" in comp_type or "oracle" in comp_type or "mysql" in comp_type:
            host = raw_config.get("host", "localhost")
            port = raw_config.get("port", 5432)
            db = raw_config.get("database", "db")
            user = raw_config.get("username", "user")
            query = raw_config.get("query") or "SELECT 1"

            env_vars[f"{safe_id.upper()}_HOST"] = host
            env_vars[f"{safe_id.upper()}_PORT"] = str(port)
            env_vars[f"{safe_id.upper()}_DB"] = db
            env_vars[f"{safe_id.upper()}_USER"] = user
            env_vars[f"{safe_id.upper()}_PASSWORD"] = ""

            step["python_code"] = (
                f"# Conexão segura via variáveis de ambiente\n"
                f"db_host = os.getenv('{safe_id.upper()}_HOST', {host!r})\n"
                f"db_port = os.getenv('{safe_id.upper()}_PORT', {str(port)!r})\n"
                f"db_user = os.getenv('{safe_id.upper()}_USER', {user!r})\n"
                f"db_pass = os.getenv('{safe_id.upper()}_PASSWORD', '')\n"
                f"db_name = os.getenv('{safe_id.upper()}_DB', {db!r})\n"
                f"# Registra view placeholder / simulação para conector\n"
            )
            step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS {query};"

        # 5. Transformação tMap / SQL Genérica
        elif comp_type in ("core.tmap", "core.transform.sql"):
            query = raw_config.get("query")
            if not query:
                src_views = [target_tables[u] for u in upstream_nodes if u in target_tables]
                primary_view = src_views[0] if src_views else "view_main"
                query = f"SELECT * FROM {primary_view}"
            step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS {query};"

        # 6. Fallback Genérico
        else:
            source_view = upstream_table or "view_input"
            step["sql_query"] = f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM {source_view};"

        return step, env_vars

    def _generate_requirements(self, nodes: List[Dict[str, Any]]) -> str:
        """Gera as dependências mínimas necessárias no requirements.txt."""
        reqs = ["duckdb>=1.1.0", "polars>=1.8.0", "pyarrow>=14.0.0"]
        for node in nodes:
            comp_type = str(node.get("component", {}).get("type", ""))
            if "postgres" in comp_type:
                reqs.append("psycopg2-binary>=2.9.0")
            elif "oracle" in comp_type:
                reqs.append("oracledb>=2.0.0")
        return "\n".join(sorted(set(reqs))) + "\n"

    def _generate_env_example(self, env_vars: Dict[str, str], pipeline_name: str) -> str:
        """Gera o arquivo de exemplo .env.example para configuração de credenciais."""
        lines = [
            f"# Variáveis de Ambiente para o Pipeline '{pipeline_name}'",
            "# Copie este arquivo para .env e preencha com suas credenciais seguras.",
            ""
        ]
        if not env_vars:
            lines.append("# Este pipeline não requer variáveis de ambiente adicionais.")
        else:
            for k, default_val in sorted(env_vars.items()):
                if "PASS" in k or "SECRET" in k or "TOKEN" in k:
                    lines.append(f"{k}=")
                else:
                    lines.append(f"{k}={default_val}")
        lines.append("")
        return "\n".join(lines)
