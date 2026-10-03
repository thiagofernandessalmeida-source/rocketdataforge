# Pesquisa Técnica e Validação de Tecnologias: Vertical Slice 001

**Documento:** `specs/001-vertical-slice/research.md`  
**Versão:** 1.0.0  
**Status:** Aprovado  

---

## 1. Escolha de Engines de Execução Local: DuckDB e Polars

### 1.1 DuckDB: Motor Relacional Vectorizado
- **Função Principal:** Execução de consultas SQL, leitura direta de bancos relacionais (PostgreSQL via driver nativo ou Arrow), junções complexas (`Join`) e agregações com mecanismo nativo de *spill-to-disk*.
- **Vantagens Comprovadas:**
  - Suporta consultas analíticas sem exigir materialização completa em memória.
  - Leitura nativa e paralela de arquivos Parquet e CSV via queries otimizadas (`read_parquet`, `read_csv_auto`).
  - Interoperabilidade zero-copy com Apache Arrow e Polars.
- **Papel no Slice 001:** Utilizado como engine prioritária quando o pipeline envolve nós relacionais com pushdown de SQL e operações de `Join` entre fontes heterogêneas.

### 1.2 Polars: Motor de Streaming em DataFrames
- **Função Principal:** Transformações tabulares velozes (`Select`, `Filter`, derivações de colunas) e leitura/escrita em streaming de arquivos.
- **Vantagens Comprovadas:**
  - API preguiçosa (`LazyFrame`) que constrói um plano lógico e físico de otimização de expressões antes da execução real.
  - Suporte nativo ao modo `streaming=True`, permitindo processamento em chunks de arquivos que excedem a memória física da máquina de desenvolvimento.
  - Desempenho de 5 a 15 vezes superior ao Pandas, com uso de memória significativamente menor.
- **Papel no Slice 001:** Utilizado para transformações em memória e streaming de arquivos CSV/Parquet locais.

### 1.3 Matriz de Decisão: DuckDB vs Polars

| Critério | DuckDB | Polars | Decisão no Slice 001 |
| :--- | :--- | :--- | :--- |
| **SQL & Dialetos** | Nativo completo | Subconjunto básico | **DuckDB** para nós baseados em queries |
| **Joins Heterogêneos** | Otimizador de hash join maduro | Excelente, em memória | **DuckDB** para junções entre Postgres e Arquivos |
| **Streaming de Arquivos** | Excelente com Parquet | Excelente com `collect(streaming=True)` | **Polars** para filtros e projeções de CSV/Parquet |
| **Spill to Disk** | Nativo por padrão | Parcial no modo streaming | **DuckDB** para datasets maiores que a RAM |

---

## 2. Framework Backend: FastAPI + Pydantic v2

- **Racional:**
  - Suporte assíncrono nativo (`asyncio`), essencial para operações I/O sem bloqueio e gerenciamento concorrente de workers.
  - **Pydantic v2 (Rust-based):** Serialização e validação de contratos em velocidade de linguagem nativa, garantindo tempo de resposta mínimo mesmo para definições de pipelines com centenas de nós.
  - Geração automática da especificação OpenAPI 3.1, garantindo que o contrato de frontend permaneça sempre sincronizado.

---

## 3. Canvas Visual Frontend: React Flow (@xyflow/react)

- **Racional:**
  - Biblioteca líder de mercado para construção de diagramas interativos de nós e fluxos de dados.
  - Suporte completo a **Custom Nodes** e **Multiple Handles** tipados (essencial para nós com portas `main`, `reject` e múltiplas entradas).
  - Desacoplamento perfeito entre estado de layout (coordenadas x, y gerenciadas pelo React Flow) e estado de negócio (armazenado no modelo declarativo do RocketDataForge).

---

## 4. Despacho e Fila de Execução Local

- **Opções Avaliadas:**
  1. *Celery + Redis:* Robusto, porém adiciona dependência operacional pesada de containers Redis para desenvolvedores rodando em máquinas locais.
  2. *ProcessPoolExecutor + PostgreSQL States:* O control plane despacha a execução em um processo filho dedicado ou em um loop assíncrono, mantendo o controle de estado e métricas transacionado diretamente no PostgreSQL.
- **Decisão para o Slice 001:**
  - Implementar o `WorkerPort` com um despachante de processos locais (`SubprocessExecutionWorker` / `AsyncExecutionDispatcher`).
  - O estado da execução é atualizado de forma atômica no PostgreSQL. O cancelamento é propagado via evento/arquivo de sinalização ou `asyncio.Event`.
  - Esta abordagem atende integralmente aos requisitos de cancelamento cooperativo e isolamento de falhas sem requerer infraestrutura externa adicional.

---

## 5. Telemetria e Observabilidade: OpenTelemetry SDK

- **Racional:**
  - Adoção direta do padrão CNCF OpenTelemetry.
  - Spans rastreiam o ciclo de vida: `compile_pipeline` -> `dispatch_execution` -> `run_task[node_id]`.
  - Métricas customizadas instrumentadas:
    - `rdf.execution.duration_seconds`
    - `rdf.node.rows_processed_total`
    - `rdf.node.rows_rejected_total`
    - `rdf.node.memory_usage_bytes`
  - Injeção obrigatória dos atributos canônicos `execution_id` e `correlation_id` em todos os registros de log estruturado (JSON).
