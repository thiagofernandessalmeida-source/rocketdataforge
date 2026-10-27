---

# 📋 `specs/003-tmap-canvas-evolution/tasks.md`

```markdown
# Implementation Tasks: 003-tmap-canvas-evolution

Critério de Aceite Geral: Cada tarefa inicia com a escrita de um teste que falha (RED), implementação da correção mínima necessária (GREEN) e refatoração com testes passando (REFACTOR). Testes unitários frontend em `ui/` (`npm test`) e backend em `tests/unit/` (`pytest`).

---

## Fase 1: Estabilidade de Canvas e Células (Frontend)

- [x] **T-1.1:** [TEST] Criar teste em `ui/tests/canvasSelection.test.mjs` simulando duas células montadas: selecionar nó na Célula 1, acionar ativação da Célula 2, disparar evento `Delete` e assinalar que o nó da Célula 1 não é removido.
- [x] **T-1.2:** [CODE] Alterar `Canvas.tsx` e `CanvasCellCard.tsx` configurando `deleteKeyCode={null}` no `<ReactFlow>`. Criar handler de teclado no container de célula verificando se a célula é ativa e se `document.activeElement` não pertence a inputs de formulário ou instâncias Monaco.
- [x] **T-1.3:** [CODE] Sanitizar nós e arestas em `saveCellGraph` (`jobStore.ts`) e no serializador de exportação, removendo propriedades `selected`, `dragging` e `measured`.
- [x] **T-1.4:** [TEST] Criar teste em `ui/tests/edgeDeletion.test.mjs` validando que a deleção de aresta isolada não remove nós, e deleção de nó remove todas as arestas associadas num único passo de snapshot no `jobStore`.
- [x] **T-1.5:** [CODE] Refatorar remoção de nós em `jobStore.ts` tornando a deleção de nó + arestas conectadas uma única transação no store. Implementar menu de contexto na aresta (`FlowEdge.tsx`) com opção "Excluir Conexão" e expandir `interactionWidth={20}`.
- [x] **T-1.6:** [CODE] Eliminar sincronização via `useEffect` cíclico e chamadas de `onUpdateGraph` de dentro de atualizadores de estado funcional em `CanvasCellCard.tsx`.
- [x] **T-1.7:** [TEST] Criar teste de roundtrip de serialização em `ui/tests/jobSerialization.test.mjs`: exportar job com 3 células, importar com viewport redimensionado e validar igualdade estrita de nós e arestas.
- [x] **T-1.8:** [CODE] Atualizar `inferAndNormalizeNode` para reter integralmente `cellId`, `layoutDirection`, `width` e `height`. Desativar `inferPipelineEdges` para schemas `>= rdf.job/v2`.

---

## Fase 2: Executor do tMap (Backend - DuckDB)

- [x] **T-2.1:** [TEST] Criar teste unitário em `tests/unit/engines/test_tmap_empty_lookup.py` reproduzindo inner join e left join contra tabela de lookup contendo zero registros.
- [x] **T-2.2:** [CODE] Em `src/core/infrastructure/engines/duckdb_runner.py`: remover o `continue` quando `lk_df.height == 0`. Registrar tabela vazia no catálogo DuckDB para preservar integridade de índices e aliases.
- [x] **T-2.3:** [TEST] Criar teste unitário em `tests/unit/engines/test_tmap_lookup_filter.py` validando cláusula de filtro com colunas pertencentes estritamente ao lookup.
- [x] **T-2.4:** [CODE] Corrigir escopo de resolução em `duckdb_runner.py`: compilar e aplicar o filtro de lookup diretamente sobre a tabela/view bruta do lookup antes de uni-lo à tabela `_tmap_working`.
- [x] **T-2.5:** [TEST] Criar teste em `tests/unit/engines/test_tmap_variables.py` validando que variável com expressão inválida lança `TMapExecutionError` explícito.
- [x] **T-2.6:** [CODE] Refatorar cálculo de `Var` no executor: remover captura silenciosa de exceções que preenche valores com `NULL`. Abortar execução e emitir mensagem indicando nó, variável e causa raiz.
- [x] **T-2.7:** [TEST] Criar teste em `tests/unit/engines/test_tmap_joins.py` verificando comportamento de `Unique Match`, `First Match`, `All Matches` e flags de reject por lookup.
- [x] **T-2.8:** [CODE] Implementar lógica determinística de joins no DuckDB com suporte a `Unique Match` (último match via window function `row_number()`) e desempate por linha.
- [x] **T-2.9:** [CODE] Isolar o ambiente de execução DuckDB no tMap configurando `enable_external_access = false` e encapsulando fechamento de conexão com bloco `try...finally`.

---

## Fase 3: Motor de Expressões Java-like (Backend & API)

- [x] **T-3.1:** [TEST] Criar suíte de testes em `tests/unit/compiler/test_expression_parser.py` cobrindo literais com aspas mistas (ex: `"it's valid"`), ternários aninhados, operadores Java (`==`, `!=`, `&&`, `||`, `!`) e concatenações com `+`.
- [x] **T-3.2:** [CODE] Implementar módulo de parsing de expressões AST em `src/core/application/compiler/expressions/`:
  - `lexer.py`: Tokenizador com isolamento estrito de literais de string e operadores.
  - `parser.py`: Parser gerador de nós AST com tratamento de precedência.
  - `duckdb_visitor.py`: Conversor de AST para sintaxe SQL DuckDB compatível.
- [x] **T-3.3:** [CODE] Implementar catálogo de rotinas em `src/core/application/compiler/expressions/routines.py`:
  - `StringHandling`: `UPCASE`, `DOWNCASE`, `TRIM`, `LEFT`, `RIGHT`, `CHANGE`, `LEN`, `INDEX`, `EREPLACE`.
  - `Relational`: `ISNULL`, `NOT_NULL`.
  - `TalendDate`: `formatDate`, `parseDate`, `getCurrentDate`, `addDate`, `diffDate`.
  - `Numeric`: `sequence(nome, inicio, passo)`.
- [x] **T-3.4:** [CODE] Substituir as rotinas antigas baseadas em Regex em `duckdb_runner.py` pelo novo compilador AST.
- [x] **T-3.5:** [CODE] Criar endpoint REST `POST /api/v1/tmap/validate-expression` expondo validação e preview de compilação de expressões.

---

## Fase 4: Interface do tMap e Gestão de Schemas (Frontend)

- [x] **T-4.1:** [TEST] Criar teste de interface em `ui/tests/clipboardSchema.test.mjs` testando seleção de múltiplas colunas, acionamento de cópia (`Ctrl+C`) e colagem (`Ctrl+V`) entre schemas distintos.
- [x] **T-4.2:** [CODE] Implementar clipboard handler no `SchemaEditor.tsx` e `TMapModal.tsx` com serialização `application/x-rdf-schema+json` e fallback `text/tab-separated-values`.
- [x] **T-4.3:** [CODE] Desenvolver componente modal `ImportSchemaModal.tsx`:
  - Passo 1: Listagem de nós com schema no job agrupados por célula.
  - Passo 2: Seleção granular de colunas com prévia de tipos e chaves.
  - Passo 3: Escolha de estratégia de colisão (`overwrite`, `skip`, `rename`).
- [x] **T-4.4:** [CODE] Integrar botão "Importar de outro componente" no `PropertyPanel.tsx` e no `TMapModal.tsx`.
- [x] **T-4.5:** [CODE] Implementar pilha de Undo/Redo local (`Ctrl+Z`, `Ctrl+Y`) encapsulada exclusivamente no estado interno de `TMapModal.tsx`.
- [x] **T-4.6:** [CODE] Conectar validação de expressões em tempo real no `TMapModal.tsx` contra o endpoint `POST /api/v1/tmap/validate-expression`, exibindo badges de erro inline nas colunas de expressão.