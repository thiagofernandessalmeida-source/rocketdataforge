# Especificação de Requisitos: Vertical Slice 001 (RocketDataForge)

**Documento:** `specs/001-vertical-slice/spec.md`  
**Versão:** 1.0.0  
**Status:** Aprovado para Implementação  
**Slice Alvo:** Vertical Slice 001 - Pipeline Visual, Compilação e Execução Local  

---

## 1. Visão Geral e Delimitação de Escopo

O objetivo deste primeiro vertical slice é entregar o ciclo de vida completo de um pipeline de dados no RocketDataForge, partindo da modelagem visual no canvas até a compilação em múltiplos estágios e a execução local assíncrona com processamento em chunks e observabilidade em tempo real.

### 1.1 No Escopo do Vertical Slice 001
1. Criação e persistência de **Workspace** e **Project** no armazenamento local.
2. Criação, manipulação e persistência de **Pipeline Draft** (nós, portas, arestas e configurações).
3. Componentes no catálogo inicial:
   - **Database Source** (PostgreSQL)
   - **File Source** (CSV, JSON, Parquet)
   - **Select** (Projeção e renomeação de colunas)
   - **Filter** (Expressões booleanas de filtragem)
   - **Join** (Inner e Left Join com chave de junção)
   - **Database Target** (PostgreSQL - Append/Replace)
   - **File Target** (Parquet, CSV, JSON)
4. Inferência e revisão manual de **Schema Lógico**.
5. Validação estática de regras estruturais e de tipos de portas (DAG acíclico, portas obrigatórias).
6. Publicação de **Pipeline Version** imutável com cálculo de hash criptográfico da lógica funcional.
7. Compilação em 3 planos: **Logical Plan**, **Optimized Plan** (com filter/projection pushdown) e **Physical Plan**.
8. Execução local assíncrona por worker utilizando **DuckDB** e **Polars**.
9. Processamento de dados por **chunks/streaming**, com controle de memória.
10. Telemetria e observabilidade: emissão e consulta de status, logs e métricas por componente (`rows_in`, `rows_out`, `duration_ms`).
11. Cancelamento cooperativo e idempotente de execuções ativas.
12. Exportação de artefatos desintegrados: `pipeline.yaml` (lógica) e `layout.json` (visual).

### 1.2 Fora do Escopo do Vertical Slice 001
- Orquestração distribuída em Kubernetes e orquestração multi-tenant SaaS.
- Engines distribuídas (Apache Spark, Flink, Ray).
- Streaming contínuo não-delimitado (Kafka, Kinesis).
- Execução remota de workers (Remote Agents / Cloud Runners).
- Autenticação corporativa via SSO/SAML/OAuth2 completo (usaremos autenticação local simples).
- Execução ativa de nós de IA/RAG/MCP (apenas contratos e pontos de extensão preservados).

---

## 2. Requisitos do Vertical Slice

### 2.1 Requisitos Funcionais

| Identificador | Título | Descrição |
| :--- | :--- | :--- |
| **FR-001** | Gestão de Pipelines e Drafts | O usuário pode criar, renomear, salvar, carregar e excluir drafts de pipeline em um projeto. |
| **FR-002** | Conexão Tipada de Portas | O usuário pode conectar portas de saída a portas de entrada, com validação de cardinalidade e compatibilidade de tipos. |
| **FR-003** | Separação Lógica/Layout | O sistema deve persistir a lógica (`pipeline.yaml`) e o posicionamento gráfico (`layout.json`) em estruturas separadas. |
| **FR-004** | Configuração de Componentes | O sistema permite configurar parâmetros de nós conforme o JSON Schema de cada componente no painel lateral. |
| **FR-005** | Gestão Segura de Conexões | Conexões são cadastradas de forma reutilizável, associadas a `SecretReference`, sem persistência de senhas em texto puro. |
| **FR-007** | Inferência e Override de Schema | O sistema é capaz de inspecionar amostras ou metadados de fontes e sugerir schemas de tipos lógicos canônicos, permitindo edição manual. |
| **FR-010** | Validação Pré-Execução | O sistema executa verificação estática do grafo (ausência de ciclos, portas desconectadas, configurações obrigatórias) antes de compilar. |
| **FR-011** | Compilação em Planos | O compilador transforma a definição visual em Logical Plan, Optimized Plan e Physical Plan de forma determinística. |
| **FR-012** | Inspeção e Explicação de Planos | O usuário pode visualizar as transformações e otimizações aplicadas (ex: pushdown de filtros) antes ou depois da execução. |
| **FR-013** | Execução Local e Cancelamento | O sistema executa o plano físico via worker local assíncrono e aceita comandos de cancelamento cooperativo a qualquer momento. |
| **FR-014** | Processamento em Chunks | O runtime deve iterar e transformar grandes massas de dados em blocos configuráveis sem sobrecarregar a memória RAM. |
| **FR-016** | Seleção de Write Strategy | O adaptador de destino deve selecionar a estratégia de gravação mais eficiente (ex: batch insert ou copy local). |
| **FR-022** | Telemetria por Componente | O sistema coleta e disponibiliza métricas estruturadas e logs detalhados para cada nó durante e após a execução. |
| **FR-024** | Publicação Imutável de Versão | O usuário pode publicar uma versão fixa do pipeline cujo identificador é derivado do hash da lógica funcional. |
| **FR-025** | Exportação de Artefatos para Git | O sistema permite exportar a definição completa como arquivos limpos prontos para versionamento em Git. |

### 2.2 Requisitos Não-Funcionais

| Identificador | Título | Critério |
| :--- | :--- | :--- |
| **NFR-001** | Segurança de Segredos | Nenhuma credencial ou token deve aparecer em logs, planos, eventos, definições exportadas ou respostas de erro. |
| **NFR-002** | Portabilidade Local | O vertical slice deve executar integralmente em uma máquina local de desenvolvimento sem dependência de serviços cloud. |
| **NFR-004** | Rastreabilidade de Telemetria | Cada log, métrica e trace deve conter obrigatoriamente `execution_id` e `correlation_id`. |
| **NFR-005** | Determinismo da Compilação | A mesma definição lógica e conjunto de parâmetros produzirá exatamente o mesmo plano de execução. |
| **NFR-006** | Versionamento de Formatos | Todo artefato exportado (`pipeline.yaml`, `layout.json`, eventos) deve conter campo explícito `schemaVersion`. |
| **NFR-007** | Testabilidade e Isolamento | O core de domínio e compilação deve ser 100% testável sem inicializar servidor HTTP ou banco de dados relacional. |
| **NFR-009** | Gestão de Memória no Runtime | O runtime local deve respeitar orçamentos de memória configuráveis e não materializar datasets inteiros em RAM por padrão. |
| **NFR-014** | Manutenibilidade e Limites DDD | Os módulos de domínio devem ser estritamente desacoplados de bibliotecas de transporte e persistência. |

---

## 3. User Stories e Critérios de Aceite (BDD)

### US-001: Criar e Salvar um Pipeline Draft
> **Como** engenheiro de dados  
> **Quero** criar um novo pipeline e editar seus componentes graficamente em formato draft  
> **Para que** eu possa desenhar meu fluxo de dados sem afetar ambientes produtivos.

- **AC-001-01:** Criação com identificador único
  - **Given** um projeto ativo existente
  - **When** o usuário solicita a criação de um novo pipeline com nome "ETL Vendas"
  - **Then** um novo `PipelineDraft` é inicializado com revisão 1 e salvo no repositório.
- **AC-001-02:** Persistência incremental de alterações
  - **Given** um draft aberto no canvas
  - **When** o usuário adiciona ou remove nós e aciona salvar
  - **Then** a revisão do draft é incrementada monotonicamente e o estado é preservado.

---

### US-002: Configurar Source e Target Genéricos
> **Como** analista de dados  
> **Quero** configurar nós de entrada (PostgreSQL, CSV, Parquet) e nós de saída (PostgreSQL, Parquet)  
> **Para que** o pipeline leia e escreva dados nos formatos requeridos.

- **AC-002-01:** Configuração de Database Source
  - **Given** um nó `core.database.source` no canvas
  - **When** o usuário seleciona a conexão `postgres-crm` e define a query `SELECT id, nome, status FROM clientes`
  - **Then** a configuração do nó é validada contra o JSON Schema do componente e salva com sucesso.
- **AC-002-02:** Rejeição de credenciais diretas no nó
  - **Given** o painel de propriedades de um nó
  - **When** o usuário tenta inserir uma senha diretamente na configuração do nó
  - **Then** o sistema rejeita a entrada e exige o vínculo com uma `connectionRef` registrada.

---

### US-003: Inferir e Editar Schema Lógico
> **Como** engenheiro de dados  
> **Quero** inferir o esquema de uma fonte de dados e revisar os tipos detectados  
> **Para que** as transformações subsequentes operem sobre tipos de dados conhecidos e canônicos.

- **AC-003-01:** Inferência a partir de arquivo CSV/Parquet
  - **Given** um nó `File Source` apontando para um arquivo CSV válido
  - **When** o usuário clica em "Inferir Schema"
  - **Then** o sistema lê uma amostra inicial do arquivo e retorna a lista de colunas com nomes, tipos lógicos canônicos (`int64`, `string`, `timestamp`) e nulabilidade.
- **AC-003-02:** Sobrescrita manual de tipos
  - **Given** um schema inferido com a coluna `codigo_postal` como `int64`
  - **When** o usuário altera o tipo lógico para `string`
  - **Then** a alteração é gravada como override de schema no draft.

---

### US-004: Conectar Nodes com Validação de Portas
> **Como** usuário do designer  
> **Quero** ligar a saída de um componente à entrada de outro componente  
> **Para que** o fluxo de dados seja estabelecido corretamente e sem inconsistências de portas.

- **AC-004-01:** Conexão válida entre portas compatíveis
  - **Given** um nó `Database Source` com porta de saída `main` e um nó `Filter` com porta de entrada `input`
  - **When** o usuário conecta a porta de saída à porta de entrada
  - **Then** uma `Edge` é criada e o grafo permanece em estado válido.
- **AC-004-02:** Bloqueio de conexões cíclicas proibidas
  - **Given** um pipeline com uma aresta existente de A para B
  - **When** o usuário tenta criar uma aresta de B para A em um pipeline padrão acíclico
  - **Then** a ação é rejeitada pelo validador com código `ERR_CYCLIC_DEPENDENCY`.

---

### US-005: Validar e Publicar uma Versão Imutável
> **Como** engenheiro de dados  
> **Quero** validar e publicar meu draft em uma versão imutável  
> **Para que** execuções oficiais utilizem um snapshot fixo e auditável.

- **AC-005-01:** Publicação com cálculo de hash da lógica
  - **Given** um draft com validação estrutural e semântica 100% aprovada
  - **When** o usuário aciona o comando "Publicar Versão"
  - **Then** uma `PipelineVersion` imutável é criada, recebe uma tag semântica (ex: `1.0.0`), e seu `definition_hash` é calculado sobre o conteúdo canônico de `pipeline.yaml`.
- **AC-005-02:** Isolamento de alterações de layout
  - **Given** uma `PipelineVersion` já publicada
  - **When** um novo draft é criado alterando apenas a posição visual (x, y) de um nó
  - **Then** o diff lógico entre as definições funcionais é vazio e o hash da lógica não se altera.

---

### US-006: Compilar e Visualizar Planos (Logical, Optimized, Physical)
> **Como** engenheiro de dados sênior  
> **Quero** inspecionar o plano lógico, otimizado e físico gerado pelo compilador  
> **Para que** eu possa auditar as otimizações aplicadas antes de executar.

- **AC-006-01:** Geração dos três estágios de compilação
  - **Given** uma `PipelineVersion` publicada
  - **When** a compilação é requisitada
  - **Then** o compilador produz:
    1. `LogicalPlan` representando o fluxo de operadores algébricos;
    2. `OptimizedPlan` com as transformações otimizadas;
    3. `PhysicalPlan` com os nós associados às engines concretas (DuckDB/Polars).
- **AC-006-02:** Pushdown de filtro baseado em capability
  - **Given** um nó `Filter` posicionado imediatamente após um `PostgreSQL Source`
  - **When** o adaptador do PostgreSQL declara a capability `supports_filter_pushdown`
  - **Then** o otimizador embute o predicado na query do source e adiciona uma anotação explicativa no plano.

---

### US-007: Executar Pipeline Localmente
> **Como** operador de pipeline  
> **Quero** disparar a execução de uma versão publicada no ambiente local  
> **Para que** os dados sejam transformados e gravados no destino final.

- **AC-007-01:** Execução ponta a ponta com DuckDB/Polars
  - **Given** um pipeline publicado contendo `File Source` (CSV), `Filter`, `Select` e `File Target` (Parquet)
  - **When** o usuário solicita a execução
  - **Then** um worker consome a tarefa, executa o plano físico por chunks, grava o arquivo Parquet e conclui com status `SUCCEEDED`.
- **AC-007-02:** Transição correta da máquina de estados
  - **Given** uma nova execução requisitada
  - **Then** o agregado transita estritamente pelos estados: `CREATED -> PLANNING -> QUEUED -> RUNNING -> SUCCEEDED`.

---

### US-008: Visualizar Logs e Métricas por Componente
> **Como** usuário monitorando um pipeline  
> **Quero** visualizar o progresso, as métricas e os logs de cada nó em tempo real  
> **Para que** eu identifique gargalos e valide a volumetria processada.

- **AC-008-01:** Métricas de contagem de linhas e tempo
  - **Given** uma execução em andamento ou finalizada
  - **When** o usuário consulta a telemetria do nó `Filter`
  - **Then** o sistema retorna `rows_in`, `rows_out`, `rejected_count`, `duration_ms` e a memória de pico utilizada.
- **AC-008-02:** Logs estruturados associados ao execution_id
  - **Given** múltiplos pipelines executando no mesmo nó local
  - **When** os logs são consultados filtrando por `execution_id`
  - **Then** apenas os eventos associados àquela execução específica são retornados, correlacionados pelo identificador.

---

### US-009: Cancelar uma Execução em Andamento
> **Como** operador de dados  
> **Quero** cancelar imediatamente uma execução de longa duração  
> **Para que** recursos da minha máquina sejam liberados sem corrupção de dados.

- **AC-009-01:** Cancelamento cooperativo bem-sucedido
  - **Given** uma execução no estado `RUNNING`
  - **When** o usuário envia uma requisição de cancelamento
  - **Then** o estado muda para `CANCELLING`, o worker interrompe o processamento na próxima fronteira de chunk e finaliza com status `CANCELLED`.
- **AC-009-02:** Idempotência do cancelamento
  - **Given** uma execução já cancelada ou finalizada
  - **When** o comando de cancelamento é enviado repetidas vezes
  - **Then** a operação retorna sucesso sem erro de estado e o status final permanece inalterado.

---

### US-010: Exportar Definição e Layout para Git
> **Como** desenvolvedor de dados  
> **Quero** exportar meu projeto em formato limpo para controle de versão em Git  
> **Para que** eu possa realizar revisões de código via Pull Request e CI/CD.

- **AC-010-01:** Estrutura limpa de arquivos exportados
  - **Given** um pipeline salvo
  - **When** a exportação para disco/Git é acionada
  - **Then** os arquivos `pipeline.yaml` e `layout.json` são gerados na pasta do projeto com identação determinística e metadados de versão `schemaVersion`.
- **AC-010-02:** Ausência absoluta de segredos exportados
  - **Given** o arquivo `pipeline.yaml` exportado
  - **When** o conteúdo textual do arquivo é analisado
  - **Then** nenhuma senha, token ou chave confidencial está presente, constando apenas strings de identificação de `connectionRef` e `secretRef`.

---

### US-011: Tratar Falhas e Rejeições Conforme Política
> **Como** engenheiro de dados  
> **Quero** que erros em conexões ou dados inválidos sejam tratados conforme política de retry configurada  
> **Para que** falhas transitórias não interrompam pipelines desnecessariamente.

- **AC-011-01:** Retry com backoff em erro transiente
  - **Given** um `Database Source` com política de 3 retries configurada
  - **When** o conector encontra uma queda temporária de rede na primeira tentativa
  - **Then** o worker aguarda o delay estipulado, retenta e registra a tentativa no histórico de execuções.
- **AC-011-02:** Falha terminal e registro detalhado de erro
  - **Given** uma falha de conversão não recuperável com política `fail_fast`
  - **When** a linha inválida é processada
  - **Then** a execução transita para `FAILED`, gravando o código `ERR_EXECUTION_TRANSFORMATION` e a mensagem de erro normalizada.

---

### US-012: Garantir Isolamento e Redaction de Segredos
> **Como** auditor de segurança da plataforma  
> **Quero** certificar que nenhum segredo trafegue ou seja gravado em claro  
> **Para que** vazamentos de credenciais sejam matematicamente impossíveis nas camadas de persistência e observabilidade.

- **AC-012-01:** Redaction em logs e mensagens de erro
  - **Given** uma falha de conexão com PostgreSQL onde a exception do driver conteria o password
  - **When** o sistema formata a mensagem de log e o erro para o usuário
  - **Then** todos os padrões de credencial são substituídos pela tag `***REDACTED***`.
- **AC-012-02:** Validação no salvamento de conexões
  - **Given** a API de cadastro de `Connection`
  - **When** uma conexão é persistida no banco de metadados
  - **Then** o campo de credencial persiste apenas um URI do tipo `secret://env/POSTGRES_PWD` ou `secret://vault/key-name`.
