# 🚀 Especificação de Novas Funcionalidades - CellFlow Data Studio

**Documento de Prompts para o Assistente Antigravity (Sessão Noturna)**

Este documento compila todas as melhorias arquiteturais, de usabilidade e performance discutidas para elevar o CellFlow Data Studio ao padrão Enterprise.

## 1. Iteração Implícita (Alternativa ao tFlowToIterate)

**Descrição:** Transforma uma aresta comum entre dois componentes Source em um loop aninhado. Para cada linha do Source A, o motor executa o Source B injetando parâmetros.

**Prompt para o Antigravity:**
Contexto: Estamos desenvolvendo o "CellFlow Data Studio", uma ferramenta de integração de dados com frontend em React Flow e backend em Python (FastAPI + DuckDB/Polars).
Quero implementar uma feature inspirada no componente `tFlowToIterate` do Talend, mas de uma forma muito mais fluida e sem exigir um componente intermediário específico.

**Comportamento Esperado:**
Quando o usuário ligar a porta de saída de um componente de Origem A (Input) diretamente na porta de entrada de um componente de Origem B (Input), essa aresta (Edge) não será uma transferência de dataset comum, mas sim uma **Aresta de Iteração (Loop/Map)**.

1. O Motor de Execução (ExecutionManager) deverá ler os dados da Origem A.

2. Para **cada linha** retornada pela Origem A, o motor vai instanciar a execução da Origem B.

3. Na query da Origem B, o usuário poderá usar uma sintaxe de template (ex: `{{node_A.id}}` ou `{{row.cliente_id}}`) para injetar dinamicamente o valor da coluna da linha atual da Origem A.

4. O resultado final será a união (Union/Append) de todos os retornos gerados pelas N execuções da Origem B.

**O que preciso que você faça:**

1. Atualize o `LogicalPlanner` e o `DAGValidator` para permitir e reconhecer a ligação entre dois componentes Source, classificando a Edge como `ITERATOR_EDGE`.

2. Proponha a alteração no `ExecutionWorker` (provavelmente uma lógica de *Nested Loop* ou execução mapeada) para que ele processe a Origem B `N` vezes de forma performática.

3. No frontend (React Flow), quando o usuário conectar dois nós de Input, aplique um estilo visual diferente (ex: uma linha tracejada animada) para que fique claro que se trata de uma iteração linha-a-linha e não de um fluxo em lote.

## 2. Fetch Size e Batch Size (Estratégia Multi-Tiered)

**Descrição:** Evita estouro de memória (OutOfMemory) ao ler/gravar grandes volumes de dados. Utiliza streaming C++ interno no DuckDB, ConnectorX (Rust) no Polars e cursores server-side como fallback.

**Prompt para o Antigravity:**
Contexto: Estamos evoluindo o "CellFlow Data Studio" (Arquitetura Clean, FastAPI, DuckDB/Polars). Quero implementar a funcionalidade de `Fetch Size` nos componentes de Source, garantindo alta performance e baixo consumo de memória (prevenindo OutOfMemory), inspirado na mecânica do Talend, mas utilizando o poder do nosso ecossistema Python/Arrow.

**Estratégia de Implementação (Multi-Tiered Fetch):**
A extração de dados não deve carregar a tabela inteira na memória. O `PhysicalPlanner` e os `Connectors` devem adotar processamento em lotes (Streaming/Chunks).

**O que preciso que você faça:**

1. **Domínio & Schemas (`src/core/domain/catalog`):** Atualize os schemas dos componentes de input relacionais (ex: `core.database.source`, `connector.nosql.scylla`) para incluir a propriedade `fetch_size` (default: 10000).

2. **Adaptação dos Motores de Execução (`infrastructure/engines/` e `connectors/`):**

   * **Para o DuckDBRunner:** Implemente a extração usando queries federadas (extensões nativas como `postgres_scanner`) quando aplicável, tirando proveito do streaming C++ interno.

   * **Para o PolarsRunner:** Adicione suporte à extração via `connectorx` (instanciado no conector relacional), que lê os dados em partições e devolve lotes `Polars DataFrame` via Arrow sem overhead do GIL.

   * **Fallback (SQLAlchemy / DB-API):** Crie um método gerador base (ex: `def stream_extract(query, fetch_size) -> Iterator[ArrowBatch]`) que utilize Server-Side Cursors. No PostgreSQL, use `stream_results=True` e `max_row_buffer` (SQLAlchemy 2.0) ou cursores nomeados com `fetchmany(fetch_size)` no Psycopg2.

3. **Orquestração (`ExecutionWorker`):** Atualize o loop de execução. Se um Source retornar um `Iterator` ou `Generator`, o Worker deve processar o pipeline em blocos (Chunks). Para cada chunk recebido do banco, ele aplica o mapeamento (tMap) e repassa para o Target, descartando o chunk da memória em seguida.

4. **Frontend (React Flow / UI):** Adicione o campo numérico "Fetch Size (Linhas)" no painel de propriedades para todos os nós configurados como Origem de Dados (Source), permitindo que o usuário controle o buffer de rede.

## 3. Telemetria Real-Time Discreta nos Nós (UI)

**Descrição:** Observabilidade sem poluir o canvas, mostrando status, linhas e throughput direto no card do nó.

**Prompt para o Antigravity:**
Contexto: Em ferramentas como o Talend, o usuário acompanha a execução do job em tempo real vendo as estatísticas de linhas e status flutuando na tela. No "CellFlow Data Studio", quero implementar isso diretamente dentro do container do componente no React Flow, de forma discreta, elegante e responsiva.

**Comportamento Esperado (Telemetry UI):**
O nó customizado no React Flow (CustomNode) deve passar a ouvir as métricas de execução vindas do Hub de Telemetria do backend (via WebSocket ou Polling do Zustand).
Durante e após a execução do Job, o *card* do componente deve exibir um "rodapé" (ou badge integrado na borda) com as seguintes informações:

1. **Status em tempo real:** Mostrar labels coloridos ou ícones discretos (ex: `Queued`, `Starting`, `Running`, `Success`, `Failed`). O estado `Starting` é essencial para quando a query está a ser processada pelo banco, mas as linhas ainda não começaram a transitar.

2. **Métricas de Linhas:** Quando o status for `Running` ou `Success`, exibir a quantidade de linhas processadas (`row_count`).

3. **Throughput (Taxa de Transferência):** Mostrar a velocidade de processamento, como `rows/sec` (linhas por segundo), atualizada a cada segundo enquanto roda.

**O que preciso que você faça:**

1. Proponha o design e a alteração do componente JSX do Nó (ex: `ui/src/features/designer/components/CanvasNode.tsx`) para acomodar esses três dados de forma que não polua o nome e a descrição do nó.

2. Crie a estrutura na store (`JobStore` ou um novo `TelemetryStore` no Zustand) para armazenar e atualizar as métricas de `status`, `row_count` e `throughput` recebidas por Nó (`node_id`).

3. Mostre como injetar isso via `useEffect` no nó sem causar re-renders pesados que travem a interface visual do Canvas durante uma execução rápida.

## 4. Python-Cells (Pro-Code Embeddado)

**Descrição:** Permite criar células de código puro estilo Jupyter integradas ao fluxo visual.

**Prompt para o Antigravity:**
Contexto: No nosso projeto "CellFlow Data Studio" (Frontend React, Backend FastAPI/Python), já estabelecemos a funcionalidade de Multi-Canvas, onde o Job é dividido em múltiplas `canvas-cells`.
Quero expandir essa funcionalidade e permitir a criação de um novo tipo de célula: a `python-cell`. A ideia é ter uma experiência similar ao Jupyter Notebook ou Databricks misturada ao nosso fluxo visual.

**Comportamento Esperado:**

1. **Frontend (UI):** O usuário pode escolher adicionar uma `canvas-cell` (visual com React Flow) ou uma `python-cell` (código puro). Na `python-cell`, a interface deve embutir um editor de código (sugiro usar o `@monaco-editor/react` para termos a experiência do VS Code).

2. **Backend (Execução):** Quando o Job for executado, o `ExecutionManager` deve identificar se o nó é visual ou código. Se for código, ele deve executar o script Python enviado pela UI.

3. **State Handoff (Contexto de Dados):** O script Python não rodará isolado. O motor deve injetar um objeto `context` global na execução (usando o parâmetro `globals` da função `exec()` do Python).

   * O usuário deve conseguir ler a saída de uma célula anterior: `df = context.read_output('canvas-cell-01')`

   * O usuário deve conseguir publicar a saída dessa célula para a próxima usar: `context.write_output(df)`

**O que preciso que você faça:**

1. **Modelagem de Dados:** Atualize o schema do Job (`PipelineDraft` / JSON definition) para suportar o tipo de célula (enum: `CANVAS`, `PYTHON`) e um campo `code_snippet` para guardar o texto do script.

2. **Frontend:** Proponha a alteração no componente renderizador de células para fazer um "If/Else" entre o componente do `ReactFlow` e o componente do `MonacoEditor`.

3. **Backend:** Crie um rascunho da classe `PythonCellRunner` mostrando como usar a função nativa `exec()` passando o contexto do DuckDB/Polars em memória de forma segura.

## 5. Undo/Redo, Copy/Paste de Nós e Schemas

**Descrição:** Atalhos clássicos de editores Enterprise (Time-Travel) para máxima produtividade.

**Prompt para o Antigravity:**
Contexto: Estamos evoluindo a UI/UX do "CellFlow Data Studio". Nosso frontend utiliza React, React Flow e Zustand para gerenciamento de estado global (JobStore). Preciso implementar três funcionalidades críticas de usabilidade e produtividade para os engenheiros de dados.

**Feature 1: Copy/Paste de Schema entre Componentes**

* O usuário copia o array de colunas de um nó de Origem e cola no de Destino. O Zustand deve ter uma action `pasteSchema(nodeId, schemaData)` que atualiza apenas o atributo de schema do nó alvo.

**Feature 2: Copy/Paste de Componentes (Nós) entre Canvas-Cells**

* O usuário seleciona um ou mais nós, usa `Ctrl + C` e `Ctrl + V` no mesmo canvas ou em outro.

* O sistema **NÃO PODE** usar o mesmo `id` do nó original. Ele deve gerar um novo UUID para não quebrar o React Flow e aplicar um pequeno offset visual (ex: x + 50, y + 50). Atualizar o `cell_id` se colado em outra célula.

**Feature 3: Undo / Redo (Desfazer / Refazer)**

* Pressionar `Ctrl + Z` desfaz a última ação no canvas. `Ctrl + Y` refaz.

**O que preciso que você faça:**

1. **Undo/Redo:** Sugira a implementação usando o middleware `zundo` para o Zustand e mostre como capturar o atalho de teclado globalmente no React.

2. **Copy/Paste de Nós:** Crie as actions `copyNodes` e `pasteNodes` no Zustand. Adicione um event listener para interceptar `Ctrl+C`/`Ctrl+V`. Forneça a lógica que recalcula a posição e o ID.

3. **Schema:** Mostre o trecho de código JSX do painel de propriedades com os botões e a action que manipula a atualização.

## 6. Timers (Sleep), Retries e Loop entre Células

**Descrição:** Adiciona controle de concorrência (Throttling), tolerância a falhas e capacidade de ciclos (Bypass do DAG).

**Prompt para o Antigravity:**
Contexto: O "CellFlow Data Studio" está amadurecendo para o nível Enterprise. Precisamos adicionar controle de concorrência (Throttling/Sleep), políticas de resiliência (Retries) e controle de fluxo de orquestração avançado (Loops entre Canvas-Cells).

**Objetivos:**

1. **Throttling e Timers (Sleep):** Adicione `batch_delay_seconds` aos nós Input/Output e `loop_delay_seconds` nas Edges de iteração. No backend, implemente `await asyncio.sleep(delay)` no meio do Generator.

2. **Resiliência (Retries):** Adicione `max_retries` e `retry_interval_seconds` nos nós. O executor deve tentar novamente em caso de falha.

3. **Orquestração (O Desafio do DAG):** Criar uma "Condition/Loop Cell" que avalia uma expressão de contexto (ex: `has_more_data`). Se True, o `ExecutionManager` reseta o status das `target_cells` de `SUCCEEDED` para `PENDING` e reinicia a execução delas, respeitando um `max_loop_limit`.

**O que preciso que você gere:**

1. Novos Schemas Pydantic para Timer, Retry e `ConditionCell`.

2. A lógica no `ExecutionWorker` com o `asyncio.sleep` e o try/except para Retry com backoff.

3. O trecho do `ExecutionManager` mostrando o reset de estado para resolver o "Loop de Células" ignorando a trava estrita do `GraphValidator`.

## 7. Variáveis de Contexto e Profiles (Ambientes)

**Descrição:** Sistema centralizado para gerenciar variáveis em níveis de ambiente (Dev/QA/Prod).

**Prompt para o Antigravity:**
Contexto: O "CellFlow Data Studio" precisa de um sistema robusto de Variáveis de Contexto em nível de Job. Para atingir o nível Enterprise, esse sistema deve incluir suporte nativo a Perfis de Execução (Ambientes como DEV, QA e PROD).

**Objetivos:**

1. **Modelagem:** Adicione ao schema do Job a estrutura de Contexto. Os valores devem ser mapeados por "Profile/Environment" (ex: `{"DEV": "localhost", "PROD": "10.0.0.5"}`).

2. **Interpolação:** Expanda o `_interpolate_tokens` para reconhecer `{{context.var}}` injetando dados com tipagem segura e escape SQL.

3. **Mutabilidade:** Permita alterar variáveis via código (`ctx.set_var()`) ou via um novo nó visual `core.context_setter`.

4. **Frontend:** Crie a UI para gerenciar variáveis e abas para trocar de ambiente.

5. **Headless CLI:** O CLI deve aceitar `--env PROD` e carregar os valores estritos no boot.

**O que preciso que você gere:**

1. Os Pydantic Models atualizados para suportar Contexto e Perfis de Ambiente.

2. Lógica regex do `_interpolate_tokens` contemplando injeção de contexto.

3. O código da classe `ContextManager`, mostrando como carrega baseado no `--env` e expõe `get_var`/`set_var`.

## 8. Documentação Automática (Docs-as-Code)

**Descrição:** Substitui HTML editável frágil por documentação em Markdown com Dicionário de Dados gerado no build.

**Prompt para o Antigravity:**
Contexto: O "CellFlow Data Studio" deve adotar "Docs-as-Code". A documentação manual deve ser feita estritamente no Studio UI e não em arquivos editáveis exportados que se perdem na recompilação.

**Objetivos:**

1. **Edição na UI:** Adicione suporte a Markdown (`documentation_md`) no schema do Job e Nós. Crie uma aba no frontend para isso.

2. **Artefatos Read-Only:** Atualize a rotina de Build para gerar 2 arquivos estritos: `docs_pipeline.md` (pronto para GitHub) e `docs_viewer.html` (apenas leitura, com estilos).

3. **Data Lineage:** O gerador deve extrair o schema inferido de cada nó e criar tabelas automáticas de Dicionário de Dados.

**O que preciso que você faça:**

1. Crie os métodos de backend (ex: `MarkdownDocGenerator`) que processam o Job e geram o `.md`.

2. Mostre o código do template em Markdown.

3. Sugira como implementar um "Botão IA" na UI que chama uma API para auto-descrever o nó selecionado.

## 9. Auto-Layout Direcional (Horizontal/Vertical)

**Descrição:** Rearranja o canvas instantaneamente usando a biblioteca `dagre`.

**Prompt para o Antigravity:**
Contexto: Estamos aprimorando a UX do "CellFlow Data Studio". Quero implementar "Auto-Layout" direcional. O usuário deve ser capaz de ir em um menu "Exibir" e alternar entre "Layout Horizontal" ('LR') e "Layout Vertical" ('TB').

**Objetivos:**

1. Use a biblioteca `dagre` para criar uma função `getLayoutedElements(nodes, edges, direction)` que calcula as novas posições X/Y.

2. Adicione ao Zustand a action `changeLayoutDirection` que força a re-renderização.

3. Nossos nós (`CustomNode.tsx`) precisam reagir ajustando a propriedade `position` dos `<Handle>` (Se 'LR': Target=Left, Source=Right. Se 'TB': Target=Top, Source=Bottom).

**O que preciso que você gere:**

1. A função `getLayoutedElements` completa.

2. Atualização da store Zustand.

3. O trecho do `CustomNode.tsx` mostrando a alteração dinâmica das portas.

## 10. Pass-through nos Nós de Target (Output)

**Descrição:** Permite que o fluxo de dados não pare no componente de destino, encadeando operações.

**Prompt para o Antigravity:**
Contexto: Nossos componentes de Target (Output) atualmente operam como "Sinks" (becos sem saída). Precisamos alterar para o padrão de "Pass-through", semelhante ao Talend. Um nó de Output deve poder ter arestas de saída.

**Objetivos:**

1. Modifique os componentes de destino no catálogo para aceitarem portas de saída (`outputs: ['main', 'reject']`).

2. Remova a restrição no frontend (`CustomNode.tsx`) para renderizar o `<Handle type="source" />` em Targets.

3. No backend (`DuckDBRunner`/`PolarsRunner`), após o `commit` do lote, retorne o próprio DataFrame (em vez de `None`) para que o `ExecutionWorker` coloque o dado no State Handoff para nós a jusante.

**O que preciso que você gere:**

1. Atualização do JSON Schema do catálogo demonstrando a porta de saída.

2. Trecho modificado do frontend para garantir o Handle.

3. Exemplo de como o Runner fará o `yield` do lote processado mantendo o fluxo vivo.

## 11. Super tMap (Paridade Avançada com Talend)

**Descrição:** Adiciona expressões nas chaves de Join, filtros no ON e suporte a funções Window (acumuladores) no Data Mapping vetorizado.

**Prompt para o Antigravity:**
Contexto: Nosso componente `core.tmap` baseado em DuckDB é extremamente rápido, mas carece da flexibilidade micrométrica do Talend. Modifique o `execute_tmap_transform` no `DuckDBRunner`.

**Objetivos:**

1. **Expressões nas Chaves de Join:** Atualize `left_keys` e `right_keys` para aceitarem expressões. Passe-as por `transpile_expression` antes de montar a igualdade do `join_cond`.

2. **Filtros no Join (ON):** Adicione a propriedade `join_filter` nos lookups e concatene essa expressão (transpilada com `AND`) diretamente no `ON` do Join gerado no passo 4.

3. **Transpilador Expandido:** Mapeie expressões de acumuladores do Talend para Window Functions do SQL (ex: `Numeric.sequence` -> `ROW_NUMBER() OVER()`, valor anterior -> `LAG(coluna) OVER()`, soma acumulada -> `SUM() OVER()`) para potencializar a Tabela `Var`.

**O que preciso que você gere:**

1. A nova estrutura reescrita do `execute_tmap_transform` (passo 4 do join_cond e join_filter).

2. Atualização da função `transpile_expression` com o Regex para conversões de Window Functions e casts.