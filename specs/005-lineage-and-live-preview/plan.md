# Implementation Plan: 005-lineage-and-live-preview

---

## 1. Arquitetura da Solução

### 1.1 Extrator de Linhagem Baseado em AST
- Localização: `src/core/application/compiler/lineage/lineage_extractor.py`.
- A classe percorre os nós da AST do tMap e dos novos operadores (`Filter`, `Aggregate`) registrando:
  - Símbolos de entrada referenciados (`row1.col`, `lookup.field`).
  - Colunas de saída produzidas.
  - Grafo direcionado em formato NetworkX ou dicionário de adjacência serializável.

### 1.2 Poda de Sub-DAG no Planejador
- No `logical_planner.py`:
  - Adicionar método `build_subdag(target_node_id: str) -> ExecutionPlan`.
  - Realizar busca em profundidade reversa (Reverse DFS) a partir do nó alvo para coletar dependências obrigatórias.

### 1.3 Cache de Prévia e Virtualização no Frontend
- Cache temporário em DuckDB: `CREATE TABLE _preview_{node_id}_{timestamp} AS ... LIMIT 5000`.
- Frontend: `TanStack Virtual` ou `@tanstack/react-table` integrado em `ui/src/features/designer/preview/DataPreviewDrawer.tsx`.

---

## 2. Diagrama de Linhagem de Coluna

```
[ Input: orders.csv ]                [ tMap: enrich_orders ]                 [ Output: final_dw ]
┌────────────────────┐               ┌──────────────────────┐                ┌──────────────────┐
│ order_id (raw)     │ ────────────> │ id = row1.order_id   │ ─────────────> │ order_id         │
│ customer_id (raw)  │ ────────────> │ cust_id = row1.cust  │                │ customer_name    │
│ total_amount       │ ──(Expr: *0.9)│ final_val = Var.desc │ ─────────────> │ discounted_total │
└────────────────────┘               └──────────────────────┘                └──────────────────┘
```
