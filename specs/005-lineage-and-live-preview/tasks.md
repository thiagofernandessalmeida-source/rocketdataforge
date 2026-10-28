# Implementation Tasks: 005-lineage-and-live-preview

---

## Fase 1: Extrator de Column Lineage
- [x] **T-1.1:** [TEST] Criar testes unitários em `tests/unit/compiler/test_lineage_extractor.py` cobrindo pass-through, transformações e lookups.
- [x] **T-1.2:** [CODE] Implementar `LineageExtractor` em `src/core/application/compiler/lineage/lineage_extractor.py`.
- [x] **T-1.3:** [CODE] Criar endpoint REST `GET /api/v1/pipelines/{id}/lineage` no router de pipelines.

## Fase 2: Poda de Sub-DAG (Run to Node)
- [x] **T-2.1:** [TEST] Criar teste em `tests/unit/compiler/test_subdag_pruning.py` validando que apenas nós a montante são selecionados.
- [x] **T-2.2:** [CODE] Implementar `build_subdag` em `src/core/application/compiler/logical_planner.py`.
- [x] **T-2.3:** [CODE] Adicionar suporte à rota `POST /api/v1/executions/partial` com target node.

## Fase 3: Cache de Preview & API de Consulta
- [x] **T-3.1:** [TEST] Criar teste em `tests/unit/engines/test_preview_cache.py` validando paginação e expiração de cache DuckDB.
- [x] **T-3.2:** [CODE] Implementar armazenamento e paginação de prévias no `duckdb_runner.py`.
- [x] **T-3.3:** [CODE] Criar rota `GET /api/v1/executions/{id}/nodes/{node_id}/preview`.

## Fase 4: Interface e Visualização (Frontend)
- [x] **T-4.1:** [UI] Adicionar botão de contexto "Executar até este nó" no menu de nós do ReactFlow.
- [x] **T-4.2:** [UI] Implementar gaveta `DataPreviewDrawer.tsx` com paginação virtualizada e seleção de portas.
- [x] **T-4.3:** [UI] Implementar destaque visual de arestas e nós ao inspecionar a linhagem de uma coluna no schema.
