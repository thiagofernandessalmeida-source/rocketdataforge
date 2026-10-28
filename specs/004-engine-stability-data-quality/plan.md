# Implementation Plan: 004-engine-stability-data-quality

---

## 1. Arquitetura e Estrutura Técnica

### 1.1 Backend DuckDB Resource Governance
- Modificar `src/core/infrastructure/engines/duckdb_runner.py`:
  - Adicionar inicialização parametrizada:
    ```python
    conn.execute(f"SET max_memory = '{max_memory}';")
    conn.execute(f"SET temp_directory = '{temp_dir}';")
    conn.execute("SET enable_external_access = false;")
    ```
- Modificar `src/core/infrastructure/execution/cancellation.py`:
  - Mapear `active_connections: dict[str, duckdb.DuckDBPyConnection]`.
  - Método `interrupt_execution(execution_id: str)` chama `conn.interrupt()`.

### 1.2 Gerenciador de Connection Pool
- Criar `src/core/infrastructure/connectors/pool_manager.py`:
  - Gerenciamento de ciclo de vida com `psycopg_pool` para PostgreSQL.
  - Cache de `Cluster` e `Session` para ScyllaDB/Cassandra com expiração LRU.

### 1.3 Novos Operadores do Compilador
- Atualizar `src/core/application/compiler/operators.py` e `logical_planner.py`:
  - Implementar classes `FilterOperator` e `AggregateOperator`.
  - Geração de SQL otimizado para o dialeto DuckDB.

---

## 2. Diagrama de Transição de Dados e Spillover

```
[ Input Stream ] ──> [ duckdb_runner (max_memory cap) ]
                               │
                ┌──────────────┴──────────────┐
         (Em Memória < Cap)           (Spillover > Cap)
                │                             │
                ▼                             ▼
       [ In-Memory Table ]            [ Scratch Directory ]
                │                             │
                └──────────────┬──────────────┘
                               ▼
            [ Filter / Aggregate Declarativo ]
                               │
                               ▼
                     [ Clean Temporary Files ]
```
