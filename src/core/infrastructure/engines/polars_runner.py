"""Motor de Execução Polars (PolarsRunner).

Executa transformações tabulares em alta velocidade com suporte a streaming em chunks.
"""

from typing import Iterator, List, Optional, Tuple

import polars as pl
from src.core.domain.shared.exceptions import DomainError


class PolarsRunner:
    """Executor de transformações em memória e streaming baseado em Polars."""

    def execute_filter(
        self,
        df: pl.DataFrame,
        expression: str,
        capture_rejects: bool = False
    ) -> Tuple[pl.DataFrame, Optional[pl.DataFrame]]:
        """Aplica filtro booleano seguro no DataFrame."""
        if not expression or not expression.strip():
            return df, (pl.DataFrame(schema=df.schema) if capture_rejects else None)

        try:
            # Avaliação segura via SQLContext do Polars
            ctx = pl.SQLContext(frames={"tbl": df})
            accepted_df = ctx.execute(f"SELECT * FROM tbl WHERE {expression}").collect()

            rejected_df = None
            if capture_rejects:
                rejected_df = ctx.execute(f"SELECT * FROM tbl WHERE NOT ({expression})").collect()

            return accepted_df, rejected_df
        except Exception as e:
            raise DomainError(
                f"Erro ao avaliar expressão de filtro '{expression}': {str(e)}",
                code="ERR_TRANSFORM_FILTER"
            )

    def execute_project(self, df: pl.DataFrame, columns: List[str]) -> pl.DataFrame:
        """Executa projeção de colunas com validação de existência."""
        if not columns:
            return df

        missing = [c for c in columns if c not in df.columns]
        if missing:
            raise DomainError(
                f"Colunas não encontradas no dataset para projeção: {missing}. Colunas disponíveis: {df.columns}",
                code="ERR_TRANSFORM_PROJECT"
            )

        return df.select(columns)

    def filter_stream(
        self,
        chunks: Iterator[pl.DataFrame],
        expression: str,
        on_chunk_processed: Optional[callable] = None
    ) -> Iterator[Tuple[pl.DataFrame, Optional[pl.DataFrame]]]:
        """Aplica filtro sobre um fluxo de chunks sucessivos."""
        for chunk in chunks:
            accepted, rejected = self.execute_filter(chunk, expression, capture_rejects=True)
            if on_chunk_processed:
                on_chunk_processed(chunk.height, accepted.height, rejected.height if rejected else 0)
            yield accepted, rejected

    def project_stream(
        self,
        chunks: Iterator[pl.DataFrame],
        columns: List[str],
        on_chunk_processed: Optional[callable] = None
    ) -> Iterator[pl.DataFrame]:
        """Aplica projeção de colunas sobre um fluxo de chunks sucessivos."""
        for chunk in chunks:
            projected = self.execute_project(chunk, columns)
            if on_chunk_processed:
                on_chunk_processed(chunk.height, projected.height, 0)
            yield projected
