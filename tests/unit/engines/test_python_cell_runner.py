import polars as pl
import pytest
from src.core.infrastructure.engines.python_cell_runner import PythonCellContext, PythonCellRunner


def test_python_cell_runner_basic_execution():
    runner = PythonCellRunner()
    context = PythonCellContext(cell_id="py-01", cell_name="teste_basico")
    code = """
print("Iniciando script python...")
df = pl.DataFrame({"id": [1, 2, 3], "nome": ["A", "B", "C"]})
context.write_output(df)
print("Sucesso!")
"""
    result = runner.run(code, context)
    assert result["success"] is True
    assert "Iniciando script python..." in result["stdout"]
    assert "Sucesso!" in result["stdout"]
    assert result["rows_out"] == 3
    assert result["output_preview"] is not None
    assert result["output_preview"]["type"] == "dataframe"
    assert result["output_preview"]["rowCount"] == 3
    assert len(result["output_preview"]["sample"]) == 3


def test_python_cell_runner_state_handoff():
    runner = PythonCellRunner()

    # Etapa 1: Célula anterior produz um DataFrame
    prev_df = pl.DataFrame({"cod": [10, 20, 30], "valor": [100.0, 250.0, 50.0]})
    shared_outputs = {"canvas-cell-01": prev_df}

    # Etapa 2: Célula Python consome o output anterior e transforma
    context = PythonCellContext(
        cell_id="python-cell-02",
        cell_name="Transformacao_Python",
        shared_outputs=shared_outputs,
    )

    code = """
# Lê a saída da célula anterior
df_in = context.read_output('canvas-cell-01')

# Transforma adicionando coluna com 10% de taxa
df_out = df_in.with_columns((pl.col("valor") * 1.1).alias("valor_com_taxa"))

# Publica a saída desta célula
context.write_output(df_out)
"""
    result = runner.run(code, context)
    assert result["success"] is True

    written = context.get_written_output()
    assert isinstance(written, pl.DataFrame)
    assert "valor_com_taxa" in written.columns
    assert written["valor_com_taxa"].to_list() == pytest.approx([110.0, 275.0, 55.0])

    # Confirma que a nova saída está no shared_outputs para a próxima célula ler
    assert "python-cell-02" in shared_outputs
    assert shared_outputs["python-cell-02"] is written


def test_python_cell_runner_syntax_error():
    runner = PythonCellRunner()
    context = PythonCellContext(cell_id="py-err", cell_name="erro_sintaxe")
    code = "def invalido(:"
    result = runner.run(code, context)
    assert result["success"] is False
    assert "Erro de Sintaxe" in result["error"]


def test_python_cell_runner_runtime_error():
    runner = PythonCellRunner()
    context = PythonCellContext(cell_id="py-rt", cell_name="erro_execucao")
    code = "x = 1 / 0"
    result = runner.run(code, context)
    assert result["success"] is False
    assert "division by zero" in result["error"]
