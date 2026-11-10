"""Testes unitários dos operadores canônicos FilterOperator e AggregateOperator (Fase 3 - Spec 004)."""

import pytest
import polars as pl

from src.core.domain.shared.exceptions import DomainValidationError
from src.core.application.compiler.operators import (
    FilterCondition,
    FilterOperator,
    AggregateField,
    AggregateOperator,
)
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


# ============================================================================
# TESTES DE FilterOperator
# ============================================================================

def test_filter_operator_single_condition_sql():
    """T-3.1: Valida geração de SQL para condição simples."""
    op = FilterOperator(
        id="filter-1",
        conditions=[
            FilterCondition(column="age", operator=">=", value=18)
        ],
        logical_operator="AND"
    )

    sql_out = op.to_sql("users", port="output")
    assert 'SELECT * FROM users WHERE ("age" >= 18)' in sql_out

    sql_rej = op.to_sql("users", port="reject")
    assert 'SELECT * FROM users WHERE NOT ("age" >= 18)' in sql_rej or 'WHERE ("age" >= 18) IS NOT TRUE' in sql_rej


def test_filter_operator_multiple_conditions_and():
    """T-3.1: Valida múltiplos predicados combinados por AND."""
    op = FilterOperator(
        id="filter-2",
        conditions=[
            FilterCondition(column="status", operator="==", value="ACTIVE"),
            FilterCondition(column="salary", operator=">", value=50000),
            FilterCondition(column="deleted_at", operator="IS NULL")
        ],
        logical_operator="AND"
    )

    sql = op.to_sql("employees", port="output")
    assert 'SELECT * FROM employees WHERE ("status" = \'ACTIVE\' AND "salary" > 50000 AND "deleted_at" IS NULL)' in sql


def test_filter_operator_multiple_conditions_or():
    """T-3.1: Valida múltiplos predicados combinados por OR."""
    op = FilterOperator(
        id="filter-3",
        conditions=[
            FilterCondition(column="role", operator="==", value="ADMIN"),
            FilterCondition(column="department", operator="==", value="IT")
        ],
        logical_operator="OR"
    )

    sql = op.to_sql("staff", port="output")
    assert 'SELECT * FROM staff WHERE ("role" = \'ADMIN\' OR "department" = \'IT\')' in sql


def test_filter_operator_in_and_like():
    """T-3.1: Valida operadores IN, NOT IN, LIKE e NOT LIKE."""
    op = FilterOperator(
        id="filter-4",
        conditions=[
            FilterCondition(column="country", operator="IN", value=["BR", "US", "CA"]),
            FilterCondition(column="email", operator="LIKE", value="%@natura.com"),
            FilterCondition(column="tag", operator="NOT LIKE", value="test_%"),
            FilterCondition(column="blocked_id", operator="NOT IN", value=[10, 20])
        ],
        logical_operator="AND"
    )

    sql = op.to_sql("customers", port="output")
    assert "\"country\" IN ('BR', 'US', 'CA')" in sql
    assert "\"email\" LIKE '%@natura.com'" in sql
    assert "\"tag\" NOT LIKE 'test_%'" in sql
    assert "\"blocked_id\" NOT IN (10, 20)" in sql


def test_filter_operator_reject_port_logic():
    """T-3.1: Valida que a porta reject nega corretamente o predicado composto."""
    op = FilterOperator(
        id="filter-5",
        conditions=[
            FilterCondition(column="active", operator="==", value=True),
            FilterCondition(column="score", operator=">=", value=70)
        ],
        logical_operator="AND"
    )

    sql_rej = op.to_sql("candidates", port="reject")
    assert 'SELECT * FROM candidates WHERE NOT ("active" = true AND "score" >= 70)' in sql_rej or \
           'SELECT * FROM candidates WHERE ("active" = true AND "score" >= 70) IS NOT TRUE' in sql_rej


def test_filter_operator_duckdb_execution():
    """T-3.1: Valida execução real em DuckDB particionando output e reject."""
    runner = DuckDBRunner()
    df = pl.DataFrame({
        "id": [1, 2, 3, 4, 5],
        "name": ["Alice", "Bob", "Charlie", "David", "Eve"],
        "age": [25, 17, 30, 15, 40]
    })

    op = FilterOperator(
        id="f1",
        conditions=[FilterCondition(column="age", operator=">=", value=18)]
    )

    result = runner.execute_filter(df, op)
    assert "output" in result
    assert "reject" in result

    accepted = result["output"]
    rejected = result["reject"]

    assert accepted.height == 3
    assert accepted["id"].to_list() == [1, 3, 5]

    assert rejected.height == 2
    assert rejected["id"].to_list() == [2, 4]


# ============================================================================
# TESTES DE AggregateOperator
# ============================================================================

def test_aggregate_operator_sql_generation():
    """T-3.1: Valida geração de SQL com GROUP BY e múltiplas agregações."""
    op = AggregateOperator(
        id="agg-1",
        group_by=["department", "country"],
        aggregations=[
            AggregateField(column="id", function="COUNT", alias="total_emp"),
            AggregateField(column="salary", function="AVG", alias="avg_salary"),
            AggregateField(column="salary", function="MAX", alias="max_salary"),
            AggregateField(column="role", function="COUNT_DISTINCT", alias="unique_roles"),
            AggregateField(column="name", function="STRING_AGG", alias="emp_names", delimiter="; ")
        ]
    )

    sql = op.to_sql("employees")
    assert '"department"' in sql
    assert '"country"' in sql
    assert 'COUNT("id") AS "total_emp"' in sql
    assert 'AVG("salary") AS "avg_salary"' in sql
    assert 'MAX("salary") AS "max_salary"' in sql
    assert 'COUNT(DISTINCT "role") AS "unique_roles"' in sql
    assert "STRING_AGG(\"name\", '; ') AS \"emp_names\"" in sql
    assert 'GROUP BY "department", "country"' in sql


def test_aggregate_operator_global_without_group_by():
    """T-3.1: Valida agregação global (sem GROUP BY)."""
    op = AggregateOperator(
        id="agg-2",
        group_by=[],
        aggregations=[
            AggregateField(column="id", function="COUNT", alias="total_records"),
            AggregateField(column="amount", function="SUM", alias="sum_amount")
        ]
    )

    sql = op.to_sql("transactions")
    assert 'GROUP BY' not in sql
    assert 'COUNT("id") AS "total_records"' in sql
    assert 'SUM("amount") AS "sum_amount"' in sql


def test_aggregate_operator_detects_alias_collision():
    """T-3.1: Valida que colisão de alias entre agregações lança DomainValidationError."""
    with pytest.raises(DomainValidationError) as exc:
        AggregateOperator(
            id="agg-err",
            group_by=["dept"],
            aggregations=[
                AggregateField(column="salary", function="SUM", alias="metric"),
                AggregateField(column="bonus", function="AVG", alias="metric")
            ]
        )
    assert "conflito" in str(exc.value).lower() or "duplicad" in str(exc.value).lower()


def test_aggregate_operator_detects_group_by_collision():
    """T-3.1: Valida que alias colidindo com coluna do group_by lança DomainValidationError."""
    with pytest.raises(DomainValidationError) as exc:
        AggregateOperator(
            id="agg-err2",
            group_by=["dept"],
            aggregations=[
                AggregateField(column="salary", function="SUM", alias="dept")
            ]
        )
    assert "dept" in str(exc.value)


def test_aggregate_operator_duckdb_execution():
    """T-3.1: Valida execução real de agregação via DuckDB."""
    runner = DuckDBRunner()
    df = pl.DataFrame({
        "dept": ["IT", "IT", "HR", "HR", "IT"],
        "name": ["Alice", "Bob", "Charlie", "David", "Eve"],
        "salary": [10000, 12000, 8000, 9000, 15000]
    })

    op = AggregateOperator(
        id="agg-exec",
        group_by=["dept"],
        aggregations=[
            AggregateField(column="name", function="COUNT", alias="headcount"),
            AggregateField(column="salary", function="AVG", alias="avg_salary"),
            AggregateField(column="salary", function="MAX", alias="max_salary")
        ]
    )

    result_df = runner.execute_aggregate(df, op)
    assert result_df.height == 2
    assert "dept" in result_df.columns
    assert "headcount" in result_df.columns
    assert "avg_salary" in result_df.columns

    it_row = result_df.filter(pl.col("dept") == "IT")
    assert it_row["headcount"][0] == 3
    assert it_row["max_salary"][0] == 15000
    assert it_row["avg_salary"][0] == pytest.approx((10000 + 12000 + 15000) / 3.0)
