# RocketDataForge: Domain Model Specification

**Versão:** 1.0  
**Status:** Draft  
**Abordagem:** Domain-Driven Design

## 1. Objetivo

Definir a linguagem ubíqua, os bounded contexts, agregados, entidades, value objects, eventos, comandos, invariantes e relações centrais do RocketDataForge. Este documento é normativo para o domínio; detalhes de framework, banco e transporte pertencem às camadas externas.

## 2. Linguagem ubíqua

- **Workspace:** limite organizacional que agrupa projetos e políticas.
- **Project:** unidade lógica que agrupa artefatos de uma solução.
- **Pipeline:** grafo direcionado de componentes e conexões.
- **Pipeline Draft:** versão editável ainda não publicada.
- **Pipeline Version:** snapshot imutável e executável.
- **Node:** instância configurada de um Component Definition.
- **Port:** ponto tipado de entrada ou saída de um node.
- **Edge:** ligação entre duas portas compatíveis.
- **Component Definition:** contrato versionado de um tipo de componente.
- **Reusable Flow:** fragmento de pipeline reutilizável e parametrizado.
- **Connection:** configuração reutilizável de acesso, sem conter segredo em claro.
- **Dataset:** representação lógica de dados externos ou produzidos.
- **Data Contract:** expectativas de schema, qualidade e compatibilidade.
- **Schema:** estrutura versionada de campos.
- **Execution:** tentativa de executar uma Pipeline Version.
- **Execution Plan:** representação física pronta para o runtime.
- **Task Run:** execução de uma unidade planejada.
- **Partition:** divisão independente de trabalho.
- **Checkpoint:** progresso persistido e retomável.
- **Reject Record:** registro rejeitado com contexto técnico.
- **Environment:** conjunto nomeado de bindings e parâmetros.
- **Deployment:** associação de uma versão publicada a um ambiente.
- **Plugin:** pacote versionado que fornece capabilities.
- **Capability:** funcionalidade declarada por adaptador ou plugin.
- **Lineage Edge:** relação de origem, transformação ou destino.

## 3. Bounded contexts

### 3.1 Workspace & Access
Responsável por workspaces, projetos, membros, papéis e políticas. Não conhece detalhes de execução.

### 3.2 Pipeline Design
Responsável pelo grafo visual, drafts, componentes, validação estrutural, reusable flows e publicação de versões.

### 3.3 Metadata & Contracts
Responsável por connections, datasets, schemas, inferência, contratos, profiling e schema drift.

### 3.4 Planning & Optimization
Responsável por compilar uma Pipeline Version em planos lógico, otimizado e físico, considerando capabilities.

### 3.5 Execution
Responsável por executions, task runs, partições, estado, retry, cancelamento, checkpoints, transações e rejeições.

### 3.6 Observability
Responsável por logs, métricas, traces, correlação e consultas operacionais.

### 3.7 Deployment & Scheduling
Responsável por environments, parameter sets, deployments, schedules e gatilhos.

### 3.8 Plugin Platform
Responsável por manifestos, registro, compatibilidade, capabilities e ciclo de vida de plugins.

### 3.9 Lineage & Governance
Responsável pelo grafo de lineage, impact analysis, auditoria e classificações.

### 3.10 AI Orchestration
Responsável por providers, prompts, structured outputs, RAG, MCP, políticas de dados e propostas de pipeline.

## 4. Context map

```text
Workspace & Access
        |
        v
Pipeline Design ---> Metadata & Contracts
        |                    |
        v                    v
Planning & Optimization <--- Plugin Platform
        |
        v
Execution ---> Observability
    |   |
    |   +------> Lineage & Governance
    v
Deployment & Scheduling

AI Orchestration ---> Pipeline Design
AI Orchestration ---> Metadata & Contracts
```

Relações recomendadas:
- Pipeline Design é upstream de Planning & Optimization.
- Metadata & Contracts fornece schemas e capabilities por Published Language.
- Plugin Platform fornece contratos de extensão via Anti-Corruption Layer.
- Execution consome apenas Physical Execution Plan.
- Observability recebe eventos sem controlar o ciclo de execução.
- AI Orchestration cria propostas; Pipeline Design valida e persiste drafts.

## 5. Agregados

### 5.1 Workspace aggregate
**Root:** Workspace

Entidades:
- ProjectReference
- Membership

Value objects:
- WorkspaceId
- WorkspaceName
- Role
- PolicySet

Invariantes:
- Nome obrigatório dentro do tenant local.
- Um projeto pertence a exatamente um workspace.
- Mudanças de papel devem ser auditadas.

Comandos:
- CreateWorkspace
- AddProject
- AddMember
- ChangeMemberRole
- ArchiveWorkspace

Eventos:
- WorkspaceCreated
- ProjectAddedToWorkspace
- MemberRoleChanged
- WorkspaceArchived

### 5.2 Project aggregate
**Root:** Project

Value objects:
- ProjectId
- ProjectName
- ProjectSlug
- TagSet

Invariantes:
- Slug único no workspace.
- Projeto arquivado não recebe novos drafts.

### 5.3 Pipeline aggregate
**Root:** PipelineDraft

Entidades:
- Node
- PortBinding
- Edge
- PipelineParameter
- VisualLayoutReference

Value objects:
- PipelineId
- DraftRevision
- NodeId
- PortId
- ComponentTypeId
- ComponentVersion
- Position
- Configuration

Invariantes:
- NodeId único no pipeline.
- Edge conecta output a input compatível.
- Portas obrigatórias devem estar conectadas ou ter valor permitido.
- O grafo deve respeitar regras de ciclo dos componentes.
- Configuração deve validar contra o schema da Component Definition.
- Layout não altera semântica.
- Draft não pode ser executado em ambiente controlado; deve ser publicado.

Comandos:
- CreatePipelineDraft
- AddNode
- ConfigureNode
- ConnectPorts
- DisconnectPorts
- MoveNode
- ValidateDraft
- PublishPipelineVersion

Eventos:
- PipelineDraftCreated
- NodeAdded
- NodeConfigured
- PortsConnected
- PipelineValidated
- PipelineVersionPublished

### 5.4 PipelineVersion aggregate
**Root:** PipelineVersion

Campos:
- pipeline_id
- version
- schema_version
- definition_hash
- immutable_definition
- published_by
- published_at

Invariantes:
- Versão publicada é imutável.
- Hash cobre a definição lógica, não o layout.
- Apenas draft válido pode ser publicado.

### 5.5 ComponentCatalog aggregate
**Root:** ComponentDefinition

Entidades:
- PortDefinition
- ConfigurationProperty
- CapabilityRequirement

Value objects:
- ComponentTypeId
- SemanticVersion
- PortType
- JsonSchema
- CompatibilityRange

Invariantes:
- Identificador e versão formam chave única.
- Configuração possui JSON Schema.
- Portas têm direção e tipo declarados.
- Breaking changes exigem nova major version.

### 5.6 Connection aggregate
**Root:** Connection

Value objects:
- ConnectionId
- ConnectorType
- Endpoint
- SecretReference
- EnvironmentBindings
- ConnectionOptions

Invariantes:
- Não armazena segredo em claro.
- Bindings podem variar por ambiente sem alterar Pipeline Version.
- Test result expira e não equivale a disponibilidade permanente.

Eventos:
- ConnectionCreated
- ConnectionBindingChanged
- ConnectionTested
- ConnectionDisabled

### 5.7 Dataset aggregate
**Root:** Dataset

Entidades:
- DatasetLocation
- SchemaReference
- ContractReference

Value objects:
- DatasetId
- DatasetKind
- LogicalName
- Classification

Invariantes:
- Dataset possui identificador lógico estável.
- Localização física é resolvida por ambiente.
- Schema atual aponta para uma SchemaVersion existente.

### 5.8 Schema aggregate
**Root:** SchemaDefinition

Entidades:
- FieldDefinition

Value objects:
- SchemaId
- SchemaVersion
- FieldName
- LogicalType
- PhysicalType
- Nullability
- Precision
- Scale

Invariantes:
- Nome de campo único no mesmo nível.
- Precisão e escala devem ser coerentes.
- Alterações publicadas geram nova versão.

Comandos:
- InferSchema
- OverrideInferredSchema
- PublishSchemaVersion
- CompareSchemas

Eventos:
- SchemaInferred
- SchemaOverridden
- SchemaVersionPublished
- SchemaDriftDetected

### 5.9 DataContract aggregate
**Root:** DataContract

Entidades:
- QualityRule
- CompatibilityRule

Value objects:
- ContractId
- RuleId
- Severity
- FailureAction

Invariantes:
- Toda regra tem severidade e ação.
- Ação deve ser uma dentre accept, reject, warn ou fail.
- Contrato publicado é versionado.

### 5.10 Execution aggregate
**Root:** Execution

Entidades:
- TaskRun
- Attempt
- PartitionRun

Value objects:
- ExecutionId
- CorrelationId
- ExecutionStatus
- TaskStatus
- RetryPolicy
- ResourceLimits
- PlanReference

Estados de Execution:
```text
CREATED -> PLANNING -> QUEUED -> RUNNING
RUNNING -> SUCCEEDED | FAILED | CANCELLING
CANCELLING -> CANCELLED
FAILED -> RETRYING -> RUNNING
```

Invariantes:
- Execution referencia uma Pipeline Version imutável.
- Estado terminal não retorna a estado ativo.
- Transição é validada e otimisticamente concorrente.
- Uma tentativa possui número monotônico.
- Cancelamento é idempotente.

Comandos:
- RequestExecution
- StartExecution
- StartTask
- CompleteTask
- FailTask
- RetryTask
- RequestCancellation
- CompleteExecution

Eventos:
- ExecutionRequested
- ExecutionStarted
- TaskStarted
- TaskSucceeded
- TaskFailed
- ExecutionCancellationRequested
- ExecutionSucceeded
- ExecutionFailed
- ExecutionCancelled

### 5.11 Checkpoint aggregate
**Root:** Checkpoint

Value objects:
- CheckpointId
- ExecutionId
- TaskId
- PartitionKey
- Cursor
- CheckpointState

Invariantes:
- Atualizações precisam ser monotônicas ou explicitamente reiniciadas.
- Checkpoint pertence a uma versão e plano específicos.
- Retomada incompatível com alteração de definição é proibida.

### 5.12 RejectBatch aggregate
**Root:** RejectBatch

Entidades:
- RejectRecord

Campos obrigatórios:
- error_code
- error_message
- component_id
- execution_id
- timestamp
- payload_reference ou payload mascarado

Invariantes:
- Dados sensíveis respeitam política de mascaramento.
- Reject não pode impedir observabilidade do erro original.

### 5.13 Environment aggregate
**Root:** Environment

Entidades:
- ParameterBinding
- ConnectionBinding
- SecretBinding

Value objects:
- EnvironmentId
- EnvironmentName
- ParameterValue

Invariantes:
- Um binding resolve uma referência lógica.
- Valores sensíveis usam SecretReference.
- Alteração de ambiente não altera Pipeline Version.

### 5.14 Deployment aggregate
**Root:** Deployment

Campos:
- deployment_id
- pipeline_version
- environment_id
- status
- deployed_by

Invariantes:
- Somente versão publicada pode ser implantada.
- Deployment registra exatamente quais bindings foram resolvidos.

### 5.15 Schedule aggregate
**Root:** Schedule

Value objects:
- ScheduleId
- TriggerDefinition
- TimeZone
- MisfirePolicy

Invariantes:
- Schedule referencia Deployment ativo.
- Fuso horário é explícito.
- Disparo gera ExecutionRequest idempotente.

### 5.16 Plugin aggregate
**Root:** Plugin

Entidades:
- CapabilityDeclaration
- ExtensionPoint

Value objects:
- PluginId
- PluginVersion
- CoreCompatibilityRange
- Checksum
- TrustLevel

Invariantes:
- Manifesto válido é obrigatório.
- Checksum identifica o pacote instalado.
- Plugin incompatível não é ativado.
- Capability deve declarar configuração e contratos.

### 5.17 LineageGraph aggregate
**Root:** LineageGraph

Entidades:
- LineageNode
- LineageEdge

Value objects:
- AssetId
- TransformationReference
- LineageConfidence

Invariantes:
- Aresta identifica origem da evidência.
- Lineage inferido é distinguível de lineage declarado ou observado.

### 5.18 AIFlowPolicy aggregate
**Root:** AIFlowPolicy

Entidades:
- ProviderPolicy
- DataHandlingRule
- CostLimit
- ModelBinding

Invariantes:
- Dados permitidos ao provider são explicitamente classificados.
- Structured output é validado antes de alimentar outro componente.
- Prompt-to-pipeline gera draft sujeito à validação normal.

## 6. Value objects transversais

### Identifier
UUID/ULID imutável, sem semântica de negócio embutida.

### SemanticVersion
`major.minor.patch`, usado em componentes, plugins e formatos.

### SecretReference
URI lógica para provider de segredo; nunca contém o valor secreto.

### DataType
Tipo lógico independente da engine, com adaptadores para tipos físicos.

### RetryPolicy
max_attempts, backoff_type, initial_delay, max_delay e retryable_errors.

### ResourceLimits
memory, cpu, timeout, max_parallelism e temporary_storage.

### ParameterValue
Valor tipado, origem e indicação de sensibilidade.

## 7. Serviços de domínio

- **GraphValidator:** valida estrutura, portas, ciclos e dependências.
- **SchemaCompatibilityService:** compara schemas e aplica política de drift.
- **PlanCompiler:** cria Logical Plan.
- **PlanOptimizer:** aplica regras preservando semântica.
- **PhysicalPlanner:** seleciona engines, adaptadores e particionamento.
- **PartitionPlanner:** produz partições determinísticas.
- **WriteStrategySelector:** escolhe estratégia conforme capability.
- **RetryDecisionService:** decide retry a partir da política e erro normalizado.
- **LineageBuilder:** produz relações de lineage a partir do plano e execução.
- **ConfigurationResolver:** combina definição, environment e secrets references.

## 8. Tipos de domínio essenciais

```yaml
LogicalDataType:
  - boolean
  - int8
  - int16
  - int32
  - int64
  - float32
  - float64
  - decimal
  - string
  - binary
  - date
  - time
  - timestamp
  - timestamp_tz
  - json
  - array
  - struct
  - unknown

FailureAction:
  - accept
  - reject
  - warn
  - fail

ExecutionStatus:
  - created
  - planning
  - queued
  - running
  - retrying
  - cancelling
  - cancelled
  - succeeded
  - failed
```

## 9. Políticas de consistência

- Publicação do pipeline e criação de versão: consistência forte no agregado.
- Estado da execução: consistência forte por Execution com optimistic locking.
- Logs, métricas e lineage: consistência eventual por eventos.
- Catálogo de plugins: leitura cacheável, ativação transacional.
- Checkpoint e gravação de destino: não prometer exactly-once universal; declarar semântica por conector e estratégia.

## 10. Contratos de repositório

```python
class PipelineRepository:
    def get_draft(self, pipeline_id): ...
    def save_draft(self, draft, expected_revision): ...
    def get_version(self, pipeline_id, version): ...
    def publish(self, draft, expected_revision): ...

class ExecutionRepository:
    def create(self, execution): ...
    def get(self, execution_id): ...
    def save(self, execution, expected_version): ...

class SchemaRepository:
    def get(self, schema_id, version=None): ...
    def publish(self, schema): ...
```

Interfaces são conceituais; assinaturas finais serão definidas na especificação técnica.

## 11. Eventos de integração

Envelope padrão:

```json
{
  "eventId": "ulid",
  "eventType": "ExecutionStarted",
  "eventVersion": 1,
  "occurredAt": "ISO-8601",
  "correlationId": "ulid",
  "causationId": "ulid",
  "tenantId": "optional",
  "payload": {}
}
```

Eventos publicados devem ser versionados, idempotentes para consumidores e livres de secrets.

## 12. Modelo declarativo mínimo

```yaml
schemaVersion: rdf.pipeline/v1
kind: Pipeline
metadata:
  id: load-active-customers
  name: Load Active Customers
spec:
  parameters: []
  nodes:
    - id: source
      component:
        type: core.database.source
        version: 1.0.0
      config:
        connectionRef: source-db
        query: SELECT id, status FROM customers
    - id: filter
      component:
        type: core.filter
        version: 1.0.0
      config:
        expression: status == "ACTIVE"
  edges:
    - from: source.main
      to: filter.input
  execution:
    engine: auto
    parallelism:
      enabled: false
```

## 13. Regras para implementação

1. Entidades de domínio não importam FastAPI, SQLAlchemy, React ou drivers.
2. Identidade, invariantes e transições ficam no domínio.
3. Persistência implementa portas, não define o modelo de domínio.
4. Erros externos são normalizados em uma taxonomia interna.
5. Eventos são produzidos por mudanças reais de estado.
6. Nenhum plugin acessa internals sem contrato público.
7. Toda definição persistida declara versão de schema.
8. Não modelar segredo como string comum.
9. Não misturar coordenadas visuais à definição lógica.
10. Não assumir exactly-once entre sistemas heterogêneos.
