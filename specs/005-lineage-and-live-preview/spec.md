# Feature Specification: 005-lineage-and-live-preview

**Status:** Ready for Implementation
**Data:** 27 de Outubro de 2026
**Autor:** RocketDataForge Core Team
**Escopo:** Column-Level Data Lineage via AST, Execução Parcial (Run to this node) e Live Preview Interativo com Paginação Virtualizada.

---

## 1. Visão Geral e Problema

À medida que os pipelines se tornam mais complexos no RocketDataForge:
1. **Opacidade nas Transformações:** É difícil rastrear a origem exata de um campo de saída que atravessou múltiplos lookups, cálculos e projeções.
2. **Ciclo Lento de Feedback:** Para validar uma alteração em um componente intermediário, o usuário precisa rodar o job completo ou recriar o cenário manualmente.
3. **Falta de Inspeção Visual Imediata:** Não há como visualizar as linhas produzidas em tempo real diretamente sobre o Canvas.

---

## 2. Requisitos Funcionais

### RF-01: Column-Level Data Lineage (Rastreabilidade de Colunas)
- **RF-01.1:** O compilador deve inspecionar a AST de expressões (`src/core/application/compiler/expressions/`) para mapear dependências diretas e indiretas de cada coluna:
  - Origem da coluna: `{ source_node_id, source_port, source_column_name }`.
  - Destino da coluna: `{ target_node_id, target_port, target_column_name }`.
  - Tipo de transformação: direta (`PASSTHROUGH`), computada (`EXPRESSION`), lookup (`LOOKUP_MATCH`).
- **RF-01.2:** Exposição de rota `GET /api/v1/pipelines/{id}/lineage?column={name}&node_id={nodeId}` devolvendo o sub-grafo de linhagem.
- **RF-01.3 (UI):** Ao clicar em uma coluna no painel de schema, o Canvas deve destacar visualmente as arestas e nós que contribuem para aquele campo.

### RF-02: Execução Parcial ("Run to this node")
- **RF-02.1:** Capacidade de selecionar qualquer nó do Canvas e solicitar a execução até aquele ponto.
- **RF-02.2:** O `logical_planner.py` deve realizar poda de DAG (*sub-DAG pruning*), executando apenas os nós a montante (upstream) necessários para produzir a saída daquele componente.
- **RF-02.3:** O resultado do nó alvo deve ser armazenado em cache de sessão (`_rdf_preview_cache_{node_id}`) para evitar reprocessamento imediato.

### RF-03: Live Preview Interativo no Canvas
- **RF-03.1:** Gaveta inferior interativa no Canvas (`DataPreviewDrawer.tsx`) exibindo a prévia dos dados paginada (tamanho de página: 50/100/500 linhas) via tabela virtualizada.
- **RF-03.2:** Seletor de portas de saída (ex: `out1`, `reject`, `lookup_unmatched`).
- **RF-03.3:** Filtro rápido de pesquisa textual e ordenação local por coluna na prévia.

---

## 3. Requisitos Não Funcionais

- **RNF-01:** O cálculo do Column Lineage deve ser realizado em memória em menos de 100ms para DAGs de até 50 nós.
- **RNF-02:** O cache de preview em disco deve expirar automaticamente após 1 hora de inatividade.
