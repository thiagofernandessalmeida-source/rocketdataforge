# RocketDataForge: Constituição Arquitetural e Princípios de Engenharia

**Documento:** `specs/000-foundation/constitution.md`  
**Versão:** 1.0.0  
**Status:** Normativo / Imutável  
**Escopo:** Todo o ciclo de vida do software e todas as fases do SPEC-KIT  

---

## 1. Preâmbulo e Autoridade Normativa

Esta Constituição estabelece os princípios arquiteturais inegociáveis, convenções de design, regras de governança técnica e padrões de codificação do **RocketDataForge**.

Em caso de divergência ou ambiguidade:
1. As regras desta Constituição prevalecem sobre conveniências de frameworks, bibliotecas ou atalhos temporários.
2. Decisões arquiteturais registradas como aceitas em [ADR-001 a ADR-020](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md) são mandatórias.
3. Invariantes do Modelo de Domínio ([02_Domain_Model_Specification.md](file:///c:/Natura/PYTHON/RocketDataForge/02_Domain_Model_Specification.md)) prevalecem sobre abstrações de persistência ou transporte.
4. Nenhuma exceção a esta Constituição pode ser adotada silenciosamente; qualquer desvio exige uma nova ADR explicitamente aprovada.

---

## 2. Princípios Arquiteturais Fundamentais

### 2.1 Separação Estrita entre Semântica e Visual (ADR-004)
- A lógica funcional do pipeline é persistida exclusivamente em `pipeline.yaml`.
- O posicionamento visual, nós no canvas, cores e anotações visuais são persistidos exclusivamente em `layout.json`.
- O hash criptográfico que identifica uma versão executável imutável (`PipelineVersion.definition_hash`) cobre unicamente a definição funcional (`pipeline.yaml`), excluindo coordenadas de layout.
- Nenhuma alteração visual pode alterar o comportamento, a compilação ou o resultado da execução.

### 2.2 Fonte de Verdade Declarativa (ADR-003)
- O pipeline declarativo versionado é a única fonte de verdade.
- Código Python gerado, documentações, diagramas e planos de execução são artefatos estritamente derivados e descartáveis.
- O sistema nunca fará engenharia reversa de código Python livremente editado para recriar grafos visuais.

### 2.3 Compilação em Quatro Estágios (ADR-006)
A execução de qualquer pipeline deve obrigatoriamente seguir a cadeia de compilação:
$$\text{Visual Definition} \longrightarrow \text{Logical Plan} \longrightarrow \text{Optimized Plan} \longrightarrow \text{Physical Plan} \longrightarrow \text{Runtime}$$
1. **Visual Definition:** Grafo declarado pelo usuário com validações estáticas.
2. **Logical Plan:** Representação canônica das operações de dados independente de motor.
3. **Optimized Plan:** Plano lógico transformado por regras que preservam semântica (pushdowns, eliminação de projeções redundantes).
4. **Physical Plan:** Grafo de tarefas executáveis concretas, engines selecionadas (DuckDB/Polars), partições e buffers.
5. **Runtime:** Execução assíncrona por workers locais ou distribuídos.

### 2.4 Pureza e Isolamento do Domínio (Clean DDD)
- O núcleo de domínio (`core/domain`) é agnóstico a frameworks, bancos e protocolos de transporte.
- É estritamente proibido importar FastAPI, SQLAlchemy, Pydantic, React, DuckDB ou Polars dentro de entidades, agregados e value objects de domínio.
- Persistência e adaptadores externos implementam interfaces (Portas e Adaptadores).
- DTOs de API e modelos relacionais de banco (ORM) pertencem às camadas de infraestrutura e aplicação, não ao domínio.

### 2.5 Zero Segredos em Texto Puro (ADR-014, NFR-001)
- Segredos (senhas, tokens, chaves de API, certificados) nunca são persistidos em definições de pipeline, nós, layouts, metadados expostos, logs, traces, mensagens de erro ou fixtures.
- Conexões armazenam apenas `SecretReference` (identificador lógico tipado para um provider seguro).
- A resolução de segredos ocorre no momento exato da execução pelo worker no servidor e sua representação em memória deve ser transitória e isolada.

### 2.6 Segurança e Autorização no Servidor (ADR-018)
- O frontend (browser) é considerado um ambiente não-confiável.
- Toda validação de grafos, resolução de parâmetros, checagem de permissões RBAC e disparo de execuções deve ser validada e autorizada no backend.
- O frontend apenas reflete o estado e as permissões validadas pelo servidor.

### 2.7 Capacidades e Pushdown Transparente (ADR-011)
- Cada conector e componente declara explicitamente sua matriz de `Capabilities` (ex: `supports_filter_pushdown`, `supports_projection_pushdown`, `supports_chunked_read`).
- Otimizações de pushdown são aplicadas apenas se o adaptador suportar a capability e a equivalência semântica for estritamente comprovada.
- Toda otimização deve ser registrada e visível no plano explicável.

### 2.8 Realismo Operacional e Semântica de Entrega (ADR-013)
- O sistema não fará promessas ingênuas de *exactly-once* universal para fontes e destinos heterogêneos.
- O padrão de entrega é *at-least-once* com suporte a idempotência declarada por chave, particionamento determinístico e checkpoints de progresso.
- O processamento de grandes volumes deve adotar leitura e escrita por chunks/streaming por padrão, evitando carregar massas integrais em memória (NFR-009).

### 2.9 Observabilidade Canônica por Padrão (ADR-015, NFR-004)
- Toda execução deve produzir logs estruturados, métricas e spans distribuídos via OpenTelemetry.
- Os identificadores `execution_id` e `correlation_id` são atributos obrigatórios em qualquer emissão de telemetria.
- Métricas e logs são emitidos por componente, por partição e por tentativa.

### 2.10 Versionamento de Esquemas e Migrações (ADR-005, NFR-006)
- Todo artefato declarativo exportado deve conter o campo `schemaVersion` (ex: `rdf.pipeline/v1`, `rdf.layout/v1`).
- Evoluções de schema devem ser acompanhadas por migradores determinísticos e testes de regressão compatíveis com versões anteriores.

---

## 3. Padrões de Nomenclatura e Identificadores Estáveis

Para garantir rastreabilidade bidirecional estrita entre PRD, Modelo de Domínio, ADRs, Especificações, Testes e Código:

| Prefixo | Significado | Exemplo |
| :--- | :--- | :--- |
| `FR-xxx` | Requisito Funcional | `FR-001`, `FR-011` |
| `NFR-xxx` | Requisito Não-Funcional | `NFR-001`, `NFR-009` |
| `ADR-xxx` | Architecture Decision Record | `ADR-004`, `ADR-010` |
| `US-xxx` | User Story | `US-001`, `US-007` |
| `AC-xxx` | Critério de Aceite (BDD) | `AC-001-01`, `AC-007-02` |
| `TASK-xxx` | Tarefa de Implementação | `TASK-001`, `TASK-024` |
| `EVENT-xxx` | Evento de Domínio / Integração | `ExecutionStarted`, `PipelineDraftCreated` |

---

## 4. Estrutura Modular da Solução (Modular Monolith)

O backend Python seguirá a estrutura em camadas por Bounded Contexts:

```text
src/
├── core/
│   ├── domain/               # Entidades puras, VOs, Domain Events, Ports (Interfaces)
│   │   ├── pipeline/
│   │   ├── execution/
│   │   ├── metadata/
│   │   └── shared/
│   ├── application/          # Use Cases, Commands, Queries, Application Services
│   │   ├── compiler/         # Logical, Optimized, Physical Plan compilers
│   │   ├── pipeline/
│   │   └── execution/
│   └── infrastructure/       # Implementação das Portas (Adapters)
│       ├── persistence/      # PostgreSQL repositories via SQLAlchemy/Asyncpg
│       ├── connectors/       # PostgreSQL, CSV, JSON, Parquet connectors
│       ├── engines/          # DuckDB e Polars execution runners
│       ├── telemetry/        # OpenTelemetry exporters
│       └── web/              # FastAPI Routers, Pydantic DTOs, Middlewares
└── ui/                       # Frontend React + TypeScript (Vite)
    ├── src/
    │   ├── components/       # Design System e Canvas React Flow
    │   ├── features/         # Designer, Catalog, Executions, Inspector
    │   └── services/         # API Client REST gerado via OpenAPI
```

---

## 5. Regras para Tratamento de Erros e Falhas

1. **Taxonomia de Erros:** Todo erro do sistema deve ser categorizado em uma classe canônica explícita:
   - `ValidationError`: Grafos inválidos, schemas incompatíveis, campos ausentes.
   - `PlanningError`: Falha na resolução de tipos, impossibilidade de construir plano físico.
   - `ConnectorError`: Falha ao acessar banco ou ler arquivo (timeout, DNS, permissão).
   - `ExecutionError`: Erro durante a transformação ou processamento de dados.
   - `CancellationError`: Cancelamento cooperativo solicitado pelo usuário.
   - `SecurityError`: Violação de segredos ou autorização.
2. **Normalização:** Exceções externas de drivers (ex: `psycopg2.OperationalError`, `duckdb.Error`) devem ser interceptadas e encapsuladas nas exceções de domínio correspondentes antes de ultrapassar os limites da infraestrutura.
3. **Cancelamento Cooperativo:** Workers e iteradores de chunks devem verificar periodicamente o sinal de cancelamento (`is_cancelled`) em pontos seguros de interrupção, liberando recursos alocados imediatamente.
