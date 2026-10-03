"""Conector AWS Messaging (SQS Queues & SNS Topics).

Fornece integração completa com mensageria e notificações AWS Serverless:
- AWS SQS: Ingestão de mensagens (Consumer) e enfileiramento (Producer)
- AWS SNS: Publicação de eventos e notificações em tópicos Pub/Sub
"""

import json
import time
from typing import Any, Dict, List, Optional, Tuple

import boto3
import polars as pl
from botocore.config import Config
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.security.redaction import sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver


class AwsMessagingConnector:
    """Conector integrado para AWS SQS e AWS SNS utilizando boto3."""

    def __init__(self, secret_resolver: SecretResolver):
        self.secret_resolver = secret_resolver

    def _get_boto_client(self, connection: Connection, service_name: str) -> Any:
        """Instancia um cliente boto3 autenticado de forma segura."""
        region = connection.options.get("region") or connection.options.get("aws_region", "sa-east-1")
        access_key = connection.options.get("access_key_id") or connection.options.get("access_key")
        endpoint_url = connection.options.get("endpoint_url") or connection.options.get("endpoint")

        raw_secret = self.secret_resolver.resolve(connection.secret_ref) if connection.secret_ref.uri != "secret://empty" else None

        client_kwargs: Dict[str, Any] = {
            "region_name": region,
            "config": Config(connect_timeout=5, read_timeout=10, retries={"max_attempts": 2})
        }

        if access_key and raw_secret:
            client_kwargs["aws_access_key_id"] = access_key
            client_kwargs["aws_secret_access_key"] = raw_secret

        if endpoint_url and "://" in endpoint_url:
            client_kwargs["endpoint_url"] = endpoint_url

        return boto3.client(service_name, **client_kwargs)

    # ─── AWS SQS Operations ──────────────────────────────────────────

    def test_sqs_connection(self, connection: Connection) -> Tuple[bool, str, Optional[int]]:
        """Testa conectividade com AWS SQS listando atributos ou verificando a fila."""
        start_time = time.time()
        try:
            client = self._get_boto_client(connection, "sqs")
            queue_url = connection.endpoint.strip()

            if queue_url.startswith("http"):
                # Verifica se a fila existe e recupera seus atributos
                res = client.get_queue_attributes(QueueUrl=queue_url, AttributeNames=["ApproximateNumberOfMessages"])
                approx = res.get("Attributes", {}).get("ApproximateNumberOfMessages", "0")
                latency = int((time.time() - start_time) * 1000)
                return True, f"Fila SQS validada com sucesso ({approx} mensagens aproximadas).", latency
            else:
                # Se for apenas o nome da fila, tenta get_queue_url
                res = client.get_queue_url(QueueName=queue_url)
                latency = int((time.time() - start_time) * 1000)
                return True, f"Fila SQS '{queue_url}' localizada com sucesso.", latency
        except Exception as e:
            sanitized = sanitize_message(str(e))
            return False, f"Falha na conexão SQS: {sanitized}", None

    def receive_sqs_messages(
        self,
        connection: Connection,
        queue_url: str,
        max_messages: int = 10,
        wait_time_seconds: int = 2,
        delete_on_receive: bool = True
    ) -> pl.DataFrame:
        """Consome mensagens de uma fila SQS e retorna como DataFrame Polars."""
        client = self._get_boto_client(connection, "sqs")
        q_url = queue_url or connection.endpoint.strip()

        try:
            response = client.receive_message(
                QueueUrl=q_url,
                MaxNumberOfMessages=min(max_messages, 10),
                WaitTimeSeconds=wait_time_seconds,
                AttributeNames=["All"],
                MessageAttributeNames=["All"]
            )
            messages = response.get("Messages", [])
            records: List[Dict[str, Any]] = []

            for msg in messages:
                body = msg.get("Body", "")
                try:
                    payload = json.loads(body)
                    if isinstance(payload, dict):
                        row = {**payload, "_sqs_message_id": msg.get("MessageId")}
                    else:
                        row = {"body": body, "_sqs_message_id": msg.get("MessageId")}
                except (json.JSONDecodeError, TypeError):
                    row = {"body": body, "_sqs_message_id": msg.get("MessageId")}

                records.append(row)

                if delete_on_receive:
                    client.delete_message(QueueUrl=q_url, ReceiptHandle=msg.get("ReceiptHandle"))

            return pl.DataFrame(records) if records else pl.DataFrame()
        except Exception as e:
            sanitized = sanitize_message(str(e))
            raise DomainValidationError(f"Erro ao receber mensagens SQS: {sanitized}")

    def send_sqs_messages(
        self,
        connection: Connection,
        queue_url: str,
        df: pl.DataFrame,
        message_group_id: Optional[str] = None
    ) -> int:
        """Envia linhas de um DataFrame como mensagens JSON para a fila SQS."""
        if df.is_empty():
            return 0

        client = self._get_boto_client(connection, "sqs")
        q_url = queue_url or connection.endpoint.strip()
        is_fifo = q_url.endswith(".fifo")

        count = 0
        records = df.to_dicts()

        # Envia em lotes de até 10 mensagens (limite do SQS Batch API)
        for i in range(0, len(records), 10):
            chunk = records[i:i + 10]
            entries = []
            for idx, row in enumerate(chunk):
                entry: Dict[str, Any] = {
                    "Id": f"msg_{i + idx}",
                    "MessageBody": json.dumps(row, default=str)
                }
                if is_fifo:
                    entry["MessageGroupId"] = message_group_id or "default_group"
                    entry["MessageDeduplicationId"] = f"dedup_{i + idx}_{int(time.time()*1000)}"
                entries.append(entry)

            response = client.send_message_batch(QueueUrl=q_url, Entries=entries)
            successful = response.get("Successful", [])
            count += len(successful)

        return count

    # ─── AWS SNS Operations ──────────────────────────────────────────

    def test_sns_connection(self, connection: Connection) -> Tuple[bool, str, Optional[int]]:
        """Testa conectividade com AWS SNS validando o Topic ARN."""
        start_time = time.time()
        try:
            client = self._get_boto_client(connection, "sns")
            topic_arn = connection.endpoint.strip()

            if topic_arn.startswith("arn:aws:sns"):
                client.get_topic_attributes(TopicArn=topic_arn)
                latency = int((time.time() - start_time) * 1000)
                return True, f"Tópico SNS validado com sucesso: {topic_arn}", latency
            else:
                # Lista tópicos para verificar conectividade
                client.list_topics()
                latency = int((time.time() - start_time) * 1000)
                return True, "Conexão com AWS SNS estabelecida com sucesso.", latency
        except Exception as e:
            sanitized = sanitize_message(str(e))
            return False, f"Falha na conexão SNS: {sanitized}", None

    def publish_sns_messages(
        self,
        connection: Connection,
        topic_arn: str,
        df: pl.DataFrame,
        subject: Optional[str] = None
    ) -> int:
        """Publica eventos de um DataFrame para um tópico SNS."""
        if df.is_empty():
            return 0

        client = self._get_boto_client(connection, "sns")
        t_arn = topic_arn or connection.endpoint.strip()

        count = 0
        records = df.to_dicts()

        for row in records:
            client.publish(
                TopicArn=t_arn,
                Message=json.dumps(row, default=str),
                Subject=subject or "RocketDataForge Event"
            )
            count += 1

        return count
