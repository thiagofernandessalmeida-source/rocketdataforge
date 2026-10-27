# Feature Specification: 003-tmap-canvas-evolution

**Branch de Referência:** `feature/16-10-2026T0822`
**Data:** 26 de Outubro de 2026
**Status:** Ready for Implementation
**Escopo:** Estabilidade de Canvas/Células, Robustez do Executor DuckDB tMap, Motor de Expressões Java-like via AST e Gestão de Schemas entre Componentes.

---

## 1. Contexto e Problema de Negócio

O RocketDataForge opera pipelines de dados com visual em grafo dividido em células de execução e um componente central de mapeamento declarativo (`tMap`). Atualmente, o sistema apresenta três gargalos críticos:
1. **Instabilidade do Canvas Multi-Célula:** O estado de seleção e mutação de grafos polui a persistência do job e gera concorrência de eventos de teclado (Delete acidental entre células e ciclos de dessincronização estado local x Zustand store).
2. **Fragilidades Semânticas no tMap:** O executor DuckDB descarta lookups vazios incorretamente, falha na resolução de filtros de lookup antes de joins e depende de expressões baseadas em Regex que quebram literais com aspas simples/duplas e estruturas aninhadas.
3. **Fricção de Produtividade no Design:** Ausência de importação de schemas entre componentes arbitrários do workspace e impossibilidade de copiar/colar definições de colunas com fidelidade de tipos.

---

## 2. Requisitos Funcionais

### RF-01: Isolamento de Seleção e Ciclo de Vida do Canvas
- **RF-01.1:** O estado de foco/seleção (`selected`, `dragging`, `measured`) de nós e arestas deve ser puramente efêmero e nunca gravado em `cell.nodes`, `cell.edges` ou nos arquivos `.rdf.json`.
- **RF-01.2:** A ativação de uma célula no frontend deve revogar explicitamente a seleção de nós e arestas de todas as demais células do workspace.
- **RF-01.3:** Teclas de deleção (`Delete`, `Backspace`) não devem ser escutadas de forma global e irrestrita pelo ReactFlow (`deleteKeyCode={null}`); o handler customizado deve atuar exclusivamente na célula ativa e ignorar eventos disparados dentro de elementos `<input>`, `<textarea>` e instâncias do editor Monaco.

### RF-02: Exclusão Atômica de Componentes e Arestas
- **RF-02.1:** A exclusão de um nó selecionado deve remover o nó e todas as arestas adjacentes conectadas em uma única transação atômica do store, consumindo apenas 1 passo de Undo/Redo.
- **RF-02.2:** A seleção de uma aresta e acionamento de exclusão deve remover unicamente a aresta selecionada, preservando os nós de origem e destino intactos.
- **RF-02.3:** Arestas devem prover menu de contexto com a ação "Excluir Conexão" e possuir `interactionWidth` de no mínimo 20px para garantir acionabilidade táctil/clique.

### RF-03: Contrato de Arestas Imutável e Desacoplado
- **RF-03.1:** A topologia de conexão deve ser identificada estritamente por `{ id, sourceNode, sourcePort, targetNode, targetPort, kind, label }`.
- **RF-03.2:** O atributo visual `flowName` é apenas um rótulo e não pode ser utilizado como chave de resolução de porta física ou lógica.
- **RF-03.3:** Em arquivos de esquema `schemaVersion >= "rdf.job/v2"`, o parser não deve invocar inferências automáticas (`inferPipelineEdges`). Células sem arestas explícitas permanecem vazias. Se nós ou portas deixarem de existir, a aresta deve ser sinalizada com status visual `invalid` e não ser descartada silenciosamente.

### RF-04: Correções Semânticas do Executor tMap (Backend)
- **RF-04.1 (Lookup Vazio):** Lookups vazios (`height == 0`) não devem disparar `continue`. Devem registrar schema e alias com zero linhas. Em `INNER JOIN`, a saída principal é esvaziada; em `LEFT JOIN`, as colunas do lookup são preenchidas com `NULL`.
- **RF-04.2 (Filtro de Lookup):** Expressões de filtro declaradas sobre o lookup devem ser avaliadas antes da operação de join, com escopo restrito às colunas da respectiva tabela de lookup.
- **RF-04.3 (Variáveis Var):** Falha na compilação ou execução de qualquer variável intermediária (`Var`) deve abortar imediatamente a execução da tarefa, lançando `TMapExecutionError` com o nome da variável, código da expressão e erro original do motor.
- **RF-04.4 (Modelo de Join):** Suporte nativo a `LEFT`, `INNER` por lookup, `Unique Match` (padrão Talend, preservando o último registro correspondente), `First Match` e `All Matches`.
- **RF-04.5 (Tipagem e Cast):** As colunas finais da projeção devem sofrer coerção/cast explícito para os tipos declarados na saída (`INTEGER`, `VARCHAR`, `TIMESTAMP`, `DECIMAL`, etc.). Falhas de coerção devem direcionar a linha para a saída de rejeição (`catchOutputReject`) ou falhar o pipeline conforme política configurada.

### RF-05: Motor de Expressões Java-like Baseado em AST
- **RF-05.1:** Substituir todos os parsers baseados em Regex por um analisador léxico e sintático (AST) dedicado para expressões tMap.
- **RF-05.2 (Imunidade de Literais):** Literais delimitados por aspas simples ou duplas não podem ter seu conteúdo interno alterado ou substituído (ex: `"it's"` deve gerar literais SQL válidos sem quebra de escape).
- **RF-05.3 (Operadores & Aninhamento):** Suporte a operadores de comparação (`==`, `!=`), lógicos (`&&`, `||`, `!`), ternários aninhados (`cond1 ? val1 : cond2 ? val2 : val3`) e concatenação de strings com `+` preservando semântica de coerção e tratamento de nulos.
- **RF-05.4 (Catálogo de Funções):**
  - `StringHandling`: `UPCASE`, `DOWNCASE`, `TRIM`, `LEFT`, `RIGHT`, `CHANGE`, `LEN`, `INDEX`, `EREPLACE`.
  - `Relational`: `ISNULL`, `NOT_NULL`.
  - `TalendDate`: `formatDate`, `parseDate`, `getCurrentDate`, `addDate`, `diffDate`.
  - `Numeric`: `sequence(name, start, step)`.
  - Wrappers de coerção: `Integer.parseInt()`, `Double.parseDouble()`, etc.
- **RF-05.5:** Exposição de rota `POST /api/v1/tmap/validate-expression` para análise sintática e checagem de tipos em tempo de digitação no frontend.

### RF-06: Importação de Schemas e Operações de Clipboard
- **RF-06.1:** Modal interativo no frontend permitindo importar schemas a partir de qualquer componente de qualquer célula do job que declare schema válido.
- **RF-06.2:** Resolução de conflitos de nomenclatura configurável pelo usuário: Sobrescrever (`overwrite`), Ignorar (`skip`) ou Renomear com sufixo (`rename`).
- **RF-06.3:** Suporte a copiar e colar colunas via `Ctrl+C` / `Ctrl+V` entre `SchemaEditor` e painéis de saída do `TMapModal`, utilizando MIME type customizado `application/x-rdf-schema+json` com fallback para texto tabular (`TSV`).

---

## 3. Requisitos Não Funcionais e Segurança

- **RNF-01 (Segurança do Engine):** A instância do DuckDB no executor deve ser estritamente isolada: `SET enable_external_access = false`. Identificadores de tabelas e colunas devem ser sanitizados contra SQL Injection estrutural.
- **RNF-02 (Zero Credenciais em Texto Puro):** Segredos e credenciais devem continuar sendo resolvidos via `secret_resolver.py` em conformidade com as ADRs do repositório.
- **RNF-03 (Determinismo de Execução):** Operações que resultem em múltiplos matches devem aplicar ordenação determinística de desempate (`_rdf_row_id ASC`).
- **RNF-04 (Compatibilidade Retroativa):** Jobs gravados em `schemaVersion` legado (`v1`, `v2`) devem ser importados normalmente com camada de migração garantida.