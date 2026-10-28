# Implementation Tasks: 004-engine-stability-data-quality

---

## Fase 1: Governança DuckDB & Cancelamento Thread-Safe
- [x] **T-1.1:** [TEST] Criar teste em `tests/unit/engines/test_duckdb_limits.py` verificando aplicação de `max_memory` e `temp_directory`.
- [x] **T-1.2:** [CODE] Implementar configuração de limites de memória e scratch em `duckdb_runner.py`.
- [x] **T-1.3:** [TEST] Criar teste em `tests/unit/execution/test_cancellation_interrupt.py` validando que `interrupt_execution` interrompe query em execução.
- [x] **T-1.4:** [CODE] Conectar registro de conexão ativa no `cancellation.py` com `conn.interrupt()`.

## Fase 2: Connection Pool Manager
- [x] **T-2.1:** [TEST] Criar teste em `tests/unit/connectors/test_pool_manager.py` testando concorrência e reaproveitamento de conexões Postgres.
- [x] **T-2.2:** [CODE] Implementar `ConnectionPoolManager` em `src/core/infrastructure/connectors/pool_manager.py`.
- [x] **T-2.3:** [CODE] Adaptar `postgres_connector.py` e `scylla_connector.py` para utilizar o pool.

## Fase 3: Componentes tFilterRow e tAggregateRow
- [x] **T-3.1:** [TEST] Criar testes unitários para `FilterOperator` (com porta reject) e `AggregateOperator` em `tests/unit/compiler/test_canonical_operators.py`.
- [x] **T-3.2:** [CODE] Implementar compilação e execução de `FilterOperator` e `AggregateOperator` em `operators.py` e `duckdb_runner.py`.
- [x] **T-3.3:** [UI] Adicionar componentes visuais no Canvas e editores de propriedades no `PropertyPanel.tsx`.

## Fase 4: Profiling Estatístico e Schema Drift
- [x] **T-4.1:** [TEST] Criar teste em `tests/unit/metadata/test_data_profiler.py` validando estatísticas (nulos, min/max, cardinalidade).
- [x] **T-4.2:** [CODE] Implementar rotina de profiling em `src/core/application/metadata/profiler.py`.
- [x] **T-4.3:** [UI] Exibir painel de métricas e alertas de Schema Drift no frontend.
