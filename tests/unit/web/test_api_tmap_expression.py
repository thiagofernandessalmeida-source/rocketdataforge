import pytest
from fastapi.testclient import TestClient
from src.core.infrastructure.web.app import app


@pytest.fixture
def client():
    return TestClient(app)


def test_validate_expression_endpoint_success(client):
    payload = {
        "expression": 'row1.age >= 18 ? "Adult" : "Minor"'
    }
    response = client.post("/api/v1/tmap/validate-expression", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert "CASE WHEN" in data["sql"]
    assert data["error"] is None


def test_validate_expression_endpoint_mixed_quotes(client):
    payload = {
        "expression": '"it\'s valid"'
    }
    response = client.post("/api/v1/tmap/validate-expression", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["sql"] == "'it''s valid'"


def test_validate_expression_endpoint_syntax_error(client):
    payload = {
        "expression": "row1.status == ? : 0"
    }
    response = client.post("/api/v1/tmap/validate-expression", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert data["sql"] is None
    assert "Parser error" in data["error"]
    assert data["position"] is not None


def test_validate_expression_endpoint_position_and_alias_check(client):
    # Rota canônica /api/v1/expressions/validate
    payload = {
        "expression": "row1.val == null ? 0 : 1",
        "alias_map": {
            "row1": {"table_ref": "tbl", "columns": {"val": "val"}}
        }
    }
    response = client.post("/api/v1/expressions/validate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert "CASE WHEN" in data["sql"]

    # Alias inexistente
    payload_bad_alias = {
        "expression": "bad_alias.val == null ? 0 : 1",
        "alias_map": {
            "row1": {"table_ref": "tbl", "columns": {"val": "val"}}
        }
    }
    res_bad = client.post("/api/v1/expressions/validate", json=payload_bad_alias)
    assert res_bad.status_code == 200
    data_bad = res_bad.json()
    assert data_bad["valid"] is False
    assert "Alias 'bad_alias'" in data_bad["error"]
    assert "row1" in data_bad["error"]

