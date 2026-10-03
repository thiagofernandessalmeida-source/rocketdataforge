"""Testes unitários do catálogo de componentes."""

import pytest
from src.core.domain.catalog.definitions import (
    CATALOG_COMPONENTS,
    DATABASE_SOURCE,
    DATABASE_TARGET,
    FILE_SOURCE,
    FILE_TARGET,
    FILTER_TRANSFORM,
    JOIN_TRANSFORM,
    SELECT_TRANSFORM,
    get_component_definition,
)


def test_catalog_contains_all_seven_slice_components():
    assert len(CATALOG_COMPONENTS) >= 7
    expected_types = {
        "core.database.source",
        "core.file.source",
        "core.select",
        "core.filter",
        "core.join",
        "core.database.target",
        "core.file.target"
    }
    actual_types = {c.type_id for c in CATALOG_COMPONENTS}
    assert expected_types.issubset(actual_types)


def test_get_component_definition_success():
    comp = get_component_definition("core.database.source")
    assert comp.name == "Database Source"
    assert comp.capabilities.supports_filter_pushdown is True
    assert comp.capabilities.supports_projection_pushdown is True


def test_get_component_definition_not_found():
    with pytest.raises(KeyError):
        get_component_definition("non_existent_component")


def test_ports_configuration():
    # Filter deve ter porta reject opcional
    filter_comp = get_component_definition("core.filter")
    port_names = {p.name for p in filter_comp.ports}
    assert "input" in port_names
    assert "main" in port_names
    assert "reject" in port_names

    # Join deve ter portas left e right
    join_comp = get_component_definition("core.join")
    join_ports = {p.name for p in join_comp.ports}
    assert "left" in join_ports
    assert "right" in join_ports
    assert "main" in join_ports
