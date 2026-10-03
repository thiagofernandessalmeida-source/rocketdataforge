"""Testes unitários dos novos conectores: ScyllaDB, Kafka e AWS Messaging (SQS / SNS)."""

import pytest
import polars as pl
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.connectors.scylla_connector import ScyllaConnector
from src.core.infrastructure.connectors.kafka_connector import KafkaConnector
from src.core.infrastructure.connectors.aws_messaging_connector import AwsMessagingConnector
from src.core.infrastructure.security.secret_resolver import SecretResolver


def test_scylla_connector_parse_endpoint():
    resolver = SecretResolver(custom_env={"SCYLLA_PASS": "scylla123"})
    connector = ScyllaConnector(resolver)

    conn = Connection(
        id="conn-scylla",
        project_id="p1",
        name="Scylla Cluster",
        connector_type="scylla",
        endpoint="10.0.0.1,10.0.0.2:9042/analytics",
        secret_ref=SecretReference("secret://env/SCYLLA_PASS"),
        options={"user": "scylla_admin"}
    )

    hosts, port, keyspace = connector.parse_endpoint(conn)
    assert hosts == ["10.0.0.1", "10.0.0.2"]
    assert port == 9042
    assert keyspace == "analytics"


def test_scylla_connector_uses_asyncio_connection():
    import sys
    resolver = SecretResolver()
    connector = ScyllaConnector(resolver)

    cluster = connector._create_cluster(hosts=["127.0.0.1"], port=9042)
    assert cluster is not None
    if sys.platform == "win32" or sys.version_info >= (3, 12):
        from cassandra.io.asyncioreactor import AsyncioConnection
        assert cluster.connection_class == AsyncioConnection


def test_kafka_connector_parse_bootstrap():
    resolver = SecretResolver()
    connector = KafkaConnector(resolver)

    conn = Connection(
        id="conn-kafka",
        project_id="p1",
        name="Kafka Prod",
        connector_type="kafka",
        endpoint="kafka1:9092, kafka2:9093",
        secret_ref=SecretReference("secret://empty"),
        options={"group_id": "test_grp"}
    )

    servers = connector.parse_bootstrap_servers(conn)
    assert servers == [("kafka1", 9092), ("kafka2", 9093)]


def test_aws_messaging_connector_sqs_connection_format():
    resolver = SecretResolver(custom_env={"AWS_SECRET": "testsecret"})
    connector = AwsMessagingConnector(resolver)

    conn = Connection(
        id="conn-sqs",
        project_id="p1",
        name="AWS SQS Queue",
        connector_type="aws_sqs",
        endpoint="https://sqs.sa-east-1.amazonaws.com/123456789012/my-queue",
        secret_ref=SecretReference("secret://env/AWS_SECRET"),
        options={"access_key_id": "AKIAIOSFODNN7EXAMPLE", "region": "sa-east-1"}
    )

    # Verifica se o cliente boto3 é instanciado sem erro de sintaxe
    client = connector._get_boto_client(conn, "sqs")
    assert client is not None
