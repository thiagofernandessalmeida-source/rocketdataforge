# Plano Técnico de Arquitetura e Implementação: Vertical Slice 001

**Documento:** `specs/001-vertical-slice/plan.md`  
**Versão:** 1.0.0  
**Status:** Aprovado para Execução  

---

## 1. Visão Geral da Arquitetura do Vertical Slice

O **Vertical Slice 001** do RocketDataForge adota a arquitetura de **Modular Monolith** ([ADR-001](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L9)), separando rigorosamente o **Control Plane** (gestão, compilação e APIs) do **Data Plane / Execution Worker** (processamento de dados com DuckDB e Polars).

```text
┌───────────────────────────────────────────────────────────────┐
│                    Frontend (React + TS)                      │
│      Canvas (React Flow) │ Property Panel │ Execution Logs    │
└───────────────────────────────┬───────────────────────────────┘
                                │ HTTP / REST (OpenAPI 3.1)
┌───────────────────────────────▼───────────────────────────────┐
│                 Control Plane (FastAPI Backend)               │
│  ┌───────────────────────┐         ┌────────────────────────┐ │
│  │   Pipeline API / DTOs │         │  Compilador de Planos  │ │
│  └───────────┬───────────┘         └───────────▲────────────┘ │
│              │                                 │              │
│  ┌───────────▼───────────┐         ┌───────────┴────────────┐ │
│  │   Domain Services     │────────>│   GraphValidator       │ │
│  │ (PipelineDraft, Ver)  │         │ (Topological sort/DAG) │ │
│  └───────────┬───────────┘         └────────────────────────┘ │
└──────────────┼────────────────────────────────────────────────┘
               │
               ├─────────────────────────┬──────────────────────┐
               │                         │                      │
┌──────────────▼──────────┐   ┌──────────▼──────────┐ ┌─────────▼────────────┐
│ PostgreSQL Metadata     │   │ ArtifactStore Local │ │ Local Execution      │
│ (Drafts, Versions,      │   │ (Planos compilados, │ │ Worker               │
│  Executions, Schemas)   │   │  exports temporários│ │ (DuckDB / Polars)    │
└─────────────────────────┘   └─────────────────────┘ └──────────────────────┘
```

---

## 2. Subsistema do Compilador em Quatro Estágios

O compilador é o componente central da inteligência do produto e opera em etapas sequenciais puras e testáveis:

### 2.1 Estágio 1: Validação Estrutural (`GraphValidator`)
- Recebe o dicionário serializado de nós e arestas.
- Executa a ordenação topológica (Algoritmo de Kahn) para garantir que o grafo é um **Directed Acyclic Graph (DAG)**.
- Valida se todas as portas de entrada obrigatórias de cada componente possuem arestas ativas conectadas.
- Valida se cada nó respeita seu respectivo JSON Schema de configuração.

### 2.2 Estágio 2: Geração do Plano Lógico (`LogicalPlanner`)
- Converte os nós do grafo visual em uma árvore canônica de operadores relacionais algébricos:
  - `LogicalScan(dataset, connection_ref, schema)`
  - `LogicalFilter(predicate_expression)`
  - `LogicalProject(columns, aliases)`
  - `LogicalJoin(left, right, on_condition, join_type)`
  - `LogicalSink(target_ref, write_mode)`
- O plano lógico é agnóstico a DuckDB ou Polars.

### 2.3 Estágio 3: Otimização Semântica (`PlanOptimizer`)
- Aplica um conjunto de regras de otimização idempotentes que preservam a semântica:
  - **Rule 1: PushdownProjectionRule:** Se um nó subsequente utiliza apenas um subconjunto de colunas, empurra a projeção para o `Scan` inicial, reduzindo tráfego de dados e I/O.
  - **Rule 2: PushdownFilterRule:** Se um `Filter` sucede um `DatabaseSource` cujo conector declara `supports_filter_pushdown`, transforma o predicado em cláusula `WHERE` da consulta SQL original.
- Produz o `OptimizedPlan`, gravando a justificativa detalhada de cada regra ativada.

### 2.4 Estágio 4: Geração do Plano Físico (`PhysicalPlanner`)
- Mapeia operadores otimizados para nós de execução concretos:
  - Se envolve SQL ou Join heterogêneo $\rightarrow$ `DuckDBPhysicalOperator`.
  - Se envolve streaming de arquivo CSV/Parquet $\rightarrow$ `PolarsPhysicalOperator`.
- Configura o tamanho de chunk (padrão: 10.000 linhas) e canais de streaming em memória.
- Serializa o `PhysicalPlan` em JSON canônico e registra seu hash e URI no `ArtifactStore`.

---

## 3. Subsistema de Execução Local e Worker

### 3.1 Ciclo de Vida da Execução
1. O usuário aciona `POST /api/v1/pipeline-versions/{id}/execute`.
2. A API cria o registro `Execution` no PostgreSQL com status `CREATED` e emite o evento `ExecutionRequested`.
3. O `ExecutionDispatcher` aloca a tarefa para o worker assíncrono.
4. O worker atualiza o status para `RUNNING`, cria os registros de `TaskRun` para cada nó e inicia a iteração por chunks.
5. A cada chunk processado:
   - Os contadores de telemetria (`rows_in`, `rows_out`) são incrementados.
   - O worker verifica a flag `is_cancelled` (armazenada de forma atômica).
6. Ao finalizar o último bloco:
   - O worker grava os dados no destino (`DatabaseTarget` ou `FileTarget`).
   - O status é consolidado como `SUCCEEDED` (ou `CANCELLED` / `FAILED`).
   - É emitido o evento de integração final correspondente.

---

## 4. Política de Redaction de Segredos no Runtime

- O componente `SecretResolver` é invocado unicamente dentro do worker no instante da conexão:
  ```python
  class SecretResolver:
      def resolve(self, secret_ref: SecretReference) -> str:
          # Lê variável de ambiente protegida
          ...
  ```
- O valor da credencial nunca é atribuído a variáveis de escopo global nem adicionado a payloads de telemetria.
- Todas as mensagens de erro capturadas por conectores passam pelo pipeline de sanitização (`sanitize_error_message`), que aplica regex contra strings sensíveis antes de qualquer persistência em banco ou envio ao frontend.
