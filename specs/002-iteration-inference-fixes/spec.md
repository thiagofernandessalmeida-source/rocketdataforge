# Especificação de Requisitos: Iteração Direta, DuckDB Integrado, tMap Visual, Ações em Tabelas e UI

**Documento:** `specs/002-iteration-inference-fixes/spec.md`  
**Versão:** 2.0.0  
**Status:** Aprovado para Planejamento e Execução  
**Contexto:** RocketDataForge — Evolução da Plataforma Low-Code ETL

---

## 1. Sumário Executivo e Objetivos

Este documento consolida e especifica o conjunto completo de evoluções funcionais, correções e novos componentes do RocketDataForge:

1. **Iteração Implícita e Direta entre Fontes de Dados (Substituição do `tFlowToIterate`):**
   - Encadeamento direto entre nós de entrada (`Input -> Input`), onde a iteração é presumida automaticamente.
   - Interpolação declarativa de parâmetros nas queries usando a sintaxe canônica `{node_id.column_name}` ou `{node_label.column_name}`.

2. **Integração Nativa de DuckDB (In-Memory Views & Componentes Dedicados):**
   - **Opção em Arquivos (CSV, Parquet, JSON, Excel):** Flag *"Tratar como Tabela DuckDB em Memória"*, permitindo consultas SQL (`SELECT`, agregados, joins locais) diretamente sobre os arquivos via motor DuckDB de alta performance.
   - **Componente `tDuckDbInput` (`connector.db.duckdb`):** Leitura de bancos DuckDB persistidos (`.duckdb`, `.db`), bancos `:memory:` ou consultas federadas sobre arquivos com funções nativas (`read_parquet`, `read_csv`, etc.).
   - **Componente `tDuckDbOutput` (`connector.db.duckdb.output`):** Gravação de datasets em arquivos DuckDB locais ou memória, criando o arquivo caso não exista.

3. **Ações em Tabelas e Ações em Dados nos Componentes de Saída (Padrão Studio Open Studio):**
   - Configuração de **Ação na Tabela (*Action on Table*)**:
     - *Nenhuma (None)*
     - *Deletar e Criar Tabela (Drop and Create)*
     - *Criar se não existir (Create if not exists)*
     - *Deletar se existir e Criar (Drop if exists and Create)*
     - *Truncar Tabela (Truncate / Clear)*
     - *Deletar todos os registros (Delete rows)*
   - Configuração de **Ação nos Dados (*Action on Data / Write Mode*)**:
     - *Inserir (Insert)*
     - *Atualizar (Update por chave primária)*
     - *Inserir ou Atualizar (Upsert / Insert or Update)*
     - *Atualizar ou Inserir (Update or Insert)*
     - *Deletar (Delete por chave primária)*

4. **Componente `tMap` (Transformação Visual no Padrão Studio `tMap`):**
   - Múltiplas entradas (Fluxo Principal *Main* + Múltiplos *Lookups* com tipos de junção: *Left Outer Join*, *Inner Join*, *First Match*, *All Matches*).
   - Múltiplos fluxos de saída nomeados e roteamento condicional (filtros por fluxo de saída e fluxo de rejeitados *Reject Flow*).
   - Tabela de Variáveis Intermediárias (*Var Table*) para cálculos intermediários reutilizáveis.
   - Construtor de Expressões (*Expression Builder*) por coluna com auto-map e mapeamento visual interativo.

5. **Identificadores de Componentes Simples e Editáveis:**
   - Geração de IDs concisos e semânticos no estilo Studio (ex: `tpostgresinput_1`, `tfileinput_1`, `tduckdbinput_1`, `tmap_1`, `tduckdboutput_1`).
   - Possibilidade de **renomear/editar o ID do componente** diretamente no painel de propriedades, com atualização em cascata de conexões e variáveis downstream.

6. **Correção de Bugs e Melhorias de UI:**
   - **BUG 1:** Inferência real e automática de schema via query SQL e cabeçalhos de arquivos (sem mock fictício).
   - **BUG 2:** Estabilidade de foco e digitação contínua na janela flutuante de configuração (duplo clique).
   - **Sidebar Toggles:** Botões de recolhimento individuais e persistentes (*Rail Toggles*) para cada painel lateral (Repositório, Paleta, Propriedades e Console).

---

## 2. Requisitos Funcionais (FR)

### FR-030: Conexão Direta entre Fontes e Iteração Implícita
- **FR-030.1:** Permitir conectar a saída de uma fonte de entrada na entrada de outra fonte de dados.
- **FR-030.2:** Interpolar variáveis na sintaxe `{node_id.column_name}` ou `{node_label.column_name}` durante a execução linha a linha.
- **FR-030.3:** Exibir chips de colunas de montante para inserção rápida na query SQL.

### FR-031: DuckDB em Arquivos e Componentes Dedicados
- **FR-031.1:** Nos nós de arquivo (CSV, Parquet, JSON, Excel), disponibilizar a opção *"Registrar como Tabela DuckDB em Memória"*, permitindo aplicar uma query SQL de transformação logo na leitura.
- **FR-031.2:** Implementar `tDuckDbInput` com suporte a arquivo `.duckdb`, `:memory:` e queries SQL sobre múltiplos arquivos locais.
- **FR-031.3:** Implementar `tDuckDbOutput` com suporte a criação de tabelas, persistência em arquivo e opções de gravação.

### FR-032: Ações de Tabela e Dados no Padrão Studio
- **FR-032.1:** Todos os nós de Target de Banco de Dados (PostgreSQL, DuckDB, MySQL, Oracle, SQL Server, etc.) devem fornecer o seletor **Ação na Tabela** (`none`, `drop_create`, `create_if_not_exists`, `drop_if_exists_create`, `truncate`, `delete_all`).
- **FR-032.2:** Todos os nós de Target de Banco devem fornecer o seletor **Ação nos Dados** (`insert`, `update`, `upsert`, `update_or_insert`, `delete`).
- **FR-032.3:** O `ExecutionWorker` deve executar a Ação na Tabela antes do streaming dos dados e respeitar a Ação nos Dados utilizando as chaves primárias (`isPrimaryKey: true`) do schema para operações de `UPDATE`, `UPSERT` e `DELETE`.

### FR-033: Componente `tMap` (Transformação Visual e Multi-Fluxo)
- **FR-033.1:** Suporte a 1 fluxo de entrada principal (*Main Flow*) e 0 ou mais fluxos de consulta (*Lookup Flows*).
- **FR-033.2:** Suporte a 1 ou mais fluxos de saída nomeados, cada qual com sua própria lista de colunas projetadas e expressão de filtro booleano opcional.
- **FR-033.3:** Tabela de Variáveis Intermediárias (*Var*) para expressões intermediárias computadas a cada registro.
- **FR-033.4:** Modal interativo de mapeamento (*tMap Studio*) com arrastar-e-soltar de colunas, auto-map por nome e editor de expressões.

### FR-034: Identificadores Simples e Renomeação de IDs
- **FR-034.1:** Ao arrastar um novo componente ao canvas, o ID padrão deve seguir a convenção limpa: `t<componente>_<sequencial>` (ex: `tpostgresinput_1`, `tmap_1`, `tfileoutput_1`).
- **FR-034.2:** O campo `ID do Nó` no painel de propriedades deve ser editável pelo usuário.
- **FR-034.3:** Ao alterar o ID, o sistema deve atualizar o identificador do nó, todas as arestas vinculadas e alertar/atualizar referências `{id_antigo.col}` nos nós conectados.

### FR-035: Inferência Real de Schema (Correção BUG 1)
- **FR-035.1:** O backend deve inspecionar a query SQL no conector ou DuckDB (`LIMIT 0` / `DESCRIBE`) e arquivos reais.
- **FR-035.2:** O frontend deve preencher a tabela de colunas no primeiro clique sem dados mocados.

### FR-036: Estabilidade de Digitação no Modal Flutuante (Correção BUG 2)
- **FR-036.1:** Desacoplar subcomponentes da árvore de renderização do `PropertyPanel` para garantir que o foco do cursor nunca seja perdido durante a digitação na janela flutuante.

### FR-037: Controles Individuais e Persistentes de Sidebars
- **FR-037.1:** Cada painel (Repositório, Paleta, Propriedades, Console) deve possuir botão próprio de recolhimento.
- **FR-037.2:** Abas verticais persistentes na borda do canvas para reabertura com 1 clique.

---

## 3. User Stories e Critérios de Aceite

### US-020: Consulta SQL Direta em Arquivos via DuckDB
- **Given** que tenho um arquivo `sales.parquet` de 500MB,
- **When** marco a opção *"Tratar como Tabela DuckDB em Memória"* e defino a query `SELECT region, SUM(amount) as total FROM sales GROUP BY region`,
- **Then** o DuckDB executa a query diretamente no arquivo em streaming de alta velocidade sem carregar todo o arquivo desnecessariamente em RAM.

### US-021: Ações de Tabela estilo Studio
- **Given** um nó `tPostgresqlOutput_1` apontando para a tabela `faturamento_diario`,
- **When** seleciono *"Ação na Tabela: Truncar Tabela (Truncate)"* e *"Ação nos Dados: Inserir (Insert)"*,
- **Then** o worker executa `TRUNCATE TABLE faturamento_diario` antes de carregar o primeiro lote de dados.

### US-022: Mapeamento e Enriquecimento com `tMap`
- **Given** uma entrada principal `clientes` e um lookup `pedidos`,
- **When** configuro no `tMap` um Left Outer Join em `cliente_id` com filtro de saída `total_pedidos > 100`,
- **Then** o `tMap` gera a saída filtrada correspondente e direciona os registros que não atenderam ao critério para o fluxo de rejeitados (*Catch Output*).

### US-023: Renomeação de ID do Componente
- **Given** um nó criado com ID `tpostgresinput_1`,
- **When** o usuário altera o campo ID para `src_consultoras`,
- **Then** o nó passa a ter ID `src_consultoras`, todas as arestas são preservadas, e os chips downstream passam a sugerir `{src_consultoras.coluna}`.
