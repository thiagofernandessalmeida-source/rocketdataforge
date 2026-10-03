# Backlog de Tarefas de Implementação: Vertical Slice 001

**Documento:** `specs/001-vertical-slice/tasks.md`  
**Versão:** 1.0.0  
**Status:** Pronto para Execução  
**Rastreabilidade:** Cada tarefa mapeia para User Stories (`US-xxx`), Requisitos (`FR-xxx`/`NFR-xxx`) e Critérios de Aceite (`AC-xxx`).  

---

## Fase 1: Fundação, Domínio Puro e Value Objects

### TASK-001: Implementar Value Objects e Canonical Type System
- **Requisitos:** FR-007, NFR-007, NFR-014 | **Stories:** US-003
- **Descrição:** Implementar os Value Objects imutáveis do domínio: `EntityId` (ULID), `SemanticVersion`, `SecretReference`, `LogicalDataType` (enum canônico com 17 tipos) e `PortId`.
- **Arquivos:** `src/core/domain/shared/types.py`, `src/core/domain/shared/identifiers.py`
- **Critério de Teste:** Testes unitários validando imutabilidade, parsing de ULID e rejeição de strings inválidas em `SecretReference`.

### TASK-002: Implementar Agregado PipelineDraft
- **Requisitos:** FR-001, FR-002, FR-003 | **Stories:** US-001, US-004
- **Descrição:** Criar entidades `Node`, `Edge`, `PortBinding` e a raiz `PipelineDraft`. Implementar métodos de comando `add_node`, `connect_ports`, `disconnect_edge`, `configure_node`.
- **Arquivos:** `src/core/domain/pipeline/draft.py`, `src/core/domain/pipeline/node.py`, `src/core/domain/pipeline/edge.py`
- **Critério de Teste:** Invariantes de nó único, validação de cardinalidade de portas e mutações válidas do draft.

### TASK-003: Implementar Agregado PipelineVersion e Hash Criptográfico
- **Requisitos:** FR-024, NFR-005, NFR-006 | **Stories:** US-005, US-010
- **Descrição:** Implementar a entidade imutável `PipelineVersion`. Criar o algoritmo de hash determinístico (SHA-256) sobre a definição funcional serializada (excluindo dados visuais).
- **Arquivos:** `src/core/domain/pipeline/version.py`, `src/core/domain/pipeline/hasher.py`
- **Critério de Teste:** Dois drafts com layouts gráficos diferentes, mas mesma lógica, geram o mesmo `definition_hash`.

### TASK-004: Implementar Agregado Connection e Proteção de Segredos
- **Requisitos:** FR-005, NFR-001 | **Stories:** US-002, US-012
- **Descrição:** Implementar agregado `Connection` com validação de que senhas e credenciais jamais são aceitas em texto puro, exigindo instâncias válidas de `SecretReference`.
- **Arquivos:** `src/core/domain/metadata/connection.py`
- **Critério de Teste:** Falha ao instanciar conexão contendo chaves como `password` ou texto sem prefixo `secret://`.

### TASK-005: Implementar Agregado Execution e Máquina de Estados
- **Requisitos:** FR-013, FR-022 | **Stories:** US-007, US-008, US-009
- **Descrição:** Criar agregados `Execution` e `TaskRun`. Implementar a máquina de estados finita (`CREATED -> PLANNING -> QUEUED -> RUNNING -> SUCCEEDED/FAILED/CANCELLED`), garantindo transições válidas e idempotência no cancelamento.
- **Arquivos:** `src/core/domain/execution/execution.py`, `src/core/domain/execution/task_run.py`, `src/core/domain/execution/status.py`
- **Critério de Teste:** Transições ilegais lançam `InvalidStateTransitionError`; cancelamentos repetidos retornam estado `CANCELLED` de forma idempotente.

---

## Fase 2: Validação de Grafos e Compilação em 4 Estágios

### TASK-006: Implementar GraphValidator (DAG & Port Matching)
- **Requisitos:** FR-002, FR-010 | **Stories:** US-004
- **Descrição:** Implementar o serviço de validação estrutural do grafo: detecção de ciclos via ordenação topológica (Algoritmo de Kahn) e validação de portas desconectadas ou incompatíveis.
- **Arquivos:** `src/core/application/compiler/validator.py`
- **Critério de Teste:** Teste com ciclo A->B->C->A rejeitado com erro específico; grafo linear acíclico aprovado com sucesso.

### TASK-007: Implementar LogicalPlanner (Geração de Operadores Canônicos)
- **Requisitos:** FR-011 | **Stories:** US-006
- **Descrição:** Converter o grafo validado do draft em árvore de operadores lógicos relacionais: `LogicalScan`, `LogicalFilter`, `LogicalProject`, `LogicalJoin`, `LogicalSink`.
- **Arquivos:** `src/core/application/compiler/logical_planner.py`, `src/core/application/compiler/operators.py`
- **Critério de Teste:** Grafo com Source, Filter e Target gera o plano lógico correspondente contendo os nós algébricos equivalentes.

### TASK-008: Implementar PlanOptimizer (Pushdown Rules)
- **Requisitos:** FR-011, FR-012 | **Stories:** US-006
- **Descrição:** Desenvolver o otimizador baseado em regras com `ProjectionPushdownRule` e `FilterPushdownRule` ativadas a partir das capabilities dos nós conectados.
- **Arquivos:** `src/core/application/compiler/optimizer.py`, `src/core/application/compiler/rules/pushdown.py`
- **Critério de Teste:** Fonte com capability de filtro move o nó de filtro para a query SQL da fonte e documenta a otimização no `OptimizedPlan`.

### TASK-009: Implementar PhysicalPlanner (Seleção de Engine DuckDB / Polars)
- **Requisitos:** FR-011, FR-014 | **Stories:** US-006, US-007
- **Descrição:** Mapear o plano otimizado para o plano físico executável, definindo o motor (`DuckDB` ou `Polars`), buffers de memória e estratégia de chunks.
- **Arquivos:** `src/core/application/compiler/physical_planner.py`
- **Critério de Teste:** Planos contendo arquivos CSV/Parquet mapeados para `PolarsEngine`; consultas relacionais e joins mapeados para `DuckDBEngine`.

### TASK-010: Implementar Golden Tests para o Compilador
- **Requisitos:** NFR-005, NFR-007 | **Stories:** US-006
- **Descrição:** Criar suíte de *Golden Tests* onde definições declarativas padronizadas são compiladas e comparadas byte a byte contra planos canônicos esperados.
- **Arquivos:** `tests/golden/test_compiler_golden.py`, `tests/golden/fixtures/*.yaml`
- **Critério de Teste:** 100% de estabilidade e determinismo na saída da compilação.

---

## Fase 3: Conectores, Inferência de Schema e Redaction

### TASK-011: Implementar Catálogo de Componentes do Slice 001
- **Requisitos:** FR-004 | **Stories:** US-002
- **Descrição:** Declarar os contratos e JSON Schemas dos 7 componentes do slice: `core.database.source`, `core.file.source`, `core.select`, `core.filter`, `core.join`, `core.database.target`, `core.file.target`.
- **Arquivos:** `src/core/domain/catalog/definitions.py`, `src/core/domain/catalog/schemas/*.json`
- **Critério de Teste:** Configurações válidas e inválidas validadas contra os esquemas declarados.

### TASK-012: Implementar Conectores de Arquivos Locais (CSV, JSON, Parquet)
- **Requisitos:** FR-002, FR-014 | **Stories:** US-002, US-007
- **Descrição:** Implementar leitores e escritores para arquivos CSV, JSON e Parquet com suporte a leitura por chunks e streaming via Polars/DuckDB.
- **Arquivos:** `src/core/infrastructure/connectors/file_connector.py`
- **Critério de Teste:** Leitura e gravação de arquivos com verificação de integridade e tipos de dados.

### TASK-013: Implementar Conector PostgreSQL (Source & Target)
- **Requisitos:** FR-002, FR-016 | **Stories:** US-002, US-007
- **Descrição:** Implementar o conector de leitura e escrita para PostgreSQL, incluindo resolução segura de segredos e estratégias de escrita em lote.
- **Arquivos:** `src/core/infrastructure/connectors/postgres_connector.py`
- **Critério de Teste:** Execução de query parametrizada e gravação de registros via transação local.

### TASK-014: Implementar Serviço de Inferência de Schema
- **Requisitos:** FR-007 | **Stories:** US-003
- **Descrição:** Inspecionar fontes de dados (PostgreSQL, CSV, Parquet) por amostragem e converter tipos físicos nativos para os tipos canônicos de `LogicalDataType`.
- **Arquivos:** `src/core/application/metadata/schema_inferer.py`
- **Critério de Teste:** Inferência correta de campos inteiros, datas, decimais e strings a partir de CSV e tabelas.

### TASK-015: Implementar SecretResolver e Filtro de Redaction
- **Requisitos:** NFR-001 | **Stories:** US-012
- **Descrição:** Componente de resolução segura de segredos locais (via variáveis de ambiente) e interceptor de mensagens de log/erro para substituição de credenciais por `***REDACTED***`.
- **Arquivos:** `src/core/infrastructure/security/secret_resolver.py`, `src/core/infrastructure/security/redaction.py`
- **Critério de Teste:** Strings de conexão com senhas têm a credencial ocultada em exceptions propositais.

---

## Fase 4: Motores de Execução (DuckDB / Polars) e Worker Assíncrono

### TASK-016: Implementar DuckDB Execution Runner
- **Requisitos:** FR-013, FR-014 | **Stories:** US-007
- **Descrição:** Implementar o executor físico baseado em DuckDB, permitindo queries relacionais, joins e agregação com suporte a spill-to-disk.
- **Arquivos:** `src/core/infrastructure/engines/duckdb_runner.py`
- **Critério de Teste:** Join entre duas tabelas/arquivos executado com sucesso e retornando dataset correto.

### TASK-017: Implementar Polars Execution Runner com Streaming
- **Requisitos:** FR-013, FR-014 | **Stories:** US-007
- **Descrição:** Implementar executor de transformações baseado em Polars LazyFrame com `streaming=True`, aplicando filtros e projeções em chunks.
- **Arquivos:** `src/core/infrastructure/engines/polars_runner.py`
- **Critério de Teste:** Filtragem de 50.000 linhas em blocos sem pico de memória no processo.

### TASK-018: Implementar ExecutionWorker e Loop de Cancelamento Cooperativo
- **Requisitos:** FR-013 | **Stories:** US-007, US-009
- **Descrição:** Desenvolver o worker assíncrono que consome o plano físico, orquestra a passagem de dados entre operadores, coleta métricas em tempo real e inspeciona o sinal de cancelamento a cada chunk.
- **Arquivos:** `src/core/infrastructure/execution/worker.py`, `src/core/infrastructure/execution/dispatcher.py`
- **Critério de Teste:** Envio de sinal de cancelamento interrompe a execução no chunk atual e transita o agregado para `CANCELLED`.

---

## Fase 5: Persistência, Metadados e Repositórios PostgreSQL

### TASK-019: Configurar Modelos SQLAlchemy e Migrações (Alembic)
- **Requisitos:** FR-001, FR-003, NFR-006 | **Stories:** US-001, US-005
- **Descrição:** Mapear tabelas relacionais (`workspaces`, `projects`, `connections`, `schemas`, `pipeline_drafts`, `pipeline_versions`, `executions`, `task_runs`) com suporte a migrações determinísticas.
- **Arquivos:** `src/core/infrastructure/persistence/models.py`, `alembic/versions/*`
- **Critério de Teste:** Execução de migrações em banco de teste PostgreSQL com integridade referencial validada.

### TASK-020: Implementar Repositórios do Domínio
- **Requisitos:** NFR-007, NFR-014 | **Stories:** US-001, US-005, US-007
- **Descrição:** Implementar adaptadores para as portas de repositório: `PipelineRepository`, `ConnectionRepository`, `ExecutionRepository`.
- **Arquivos:** `src/core/infrastructure/persistence/pipeline_repository.py`, `src/core/infrastructure/persistence/execution_repository.py`
- **Critério de Teste:** Testes de integração CRUD completos e controle de concorrência com revision tracking.

### TASK-021: Implementar LocalFileSystemArtifactStore
- **Requisitos:** FR-011, NFR-002 | **Stories:** US-006
- **Descrição:** Implementar armazenamento local para arquivos temporários, planos físicos em binário e logs extensos com cálculo de checksum SHA-256.
- **Arquivos:** `src/core/infrastructure/persistence/artifact_store.py`
- **Critério de Teste:** Gravação, leitura e validação de hash de artefatos armazenados em disco.

---

## Fase 6: API REST (FastAPI) e Telemetria OpenTelemetry

### TASK-022: Implementar DTOs Pydantic v2 e Routers do Control Plane
- **Requisitos:** FR-001, FR-004, FR-005 | **Stories:** US-001, US-002, US-005
- **Descrição:** Implementar endpoints REST conforme a especificação `openapi.yaml`: workspaces, projects, connections, catalog, drafts, validate, publish.
- **Arquivos:** `src/core/infrastructure/web/routers/*.py`, `src/core/infrastructure/web/dto/*.py`
- **Critério de Teste:** Testes de API com TestClient validando respostas HTTP, códigos de status e contratos de erro canônicos.

### TASK-023: Implementar Endpoints de Execução, Status, Cancelamento e Logs
- **Requisitos:** FR-013, FR-022 | **Stories:** US-007, US-008, US-009
- **Descrição:** Endpoints `POST /execute`, `GET /executions/{id}`, `POST /cancel` e `GET /logs`.
- **Arquivos:** `src/core/infrastructure/web/routers/executions.py`
- **Critério de Teste:** Disparo de execução assíncrona, consulta de progresso e cancelamento via chamadas HTTP.

### TASK-024: Implementar Exportação Separada de pipeline.yaml e layout.json
- **Requisitos:** FR-003, FR-025 | **Stories:** US-010
- **Descrição:** Gerador de exportação que empacota e entrega os dois arquivos de forma limpa, garantindo versionamento `schemaVersion` e ausência de segredos.
- **Arquivos:** `src/core/application/pipeline/exporter.py`
- **Critério de Teste:** Validação do bundle exportado contra `pipeline.schema.json` e `layout.schema.json`.

### TASK-025: Instrumentar Telemetria com OpenTelemetry
- **Requisitos:** NFR-004 | **Stories:** US-008
- **Descrição:** Configurar provedor OTel com injeção automática de `execution_id` e `correlation_id` em logs, traces e métricas.
- **Arquivos:** `src/core/infrastructure/telemetry/otel_setup.py`
- **Critério de Teste:** Spans de execução emitidos com atributos obrigatórios e métricas de nós registradas.

---

## Fase 7: Frontend Designer Visual (React + TypeScript)

### TASK-026: Setup do Frontend e Canvas com React Flow
- **Requisitos:** FR-001, FR-002 | **Stories:** US-001, US-004
- **Descrição:** Inicializar aplicação React + Vite + TypeScript. Configurar canvas React Flow com nós customizados e handles tipados para portas de entrada e saída.
- **Arquivos:** `ui/src/features/designer/Canvas.tsx`, `ui/src/features/designer/nodes/GenericNode.tsx`
- **Critério de Teste:** Renderização do canvas, adição de nós e conexão de arestas entre portas.

### TASK-027: Painel de Propriedades e Inferência de Schema
- **Requisitos:** FR-004, FR-007 | **Stories:** US-002, US-003
- **Descrição:** Desenvolver painel lateral de propriedades dinâmico gerado a partir do schema do componente e botão de inferência/revisão de tipos de colunas.
- **Arquivos:** `ui/src/features/designer/PropertyPanel.tsx`, `ui/src/features/designer/SchemaEditor.tsx`
- **Critério de Teste:** Edição de parâmetros atualiza o nó no draft e dispara inferência de tipos.

### TASK-028: Painel de Execução, Logs e Telemetria em Tempo Real
- **Requisitos:** FR-013, FR-022 | **Stories:** US-007, US-008, US-009
- **Descrição:** Painel inferior com abas de Plano Compilado, Logs Estruturados, Métricas por Nó e botão de Cancelamento de execução.
- **Arquivos:** `ui/src/features/execution/ExecutionConsole.tsx`, `ui/src/features/execution/MetricsTable.tsx`
- **Critério de Teste:** Atualização visual do progresso e interrupção imediata ao clicar em Cancelar.

---

## Fase 8: Verificação End-to-End e Testes Integrados

### TASK-029: Teste End-to-End do Vertical Slice
- **Requisitos:** Todos do Vertical Slice 001 | **Stories:** US-001 a US-012
- **Descrição:** Teste automatizado ponta a ponta: criar workspace -> criar draft com Postgres/CSV Source, Filter, Join e Parquet Target -> inferir schema -> publicar versão -> compilar planos -> executar worker -> validar arquivo de saída Parquet -> verificar telemetria.
- **Arquivos:** `tests/e2e/test_vertical_slice_e2e.py`
- **Critério de Teste:** Pipeline completo executado com sucesso e zero falhas de contrato.
