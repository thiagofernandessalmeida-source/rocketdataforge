# Entrada mestre para SPEC-KIT: RocketDataForge

## Papel do agente

Atue como Product Architect, Domain-Driven Design practitioner e Staff Software Engineer. Converta os documentos fornecidos em especificações implementáveis, rastreáveis e testáveis. Não invente requisitos silenciosamente. Quando faltar uma decisão, registre uma assumption explícita ou uma open question, sem bloquear a produção dos demais artefatos.

## Documentos normativos, em ordem de precedência

1. `01_PRD_RocketDataForge.md`: objetivos, escopo e requisitos do produto.
2. `02_Domain_Model_Specification.md`: linguagem, bounded contexts, invariantes e eventos.
3. `03_Architecture_Decision_Records_ADR-001-020.md`: decisões arquiteturais.

Em caso de conflito:
- ADR aceita prevalece sobre sugestão técnica genérica.
- Invariante de domínio prevalece sobre conveniência de framework.
- Requisito explícito do PRD prevalece sobre detalhe não normativo.
- Registre conflito e proponha alteração, mas não o resolva silenciosamente.

## Contexto do produto

RocketDataForge é uma plataforma visual low-code e Python-native para criar, validar, executar, monitorar, versionar e governar pipelines de dados e IA. Ela utiliza componentes genéricos configuráveis, definição declarativa, compilação em planos, paralelismo nativo, schema inference, chunking, otimização por capabilities, plugins e observabilidade. Funciona localmente primeiro e evolui para execução remota/distribuída.

## Objetivo desta execução do SPEC-KIT

Produzir a especificação executável do primeiro vertical slice, preservando a arquitetura necessária às fases futuras sem implementá-las prematuramente.

### Vertical slice alvo

1. Criar workspace e project local.
2. Criar pipeline draft no designer.
3. Adicionar Database/File Source, Select, Filter, Join e Database/File Target.
4. Configurar PostgreSQL, CSV, JSON e Parquet.
5. Inferir e revisar schema.
6. Validar o grafo e as configurações.
7. Publicar Pipeline Version imutável.
8. Compilar para Logical, Optimized e Physical Plan.
9. Executar localmente com DuckDB/Polars, conforme regra explícita.
10. Processar por chunks quando suportado.
11. Exibir status, logs e métricas por componente.
12. Cancelar execução.
13. Exportar `pipeline.yaml` e `layout.json`.

### Fora do primeiro vertical slice

- Kubernetes, multi-tenancy SaaS, billing, marketplace público, Spark, streaming contínuo, remote agent, SSO corporativo completo, RAG e MCP executáveis. Esses temas devem apenas manter contratos e extension points coerentes.

## Artefatos obrigatórios

Produza, nesta ordem:

1. `specs/000-foundation/constitution.md`
2. `specs/001-vertical-slice/spec.md`
3. `specs/001-vertical-slice/clarifications.md`
4. `specs/001-vertical-slice/domain-model.md`
5. `specs/001-vertical-slice/data-model.md`
6. `specs/001-vertical-slice/contracts/openapi.yaml`
7. `specs/001-vertical-slice/contracts/pipeline.schema.json`
8. `specs/001-vertical-slice/contracts/layout.schema.json`
9. `specs/001-vertical-slice/contracts/events.schema.json`
10. `specs/001-vertical-slice/research.md`
11. `specs/001-vertical-slice/plan.md`
12. `specs/001-vertical-slice/tasks.md`
13. `specs/001-vertical-slice/quickstart.md`
14. `docs/c4/context.md`
15. `docs/c4/container.md`
16. `docs/c4/component.md`
17. `docs/testing-strategy.md`
18. `docs/security-threat-model.md`

## Regras de especificação

- Use identificadores estáveis: FR-xxx, NFR-xxx, US-xxx, AC-xxx, TASK-xxx e ADR-xxx.
- Cada user story deve mapear para requisitos e critérios de aceite.
- Cada tarefa deve mapear para user stories, critérios e arquivos/componentes afetados.
- Critérios de aceite devem ser observáveis e testáveis em Given/When/Then.
- Separe requisitos funcionais, qualidade, segurança e operação.
- Não use percentuais de performance sem benchmark. Defina inicialmente cenários de medição e budgets configuráveis.
- Não prometa exactly-once universal.
- Nunca persista secrets em pipeline, layout, logs, eventos ou fixtures.
- Diferencie erro de validação, planejamento, infraestrutura, conector, transformação, qualidade e cancelamento.
- Inclua happy path, erros, cancelamento, retry, idempotência e concorrência.
- Preserve `schemaVersion` nos artefatos.
- Mantenha domínio independente de frameworks.
- Não misture layout visual com semântica executável.
- Toda otimização deve preservar semântica e ser explicável.
- Defina comportamento quando uma capability não estiver disponível.
- Registre assumptions e open questions em arquivos próprios.

## Arquitetura obrigatória

- Modular monolith no control plane.
- Python no backend/runtime.
- React + TypeScript no frontend.
- PostgreSQL para metadata.
- ArtifactStore por interface, com filesystem local inicial.
- Execução assíncrona por workers.
- DuckDB e Polars como engines iniciais candidatas.
- REST para control plane.
- Eventos internos para progresso e integração.
- OpenTelemetry para logs, métricas e traces.
- Plugins por manifesto e contratos versionados.

## Bounded contexts obrigatórios

- Workspace & Access
- Pipeline Design
- Metadata & Contracts
- Planning & Optimization
- Execution
- Observability
- Deployment & Scheduling
- Plugin Platform
- Lineage & Governance
- AI Orchestration

No primeiro vertical slice, implemente apenas o necessário em Workspace & Access, Pipeline Design, Metadata & Contracts, Planning & Optimization, Execution e Observability. Nos demais, crie apenas interfaces se forem realmente necessárias.

## User stories mínimas

- US-001 Criar e salvar um pipeline draft.
- US-002 Configurar source e target genéricos.
- US-003 Inferir e editar schema.
- US-004 Conectar nodes com validação de portas.
- US-005 Validar e publicar uma versão.
- US-006 Compilar e visualizar planos.
- US-007 Executar localmente.
- US-008 Visualizar logs e métricas por componente.
- US-009 Cancelar uma execução.
- US-010 Exportar definição e layout para Git.
- US-011 Tratar falha e retry conforme política.
- US-012 Garantir que secrets sejam somente referências.

## Cenários de aceite mínimos

### Publicação
Given um draft estruturalmente e semanticamente válido  
When o usuário publica  
Then uma Pipeline Version imutável é criada com hash da definição lógica.

### Layout
Given uma Pipeline Version publicada  
When apenas a posição visual de um node muda em novo draft  
Then o diff lógico não deve indicar mudança funcional.

### Schema inference
Given uma connection válida e dataset acessível  
When o usuário solicita inferência  
Then o sistema retorna nomes, logical types, physical types e nulabilidade disponíveis, sem persistir credenciais.

### Planejamento
Given uma Pipeline Version válida  
When a execução é solicitada  
Then o sistema produz Logical Plan, Optimized Plan e Physical Plan rastreáveis.

### Capability
Given um filtro e um source cujo adaptador suporta filter pushdown  
When o optimizer comprova equivalência semântica  
Then o filtro pode ser movido para a fonte e a decisão aparece na explicação do plano.

### Cancelamento
Given uma execução em andamento  
When o cancelamento é solicitado repetidas vezes  
Then a operação é idempotente e a execução termina em cancelled ou em estado terminal já alcançado.

### Secrets
Given um pipeline exportado  
When seus artefatos, logs e eventos são inspecionados  
Then nenhum valor secreto aparece, apenas referências permitidas.

## Estratégia de testes obrigatória

- Unit tests para agregados, invariantes e state machines.
- Contract tests para connectors e plugins.
- Golden tests para compilação de pipeline.
- Property-based tests para grafos, schemas e partições.
- Integration tests com PostgreSQL e arquivos.
- End-to-end test do vertical slice.
- Security tests para redaction e autorização.
- Migration tests para `schemaVersion`.
- Failure injection para retry, cancellation e checkpoint futuro.

## Qualidade de saída

Antes de finalizar:

1. Verifique rastreabilidade entre PRD, domain model, ADRs, histórias, critérios e tarefas.
2. Liste contradições e decisões pendentes.
3. Confirme que nenhuma tarefa exige tecnologia fora do escopo sem justificativa.
4. Confirme que cada endpoint e evento possui authorization, validation, error model e idempotency quando aplicável.
5. Confirme que nenhuma estrutura contém segredo em claro.
6. Confirme que o vertical slice pode ser demonstrado ponta a ponta.
7. Gere uma matriz final de cobertura de requisitos.

## Resultado esperado

O resultado deve permitir que outro agente implemente o vertical slice em incrementos pequenos, com testes desde o início, sem reinterpretar decisões fundamentais do produto.
