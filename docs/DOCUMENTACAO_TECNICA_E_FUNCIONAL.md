# 🚀 RocketDataForge — Documento Técnico e Funcional da Aplicação

**Versão da Aplicação:** `1.3.0`  
**Status do Projeto:** Enterprise Production Ready  
**Padrão Arquitetural:** Clean Architecture / DDD (Domain-Driven Design) com Compilador de Álgebra Relacional e Motores de Execução Vetorizados Híbridos (DuckDB + Polars).

---

## 1. Visão Geral e Propósito (Executive Summary)

O **RocketDataForge** é um **Data Integration & Engineering Studio** de última geração, desenvolvido para modelar, validar, otimizar e executar fluxos de dados de altíssima vazão e baixa latência.

A aplicação combina a facilidade de desenvolvimento visual em **DAGs (Directed Acyclic Graphs)** com o poder de engines analíticas modernas em memória (**DuckDB**, **Polars** e **Python Engine**), operando tanto em modo interativo de desenvolvimento (*low-code / no-code*) quanto em execução de código analítico puro via notebooks modulares (*code-first*).

### Diferenciais de Engenharia:
1. **Compilação Formal de Pipelines**: Um pipeline visual não é um mero script sequencial. Ele é tratado como uma expressão da álgebra relacional que passa por **Validação Estrutural**, **Planejamento Lógico**, **Otimização Semântica baseada em Regras (RBO)** e **Compilação de Plano Físico**.
2. **Arquitetura Multi-Canvas e Células Híbridas**: Divisão modular do trabalho em **Canvas Cells** (fluxos visuais React Flow) e **Python Cells** (código Python com injeção de estado e DataFrames bidirecionais).
3. **Mecanismo de Nested-Loop e Iteração Dinâmica**: Suporte a arestas iterativas parametrizadas com interpolação de tokens em tempo de execução (`{{upstream_node.coluna}}`), permitindo que cada linha de uma fonte dispare consultas customizadas em outros bancos (DuckDB, ScyllaDB, PostgreSQL, Oracle).
4. **Data Mapper (`tMap`) de Alto Desempenho**: Mapeador visual relacional que suporta múltiplos lookups, controle de *Match Models* (`All`, `First`, `Unique`), variáveis intermediárias encadeadas, filtros com captura de rejeições e transposição nativa para DuckDB SQL.
5. **Segurança Rigorosa e Política de Segredos**: Proibição estrita de credenciais em texto claro nos nós, resolução dinâmica de segredos via `SecretReference` (`secret://...`) e assinatura digital assimétrica ECDSA de políticas de conformidade.
6. **Multi-Workspace Empresarial**: Isolamento completo de projetos, credenciais, pipelines e dados analíticos por pasta de workspace com detecção e persistência automática.

---

## 2. Arquitetura de Software e Padrões de Projeto

O backend foi construído sob os princípios da **Clean Architecture** e **Domain-Driven Design**, garantindo desacoplamento total entre o modelo de negócios e as tecnologias de infraestrutura.

```mermaid
graph TD
    UI[Frontend Studio - React 18 + Vite] -->|REST API JSON / HTTP| CP[FastAPI Control Plane :8000]
    
    subgraph CoreDomain [Domínio Puro (src/core/domain)]
        PD[PipelineDraft / PipelineVersion]
        ND[Node & Edge & Ports]
        EX[Execution & Tasks FSM]
        CN[Connection & SecretReference]
    end

    subgraph CompilerApp [Compilador de Pipelines (src/core/application/compiler)]
        GV[GraphValidator - Detecção de Ciclos & DAG]
        LP[LogicalPlanner - Árvore de Operadores Relacionais]
        PO[PlanOptimizer - Filter & Projection Pushdown]
        PP[PhysicalPlanner - Seleção de Engines & Buffers]
    end

    subgraph InfrastructureEngines [Motores & Conectores (src/core/infrastructure)]
        EW[ExecutionWorker / ExecutionManager]
        DK[DuckDB Runner - Relacional OLAP & tMap]
        PL[Polars Runner - Colunar Vetorizado em Rust]
        PY[PythonCellRunner - Execução Dinâmica com State Handoff]
        SC[ScyllaConnector - NoSQL Distribuído CQL]
        PG[PostgresConnector & OracleConnector]
        KF[Kafka & AWS SQS/SNS Messaging]
    end

    CP --> CompilerApp
    CompilerApp --> CoreDomain
    CP --> EW
    EW --> InfrastructureEngines
    InfrastructureEngines --> CoreDomain
```

### 2.1 Camadas do Código (`src/core/`)

- **`domain/` (Núcleo de Regras de Negócio)**:
  - `pipeline/`: Entidades de rascunho (`PipelineDraft`), versionamento imutável (`PipelineVersion`), nós (`Node`), arestas (`Edge`), portas de dados (`PortId`).
  - `execution/`: Entidade de ciclo de vida (`Execution`), tarefas atômicas por nó (`TaskExecution`) e máquina de estados canônica (`ExecutionStatus`).
  - `metadata/`: Entidades de conexões (`Connection`) com proteção contra chaves em texto plano (`FORBIDDEN_PLAINTEXT_KEYS`).
  - `catalog/`: Definições canônicas de componentes, capacidades e tipos de dados lógicos (`LogicalDataType`).
  - `shared/`: Tipos primitivos com validação de invariantes (`SemanticVersion`, `EntityId`, exceções `DomainError`, `DomainValidationError`).

- **`application/` (Casos de Uso e Compilação)**:
  - `compiler/validator.py`: Validação de aciclicidade (Tarjan/DFS), compatibilidade de portas, detecção de nós órfãos e mapeamento de arestas de iteração (`iterator_edges`).
  - `compiler/logical_planner.py`: Converte o grafo de nós em uma árvore formal de operadores algébricos (`LogicalScan`, `LogicalFilter`, `LogicalProject`, `LogicalJoin`, `LogicalTMap`, `LogicalSink`).
  - `compiler/optimizer.py`: Otimizador baseado em regras (RBO) que realiza *Filter Pushdown* (empurrando filtros para as fontes) e *Projection Pushdown* (eliminando colunas desnecessárias antes do transporte).
  - `compiler/physical_planner.py`: Seleciona determinística e atomicamente a melhor engine física (`duckdb` ou `polars`) para cada operador com base na carga e natureza dos dados.
  - `workspace/`: Gerenciador multi-workspace com isolamento de diretórios, banco DuckDB e metadados.

- **`infrastructure/` (Implementações Concretas)**:
  - `engines/`: Motor DuckDB (`DuckDBRunner`), Motor Polars (`PolarsRunner`) e Executor de Células Python (`PythonCellRunner`).
  - `connectors/`: Conectores para ScyllaDB, PostgreSQL, Oracle, Kafka, AWS SQS, AWS SNS e arquivos locais (CSV, Parquet, JSON, Excel).
  - `execution/`: Worker assíncrono multithread (`ExecutionWorker`), orquestrador em background (`ExecutionManager`) e cancelamento cooperativo (`CancellationToken`).
  - `security/`: Resolução de segredos (`SecretResolver`), sanitização de logs (`sanitize_message`) e motor de políticas criptográficas (`PolicyEngine`).
  - `web/`: Roteadores FastAPI (`pipelines.py`, `executions.py`, `connections.py`, `workspaces.py`).

---

## 3. Pilha Tecnológica Completa (Tech Stack)

### 3.1 Backend
| Tecnologia | Versão Mínima | Função e Racional Técnico |
| :--- | :--- | :--- |
| **Python** | `3.11` / `3.12` | Runtime central com alta compatibilidade para computação numérica e drivers assíncronos. |
| **FastAPI** | `^0.115.0` | API REST de alto desempenho, documentação OpenAPI automática e suporte nativo a `asyncio`. |
| **DuckDB** | `^1.1.0` | Engine SQL OLAP embarcada. Executa queries relacionais com vetorização SIMD direta sobre arquivos e memória sem custo de serialização. |
| **Polars** | `^1.8.0` | Engine de DataFrames escrita em Rust com paralelismo nativo em multithreading (Rayon), utilizada para varreduras rápidas e projeções. |
| **Cassandra Driver** | `^3.29.0` | Driver CQL nativo com `AsyncioConnection` para comunicação com ScyllaDB e Apache Cassandra. |
| **Psycopg2-binary** | `^2.9.9` | Driver de banco relacional PostgreSQL com suporte a cursores nomeados para streaming de grandes volumes. |
| **SQLAlchemy** | `^2.0.30` | ORM e controle transacional para o banco de metadados SQLite/PostgreSQL. |
| **Pydantic** | `^2.8.0` | Validação estrita de contratos de entrada/saída (DTOs) com serialização ultrarrápida (Core em Rust). |
| **OpenTelemetry** | `^1.26.0` | Tracing e instrumentação padronizada para métricas operacionais e diagnósticos. |
| **Pytest** | `^8.0.0` | Suíte de testes com cobertura de testes unitários, de integração e testes golden determinísticos. |

### 3.2 Frontend
| Tecnologia | Versão | Função e Racional Técnico |
| :--- | :--- | :--- |
| **React** | `^18.3.1` | Biblioteca reativa baseada em hooks e composição modular. |
| **TypeScript** | `^5.7.3` | Segurança de tipagem em tempo de compilação em todo o ciclo de vida do estúdio visual. |
| **Vite** | `^6.1.0` | Bundler e servidor de desenvolvimento ultra-rápido com Hot Module Replacement (HMR). |
| **React Flow** | `^11.11.4` | Biblioteca para renderização do canvas infinito, nós interativos, conexões de portas e minimapa. |
| **Monaco Editor** | `@monaco-editor/react` | Editor de código com realce de sintaxe, autocompletion e atalhos idênticos ao Visual Studio Code para as células Python. |
| **Zustand** | Integrado | Gerenciamento de estado global reativo para abas de jobs, células, conexões e variáveis de contexto. |
| **Lucide React** | `^0.475.0` | Ícones modernos e consistentes para o catálogo de componentes. |
| **Vanilla CSS** | CSS3 Moderno | Sistema de design personalizado com suporte a tema escuro profundo, glassmorphism e microanimações. |

---

## 4. O Ciclo de Vida do Pipeline (Pipeline Compilation & Execution)

O processamento de um job no RocketDataForge passa por 6 etapas rigorosamente estruturadas:

```mermaid
sequenceDiagram
    autonumber
    actor User as Engenheiro de Dados
    participant UI as Studio UI (React)
    participant API as FastAPI Control Plane
    participant Comp as Compiler Pipeline
    participant Worker as Execution Worker
    participant DB as Engines (DuckDB / Polars / Scylla)

    User->>UI: Desenha nós e arestas no Canvas
    User->>UI: Clica em "Executar Célula" ou "Executar Job"
    UI->>API: POST /api/pipelines/{id}/update_draft (JSON)
    API->>Comp: 1. GraphValidator.validate(draft)
    Comp-->>API: DAG válida (sem ciclos, portas compatíveis)
    API->>Comp: 2. LogicalPlanner.compile(draft)
    Comp-->>API: Árvore de Operadores Relacionais
    API->>Comp: 3. PlanOptimizer.optimize(logical_plan)
    Comp-->>API: Plano Lógico Otimizado (Pushdowns aplicados)
    API->>Comp: 4. PhysicalPlanner.compile(optimized_plan)
    Comp-->>API: PhysicalPlan com Engines Selecionadas
    API->>Worker: 5. ExecutionWorker.run(plan)
    loop Para cada operador em topologia
        Worker->>DB: Executa Scan, Transform, Iteração ou Sink
        DB-->>Worker: Registros processados & métricas
        Worker->>API: Emite telemetria atômica (rows_in, rows_out)
    end
    Worker-->>API: Execution SUCCEEDED
    API-->>UI: Métricas em tempo real e atualização de status
```

### 4.1 Validação Estrutural (`GraphValidator`)
- Garante que o grafo é acíclico através de algoritmo DFS com coloração de vértices.
- Valida compatibilidade de tipos entre portas de origem e destino (`dataset`, `lookup`, `reject`).
- Detecta arestas de iteração (`iterator_edges`), identificando automaticamente loops de processamento linha a linha (*Nested-Loop Iteration*).

### 4.2 Planejamento Lógico (`LogicalPlanner`)
- Desacopla as propriedades visuais do React Flow e gera nós canônicos da álgebra relacional:
  - `LogicalScan`: Leitura de origens com metadados de conexão, queries e caminhos.
  - `LogicalFilter`: Restrição de tuplas via predicados booleanos.
  - `LogicalProject`: Projeção de colunas e mapeamentos dimensionais.
  - `LogicalJoin`: Junção relacional binária de dois fluxos.
  - `LogicalTMap`: Mapeador complexo multi-origem com lookups e variáveis.
  - `LogicalSink`: Gravação em destinos com ações de tabela e dados.

### 4.3 Otimização Semântica (`PlanOptimizer`)
- **Filter Pushdown**: Analisa predicados em nós `core.filter` e os empurra diretamente para a query SQL da fonte (`core.database.source`), evitando transferência de dados desnecessários pela rede.
- **Projection Pushdown**: Inspeciona colunas requeridas pelos nós a jusante e projeta apenas os campos necessários na fonte.

### 4.4 Planejamento Físico (`PhysicalPlanner`)
Aplica uma regra determinística para selecionar a engine de execução (ADR-010):
- **DuckDB**: Selecionada para nós de junção relacional complexa (`LogicalJoin`), transformações analíticas (`LogicalTMap`), leitura/escrita relacional SQL e destinos DuckDB.
- **Polars**: Selecionada para operações de streaming colunar de alto desempenho, leitura/escrita rápida de arquivos (CSV, Parquet, JSON) e filtros/projeções lineares em memória.

---

## 5. Estrutura Funcional: Multi-Canvas e Células de Execução

O estúdio suporta pipelines corporativos modulares através do conceito de **Multi-Canvas**:

```mermaid
graph LR
    subgraph Job [Job: Processamento_Harmonizacao_Brasil]
        C1[canvas-cell-01: Extração & Validação Inicial] -->|Dependência OK| C2[canvas-cell-02: Carga Dimensões DuckDB]
        C2 -->|Dependência OK| P1[python-cell-03: Limpeza de Anomalias com Pandas/Polars]
        P1 -->|Dependência OK| C3[canvas-cell-04: Carga NoSQL ScyllaDB]
    end
```

### 5.1 Canvas Cell (Fluxo Visual)
- Permite desenhar visualmente a topologia de nós com drag-and-drop a partir do catálogo.
- Suporta múltiplos nós com conexões diretas de dados (`main`), conexões de junção (`lookup`), arestas de iteração (`iterate`) e captura de rejeições (`reject`).
- Pode ser executada individualmente com isolamento de contexto e painel exclusivo de **Métricas e Logs**.

### 5.2 Python Cell (Código Puro Interativo)
- Provê um ambiente modular estilo notebook embutido com o editor **Monaco** (VS Code).
- **Injeção de Contexto (`State Handoff`)**:
  - O script Python tem acesso a um objeto `ctx` injetado pelo backend.
  - `ctx.get_df(cell_name)`: Recupera o DataFrame Polars/DuckDB produzido por qualquer célula anterior do job.
  - `ctx.set_df(output_name, df)`: Salva DataFrames produzidos pelo código Python no buffer compartilhado da memória do job para consumo em canvas cells a jusante.
  - `ctx.log(mensagem)`: Envia logs ao vivo diretamente para o console da célula no frontend.
- O executor utiliza um subprocesso isolado com tratamento de exceções, garantindo que falhas em scripts de usuário não afetem o Control Plane da aplicação.

---

## 6. Motores de Execução Híbridos (Execution Engines)

### 6.1 DuckDB Runner (`src/core/infrastructure/engines/duckdb_runner.py`)
- Opera em modo *in-memory* ou persistido em arquivo local `.duckdb`.
- **Zero-Copy Arrow Integration**: Utiliza a interface Apache Arrow para registrar DataFrames Polars diretamente no DuckDB sem custo de cópia de memória (`conn.register("_chunk_batch", arrow_table)`).
- **Ações de Tabela (`Table Actions`)**:
  - `none`: Preserva a estrutura existente.
  - `drop_create` / `drop_if_exists_create`: Recria a tabela com base no schema do lote.
  - `create_if_not_exists`: Cria a tabela caso não exista previamente.
  - `truncate` / `delete_all`: Esvazia os registros antes da gravação do primeiro chunk.
- **Ações de Dados (`Data Actions`)**:
  - `insert`: Inserção padrão com alinhamento nominal de colunas (`INSERT INTO table (colA, colB) SELECT ...`).
  - `upsert` / `update_or_insert`: Utiliza chaves primárias configuradas para atualizar registros existentes ou inserir novos.
- **Batch Processing**: Suporte a processamento paginado em blocos configuráveis (`batch_size`, ex: 10.000 registros por lote).

### 6.2 Polars Runner (`src/core/infrastructure/engines/polars_runner.py`)
- Motor colunar baseado na biblioteca Polars em Rust.
- Executa operações de projeção, filtragem com captura de rejeição e streaming de leitura/escrita em tempo linear.
- **Resiliência a Tipos Mistos**: O utilitário `batch_to_polars_df` garante unificação de tipos heterogêneos, evitando falhas em colunas com números e strings mesclados vindos de drivers externos.

### 6.3 Python Cell Runner (`src/core/infrastructure/engines/python_cell_runner.py`)
- Executa scripts Python com injeção segura de contexto, DataFrames e variáveis de ambiente.
- Captura stdout, stderr e logs estruturados em tempo real, integrando-os com a telemetria do estúdio.

---

## 7. Conectores e Integrações Nativas

O catálogo possui conectores otimizados para diversos ecossistemas corporativos:

| Conector | Tipo | Capacidades Principais |
| :--- | :--- | :--- |
| **ScyllaDB / Cassandra** | NoSQL | Leitura CQL com paginação e Varredura Paralela de Tokens Murmur3 (até 16 threads). Escrita concorrente com Prepared Statements assíncronos Shard-Aware. Tratamento rico de erros (topologia, timeout, permissão). |
| **DuckDB** | OLAP Local | Leitura e escrita ultrarrápida em `.duckdb` ou arquivos locais tratados como views em memória. Suporte completo a Ações na Tabela e nos Dados. |
| **PostgreSQL** | Relacional | Conector nativo via psycopg2 com cursores nomeados (`named cursors`) no servidor, evitando estouro de memória em datasets com milhões de linhas. |
| **Oracle Database** | Relacional | Integração direta com suporte a queries SQL complexas, pushdown de filtros e escrita em lote com tratamento de maiúsculas/minúsculas. |
| **Apache Kafka** | Streaming | Consumo e produção em lote com commits manuais de offset e serialização/desserialização JSON de alta velocidade. |
| **AWS SQS & SNS** | Nuvem / Mensageria | Recepção de mensagens em lote (Standard/FIFO), publicação Pub/Sub com formatação JSON e resolução de credenciais seguras. |
| **Arquivos Locais** | Filesystem | Leitura e escrita colunar em Parquet, CSV delimitado, JSON Lines e planilhas Excel. |

---

## 8. Mecanismo de Iteração Dinâmica (Nested Loop Scan)

Um dos pontos mais avançados da aplicação é a capacidade de realizar **Varreduras Iterativas Linha a Linha** (semelhante ao comportamento de operadores *tFlowToIterate*):

```mermaid
graph TD
    A[Nó 1: duckdb_source_4] -->|68 linhas| B[Nó 2: postgres_source_3]
    B -->|Aresta 'iterate' com 68 linhas| C[Nó 3: scylla_1 - ScyllaDB]
    C -->|Resultados Combinados via Union| D[Nó 4: duckdb_sink_2 - DuckDB]

    subgraph LoopExec [Execução Iterativa no Nó 3]
        C1[Para cada linha do Nó 2] --> C2[Interpola tokens na Query CQL]
        C2 --> C3[Executa SimpleStatement no ScyllaDB]
        C3 --> C4[Acumula DataFrame do lote]
    end
```

### 8.1 Interpolação de Tokens (`_interpolate_tokens`)
O motor analisa a query da fonte e substitui tokens no formato `{{upstream_id.coluna}}`, `{{row.coluna}}` ou `{{coluna}}` pelos valores correspondentes da tupla atual.
- **Tipagem Automática em SQL/CQL**:
  - Valores numéricos (`int`, `float`) são injetados sem aspas (ex: `and consultant_code = 1001`).
  - Strings e textos recebem escape de aspas simples para segurança contra injeção SQL (ex: `'SP'`).
  - Nulos viram `NULL` e booleanos viram `TRUE`/`FALSE`.
- **Validação Antecipada**: Caso algum token não seja encontrado nas colunas da linha anterior, a execução é interrompida com o código `ERR_UNRESOLVED_TOKEN` listando claramente todas as colunas disponíveis.

---

## 9. Mapeador de Dados Avançado (Data Mapper / `tMap`)

O componente `core.tmap` é o coração das transformações relacionais visuais do RocketDataForge:

```mermaid
graph LR
    subgraph Inputs [Fluxos de Entrada]
        Main[Main Input: Pedidos]
        L1[Lookup 1: Clientes]
        L2[Lookup 2: Produtos]
    end

    subgraph tMapCore [Data Mapper Engine - DuckDB]
        Match[Match Models: All / First / Unique]
        Vars[Variáveis Intermediárias: Var.desconto_final]
        JoinType[Join: Inner / Left Outer]
    end

    subgraph Outputs [Múltiplas Saídas]
        Out1[Saída Principal: Faturamento]
        Out2[Rejeições Inner Join: catch_inner_join_reject]
        Out3[Rejeições de Filtro: catch_output_reject]
    end

    Inputs --> tMapCore
    tMapCore --> Outputs
```

### Características Técnicas:
1. **Match Models Configuráveis por Lookup**:
   - `All matches`: Comportamento relacional padrão (todas as linhas correspondentes).
   - `First match`: Retorna apenas o primeiro registro correspondente na tabela de lookup.
   - `Unique match`: Garante correspondência única com descarte determinístico de duplicatas.
2. **Variáveis Intermediárias (`Var`)**:
   - Cálculos e conversões intermediárias avaliadas em ordem sequencial e reutilizáveis nas saídas.
3. **Captura Dupla de Rejeições**:
   - `catch_inner_join_reject`: Roteia para uma porta de saída exclusiva todas as linhas da origem principal que não encontraram correspondência nos lookups com *Inner Join*.
   - `catch_output_reject`: Roteia linhas que foram descartadas pelos filtros de expressão das outras saídas.
4. **Transpilação SQL DuckDB**:
   - Toda a lógica configurada visualmente na interface é transposta para uma consulta SQL DuckDB altamente otimizada, executada com aceleração vetorizada em memória.

---

## 10. Segurança, Políticas e Gestão de Segredos

O RocketDataForge adota uma postura **Secure-by-Design**:

### 10.1 Gestão de Segredos e Prevenção de Vazamento
- **Chaves Sensíveis Proibidas**: As entidades de conexão e nós rejeitam terminantemente chaves como `password`, `pwd`, `secret`, `token` em campos abertos de opções (`FORBIDDEN_PLAINTEXT_KEYS`).
- **Resolução Indireta**: Todas as credenciais utilizam URIs do tipo `SecretReference` (`secret://env/NOME_VARIAVEL`).
- **Sanitização de Mensagens (`sanitize_message`)**: Toda exceção, mensagem de log ou telemetria passa por regex de sanitização que oculta senhas em URLs (`postgres://user:***@host...`) e pares chave-valor antes de serem persistidas ou exibidas na UI.

### 10.2 Motor de Políticas Criptográficas (`PolicyEngine`)
- Validação de conformidade corporativa baseada em políticas assinadas assimetricamente com **chaves elípticas ECDSA (SECP256k1)**.
- **Detecção de Violação (Anti-Tamper)**: Modificações indevidas no arquivo de pipeline invalidam imediatamente a assinatura digital, impedindo sua execução em ambientes de produção.
- **Restrições de Execução**: Bloqueio de conectores não autorizados, limites máximos de tamanho de lote e vinculação de identidade corporativa.

---

## 11. Workspaces e Isolamento de Projetos

A partir da versão 1.2+, a aplicação suporta múltiplos workspaces independentes:

```mermaid
graph TD
    WS[Workspace Ativo: C:/Natura/harmonizacao_brasil]
    WS --> D[data/ - Bancos DuckDB, Parquet e CSVs]
    WS --> P[pipelines/ - Rascunhos e Jobs JSON]
    WS --> C[connections/ - Conexões Cadastradas]
    WS --> M[metadata.db - Banco de Dados Local SQLite]
```

- **Seleção no Startup**: Modal interativo que permite escolher um workspace existente via navegador de arquivos do SO (`Browse`) ou criar um novo.
- **Workspace Default**: O último workspace utilizado é gravado na configuração da aplicação e carregado automaticamente nas inicializações seguintes.
- **Portabilidade**: Como todos os caminhos relativos e arquivos DuckDB residem dentro da pasta do workspace, o diretório pode ser versionado via Git e executado em qualquer outro computador sem quebra de referências.

---

## 12. Observabilidade, Métricas e Diagnósticos de Erros

A aplicação implementa telemetria em tempo real no nível de nós:

```mermaid
graph LR
    Worker[Execution Worker] -->|Eventos Atômicos| Hub[Execution Tracker]
    Hub -->|OpenTelemetry Spans| Trace[OpenTelemetry Exporter]
    Hub -->|WebSocket / Polling| UIConsole[Live Metrics & Log Console]
```

- **Métricas por Nó**: Linhas lidas (`rows_in`), linhas gravadas (`rows_out`), taxa de transferência (`rows/s`), tempo de execução em milissegundos (`duration_ms`).
- **Diagnóstico Rico de Erros**:
  - `ERR_DB_CONNECTION`: Falha de autenticação, host inacessível ou porta incorreta com mensagens claras de diagnóstico.
  - `ERR_UNRESOLVED_TOKEN`: Parâmetro dinâmico ausente no fluxo a montante, listando as colunas válidas.
  - `ERR_TABLE_NOT_FOUND` / `ERR_SYNTAX`: Erros de sintaxe SQL ou CQL mapeados de forma amigável ao usuário.

---

## 13. Guia Operacional: Instalação e Execução

### 13.1 Pré-requisitos
- **Python**: Versão `3.11` ou `3.12` instalada.
- **Node.js**: Versão `18+` (recomendado Node 20 LTS) e `npm`.
- **Git** configurado.

### 13.2 Inicialização Rápida no Windows

A aplicação conta com um script automatizado de inicialização:
```cmd
start_desktop.bat
```
Esse script valida o ambiente virtual `.venv`, instala dependências faltantes, inicia o servidor backend FastAPI na porta `8000` e a interface React Vite na porta `5173`.

### 13.3 Inicialização Manual Passo a Passo

#### 1. Backend (FastAPI / Uvicorn)
```bash
# Ativar o ambiente virtual
.venv\Scripts\activate

# Instalar dependências
pip install -r requirements.txt

# Executar o Control Plane
uvicorn src.core.infrastructure.web.app:app --host 127.0.0.1 --port 8000 --reload
```

#### 2. Frontend (React / Vite)
```bash
cd ui
npm install
npm run dev
```

Acesse o estúdio em seu navegador: **`http://localhost:5173`**.

---

## 14. Matriz de Componentes e Parâmetros Canônicos

| Componente | Categoria | Propriedades Críticas | Saídas Suportadas |
| :--- | :--- | :--- | :--- |
| `connector.db.duckdb` | Source | `database_path`, `query`, `fetch_size` | `main` |
| `connector.db.duckdb.output` | Target | `database_path`, `table`, `table_action`, `data_action`, `use_batch_mode` | `None` (Sink) |
| `connector.nosql.scylla` | Source | `connection_ref`, `keyspace`, `query` (CQL), `consistency_level`, `parallel_scans` | `main` |
| `connector.nosql.scylla.output` | Target | `connection_ref`, `keyspace`, `table`, `table_action`, `write_strategy`, `concurrency` | `None` (Sink) |
| `core.tmap` | Transform | `lookups` (joins, match models), `variables` (Var), `outputs` (expressions, filters) | Multi-saídas (`main`, `reject`) |
| `core.filter` | Transform | `predicate` (expressão booleana) | `main`, `reject` |
| `core.file.source.csv` | Source | `path`, `delimiter`, `has_header`, `encoding` | `main` |
| `core.file.target.parquet` | Target | `path`, `write_mode` (`append`, `replace`) | `None` (Sink) |
| `core.database.source` | Source | `connection_ref`, `query`, `named_cursor`, `fetch_size` | `main` |
| `core.database.target` | Target | `connection_ref`, `table`, `table_action`, `data_action`, `keys` | `None` (Sink) |

---

## 15. Conclusão e Próximos Passos

O **RocketDataForge** estabelece um novo padrão para integração e engenharia de dados, combinando facilidade de uso, segurança corporativa rigorosa e a velocidade dos motores analíticos mais rápidos do mundo.

Sua arquitetura extensível permite fácil adição de novos conectores (Snowflake, BigQuery, Databricks), orquestração via DAGs exportadas para Apache Airflow ou Dagster, e execução distribuída transparente, mantendo a integridade semântica e a elegância visual do projeto.
