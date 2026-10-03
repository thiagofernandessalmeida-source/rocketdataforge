"""Repositório SQLAlchemy para o Agregado Connection."""

from typing import List, Optional

from sqlalchemy.orm import Session
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.persistence.models import ConnectionModel


class SqlAlchemyConnectionRepository:
    """Implementação concreta de repositório de conexões usando SQLAlchemy."""

    def __init__(self, session: Session):
        self.session = session

    def save(self, connection: Connection) -> None:
        """Salva ou atualiza a conexão."""
        model = self.session.get(ConnectionModel, connection.id)
        if model is None:
            model = ConnectionModel(
                id=connection.id,
                project_id=connection.project_id,
                name=connection.name,
                connector_type=connection.connector_type,
                endpoint=connection.endpoint,
                secret_ref=connection.secret_ref.uri,
                options_json=connection.options,
                is_active=connection.is_active
            )
            self.session.add(model)
        else:
            model.name = connection.name
            model.connector_type = connection.connector_type
            model.endpoint = connection.endpoint
            model.secret_ref = connection.secret_ref.uri
            model.options_json = connection.options
            model.is_active = connection.is_active

        self.session.flush()

    def get(self, connection_id: str) -> Optional[Connection]:
        """Recupera conexão pelo ID convertendo para entidade de domínio."""
        model = self.session.get(ConnectionModel, connection_id)
        if model is None:
            return None

        return Connection(
            id=model.id,
            project_id=model.project_id,
            name=model.name,
            connector_type=model.connector_type,
            endpoint=model.endpoint,
            secret_ref=SecretReference(model.secret_ref),
            options=dict(model.options_json),
            is_active=model.is_active
        )

    def list_by_project(self, project_id: str) -> List[Connection]:
        """Lista todas as conexões de um projeto."""
        models = (
            self.session.query(ConnectionModel)
            .filter(ConnectionModel.project_id == project_id)
            .all()
        )
        return [
            Connection(
                id=m.id,
                project_id=m.project_id,
                name=m.name,
                connector_type=m.connector_type,
                endpoint=m.endpoint,
                secret_ref=SecretReference(m.secret_ref),
                options=dict(m.options_json),
                is_active=m.is_active
            )
            for m in models
        ]
