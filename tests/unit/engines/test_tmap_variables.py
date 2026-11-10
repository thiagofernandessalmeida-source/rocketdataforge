import polars as pl
import pytest
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner
from src.core.domain.shared.exceptions import TMapExecutionError


def test_tmap_variable_invalid_expression_raises_tmap_execution_error():
    runner = DuckDBRunner()

    main_df = pl.DataFrame({
        "id": [1, 2, 3],
        "name": ["Alice", "Bob", "Charlie"]
    })

    # Variable with completely invalid syntax/expression
    variables = [{
        "name": "my_invalid_var",
        "expression": "NON_EXISTENT_FUNC(### INVALID SYNTAX",
        "type": "String"
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "val", "expression": "Var.my_invalid_var"}
        ]
    }]

    with pytest.raises(TMapExecutionError) as exc_info:
        runner.execute_tmap_transform(
            main_df=main_df,
            lookups=[],
            lookup_dfs={},
            variables=variables,
            outputs=outputs,
            node_id="tmap_test_node"
        )

    err = exc_info.value
    assert err.var_name == "my_invalid_var"
    assert "tmap_test_node" in err.message or err.node_id == "tmap_test_node"
    assert "my_invalid_var" in err.message
