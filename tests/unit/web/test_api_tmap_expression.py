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
