# Modelo de Domínio: Vertical Slice 001 (RocketDataForge)

**Documento:** `specs/001-vertical-slice/domain-model.md`  
**Versão:** 1.0.0  
**Status:** Normativo / DDD Puro  
**Princípio:** Sem acoplamento a frameworks externos (sem FastAPI, SQLAlchemy ou drivers)  

---

## 1. Linguagem Ubíqua do Vertical Slice

- **Workspace:** Limite organizacional e de segurança.
- **Project:** Coleção lógica de pipelines e artefatos de dados.
- **PipelineDraft:** Grafo editável e mutável composto por nós, portas, arestas e parâmetros.
- **PipelineVersion:** Snapshot imutável de uma definição funcional válida, identificado por hash criptográfico.
- **Node:** Instância configurada de um tipo de componente no grafo.
- **Port:** Ponto de entrada ou saída tipado de um nó.
- **Edge:** Vínculo unidirecional conectando uma porta de saída a uma porta de entrada compatível.
- **ComponentDefinition:** Contrato público de um componente (tipos de portas, JSON Schema de configuração e capabilities).
- **Connection:** Configuração de acesso a uma fonte ou destino de dados, contendo exclusivamente referências de segredos.
- **SchemaDefinition:** Metadados estruturais sobre campos, tipos de dados lógicos e nulabilidade.
- **Execution:** Instância de execução de uma `PipelineVersion`, gerenciada por uma máquina de estados finita.
- **Plan:** Representação intermediária do pipeline (Logical, Optimized e Physical).

---

## 2. Value Objects Transversais

### 2.1 Identificadores e Tipagem
```python
@dataclass(frozen=True)
class EntityId:
    value: str  # ULID canônico (26 caracteres alfanuméricos)

@dataclass(frozen=True)
class SemanticVersion:
    major: int
    minor: int
    patch: int
    
    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"

@dataclass(frozen=True)
class SecretReference:
    uri: str  # Ex: "secret://env/POSTGRES_PASSWORD"
    
    def validate(self) -> None:
        if not self.uri.startswith("secret://"):
            raise DomainValidationError("SecretReference deve iniciar com 'secret://'")
```

### 2.2 Sistema Canônico de Tipos Lógicos (`LogicalDataType`)
```python
class LogicalDataType(Enum):
    BOOLEAN = "boolean"
    INT16 = "int16"
    INT32 = "int32"
    INT64 = "int64"
    FLOAT32 = "float32"
    FLOAT64 = "float64"
    DECIMAL = "decimal"
    STRING = "string"
    BINARY = "binary"
    DATE = "date"
    TIME = "time"
    TIMESTAMP = "timestamp"
    TIMESTAMP_TZ = "timestamp_tz"
    JSON = "json"
    ARRAY = "array"
    STRUCT = "struct"
    UNKNOWN = "unknown"
```

### 2.3 Portas e Direção
```python
class PortDirection(Enum):
    INPUT = "input"
    OUTPUT = "output"

class PortType(Enum):
    DATASET = "dataset"
    CONTROL = "control"
    REJECT = "reject"

@dataclass(frozen=True)
class PortId:
    node_id: str
    port_name: str  # Ex: "main", "reject", "input", "lookup"
```

---

## 3. Agregados do Domínio

### 3.1 Agregado: PipelineDraft
**Aggregate Root:** `PipelineDraft`

```text
PipelineDraft (Root)
 ├── nodes: List[Node]
 │    ├── id: str
 │    ├── component_type_id: str
 │    ├── component_version: SemanticVersion
 │    └── config: Dict[str, Any]
 ├── edges: List[Edge]
 │    ├── id: str
 │    ├── from_node: str
 │    ├── from_port: str
 │    ├── to_node: str
 │    └── to_port: str
 └── parameters: List[PipelineParameter]
```

#### Invariantes do Agregado:
1. **Identificadores Únicos de Nós:** Nenhum nó dentro do mesmo draft pode possuir o mesmo `id`.
2. **Conexões Válidas:** Toda `Edge` deve conectar nós existentes e respeitar a direção `from_port (OUTPUT) -> to_port (INPUT)`.
3. **Cardinalidade de Portas de Entrada:** Uma porta de entrada de dados (`dataset`) aceita no máximo uma aresta conectada (a menos que explicitamente definida como porta coletora de união).
4. **Aciclicidade (DAG):** O grafo de dados não pode conter ciclos orientados.
5. **Separação de Coordenadas:** O `PipelineDraft` não armazena coordenadas visuais de tela (x, y); essas coordenadas residem no agregado visual de layout.

#### Comandos e Eventos:
- `add_node(component_def: ComponentDefinition, config: Dict[str, Any]) -> NodeId`
- `connect_ports(from_port: PortId, to_port: PortId) -> EdgeId`
- `disconnect_edge(edge_id: str) -> None`
- `update_node_config(node_id: str, new_config: Dict[str, Any]) -> None`
- **Eventos:** `PipelineDraftCreated`, `NodeAdded`, `PortsConnected`, `NodeConfigured`

---

### 3.2 Agregado: PipelineVersion
**Aggregate Root:** `PipelineVersion` (Imutável)

```python
@dataclass(frozen=True)
class PipelineVersion:
    pipeline_id: str
    version_tag: str                  # Ex: "1.0.0"
    schema_version: str               # "rdf.pipeline/v1"
    definition_hash: str              # SHA-256 do YAML canônico da lógica funcional
    immutable_definition: Dict[str, Any]
    published_by: str
    published_at: datetime
```

#### Invariantes:
1. **Imutabilidade Total:** Uma vez instanciada e salva, a `PipelineVersion` nunca pode ser alterada ou sobrescrita.
2. **Determinismo Criptográfico:** `definition_hash` é calculado sobre a representação canônica serializada da definição lógica, excluindo qualquer atributo de apresentação gráfica.
3. **Validação Prévia Obrigatória:** Uma versão só pode ser gerada se o draft correspondente for aprovado sem erros pelo `GraphValidator`.

---

### 3.3 Agregado: Connection
**Aggregate Root:** `Connection`

```python
@dataclass
class Connection:
    id: str
    project_id: str
    name: str
    connector_type: str              # "postgres", "file", "s3"
    endpoint: str                    # Ex: "db.internal.corp:5432/analytics"
    secret_ref: SecretReference      # Referência ao segredo, nunca a senha em claro
    options: Dict[str, Any]          # Ex: {"ssl_mode": "require", "timeout_sec": 30}
    is_active: bool
```

#### Invariantes:
1. **Inviolabilidade de Segredos:** O objeto rejeita em tempo de instanciação qualquer chave como `password`, `secret`, `token` em campos que não sejam do tipo `SecretReference`.
2. **Identificador Estável:** O `name` é único no escopo do projeto.

---

### 3.4 Agregado: SchemaDefinition
**Aggregate Root:** `SchemaDefinition`

```python
@dataclass(frozen=True)
class FieldDefinition:
    name: str
    logical_type: LogicalDataType
    physical_type: str               # Ex: "VARCHAR(255)", "INT8"
    nullable: bool
    description: Optional[str] = None

@dataclass
class SchemaDefinition:
    id: str
    dataset_name: str
    version: int
    fields: List[FieldDefinition]
```

#### Invariantes:
1. **Nomes Únicos:** Não são permitidos campos duplicados no mesmo nível de schema.
2. **Evolução Versionada:** Qualquer adição, remoção ou alteração de tipo resulta em um novo incremento de versão.

---

### 3.5 Agregado: Execution
**Aggregate Root:** `Execution`

```python
class ExecutionStatus(Enum):
    CREATED = "created"
    PLANNING = "planning"
    QUEUED = "queued"
    RUNNING = "running"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

@dataclass
class TaskRun:
    task_id: str
    node_id: str
    status: ExecutionStatus
    rows_in: int = 0
    rows_out: int = 0
    rejected_count: int = 0
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None

@dataclass
class Execution:
    id: str
    pipeline_version_id: str
    correlation_id: str
    status: ExecutionStatus
    tasks: Dict[str, TaskRun]
    attempt: int
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_details: Optional[Dict[str, Any]] = None
```

#### Máquina de Estados Finita da Execução:
```text
[CREATED] ──> [PLANNING] ──> [QUEUED] ──> [RUNNING] ──> [SUCCEEDED]
                                            │    │
                                            │    ├───> [FAILED]
                                            │
                                            └──> [CANCELLING] ──> [CANCELLED]
```

#### Invariantes:
1. **Transições Válidas:** Não é permitido transitar de um estado terminal (`SUCCEEDED`, `FAILED`, `CANCELLED`) de volta para estados ativos.
2. **Idempotência do Cancelamento:** Solicitações de cancelamento recebidas quando o estado já é `CANCELLING` ou `CANCELLED` são confirmadas sem alteração de estado ou erro.
3. **Atomicidade da Tentativa:** O campo `attempt` inicia em 1 e só é incrementado caso haja política explícita de retry em caso de falha transiente.

---

## 4. Serviços de Domínio (Domain Services)

### 4.1 GraphValidator
Responsável por verificar a integridade estrutural e de tipos do grafo:
- Detecta ciclos através de ordenação topológica (Algoritmo de Kahn).
- Valida compatibilidade de tipos entre portas conectadas.
- Confirma que todos os nós obrigatórios têm suas portas mínimas satisfeitas.

### 4.2 PlanCompiler
Compila o grafo validado em um **LogicalPlan**:
- Transforma nós visuais em uma árvore/grafo de operadores algébricos (`Scan`, `Filter`, `Project`, `Join`, `Write`).

### 4.3 PlanOptimizer
Aplica transformações que preservam a semântica:
- Inspeciona as `Capabilities` dos adaptadores de dados conectados.
- Realiza **Projection Pushdown** (move a seleção de colunas para o `Scan`).
- Realiza **Filter Pushdown** (move predicados de filtro para a query SQL da fonte quando suportado).
- Produz um **OptimizedPlan** contendo as justificativas explicáveis de cada otimização.

### 4.4 PhysicalPlanner
Seleciona os componentes executáveis e estratégias físicas:
- Atribui os motores de execução adequados aos nós (`DuckDBEngine` vs `PolarsEngine`).
- Configura o particionamento em chunks e os limites de buffer em memória.
- Produz o **PhysicalPlan** pronto para consumo assíncrono pelo worker.
