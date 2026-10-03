# RocketDataForge: Architecture Decision Records

**Conjunto:** ADR-001 a ADR-020  
**Status geral:** Proposed  
**Regra:** cada decisão deve ser revisada durante a especificação da feature correspondente.

---

## ADR-001: Modular monolith como arquitetura inicial

**Status:** Accepted for MVP

### Contexto
O produto possui muitos domínios, mas o MVP precisa de baixo custo operacional e refatoração rápida.

### Decisão
Implementar backend como modular monolith, com módulos alinhados aos bounded contexts e dependências explícitas. Workers podem ser processos separados usando os mesmos contratos de aplicação.

### Consequências
- Deploy inicial simplificado.
- Transações locais mais simples.
- Exige disciplina de fronteiras.
- Extração futura de serviços passa a ser uma opção, não requisito inicial.

### Alternativas rejeitadas
Microservices desde o primeiro release, por elevar complexidade antes de existirem padrões reais de escala.

---

## ADR-002: Python no backend e TypeScript/React no frontend

**Status:** Accepted

### Contexto
O produto é Python-native e precisa de amplo ecossistema de conectores e processamento, além de UI visual rica.

### Decisão
Usar Python no backend/runtime e React com TypeScript no frontend. FastAPI é a implementação HTTP inicial.

### Consequências
- Alinhamento com ecossistema de dados.
- Tipagem explícita no frontend.
- Contratos devem ser gerados ou testados entre linguagens.

---

## ADR-003: Definição declarativa como fonte de verdade

**Status:** Accepted

### Contexto
Código gerado, layout e execução não podem competir como fontes de verdade.

### Decisão
A fonte de verdade será uma definição declarativa versionada. Código Python, documentação e planos serão artefatos derivados.

### Consequências
- Diff e migração previsíveis.
- Regeneração consistente.
- Customização manual do código gerado não retorna automaticamente ao designer.

---

## ADR-004: Separar lógica do pipeline e layout visual

**Status:** Accepted

### Contexto
Movimentar um node no canvas não representa mudança funcional.

### Decisão
Persistir `pipeline.yaml` e `layout.json` separadamente. O hash da versão funcional exclui layout.

### Consequências
- Diffs Git mais limpos.
- Colaboração visual independente.
- Publicação precisa associar revisões compatíveis dos dois artefatos.

---

## ADR-005: Formato versionado e migrações determinísticas

**Status:** Accepted

### Contexto
Pipelines sobreviverão a mudanças do produto.

### Decisão
Todo artefato declarativo terá `schemaVersion`. Migrações serão explícitas, testadas, determinísticas e preferencialmente reversíveis.

### Consequências
- Compatibilidade controlada.
- Custo permanente de manter migradores e fixtures.

---

## ADR-006: Pipeline compilation em quatro estágios

**Status:** Accepted

### Contexto
Executar diretamente o grafo visual prejudica otimização e portabilidade.

### Decisão
Usar Visual Definition, Logical Plan, Optimized Plan e Physical Execution Plan.

### Consequências
- Otimizações e múltiplos runtimes tornam-se possíveis.
- O compilador vira subsistema crítico e requer testes golden e property-based.

---

## ADR-007: PostgreSQL como metadata store inicial

**Status:** Accepted for MVP

### Contexto
Metadata exige integridade relacional, transações e consultas operacionais.

### Decisão
Usar PostgreSQL como store transacional de metadata. Artefatos grandes e logs não precisam residir nele.

### Consequências
- Modelo e operações maduros.
- Requer migrações de banco.
- Evita acoplamento a serviço cloud proprietário.

---

## ADR-008: Object/artifact storage atrás de uma porta

**Status:** Accepted

### Contexto
Planos, manifests, exports, amostras permitidas e logs extensos podem não caber adequadamente no metadata store.

### Decisão
Definir ArtifactStore port. Implementação local usa filesystem; futuras implementações podem usar object storage.

### Consequências
- Portabilidade local/cloud.
- Necessidade de checksum, lifecycle e autorização por artefato.

---

## ADR-009: Execução assíncrona baseada em workers

**Status:** Accepted

### Contexto
Pipelines podem durar mais que uma requisição HTTP e precisam de cancelamento, retry e isolamento.

### Decisão
API cria ExecutionRequest; workers consomem unidades de trabalho. A implementação inicial pode usar uma fila simples/Redis, preservando interfaces para troca futura.

### Consequências
- API não bloqueia.
- Estado e idempotência tornam-se obrigatórios.
- A tecnologia concreta da fila será selecionada em especificação técnica.

---

## ADR-010: DuckDB e Polars como engines iniciais

**Status:** Accepted for evaluation

### Contexto
É necessário processar localmente com boa eficiência e suporte a SQL/dataframes.

### Decisão
Usar DuckDB para SQL, joins e spill-oriented workloads; Polars para transformações dataframe/streaming quando adequado. Pandas entra como interoperabilidade, não engine padrão.

### Consequências
- Flexibilidade por workload.
- Precisa de canonical type system e testes de equivalência.
- O planner decide a engine com regra explicável.

---

## ADR-011: Pushdown orientado por capabilities

**Status:** Accepted

### Contexto
Nem todo conector suporta as mesmas operações ou semântica.

### Decisão
Conectores declaram capabilities. O optimizer aplica projection, filter, aggregate ou join pushdown apenas quando suportado e semanticamente seguro.

### Consequências
- Melhor desempenho sem acoplamento a vendor.
- Requer matriz de capabilities e testes de semântica.
- Plano explica operações empurradas.

---

## ADR-012: Paralelismo declarativo e particionamento determinístico

**Status:** Accepted

### Contexto
Duplicar componentes para paralelizar prejudica manutenção.

### Decisão
Paralelismo será configuração do plano, com estratégias hash, range, date, list, expression, row_number, native e auto. Partições precisam ter chaves determinísticas.

### Consequências
- Canvas mais limpo.
- Checkpoints e métricas por partição.
- Skew e limites da fonte precisam ser tratados.

---

## ADR-013: Sem promessa universal de exactly-once

**Status:** Accepted

### Contexto
Transações distribuídas entre fontes heterogêneas são inviáveis ou caras.

### Decisão
Documentar semântica por conector e operar com idempotência, checkpoints e at-least-once como base. Exactly-once só pode ser declarado quando comprovado pela combinação de fonte, destino e estratégia.

### Consequências
- Evita garantia falsa.
- Usuário precisa definir chave ou estratégia idempotente em cenários críticos.

---

## ADR-014: Secrets somente por referência

**Status:** Accepted

### Contexto
Pipelines e exports podem circular em Git e ambientes diferentes.

### Decisão
Connections armazenam `SecretReference`. Providers resolvem valores em runtime. Secrets são redigidos de logs, eventos e erros.

### Consequências
- Artefatos exportáveis com menor risco.
- Execução depende de provider disponível e autorizado.
- Cache de segredo deve ter TTL e proteção em memória.

---

## ADR-015: OpenTelemetry como padrão de instrumentação

**Status:** Accepted

### Contexto
A plataforma precisa correlacionar API, planner, worker, componente e conector.

### Decisão
Instrumentar traces, metrics e structured logs com OpenTelemetry. `execution_id` e `correlation_id` serão atributos obrigatórios.

### Consequências
- Exportadores podem variar.
- Cardinalidade de labels deve ser controlada.
- Telemetria não pode conter secrets ou payloads sensíveis por padrão.

---

## ADR-016: SDK de plugins baseado em manifesto e contratos versionados

**Status:** Accepted

### Contexto
Novos conectores e componentes não devem modificar o core.

### Decisão
Cada plugin fornece manifesto, versão, faixa de compatibilidade, checksum, configuration schema, ports e capabilities. APIs internas não fazem parte do contrato.

### Consequências
- Ecossistema extensível.
- Necessidade de testes de compatibilidade e política de confiança.
- Sandbox forte fica fora do MVP; plugins iniciais devem ser confiáveis.

---

## ADR-017: REST para control plane e eventos para progresso

**Status:** Accepted

### Contexto
CRUD/configuração e atualizações de execução possuem características diferentes.

### Decisão
Usar REST para comandos e consultas do control plane. Usar eventos internos e canal de atualização em tempo real para status e logs. GraphQL não será requisito do MVP.

### Consequências
- API simples e previsível.
- Frontend precisa combinar snapshots REST e updates.
- Tecnologia de streaming ao browser será decidida na feature correspondente.

---

## ADR-018: Segurança e autorização no servidor

**Status:** Accepted

### Contexto
O cliente não é fronteira de confiança e componentes podem acessar dados sensíveis.

### Decisão
Autenticação, RBAC, validação de configuração, resolução de secrets e autorização de execução ocorrem no servidor. UI apenas reflete permissões.

### Consequências
- Proteção consistente entre UI e API.
- Toda ação privilegiada deve ser auditada.
- SSO corporativo é evolução; identidade local pode atender ao desenvolvimento inicial.

---

## ADR-019: IA assistiva com validação humana e saída estruturada

**Status:** Accepted

### Contexto
IA pode acelerar criação, explicação e diagnóstico, porém suas respostas não são fonte confiável de execução por si mesmas.

### Decisão
IA cria propostas/drafts. Saídas que alimentam pipelines usam schemas estruturados e validação do domínio. Publicação, secrets e operações destrutivas exigem fluxo explícito de autorização.

### Consequências
- Reduz risco operacional.
- Prompts, modelos, custos e políticas precisam ser versionados/observados.
- Dados enviados a providers seguem AIFlowPolicy.

---

## ADR-020: Open source core com extensões futuras

**Status:** Proposed

### Contexto
A visão é open source first, com possibilidade futura de ofertas enterprise e SaaS.

### Decisão
Manter designer, definição, compilador e runtime local no core aberto. Capacidades gerenciadas, governança avançada e operação distribuída poderão ser empacotadas separadamente, sem tornar artefatos básicos proprietários.

### Consequências
- Aumenta confiança e adoção.
- Exige definição posterior de licença e limites de edição.
- Pipelines permanecem portáveis mesmo sem serviços comerciais.

---

## Índice de decisões e dependências

| ADR | Tema | Depende de |
|---|---|---|
| 001 | Modular monolith | Nenhuma |
| 002 | Stack principal | 001 |
| 003 | Fonte de verdade | Nenhuma |
| 004 | Lógica e layout | 003 |
| 005 | Versionamento de formato | 003 |
| 006 | Compilação em estágios | 003 |
| 007 | Metadata store | 001 |
| 008 | Artifact store | 001 |
| 009 | Workers | 001, 006 |
| 010 | Engines | 006 |
| 011 | Pushdown | 006, 016 |
| 012 | Paralelismo | 006, 009 |
| 013 | Semântica de entrega | 009, 012 |
| 014 | Secrets | 018 |
| 015 | Observabilidade | 009 |
| 016 | Plugins | 003, 005 |
| 017 | APIs e eventos | 001, 009 |
| 018 | Segurança server-side | 001 |
| 019 | IA assistiva | 003, 018 |
| 020 | Estratégia open source | 003, 016 |

## Template para novas ADRs

```markdown
# ADR-XXX: Título

**Status:** Proposed | Accepted | Deprecated | Superseded

## Contexto

## Decisão

## Consequências

## Alternativas consideradas

## Evidências e critérios de revisão
```
