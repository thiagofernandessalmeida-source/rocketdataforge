# Matriz de Tarefas de Implementação: Vertical Slice 002 Completo

**Documento:** `specs/002-iteration-inference-fixes/tasks.md`  
**Versão:** 2.0.0  
**Status:** ✅ Concluído e Validado (100% dos Testes Passando)  

---

## 1. Mapeamento de Tarefas

| ID | Título | Módulo / Camada | Arquivos Afetados | Status |
|---|---|---|---|---|
| **TASK-030** | Portas de Entrada em Fontes & Iteração Implícita | Domain & Catalog | `definitions.py`, `components.ts`, `GenericNode.tsx` | ✅ Concluído |
| **TASK-031** | Token Parser `{node.col}` e Compilador de Iteração | Compiler | `operators.py`, `logical_planner.py`, `physical_planner.py` | ✅ Concluído |
| **TASK-032** | Execução Iterativa Parametrizada no Worker | Execution Engine | `worker.py`, `duckdb_runner.py`, `postgres_connector.py` | ✅ Concluído |
| **TASK-033** | Suporte DuckDB em Arquivos e Componentes `tDuckDb` | Connectors & Engines | `duckdb_runner.py`, `definitions.py`, `components.ts`, `worker.py` | ✅ Concluído |
| **TASK-034** | Ações de Tabela e Dados no Padrão Talend em DB Outputs | Output Connectors | `postgres_connector.py`, `worker.py`, `PropertyPanel.tsx` | ✅ Concluído |
| **TASK-035** | Componente `tMap` (Transformação Visual Multi-Fluxo) | Compiler, UI & Engine | `tmap.py`, `operators.py`, `TMapModal.tsx`, `PropertyPanel.tsx` | ✅ Concluído |
| **TASK-036** | IDs Simples no Estilo Talend e Renomeação de Nós | Frontend Designer | `Canvas.tsx`, `PropertyPanel.tsx`, `App.tsx` | ✅ Concluído |
| **TASK-037** | Correção da Inferência Real de Schema (Bug 1) | Metadata & API | `schema_inferer.py`, `catalog.py`, `PropertyPanel.tsx` | ✅ Concluído |
| **TASK-038** | Correção de Perda de Foco em Modais Flutuantes (Bug 2) | Frontend Designer | `PropertyPanel.tsx`, `FloatingNodeConfig.tsx` | ✅ Concluído |
| **TASK-039** | Controles Individuais de Sidebars com Abas Persistentes | Frontend Layout | `App.tsx`, `Header.tsx`, `index.css` | ✅ Concluído |
| **TASK-040** | Suíte de Testes Automatizados (Unit, E2E e Golden) | Test Suite | `tests/unit/...`, `tests/e2e/...`, `tests/golden/...` | ✅ Concluído |

---

## 2. Detalhamento das Tarefas

### TASK-030: Portas de Entrada em Fontes & Iteração Implícita
- **Descrição:** Habilitar porta de entrada/iteração em todos os componentes de categoria `source` no catálogo do backend e frontend. Permitir conexão visual direta `Input -> Input` no canvas.

### TASK-031: Token Parser e Compilador de Iteração
- **Descrição:** Adicionar extração de tokens canônicos `{node_id.col}` e `{label.col}` em queries e parâmetros. Mapear nós para `IterativeScan` no `LogicalPlanner` e `PhysicalPlanner`.

### TASK-032: Execução Iterativa no Worker
- **Descrição:** No `ExecutionWorker`, executar o loop de iteração sobre o buffer a montante, interpolando valores linha a linha na query SQL, reutilizando a conexão com o banco e acumulando os registros no buffer de saída.

### TASK-033: Suporte DuckDB em Arquivos e Componentes `tDuckDb`
- **Descrição:**
  - Adicionar opção *"Tratar como Tabela DuckDB em Memória"* nos componentes de arquivo (CSV, Parquet, JSON, Excel), permitindo queries SQL nativas na leitura.
  - Criar os componentes canônicos `connector.db.duckdb` (`tDuckDbInput`) e `connector.db.duckdb.output` (`tDuckDbOutput`).

### TASK-034: Ações de Tabela e Dados no Padrão Talend em DB Outputs
- **Descrição:**
  - Adicionar as opções **Ação na Tabela** (`none`, `drop_create`, `create_if_not_exists`, `drop_if_exists_create`, `truncate`, `delete_all`).
  - Adicionar as opções **Ação nos Dados** (`insert`, `update`, `upsert`, `update_or_insert`, `delete`).
  - Executar a ação de tabela antes do streaming e aplicar a ação nos dados respeitando chaves primárias.

### TASK-035: Componente `tMap` (Transformação Visual Multi-Fluxo)
- **Descrição:**
  - Implementar o componente `core.tmap` com suporte a fluxos de entrada (Main + Lookups), junções (Inner, Left Outer), tabela de variáveis (Var), múltiplos fluxos de saída nomeados e filtros booleanos por fluxo.
  - Criar a interface visual `TMapModal.tsx` com arrastar-e-soltar de colunas, auto-map e editor de expressões.

### TASK-036: IDs Simples no Estilo Talend e Renomeação de Nós
- **Descrição:**
  - Gerar IDs concisos (ex: `tpostgresinput_1`, `tfileinput_1`, `tmap_1`, `tduckdbinput_1`).
  - Permitir a edição do ID no `PropertyPanel`, propagando a alteração para arestas e referências de variáveis.

### TASK-037: Correção da Inferência Real de Schema (Bug 1)
- **Descrição:** Conectar a inferência de schema à inspeção real da query SQL (`LIMIT 0` / DuckDB `DESCRIBE`) e cabeçalho de arquivos, eliminando os dados mocados fictícios.

### TASK-038: Correção de Perda de Foco em Modais Flutuantes (Bug 2)
- **Descrição:** Mover componentes internos de `PropertyPanel.tsx` para o escopo do módulo e estabilizar o estado de digitação no `FloatingNodeConfig.tsx`.

### TASK-039: Controles Individuais de Sidebars com Abas Persistentes
- **Descrição:** Criar controles individuais para Repositório, Paleta, Propriedades e Console, com abas verticais persistentes na lateral da tela (*rail toggles*) para restauração instantânea.

### TASK-040: Testes Automatizados
- **Descrição:** Cobertura de testes unitários, de integração e regressão para todos os novos operadores, conectores e fluxos iterativos.
