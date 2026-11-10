"""Motor de Execução Polars (PolarsRunner).

Executa transformações tabulares em alta velocidade com suporte a streaming em chunks.
"""

from typing import Any, Dict, Iterator, List, Optional, Tuple

import polars as pl
from src.core.domain.shared.exceptions import DomainError


def deduplicate_column_names(names: List[str]) -> List[str]:
    """Garante que a lista de nomes de colunas não contenha duplicatas, evitando erros de schema no Polars."""
    seen: Dict[str, int] = {}
    deduped: List[str] = []
    for name in names:
        base = str(name) if name is not None else "col"
        if base in seen:
            seen[base] += 1
            deduped.append(f"{base}_{seen[base]}")
        else:
            seen[base] = 0
            deduped.append(base)
    return deduped


def batch_to_polars_df(batch: List[Any], col_names: List[str]) -> pl.DataFrame:
    """Converte um lote de tuplas de cursor de banco de dados em um pl.DataFrame de forma altamente resiliente."""
    col_names = col_names or (["result"] if not batch else [f"col_{i}" for i in range(len(batch[0]))])
    deduped_cols = deduplicate_column_names(col_names)
    if not batch:
        return pl.DataFrame({c: [] for c in deduped_cols})

    # 1. Tentativa nativa de alta velocidade com inferência total
    try:
        return pl.DataFrame(batch, schema=deduped_cols, orient="row", infer_schema_length=None, strict=False)
    except Exception:
        pass

    # 2. Construção por dicionário de colunas com strict=False
    try:
        col_dict = {col: [row[i] for row in batch] for i, col in enumerate(deduped_cols)}
        return pl.DataFrame(col_dict, strict=False)
    except Exception:
        pass

    # 3. Interoperabilidade via Pandas (quando disponível)
    try:
        import pandas as pd
        pdf = pd.DataFrame(batch, columns=deduped_cols)
        return pl.from_pandas(pdf)
    except Exception:
        pass

    # 4. Fallback por séries individuais com coerção de tipos incompatíveis para string
    try:
        col_dict = {}
        for i, col in enumerate(deduped_cols):
            vals = [row[i] for row in batch]
            try:
                col_dict[col] = pl.Series(col, vals, strict=False)
            except Exception:
                col_dict[col] = pl.Series(col, [str(v) if v is not None else None for v in vals])
        return pl.DataFrame(col_dict)
    except Exception:
        pass

    # 5. Fallback final garantido
    safe_dict = {
        col: [str(row[i]) if row[i] is not None else None for row in batch]
        for i, col in enumerate(deduped_cols)
    }
    return pl.DataFrame(safe_dict)


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
