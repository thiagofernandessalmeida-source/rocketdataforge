# PRD: RocketDataForge

**Versão:** 1.0  
**Status:** Draft para especificação  
**Owner:** Thiago Fernandes da Silva Almeida  
**Produto:** RocketDataForge  
**Categoria:** Plataforma visual open source de engenharia de dados e IA

## 1. Resumo executivo

RocketDataForge é uma plataforma visual low-code, Python-native, destinada à construção, validação, execução, observação, versionamento e governança de pipelines de dados e IA. O produto se inspira na experiência visual de ferramentas ETL tradicionais, mas substitui componentes excessivamente específicos por componentes genéricos configuráveis, inferência automática de schema, paralelismo declarativo, processamento em chunks, otimização automática, extensibilidade por plugins e integração nativa com APIs, MCP, RAG e LLMs.

O pipeline visual será persistido como uma definição declarativa e transformado em um plano lógico, um plano otimizado e um plano físico de execução. A plataforma deverá funcionar localmente sem dependência obrigatória de cloud ou Kubernetes e evoluir de forma modular para execução remota e distribuída.

## 2. Problema

Ferramentas ETL tradicionais frequentemente exigem configuração repetitiva de schemas, componentes separados para cada tecnologia, duplicação visual para paralelização, gerenciamento manual de otimizações, baixa transparência do plano de execução e integração limitada com práticas modernas de engenharia de software e IA.

O RocketDataForge deverá reduzir essa complexidade sem esconder dos usuários avançados os artefatos, decisões e métricas de execução.

## 3. Visão e missão

### 3.1 Visão
Ser uma plataforma aberta, extensível e moderna para engenharia visual de dados e IA, com pipelines portáveis, observáveis, testáveis e executáveis em diferentes ambientes.

### 3.2 Missão
Permitir que equipes construam pipelines corporativos com menor esforço manual, mantendo desempenho, governança, transparência e liberdade tecnológica.

## 4. Objetivos do produto

1. Reduzir o esforço necessário para criar e manter pipelines.
2. Eliminar duplicação visual usada apenas para paralelismo.
3. Automatizar inferência e evolução de schemas.
4. Aplicar estratégias eficientes de leitura e escrita automaticamente.
5. Oferecer preview, depuração, testes, lineage e observabilidade por componente.
6. Suportar promoção consistente entre DEV, QA, HML e PRD.
7. Permitir extensão por SDK sem alteração do núcleo.
8. Unificar pipelines tradicionais, APIs e fluxos de IA em uma única experiência.

## 5. Não objetivos do MVP

- Substituir engines distribuídas como Spark.
- Oferecer streaming contínuo.
- Entregar marketplace público.
- Entregar SaaS multi-tenant.
- Implementar billing.
- Implementar runtime nativo de Databricks.
- Garantir todos os conectores corporativos na primeira versão.

## 6. Personas

### 6.1 Engenheiro de dados
Cria pipelines de ingestão, transformação e carga; precisa de desempenho, depuração, reuso, automação e portabilidade.

### 6.2 Analytics engineer
Constrói transformações e modelos; precisa de SQL, contratos, testes e lineage.

### 6.3 QA engineer
Seleciona e prepara massas existentes para testes; precisa de filtros reutilizáveis, mascaramento, regras de elegibilidade e rastreabilidade.

### 6.4 AI engineer
Constrói fluxos de documentos, embeddings, busca vetorial, RAG, tool calling e MCP.

### 6.5 Platform engineer
Configura executores, secrets, ambientes, permissões, telemetria e políticas operacionais.

## 7. Princípios de produto

- Componentes genéricos com configuração específica por adaptador.
- Definição declarativa como fonte de verdade.
- Separação entre lógica e layout visual.
- Otimização automática, mas explicável.
- Execução local primeiro, distribuição por adaptadores.
- Nenhum segredo em texto puro.
- Compatibilidade retroativa dos artefatos sempre que possível.
- Extensibilidade por contratos públicos e versionados.
- Observabilidade por padrão.
- A IA propõe; o usuário revisa antes de publicar ou executar ações sensíveis.

## 8. Escopo funcional

### 8.1 Organização
- Workspaces, projetos, pastas virtuais e tags.
- Pipelines, reusable flows, connections, datasets, schemas, parameters, secrets, tests, schedules, deployments e execution history.
- Busca e filtros por nome, tag, tipo, ambiente e status.

### 8.2 Designer visual
- Canvas com drag-and-drop.
- Palette de componentes à esquerda.
- Painel de propriedades à direita.
- Área inferior para preview, schema, logs, erros e plano.
- Validação de conexões, portas, schemas e configurações.
- Zoom, minimap, alinhamento, agrupamento, copiar/colar, undo/redo.
- Execução completa, parcial, por ramo ou até um componente.

### 8.3 Connections e secrets
- Connections reutilizáveis e separadas dos pipelines.
- Credenciais armazenadas somente por referências de secrets.
- Teste de conectividade sem exposição do segredo.
- Configurações por ambiente.
- Adaptadores futuros para Azure Key Vault, HashiCorp Vault, AWS Secrets Manager e Kubernetes Secrets.

### 8.4 Datasets e contratos
- Dataset representa tabela, query, arquivo, endpoint, objeto ou coleção.
- Schema versionado com origem, tipos, nulabilidade, precisão e escala.
- Contratos com regras de compatibilidade e qualidade.
- Classificação e descrição de dados.

### 8.5 Componentes genéricos
#### Sources
- Database Source
- File Source
- API Source
- DataFrame Source
- MCP Source

#### Targets
- Database Target
- File Target
- API Target
- Vector Store Target

#### Transformations
- Select, rename, cast, derive, filter, sort, aggregate, join, union, deduplicate, normalize, pivot, unpivot, lookup, window, SQL transform e Python transform.

#### Controle
- Start, end, if, switch, loop, for each, wait, retry, parallel, subpipeline, checkpoint, commit e rollback.

#### Qualidade
- Not null, uniqueness, allowed values, regex, range, referential integrity, reconciliation, row count e custom rule.

#### IA
- Document loader, splitter, metadata enricher, embedding, vector store, vector search, reranker, context builder, prompt template, structured output, classification, extraction, summarization, LLM e MCP client.

### 8.6 Inferência de schema
- Inferência por metadata, amostragem ou descrição sem execução, quando suportada.
- Edição manual posterior.
- Detecção de colunas adicionadas, removidas e alteradas.
- Políticas de schema drift: bloquear, alertar, aceitar, ignorar ou converter quando seguro.

### 8.7 Data preview e profiling
- Primeiras linhas ou amostra aleatória.
- Limite de registros e tempo.
- Contagem, nulidade, cardinalidade, mínimo, máximo e distribuição básica.
- Mascaramento no preview conforme política.
- Preview claramente identificado como amostra.

### 8.8 Planejamento e otimização
Fluxo obrigatório:

```text
Visual Definition -> Logical Plan -> Optimized Plan -> Physical Plan -> Runtime
```

O planejador poderá aplicar projection pushdown, filter pushdown, join pushdown, eliminação de componentes redundantes, escolha de engine, chunking, particionamento e estratégia de escrita. Toda otimização deverá ser visível no plano explicável.

### 8.9 Paralelismo
- Configuração sem duplicar nós.
- Estratégias: hash, range, date, list, SQL expression, row_number, native partition e auto.
- Quantidade de workers configurável.
- Balanceamento opcional.
- Métricas e checkpoints por partição.
- Controle separado de concorrência de leitura, transformação e escrita.

### 8.10 Processamento e memória
- Leitura por chunks e fetch size.
- Escrita por batch size.
- In-memory, spill-to-disk e híbrido.
- Temporários preferencialmente em Parquet ou DuckDB.
- Limite de memória e política de limpeza.
- Engines iniciais: DuckDB e Polars; Pandas como interoperabilidade.

### 8.11 Escrita otimizada
- Modo automático, append, replace, insert, update, upsert e merge.
- Seleção automática de bulk strategy por adaptador.
- PostgreSQL COPY, Oracle array binding e estratégias equivalentes quando disponíveis.
- O detalhe interno não será um componente visual, mas aparecerá no plano e na telemetria.

### 8.12 Transações e falhas
- Auto commit como padrão configurável.
- Commit e rollback explícitos.
- Retry com backoff e política por erro.
- Reconexão.
- Timeout e cancelamento cooperativo.
- Saídas Main e Reject quando aplicável.
- Registro rejeitado com error_code, error_message, component_id, execution_id, original_payload e timestamp.

### 8.13 Checkpoints e idempotência
- Checkpoint por lote, página, arquivo, faixa, data, partição ou componente.
- Retomada somente das unidades incompletas.
- Chave de idempotência configurável.
- Registro de tentativa, lease e estado.

### 8.14 Observabilidade
- Logs estruturados.
- Métricas por pipeline, componente, partição e tentativa.
- Traces distribuídos.
- execution_id e correlation_id obrigatórios.
- Rows in/out/rejected, duração, throughput, memória, CPU, retries, batches e estratégia usada.
- Integração com OpenTelemetry.

### 8.15 Lineage
- Lineage de pipeline, dataset e coluna.
- Impact analysis.
- Registro de origem, transformação e destino.
- Indicação clara quando o lineage for inferido em vez de declarado.

### 8.16 Versionamento e Git
- Versões imutáveis publicadas.
- Draft editável.
- Comparação semântica.
- Rollback.
- Exportação textual.
- Separação entre `pipeline.yaml` e `layout.json`.
- Validação e testes em CI.

### 8.17 Scheduling e deployments
- Agendamento cron, calendário e evento futuro.
- Deployments associados a versão e ambiente.
- Parâmetros por ambiente.
- Execução local no MVP; remote agent e Kubernetes posteriormente.

### 8.18 Plugins
- SDK versionado.
- Plugins para connectors, components, validators, secret providers, observability exporters e executors.
- Manifesto, capabilities, schema de configuração e compatibility range.
- Isolamento e permissões deverão evoluir antes de plugins não confiáveis.

### 8.19 IA, RAG e MCP
- Prompt-to-pipeline cria draft, nunca publica automaticamente.
- Explicação e documentação do pipeline.
- Sugestões de testes e otimização.
- Diagnóstico assistido por logs, sem ocultar evidências.
- Structured output obrigatório quando a saída alimentar outro componente.
- Controle de tokens, custo, timeout, retry e dados sensíveis.
- MCP client com tools, resources e prompts.

## 9. Requisitos funcionais

- **FR-001:** criar, editar, duplicar, excluir e organizar pipelines.
- **FR-002:** conectar componentes com validação de compatibilidade de portas.
- **FR-003:** salvar lógica e layout separadamente.
- **FR-004:** configurar componentes em painel de propriedades.
- **FR-005:** cadastrar e reutilizar connections sem embutir credenciais.
- **FR-006:** cadastrar datasets e contratos de schema.
- **FR-007:** inferir schema e permitir override.
- **FR-008:** detectar schema drift e executar política configurada.
- **FR-009:** visualizar amostra e profiling limitado.
- **FR-010:** validar o pipeline antes da execução.
- **FR-011:** compilar a definição em planos lógico, otimizado e físico.
- **FR-012:** exibir plano e otimizações aplicadas.
- **FR-013:** executar localmente com cancelamento.
- **FR-014:** processar dados em chunks.
- **FR-015:** configurar paralelismo declarativo.
- **FR-016:** usar write strategy otimizada selecionada pelo adaptador.
- **FR-017:** suportar main e reject flows.
- **FR-018:** aplicar retry e reconexão conforme política.
- **FR-019:** suportar auto commit, commit manual e rollback quando o conector permitir.
- **FR-020:** persistir checkpoints e retomar execução.
- **FR-021:** aplicar idempotência quando configurada.
- **FR-022:** registrar histórico, logs, métricas e traces.
- **FR-023:** executar testes unitários, de contrato, integração e qualidade.
- **FR-024:** versionar e comparar definições.
- **FR-025:** exportar projeto em arquivos adequados para Git.
- **FR-026:** reutilizar subpipelines parametrizados.
- **FR-027:** registrar lineage de datasets e colunas.
- **FR-028:** agendar versões publicadas.
- **FR-029:** promover configurações entre ambientes sem alterar lógica.
- **FR-030:** instalar plugins compatíveis e confiáveis.
- **FR-031:** gerar draft de pipeline por linguagem natural.
- **FR-032:** explicar e documentar pipelines.
- **FR-033:** suportar componentes MCP, RAG e LLM.
- **FR-034:** expor APIs para gestão e execução.
- **FR-035:** auditar alterações relevantes.

## 10. Requisitos não funcionais

- **NFR-001 Segurança:** secrets nunca em texto puro, logs ou artefatos exportados.
- **NFR-002 Portabilidade:** execução local sem cloud obrigatória.
- **NFR-003 Extensibilidade:** novo conector não exige mudança do domínio central.
- **NFR-004 Observabilidade:** toda execução emite logs, métricas e traces correlacionados.
- **NFR-005 Determinismo:** a mesma versão e parâmetros devem produzir o mesmo plano, salvo capabilities externas explicitamente registradas.
- **NFR-006 Compatibilidade:** artefatos incluem `schemaVersion` e mecanismo de migração.
- **NFR-007 Testabilidade:** core independente de UI, banco e conectores concretos.
- **NFR-008 Resiliência:** falhas isoladas por componente, partição e tentativa quando possível.
- **NFR-009 Performance:** não carregar datasets completos em memória por padrão.
- **NFR-010 Acessibilidade:** navegação por teclado, contraste e estados não dependentes apenas de cor.
- **NFR-011 Internacionalização:** textos de UI desacoplados do código.
- **NFR-012 Auditabilidade:** alterações e execuções relevantes possuem autoria, data e correlação.
- **NFR-013 Privacidade:** previews, logs e IA respeitam políticas de mascaramento e minimização.
- **NFR-014 Manutenibilidade:** arquitetura modular, contratos versionados e dependências direcionadas ao domínio.

## 11. Critérios de sucesso do MVP

1. Usuário cria e salva um pipeline visual válido.
2. Pipeline lê PostgreSQL, CSV, JSON ou Parquet.
3. Pipeline aplica select, filter e join.
4. Pipeline grava em PostgreSQL ou Parquet.
5. Schema pode ser inferido e revisado.
6. Execução local exibe status, logs e métricas por componente.
7. Grandes entradas podem ser lidas em chunks sem materialização integral por padrão.
8. Falhas produzem diagnóstico e registros rejeitados quando configurado.
9. Definição exportada pode ser versionada em Git.
10. Testes automatizados cobrem o compilador, domínio e conectores iniciais.

As metas quantitativas de desempenho, disponibilidade e redução de esforço deverão ser definidas após benchmark do protótipo. Não serão usados percentuais arbitrários como critérios de aceite.

## 12. Fases

### Fase 1: Vertical slice
Designer, formato declarativo, validação, PostgreSQL/CSV/JSON/Parquet, select/filter/join, execução local, preview e logs.

### Fase 2: Runtime robusto
DuckDB/Polars, chunks, paralelismo, reject flow, checkpoints, idempotência e otimização de escrita.

### Fase 3: Plataforma
Versionamento, environments, secrets providers, scheduling, deployments, lineage, auditoria e observabilidade completa.

### Fase 4: IA e ecossistema
Prompt-to-pipeline, documentação, MCP, RAG, SDK estabilizado, remote agent e marketplace controlado.

## 13. Riscos

- Escopo excessivo antes do vertical slice.
- Semântica transacional inconsistente entre conectores.
- Código gerado divergir da definição visual.
- Plugins introduzirem riscos de segurança e compatibilidade.
- Preview provocar carga excessiva na fonte.
- Pushdown alterar semântica entre engines.
- Checkpoint produzir duplicidade sem idempotência.
- IA gerar configurações tecnicamente válidas, mas operacionalmente inseguras.

## 14. Dependências e premissas

- Backend Python com API HTTP.
- Frontend React + TypeScript.
- PostgreSQL para metadata.
- Definição declarativa versionada.
- Execução local como primeira implementação.
- DuckDB e Polars como engines iniciais candidatas.
- OpenTelemetry como padrão de instrumentação.

## 15. Questões em aberto

- A exportação Python será produto principal ou visão derivada do plano?
- Qual política de compatibilidade será oferecida para plugins?
- Quais limites serão aplicados a Python Transform?
- Como transações serão representadas entre recursos heterogêneos?
- Qual modelo de licenciamento open source será adotado?
- Quais provedores de LLM e vector stores estarão no primeiro ciclo de IA?

## 16. Definition of Done global

Uma feature somente está concluída quando possui requisitos e critérios de aceite, validação de erro, testes automatizados, telemetria, documentação, migração quando aplicável, análise de segurança e comportamento definido para cancelamento e retry.
