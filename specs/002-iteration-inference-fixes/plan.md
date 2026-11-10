# Plano Técnico de Arquitetura e Implementação: Slice 002 Completo

**Documento:** `specs/002-iteration-inference-fixes/plan.md`  
**Versão:** 2.0.0  
**Status:** Aprovado para Execução  

---

## 1. Visão Geral da Arquitetura

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                Frontend (React + TypeScript)                           │
│  ┌────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────┐  │
│  │  tMap Visual Studio    │  │  Persistent Sidebar Rails │  │  PropertyPanel        │  │
│  │  (Lookups, Vars, Outs) │  │  (Rep, Pal, Prop, Console)│  │  (Editable ID, Chips) │  │
│  └────────────────────────┘  └───────────────────────────┘  └───────────────────────┘  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ REST / API
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                             Control Plane (FastAPI Backend)                            │
│  ┌─────────────────────────────────┐   ┌────────────────────────────────────────────┐  │
│  │  SchemaInferer                  │   │  Logical & Physical Compilers              │  │
│  │  (SQL LIMIT 0 & DuckDB DESCRIBE)│   │  (IterativeScan, tMap Operator, Pre-Action)│  │
│  └─────────────────────────────────┘   └────────────────────────────────────────────┘  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                                    Execution Worker                                    │
│  ┌────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────┐  │
│  │  DuckDB Engine         │  │  IterativeScan Loop       │  │  Database Outputs     │  │
│  │  (Views, In-Mem & DB)  │  │  (Param Token Replace)    │  │  (Table Actions, FSM) │  │
│  └────────────────────────┘  └───────────────────────────┘  └───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Subsistema DuckDB (Arquivos em Memória & Componentes Dedicados)

### 2.1 DuckDB em Componentes de Arquivo
- **Nova Opção no `FileInput`:** `enable_duckdb_view: boolean` e `duckdb_query: string`.
- Quando ativado:
  - O arquivo (CSV, Parquet, JSON, Excel) é registrado automaticamente no DuckDB como view temporária:
    ```sql
    CREATE VIEW source_data AS SELECT * FROM read_parquet('data/sales.parquet');
    ```
  - Executa a query definida pelo usuário sobre a view `source_data`, permitindo filtros complexos, agregações, window functions e subconsultas diretamente na leitura.

### 2.2 Componente `tDuckDbInput` (`connector.db.duckdb`)
- **Parâmetros:** `database_path` (caminho para arquivo `.duckdb` ou `:memory:`), `query`, `read_only`.
- **Capacidades:** Permite ler tabelas pré-existentes ou executar queries federadas sobre múltiplos arquivos e diretórios (`read_csv('data/*.csv')`).

### 2.3 Componente `tDuckDbOutput` (`connector.db.duckdb.output`)
- **Parâmetros:** `database_path`, `table_name`, `table_action`, `data_action`.
- **Comportamento:** Cria o banco DuckDB se o arquivo não existir, executa a ação de tabela (ex: `DROP TABLE IF EXISTS`, `CREATE TABLE`) e insere/atualiza os dados via PyArrow zero-copy.

---

## 3. Subsistema de Ações de Tabela e Dados (Padrão Studio)

### 3.1 Contrato de Configuração de Saída
```json
{
  "table_action": "none | drop_create | create_if_not_exists | drop_if_exists_create | truncate | delete_all",
  "data_action": "insert | update | upsert | update_or_insert | delete",
  "table": "public.clientes",
  "keys": ["id"]
}
```

### 3.2 Execução no Worker
Antes de iterar sobre os chunks de dados para inserção:
1. **Pre-Table Action:**
   - `drop_create`: `DROP TABLE IF EXISTS table; CREATE TABLE table (...);`
   - `create_if_not_exists`: Cria a tabela baseada no schema fornecido se não existir.
   - `truncate`: `TRUNCATE TABLE table;`
   - `delete_all`: `DELETE FROM table;`
2. **Data Streaming Action:**
   - `insert`: Utiliza `COPY` ou `INSERT INTO` em lotes.
   - `update`: Executa `UPDATE table SET ... WHERE pk = row.pk`.
   - `upsert`: Utiliza `INSERT INTO ... ON CONFLICT (pk) DO UPDATE SET ...` (PostgreSQL/DuckDB).
   - `delete`: `DELETE FROM table WHERE pk = row.pk`.

---

## 4. Subsistema `tMap` (Transformação Visual Multi-Fluxo)

### 4.1 Estrutura de Dados do `tMap`
```json
{
  "component_type": "core.tmap",
  "config": {
    "inputs": [
      { "name": "row1", "type": "main" },
      { "name": "row2", "type": "lookup", "join_type": "left_outer", "join_keys": { "row1.cliente_id": "row2.id" } }
    ],
    "variables": [
      { "name": "var_nome_completo", "expression": "row1.first_name + ' ' + row1.last_name" }
    ],
    "outputs": [
      {
        "name": "out_principais",
        "filter_expression": "row1.ativo == True",
        "columns": [
          { "target": "id", "expression": "row1.cliente_id" },
          { "target": "nome_completo", "expression": "var_nome_completo" },
          { "target": "cidade", "expression": "row2.cidade" }
        ]
      },
      {
        "name": "out_rejeitados",
        "is_reject": true,
        "columns": [...]
      }
    ]
  }
}
```

### 4.2 Interface Visual `tMap Studio`
- Layout de 3 colunas: **Fontes de Entrada** (Esquerda) | **Variáveis de Transformação** (Centro) | **Fluxos de Saída** (Direita).
- Arrastar colunas para conectar campos.
- Botão "Auto Map" por similaridade de nomes.
- Editor de expressões com realce de sintaxe e autocompletar de funções utilitárias.

---

## 5. Identificadores Simples e Renomeação de Componentes

### 5.1 Geração de IDs Limpos
- Prefixos padronizados baseados no tipo:
  - `connector.db.postgresql` $\rightarrow$ `tpostgresinput_1`, `tpostgresinput_2`
  - `connector.db.duckdb` $\rightarrow$ `tduckdbinput_1`
  - `core.file.source.*` $\rightarrow$ `tfileinput_1`
  - `core.tmap` $\rightarrow$ `tmap_1`
  - `core.filter` $\rightarrow$ `tfilter_1`
  - `connector.db.*.output` $\rightarrow$ `tpostgresoutput_1`, `tduckdboutput_1`

### 5.2 Renomeação no Painel de Propriedades
- O campo `ID do Nó` passa a ser um input editável com validação de unicidade.
- Ao submeter o novo ID:
  - O store atualiza o ID do nó.
  - Atualiza as arestas (`source` / `target`).
  - Atualiza o mapa de buffers e identificadores no DAG.

---

## 6. Correções de Bugs (Schema & Foco) e Sidebars Persistentes

1. **Schema Real:** O `SchemaInferer` consulta metadados do cursor PostgreSQL ou executa `DESCRIBE` no DuckDB para preencher tipos canônicos reais no primeiro clique.
2. **Estabilidade de Foco:** Subcomponentes do `PropertyPanel` são movidos para o escopo global do módulo, evitando recriação de tipos de componentes e unmount de `<textarea>`.
3. **Sidebar Rails:** Abas verticais estilizadas fixadas nas bordas para restaurar Repositório, Paleta, Propriedades e Console a qualquer momento.
