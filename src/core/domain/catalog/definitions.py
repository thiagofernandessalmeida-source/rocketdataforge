"""Definições e contratos dos componentes do Catálogo do Slice 001."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from src.core.domain.shared.types import PortDirection, PortType, SemanticVersion


@dataclass(frozen=True)
class PortDefinition:
    """Definição de uma porta em um componente do catálogo."""
    name: str
    direction: PortDirection
    type: PortType
    required: bool = True
    description: str = ""


@dataclass(frozen=True)
class ComponentCapability:
    """Declaração de capacidades operacionais suportadas pelo componente."""
    supports_filter_pushdown: bool = False
    supports_projection_pushdown: bool = False
    supports_chunked_read: bool = False
    supports_bulk_write: bool = False


@dataclass(frozen=True)
class ComponentDefinition:
    """Contrato público e imutável de um componente."""
    type_id: str
    version: SemanticVersion
    name: str
    category: str  # "source", "transform", "target", "control"
    description: str
    ports: List[PortDefinition]
    config_schema: Dict[str, Any]
    capabilities: ComponentCapability = field(default_factory=ComponentCapability)
    base_type_id: Optional[str] = None
    constraints: Dict[str, Any] = field(default_factory=dict)


# ============================================================================
# COMPONENTES CANÔNICOS DO VERTICAL SLICE 001
# ============================================================================

DATABASE_SOURCE = ComponentDefinition(
    type_id="core.database.source",
    version=SemanticVersion(1, 0, 0),
    name="Database Source",
    category="source",
    description="Lê dados relacionais estruturados a partir de conexão de banco de dados.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET, required=False, description="Entrada opcional para fluxo de iteração"),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET, description="Fluxo principal de dados")
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "query"],
        "properties": {
            "connection_ref": {"type": "string", "description": "Nome da conexão registrada"},
            "query": {"type": "string", "description": "Consulta SQL de leitura"},
            "fetch_size": {"type": "integer", "default": 10000, "description": "Quantidade de registros recuperados por fetch de cursor (Fetch Size)"}
        }
    },
    capabilities=ComponentCapability(
        supports_filter_pushdown=True,
        supports_projection_pushdown=True,
        supports_chunked_read=True
    )
)

FILE_SOURCE = ComponentDefinition(
    type_id="core.file.source",
    version=SemanticVersion(1, 0, 0),
    name="File Source",
    category="source",
    description="Lê arquivos locais nos formatos CSV, JSON ou Parquet em streaming.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET, required=False, description="Entrada opcional para fluxo de iteração"),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET, description="Fluxo de dados lido")
    ],
    config_schema={
        "type": "object",
        "required": ["path"],
        "properties": {
            "path": {"type": "string", "description": "Caminho do arquivo de dados"},
            "format": {"type": "string", "enum": ["csv", "parquet", "json", "excel"], "default": "csv"},
            "connection_ref": {"type": "string", "description": "Conexão de storage opcional"},
            "enable_duckdb_view": {"type": "boolean", "default": False, "description": "Tratar como tabela DuckDB em memória"},
            "duckdb_query": {"type": "string", "description": "Consulta SQL DuckDB opcional sobre a view"}
        }
    },
    capabilities=ComponentCapability(
        supports_projection_pushdown=True,
        supports_chunked_read=True
    )
)

DUCKDB_SOURCE = ComponentDefinition(
    type_id="connector.db.duckdb",
    version=SemanticVersion(1, 0, 0),
    name="DuckDB Source",
    category="source",
    description="Executa consultas analíticas locais em alta velocidade com DuckDB sobre arquivos ou banco .duckdb.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET, required=False, description="Entrada opcional para fluxo de iteração"),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET, description="Fluxo de dados lido")
    ],
    config_schema={
        "type": "object",
        "required": ["query"],
        "properties": {
            "database_path": {"type": "string", "default": ":memory:", "description": "Caminho do banco DuckDB ou :memory:"},
            "query": {"type": "string", "description": "Consulta SQL analítica"},
            "read_only": {"type": "boolean", "default": True},
            "fetch_size": {"type": "integer", "default": 10000, "description": "Quantidade de registros recuperados por fetch de cursor (Fetch Size)"}
        }
    },
    capabilities=ComponentCapability(
        supports_filter_pushdown=True,
        supports_projection_pushdown=True,
        supports_chunked_read=True
    )
)

DUCKDB_TARGET = ComponentDefinition(
    type_id="connector.db.duckdb.output",
    version=SemanticVersion(1, 0, 0),
    name="DuckDB Output",
    category="target",
    description="Grava registros em banco de dados DuckDB local ou arquivo persistido com criação automática.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["table"],
        "properties": {
            "database_path": {"type": "string", "default": "data/output.duckdb"},
            "table": {"type": "string"},
            "table_action": {"type": "string", "enum": ["none", "drop_create", "create_if_not_exists", "drop_if_exists_create", "truncate", "delete_all"], "default": "none"},
            "data_action": {"type": "string", "enum": ["insert", "update", "upsert", "update_or_insert", "delete"], "default": "insert"},
            "use_batch_mode": {"type": "boolean", "default": True, "description": "Ativar escrita em lotes particionados (Batch Mode)"},
            "batch_size": {"type": "integer", "default": 10000, "description": "Tamanho do lote para escrita particionada (Batch Size)"}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True)
)

TMAP_TRANSFORM = ComponentDefinition(
    type_id="core.tmap",
    version=SemanticVersion(1, 0, 0),
    name="Data Mapper",
    category="transform",
    description="Mapeador visual avançado de dados: junções multi-lookup, variáveis intermediárias, múltiplos fluxos de saída, filtros e expressões customizadas.",
    ports=[
        PortDefinition(name="main", direction=PortDirection.INPUT, type=PortType.DATASET, description="Fluxo principal (Main)"),
        PortDefinition(name="lookup", direction=PortDirection.INPUT, type=PortType.DATASET, required=False, description="Fluxo de consulta (Lookup)"),
        PortDefinition(name="main_out", direction=PortDirection.OUTPUT, type=PortType.DATASET, description="Fluxo de saída principal"),
        PortDefinition(name="reject_out", direction=PortDirection.OUTPUT, type=PortType.REJECT, required=False, description="Fluxo de registros rejeitados")
    ],
    config_schema={
        "type": "object",
        "properties": {
            "variables": {"type": "array", "items": {"type": "object"}},
            "outputs": {"type": "array", "items": {"type": "object"}},
            "lookups": {"type": "array", "items": {"type": "object"}}
        }
    }
)

SELECT_TRANSFORM = ComponentDefinition(
    type_id="core.select",
    version=SemanticVersion(1, 0, 0),
    name="Select",
    category="transform",
    description="Projeta, reordena e renomeia colunas do dataset.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["columns"],
        "properties": {
            "columns": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Lista de colunas a serem mantidas"
            }
        }
    }
)

FILTER_TRANSFORM = ComponentDefinition(
    type_id="core.filter",
    version=SemanticVersion(1, 0, 0),
    name="Filter",
    category="transform",
    description="Filtra registros a partir de uma expressão booleana.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET, description="Registros aprovados"),
        PortDefinition(name="reject", direction=PortDirection.OUTPUT, type=PortType.REJECT, required=False, description="Registros reprovados")
    ],
    config_schema={
        "type": "object",
        "required": ["expression"],
        "properties": {
            "expression": {"type": "string", "description": "Expressão booleana (ex: status == 'ACTIVE')"}
        }
    }
)

JOIN_TRANSFORM = ComponentDefinition(
    type_id="core.join",
    version=SemanticVersion(1, 0, 0),
    name="Join",
    category="transform",
    description="Realiza junção relacional entre dois fluxos de dados.",
    ports=[
        PortDefinition(name="left", direction=PortDirection.INPUT, type=PortType.DATASET),
        PortDefinition(name="right", direction=PortDirection.INPUT, type=PortType.DATASET),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["type", "left_on", "right_on"],
        "properties": {
            "type": {"type": "string", "enum": ["inner", "left", "right", "full"], "default": "inner"},
            "left_on": {"type": "array", "items": {"type": "string"}},
            "right_on": {"type": "array", "items": {"type": "string"}}
        }
    }
)

DATABASE_TARGET = ComponentDefinition(
    type_id="core.database.target",
    version=SemanticVersion(1, 0, 0),
    name="Database Target",
    category="target",
    description="Grava dados em banco relacional (PostgreSQL, MySQL, Oracle, etc.) com ações avançadas de tabela e dados.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "table"],
        "properties": {
            "connection_ref": {"type": "string"},
            "table": {"type": "string"},
            "table_action": {"type": "string", "enum": ["none", "drop_create", "create_if_not_exists", "drop_if_exists_create", "truncate", "delete_all"], "default": "none"},
            "data_action": {"type": "string", "enum": ["insert", "update", "upsert", "update_or_insert", "delete"], "default": "insert"},
            "use_batch_mode": {"type": "boolean", "default": True, "description": "Ativar inserção/atualização agrupada em lote (Batch Mode)"},
            "batch_size": {"type": "integer", "default": 10000, "description": "Quantidade de registros por transação/lote de escrita com commit (Batch Size)"}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True)
)

FILE_TARGET = ComponentDefinition(
    type_id="core.file.target",
    version=SemanticVersion(1, 0, 0),
    name="File Target",
    category="target",
    description="Grava dados em arquivos locais (Parquet, CSV, JSON).",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["path"],
        "properties": {
            "path": {"type": "string"},
            "format": {"type": "string", "enum": ["parquet", "csv", "json"], "default": "parquet"},
            "write_mode": {"type": "string", "enum": ["append", "replace"], "default": "append"}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True)
)

SCYLLA_SOURCE = ComponentDefinition(
    type_id="connector.nosql.scylla",
    version=SemanticVersion(1, 0, 0),
    name="ScyllaDB / Cassandra Source",
    category="source",
    description="Lê dados distribuídos de alta vazão no ScyllaDB ou Cassandra via CQL.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET, required=False),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET, description="Dados lidos via CQL")
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref"],
        "properties": {
            "connection_ref": {"type": "string"},
            "query": {"type": "string", "description": "Consulta CQL (SELECT ...)"},
            "table": {"type": "string", "description": "Nome da tabela (caso query não informada)"},
            "keyspace": {"type": "string"}
        }
    },
    capabilities=ComponentCapability(supports_filter_pushdown=True, supports_chunked_read=True)
)

SCYLLA_TARGET = ComponentDefinition(
    type_id="connector.nosql.scylla.output",
    version=SemanticVersion(1, 0, 0),
    name="ScyllaDB / Cassandra Output",
    category="target",
    description="Grava registros em alta performance no ScyllaDB ou Cassandra via batches CQL.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "table"],
        "properties": {
            "connection_ref": {"type": "string"},
            "table": {"type": "string"},
            "batch_size": {"type": "integer", "default": 1000}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True)
)

KAFKA_SOURCE = ComponentDefinition(
    type_id="connector.streaming.kafka",
    version=SemanticVersion(1, 0, 0),
    name="Apache Kafka Consumer",
    category="source",
    description="Consome fluxos de eventos em tempo real a partir de tópicos Kafka.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET, required=False),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET, description="Stream de mensagens")
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "topic"],
        "properties": {
            "connection_ref": {"type": "string"},
            "topic": {"type": "string"},
            "group_id": {"type": "string"},
            "max_messages": {"type": "integer", "default": 1000}
        }
    },
    capabilities=ComponentCapability(supports_chunked_read=True)
)

KAFKA_TARGET = ComponentDefinition(
    type_id="connector.streaming.kafka.output",
    version=SemanticVersion(1, 0, 0),
    name="Apache Kafka Producer",
    category="target",
    description="Produz e publica lotes de eventos serializados em JSON em tópicos Kafka.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "topic"],
        "properties": {
            "connection_ref": {"type": "string"},
            "topic": {"type": "string"},
            "key_column": {"type": "string", "description": "Coluna para particionamento por chave"}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True)
)

AWS_SQS_SOURCE = ComponentDefinition(
    type_id="connector.cloud.aws_sqs",
    version=SemanticVersion(1, 0, 0),
    name="AWS SQS Consumer",
    category="source",
    description="Recebe mensagens de filas AWS SQS (Standard ou FIFO) com parsing JSON automático.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET, required=False),
        PortDefinition(name="main", direction=PortDirection.OUTPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "queue_url"],
        "properties": {
            "connection_ref": {"type": "string"},
            "queue_url": {"type": "string"},
            "max_messages": {"type": "integer", "default": 10},
            "wait_time_seconds": {"type": "integer", "default": 2}
        }
    },
    capabilities=ComponentCapability(supports_chunked_read=True)
)

AWS_SQS_TARGET = ComponentDefinition(
    type_id="connector.cloud.aws_sqs.output",
    version=SemanticVersion(1, 0, 0),
    name="AWS SQS Producer",
    category="target",
    description="Enfileira registros como mensagens em lotes em filas AWS SQS.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "queue_url"],
        "properties": {
            "connection_ref": {"type": "string"},
            "queue_url": {"type": "string"},
            "message_group_id": {"type": "string", "description": "Grupo para filas FIFO"}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True)
)

AWS_SNS_TARGET = ComponentDefinition(
    type_id="connector.cloud.aws_sns.output",
    version=SemanticVersion(1, 0, 0),
    name="AWS SNS Publisher",
    category="target",
    description="Dispara notificações e publica eventos em tópicos AWS SNS Pub/Sub.",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET)
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "topic_arn"],
        "properties": {
            "connection_ref": {"type": "string"},
            "topic_arn": {"type": "string"},
            "subject": {"type": "string"}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True)
)

MYSQL_AGREEMENTS = ComponentDefinition(
    type_id="connector.custom.mysql_agreements",
    version=SemanticVersion(1, 0, 0),
    name="MySQL Agreements (Restricted Target)",
    category="target",
    description="Componente corporativo derivado com Hard Constraints de lote (máximo 1000 registros).",
    ports=[
        PortDefinition(name="input", direction=PortDirection.INPUT, type=PortType.DATASET, description="Dados de acordos comerciais")
    ],
    config_schema={
        "type": "object",
        "required": ["connection_ref", "table_name"],
        "properties": {
            "connection_ref": {"type": "string", "description": "Conexão com base de acordos"},
            "table_name": {"type": "string", "description": "Nome da tabela de contratos"},
            "batch_size": {"type": "integer", "description": "Tamanho do lote para inserção"}
        }
    },
    capabilities=ComponentCapability(supports_bulk_write=True),
    base_type_id="core.database.target",
    constraints={"max_batch_size": 1000}
)

CATALOG_COMPONENTS: List[ComponentDefinition] = [
    DATABASE_SOURCE,
    FILE_SOURCE,
    DUCKDB_SOURCE,
    DUCKDB_TARGET,
    TMAP_TRANSFORM,
    SELECT_TRANSFORM,
    FILTER_TRANSFORM,
    JOIN_TRANSFORM,
    DATABASE_TARGET,
    FILE_TARGET,
    SCYLLA_SOURCE,
    SCYLLA_TARGET,
    KAFKA_SOURCE,
    KAFKA_TARGET,
    AWS_SQS_SOURCE,
    AWS_SQS_TARGET,
    AWS_SNS_TARGET,
    MYSQL_AGREEMENTS
]


def get_component_definition(type_id: str) -> ComponentDefinition:
    """Busca a definição de um componente pelo type_id."""
    for comp in CATALOG_COMPONENTS:
        if comp.type_id == type_id:
            return comp
    raise KeyError(f"Componente '{type_id}' não encontrado no catálogo.")

