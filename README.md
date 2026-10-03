# 🚀 RocketDataForge: Visual Data Engineering Studio

Plataforma unificada para engenharia e processamento de dados em alto desempenho, combinando modelagem visual em grafos acíclicos dirigidos (DAG), compilação determinística em 4 estágios, execução local híbrida com **DuckDB** e **Polars**, e observabilidade em tempo real com **OpenTelemetry**.

Construído sob a metodologia **Spec-Driven Development (SDD / SPEC-KIT)** com separação estrita de camadas (Clean DDD), isolamento declarativo de layout e garantia inegociável de **zero credenciais confidenciais em texto puro**.

---

## 🏛️ Arquitetura em Camadas (Clean DDD)

O RocketDataForge segue estritamente os princípios de Domain-Driven Design e Inversão de Dependências:

```
┌──────────────────────────────────────────────────────────────┐
│       UI Designer (React 18 + Vite + React Flow + CSS)        │
└──────────────────────────────┬───────────────────────────────┘
                               │ REST API (OpenAPI 3.1)
┌──────────────────────────────▼───────────────────────────────┐
│     Control Plane (FastAPI + Pydantic v2 + OpenTelemetry)     │
└──────┬───────────────────────┬───────────────────────────────┘
       │                       │
┌──────▼──────────────┐ ┌──────▼───────────────────────────────┐
│ Application Service │ │   Compilador em 4 Estágios           │
│ - Metadata Inferer  │ │   1. GraphValidator (Kahn DAG)       │
│ - PipelineExporter  │ │   2. LogicalPlanner                  │
│ - ExecutionManager  │ │   3. PlanOptimizer (Rule Pushdown)   │
└──────┬──────────────┘ │   4. PhysicalPlanner (Chunking)      │
       │                └──────┬───────────────────────────────┘
┌──────▼───────────────────────▼───────────────────────────────┐
│                Pure Domain (Zero Frameworks)                 │
│ PipelineDraft, PipelineVersion, Connection, Execution, FSM   │
└──────────────────────────────┬───────────────────────────────┘
                               │ Inversão de Controle
┌──────────────────────────────▼───────────────────────────────┐
│             Infrastructure & Execution Engines               │
│ - DuckDB Runner (Joins & SQL Relacional)                     │
│ - Polars Runner (Filtros Vetoriais & Projeções)              │
│ - LocalFileConnector (CSV, Parquet, JSON streaming chunks)   │
│ - SqlAlchemy Repositories (PostgreSQL / SQLite In-Memory)    │
│ - OpenTelemetry Tracing & Metrics Provider                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 📦 Fases Implementadas (Vertical Slice 001)

| Fase | Descrição | Módulos & Artefatos |
| :--- | :--- | :--- |
| **Fase 1** | **Domínio Puro (DDD)** | `Node`, `Edge`, `PipelineDraft`, `PipelineVersion`, `Connection`, `Execution`, `ExecutionStatus` (FSM) |
| **Fase 2** | **Compilador 4 Estágios** | `GraphValidator` (Kahn DAG), `LogicalPlanner`, `PlanOptimizer` (Pushdown), `PhysicalPlanner` |
| **Fase 3** | **Conectores & Inferência** | Catálogo dos 7 componentes canônicos, `LocalFileConnector`, `PostgresConnector`, `SchemaInferer`, `SecretResolver` |
| **Fase 4** | **Motores de Execução** | `DuckDBRunner`, `PolarsRunner`, `CancellationToken` (cooperativo), `ExecutionWorker` (streaming chunks) |
| **Fase 5** | **Persistência de Metadados** | Modelos SQLAlchemy 2.0, `SqlAlchemyPipelineRepository`, `ExecutionRepository`, `ArtifactStore` |
| **Fase 6** | **API REST & Exportador** | FastAPI Control Plane (`/workspaces`, `/pipelines`, `/executions`), `PipelineExporter` (`pipeline.yaml` + `layout.json`), OTel |
| **Fase 7** | **Frontend Designer Visual** | React Flow Canvas, nós customizados com portas tipadas, painel de propriedades, editor de schema, console de execução |
| **Fase 8** | **Garantia & Testes E2E** | Suíte integrada unitária e de ponta a ponta (`tests/e2e/test_vertical_slice_e2e.py`) |

---

## 🛠️ Início Rápido (Quickstart)

### 1. Pré-Requisitos
- Python 3.11+
- Node.js 20+ e npm

### 2. Executando o Backend (API REST)

```bash
# Instalar dependências
pip install -r requirements.txt

# Iniciar o servidor FastAPI
python -m src.core.infrastructure.web.main
```
- **Documentação Interativa (Swagger):** `http://localhost:8000/docs`
- **Health Check:** `http://localhost:8000/api/v1/health`

### 3. Executando o Frontend (Studio Visual)

Em um novo terminal:
```bash
cd ui
npm install
npm run dev
```
- **Interface Gráfica do Studio:** `http://localhost:5173`

---

## 🔒 Princípio de Zero Segredos em Texto Puro

O RocketDataForge implementa segurança defensiva de primeiro nível:
- Nenhuma credencial confidencial (senhas, tokens, api keys) é aceita em texto puro nos endpoints ou arquivos declarativos.
- Todas as credenciais utilizam obrigatoriamente a abstração `SecretReference` no formato `secret://provider/chave` (ex: `secret://env/POSTGRES_PWD`).
- Sanitização automática de logs e mensagens de erro via `src.core.infrastructure.security.redaction`.

---

## 📄 Especificações do SPEC-KIT

Todos os contratos normativos, ADRs e especificações técnicas estão documentados e versionados em:
- [Constituição do Projeto](specs/000-foundation/constitution.md)
- [Especificação de Requisitos da Vertical Slice](specs/001-vertical-slice/spec.md)
- [Contrato OpenAPI 3.1](specs/001-vertical-slice/contracts/openapi.yaml)
- [Schema Declarativo de Pipeline (YAML)](specs/001-vertical-slice/contracts/pipeline.schema.json)
- [Schema Visual de Layout (JSON)](specs/001-vertical-slice/contracts/layout.schema.json)
- [Backlog e Rastreabilidade de Tarefas](specs/001-vertical-slice/tasks.md)
- [Arquitetura C4 (Contexto, Containers, Componentes)](docs/c4/)
- [Estratégia de Testes](docs/testing-strategy.md)
- [Modelo de Ameaças de Segurança (STRIDE)](docs/security-threat-model.md)
