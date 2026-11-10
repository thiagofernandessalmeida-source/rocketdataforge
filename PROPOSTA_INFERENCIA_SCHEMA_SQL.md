# Proposta: Inferência de Schema por Análise de SQL e Catálogo

**Projeto:** RocketDataForge  
**Base de análise:** branch `feature/16-10-2026T0822`, commit `46caa46`  
**Arquivo analisado:** `src/core/application/metadata/schema_inferer.py` (método `infer_from_sql_query`)  
**Status:** Proposta. Nada aqui foi executado contra um Postgres real (ver Seção 9).

---

## 1. Resumo

Sua ideia está certa, mas resolve só metade do problema. Recomendo uma arquitetura em três camadas:

| Camada | O que resolve | Fonte |
| :--- | :--- | :--- |
| **A. Forma e tipos** | Quais colunas a query devolve e de que tipo, incluindo CTE, `*`, window, casts e expressões. | O próprio banco, sem ler dados (`LIMIT 0` ou view temporária). |
| **B. Linhagem e metadados** (sua ideia) | De qual tabela e coluna cada saída vem; `nullable`, chave primária, tamanho, precisão e comentário. | Análise do SQL (`sqlglot`) + catálogo das tabelas base. |
| **C. Modo offline** | Melhor esforço quando a camada A não roda (query com `{token}`, sem permissão, sem conexão). | `sqlglot` + catálogo em cache. Marcado como "estimado". |

Em todos os casos, o `*` vindo de uma CTE deixa de ser um problema, porque quem decide as colunas finais é o planner do banco (A) ou a resolução de escopos do parser (C).

---

## 2. Diagnóstico do comportamento atual

### 2.1 Por que a inferência devolve `*`

Li `infer_from_sql_query`. O fluxo é uma cadeia de tentativas, cada uma com `except Exception: pass`:

1. **Postgres** (`psycopg2`): executa `SELECT * FROM (<query>) AS _subq_infer LIMIT 0` e lê `cursor.description`. **Esta tentativa já devolveria as colunas finais da sua query** (`person_code, person_uid, ...`), porque o Postgres resolve a CTE e o `*`.
2. **DuckDB em memória vazia**: `DESCRIBE (<query>)`. Falha, porque as tabelas `brm.*` não existem nesse DuckDB.
3. **Fallback por regex**: `SELECT\s+(.*?)\s+FROM` sobre o texto. Pega o **primeiro** `SELECT ... FROM`, que é o corpo da CTE, não o `SELECT` final.

Rodei só o passo 3 (cópia fiel do código) contra a sua query:

| Query | Resultado do fallback |
| :--- | :--- |
| Como você colou (sem vírgula depois de `bp.person_uid`) | `['*', 'brm_person_uid', 'function', 'role', 'rn']` |
| Com a vírgula corrigida | `['*', 'person_uid', 'brm_person_uid', 'function', 'role', 'rn']` |

Isso reproduz exatamente o sintoma que você descreveu. A conclusão é que **o fallback está sendo alcançado**, e o erro real do banco é descartado sem aviso.

**Gatilho provável (não confirmado).** A query que você colou tem um erro de sintaxe: falta a vírgula entre `bp.person_uid` e `row_number()`. O Postgres rejeitaria a query, a exceção seria engolida e o fluxo cairia no regex. Outras causas possíveis são falha de conexão, permissão negada ou um `{token}` que quebra a query (ver 2.3). Para saber qual foi a sua, reproduza com o log do backend em nível `DEBUG` e remova o `except Exception: pass` da etapa 1 temporariamente.

### 2.2 Outros problemas do caminho Postgres

| # | Problema | Onde | Efeito |
| :--- | :--- | :--- | :--- |
| 1 | `nullable` é sempre `True`. | `InferredField(... nullable=True)` | A UI nunca mostra `NOT NULL`. |
| 2 | `physical_type` guarda o número do OID (`"23"`), não o nome do tipo. | `physical_type=str(type_code)` | O usuário vê `23` em vez de `integer`. |
| 3 | Tipos não mapeados viram `STRING`: `uuid`, `json`, `jsonb`, `bytea`, `time`, arrays, `interval`. | cadeia de `if type_code in (...)` | Schema incorreto para colunas comuns. |
| 4 | `timestamptz` (1184) é mapeado como `TIMESTAMP`, embora exista `TIMESTAMP_TZ`. | `type_code in (1114, 1184)` | Perde o fuso. |
| 5 | `int2` (21) é mapeado como `INT32`, embora exista `INT16`. | `type_code in (20, 21, 23)` | Tipo mais largo que o real. |
| 6 | Tamanho, precisão e escala não são lidos, nem chave primária nem comentário. | `cursor.description` só tem 2 campos usados | O schema inferido é mais pobre que o do `SchemaColumn`, que já tem esses campos. |

### 2.3 Tokens `{node.coluna}` viram o literal `1`

`re.sub(r"\{...\}", "1", query)` troca o token por `1`. Em `WHERE person_code = {n.code}` com `person_code` do tipo texto, isso vira `text = integer` e o Postgres rejeita a query. Troque por `NULL`, que é aceito em qualquer comparação. Em literais entre aspas (`'{n.code}'`), `NULL` também funciona, mas vira a string `'NULL'`; use a análise por AST (camada B) para tratar placeholders corretamente.

---

## 3. Abordagem proposta

### 3.1 Camada A: o banco descreve a query

O planner do banco é o único "interpretador de SQL" completo. Duas formas de usá-lo sem ler dados:

- **A1. `LIMIT 0`** (o que existe hoje). Simples. Dá nome e OID do tipo. Para `numeric(12,2)` ou `varchar(50)`, o OID não traz tamanho nem precisão.
- **A2. View temporária** (recomendada para tipos completos). Dentro de uma transação que termina em `ROLLBACK`:
  ```sql
  BEGIN READ WRITE;                       -- necessário para CREATE TEMP VIEW
  SET LOCAL statement_timeout = '10s';
  CREATE TEMP VIEW _rdf_infer AS <query>;
  SELECT a.attname,
         format_type(a.atttypid, a.atttypmod) AS data_type   -- ex.: numeric(12,2), character varying(50)
  FROM pg_attribute a
  WHERE a.attrelid = '_rdf_infer'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY a.attnum;
  ROLLBACK;
  ```
  Isso devolve o tipo exato com tamanho e precisão, e não grava nada. Exige a permissão `TEMP` no banco (padrão para `PUBLIC`). Se não houver, volte para A1. `attnotnull` de colunas de view é sempre falso, então `nullable` vem da camada B.

Regras comuns a A1 e A2: usar uma transação `READ ONLY` quando possível, `statement_timeout` curto, e **nunca engolir o erro**: devolver a mensagem do banco (sem segredos) para a UI.

### 3.2 Camada B: linhagem com o catálogo (sua ideia)

Para cada coluna de saída da query, descobrir de qual coluna de qual tabela base ela vem, e copiar do catálogo os metadados que a camada A não entrega.

**Passos:**

1. Parsear a query com `sqlglot.parse_one(sql, dialect="postgres")` (o dialeto vem do tipo de conexão).
2. Coletar as tabelas base: `exp.Table` que **não** são nomes de CTE (comparar com `{cte.alias for cte in tree.find_all(exp.CTE)}`).
3. Buscar o catálogo dessas tabelas, **só delas**, com uma consulta (Seção 4.2). Montar o `schema` no formato do sqlglot: `{"brm": {"brm": {"brm_business_relation": {"person_code": "VARCHAR", ...}}}}`.
4. Qualificar a query: `sqlglot.optimizer.qualify.qualify(tree, schema=schema, dialect="postgres")`. Esse passo expande `*` e `tabela.*`, resolve CTEs e prefixa cada coluna com a tabela de origem.
5. Para cada projeção do `SELECT` final, rodar `sqlglot.lineage.lineage(coluna, sql, schema=schema, dialect="postgres")` e percorrer os nós folha. Cada folha cujo `source` é uma tabela dá `(tabela, coluna)`.
6. Para cada folha, ler no catálogo: `nullable`, `is_primary_key`, `length`, `precision`, `scale`, `comment`.
7. Ajustar `nullable`: a coluna é anulável se a tabela está do lado anulável de um `LEFT`, `RIGHT` ou `FULL JOIN` no `SELECT` onde ela é lida (mesmo que a coluna seja `NOT NULL` na tabela).
8. Colunas sem folha de tabela (por exemplo `rn`, `count(*)`, `coalesce(a, 'x')`) são marcadas `computed: true`. O tipo vem da camada A (ou de `annotate_types` no modo offline).
9. Se uma coluna de saída tem várias origens (`coalesce(a.x, b.x)`, `case`), guardar a lista de origens e mesclar: o tipo vem da camada A, `nullable` é a união.

**Aplicado à sua query** (com a vírgula corrigida):

| Coluna de saída | Origem | Observação |
| :--- | :--- | :--- |
| `person_code` | `brm.brm.brm_business_relation.person_code` | Entra pela CTE via `br.*`. |
| `person_uid` | `brm.brm.brm_person.person_uid` | Entra pela CTE via `bp.person_uid`. |
| `business_status_code` | `brm_business_relation.business_status_code` | `br.*`. |
| `structure_code` | `brm_business_relation.structure_code` | `br.*`. |
| `structure_level` | `brm_business_relation.structure_level` | `br.*`. |
| `rn` | calculada (`row_number()`) | Usada no `WHERE rn = 1`, **não aparece na saída**. |

Isso assume que `person_code`, `business_status_code`, `structure_code` e `structure_level` existem em `brm_business_relation`. Se alguma estiver em `brm_person`, a linhagem a atribuirá à tabela correta. Se não existir em nenhuma, a camada A falha e a B reporta "coluna não encontrada".

### 3.3 Camada C: modo offline

Quando A não roda, usar o catálogo (em cache ou buscado) e `qualify` + `annotate_types` de sqlglot para estimar nomes e tipos. A resposta traz `inference_source: "static"` e a UI mostra um aviso "estimado, não confirmado pelo banco". Quando o catálogo não tem a tabela, os tipos ficam `Unknown` e a UI avisa.

**Nunca usar o fallback por regex.** Ele devolve resultados errados com aparência de certos. Se nada funcionar, devolver erro claro com a causa.

### 3.4 Quando usar cada camada

```text
infer(query, conexão)
 ├─ tentar A (A2, depois A1)          → nomes + tipos exatos
 │    └─ sucesso → enriquecer com B   → origem, nullable, PK, tamanho, comentário
 │    └─ falha   → registrar o erro real em warnings[]
 └─ se A falhou → C (static)          → estimado, inference_source="static"
```

A camada B roda mesmo quando A tem sucesso, mas **uma falha de B nunca invalida A**: o schema volta com os tipos do banco e um aviso `lineage_unavailable`.

---

## 4. Contratos

### 4.1 `CatalogProvider` (porta, por conector)

```python
class CatalogProvider(Protocol):
    def get_table_columns(self, catalog: str | None, schema: str | None, table: str) -> list[CatalogColumn]: ...
    def resolve_type(self, catalog_type: str) -> LogicalDataType: ...

@dataclass(frozen=True)
class CatalogColumn:
    name: str
    data_type: str            # ex.: "numeric(12,2)", "character varying(50)"
    nullable: bool
    is_primary_key: bool
    length: int | None
    precision: int | None
    scale: int | None
    comment: str | None
```

Implementações: `PostgresCatalogProvider` (a primeira), depois `OracleCatalogProvider` (`ALL_TAB_COLUMNS`), `DuckDbCatalogProvider` (`duckdb_columns()`) e `MySqlCatalogProvider` (`information_schema`). Scylla/Cassandra seguem com o caminho atual até haver demanda.

Em linha com a Constituição (2.4), a porta e os DTOs ficam em `core/domain` ou `core/application`, e os provedores concretos em `core/infrastructure/connectors/`.

### 4.2 Consulta de catálogo para PostgreSQL

```sql
SELECT a.attname                                         AS name,
       format_type(a.atttypid, a.atttypmod)              AS data_type,
       NOT a.attnotnull                                  AS nullable,
       COALESCE(pk.is_pk, false)                         AS is_primary_key,
       col_description(a.attrelid, a.attnum)             AS comment
FROM pg_attribute a
JOIN pg_class c      ON c.oid = a.attrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace
LEFT JOIN LATERAL (
    SELECT true AS is_pk
    FROM pg_index x
    WHERE x.indrelid = c.oid AND x.indisprimary AND a.attnum = ANY (x.indkey)
) pk ON true
WHERE n.nspname = %(schema)s
  AND c.relname = %(table)s
  AND c.relkind IN ('r', 'v', 'm', 'p', 'f')   -- tabela, view, view materializada, particionada, externa
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;
```

Usa `pg_catalog`, que é mais completo que `information_schema` e inclui `col_description`. Parâmetros sempre ligados (`%(...)s`), nunca concatenados. `length`, `precision` e `scale` saem do `data_type` com uma função utilitária que lê `varchar(50)` e `numeric(12,2)`.

**Nome de três partes.** No Postgres, `brm.brm.tabela` só é válido quando o primeiro `brm` é o banco da conexão atual. Se o catálogo da query for outro banco, a camada B não consegue buscar o catálogo e devolve o aviso `cross_database_reference`.

### 4.3 Mapeamento de tipo do catálogo para `LogicalDataType`

| `format_type` | `LogicalDataType` |
| :--- | :--- |
| `smallint` | `INT16` |
| `integer` | `INT32` |
| `bigint` | `INT64` |
| `real` | `FLOAT32` |
| `double precision` | `FLOAT64` |
| `numeric(p,s)` | `DECIMAL` |
| `boolean` | `BOOLEAN` |
| `text`, `character varying(n)`, `character(n)`, `uuid`, `citext` | `STRING` |
| `bytea` | `BINARY` |
| `date` | `DATE` |
| `time` / `time with time zone` | `TIME` |
| `timestamp without time zone` | `TIMESTAMP` |
| `timestamp with time zone` | `TIMESTAMP_TZ` |
| `json`, `jsonb` | `JSON` |
| qualquer `tipo[]` | `ARRAY` |
| composto, range, `hstore` | `UNKNOWN` (o `physical_type` preserva o nome) |

`uuid` fica como `STRING` porque `LogicalDataType` não tem tipo próprio; o `physical_type` guarda `uuid` para o usuário e para a escrita em destino.

### 4.4 `InferredField` estendido

Campos novos, todos opcionais, para compatibilidade com o frontend atual:

```python
@dataclass(frozen=True)
class InferredField:
    name: str
    logical_type: LogicalDataType
    physical_type: str                 # nome real do tipo, não o OID
    nullable: bool = True
    description: Optional[str] = None
    length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    is_primary_key: bool = False
    origin: list[str] = field(default_factory=list)   # ["brm.brm.brm_business_relation.person_code"]
    computed: bool = False
```

A resposta de `POST /schemas/infer` ganha dois campos: `inference_source` (`"database"`, `"database+lineage"` ou `"static"`) e `warnings: list[str]`. O `SchemaColumn` do frontend já tem `length`, `precision`, `scale`, `isPrimaryKey` e `comment`; só falta mapear `origin` e `computed` (podem ir para `comment` na primeira versão).

---

## 5. Casos de teste

Os testes da camada B podem usar um catálogo em memória (um `FakeCatalogProvider`), sem banco. Os da camada A precisam de Postgres (container) ou, para a forma da saída, DuckDB com `ATTACH`.

| # | Query | Resultado esperado |
| :--- | :--- | :--- |
| 1 | A sua query (com a vírgula corrigida). | 5 colunas: `person_code`, `person_uid`, `business_status_code`, `structure_code`, `structure_level`, com origem na tabela correta. `rn` não aparece. |
| 2 | `select * from t`. | Todas as colunas de `t`, na ordem do catálogo. |
| 3 | `with a as (select * from t) select x, y from a`. | Só `x` e `y`, com origem em `t`. |
| 4 | `select a.*, b.z from a join b using(id)`. | Colunas de `a` mais `z`, sem duplicar `id`. |
| 5 | `select a.id, b.v from a left join b on b.id = a.id`, com `b.v NOT NULL`. | `v` com `nullable = true` (lado anulável do `LEFT JOIN`). |
| 6 | `select count(*) as n, max(d) from t`. | `n` e `max` marcadas `computed`, tipos vindos da camada A. |
| 7 | `select coalesce(a.x, b.x) as x from a, b`. | `x` com duas origens. |
| 8 | `select id from t1 union all select id from t2`. | `id` com origens em `t1` e `t2`. |
| 9 | `select * from (select id, name from t) s`. | `id` e `name`. |
| 10 | Query com erro de sintaxe. | Erro com a mensagem do banco; **nunca** o resultado do regex. |
| 11 | Query com `where code = {n.code}`. | A inferência funciona; o token vira `NULL` (ou placeholder no AST). |
| 12 | `select "Person_Code" from t` com identificador entre aspas. | Respeita a caixa; sem aspas, o Postgres usa minúsculas. |
| 13 | Tabela base é uma view. | Resolvida pelo catálogo (`relkind = 'v'`). |
| 14 | Tabela inexistente. | `ValidationError` com o nome da tabela; sem schema parcial silencioso. |
| 15 | `varchar(50)` e `numeric(12,2)` no catálogo. | `length = 50`; `precision = 12`, `scale = 2`. |
| 16 | `timestamptz`, `int2`, `uuid`, `jsonb`, `text[]`. | `TIMESTAMP_TZ`, `INT16`, `STRING` (physical `uuid`), `JSON`, `ARRAY`. |

---

## 6. Tarefas (no formato do projeto)

Ajuste os IDs à sua numeração atual (usei a faixa 070 para não colidir com o que já existe).

| ID | Título | Arquivos |
| :--- | :--- | :--- |
| **TASK-070** | Reproduzir e registrar o erro real: remover `except Exception: pass` do caminho Postgres, devolver a mensagem do banco e adicionar `warnings`. Teste: query com erro de sintaxe devolve erro, nunca regex. | `schema_inferer.py`, `catalog.py` |
| **TASK-071** | Remover o fallback por regex. Substituir `{token}` por `NULL`. | `schema_inferer.py` |
| **TASK-072** | Corrigir o mapeamento de tipos (`timestamptz`, `int2`, `uuid`, `json`, `jsonb`, `bytea`, arrays) e guardar o nome do tipo em `physical_type`, via `pg_type` ou `format_type`. | `schema_inferer.py` |
| **TASK-073** | Porta `CatalogProvider` + `PostgresCatalogProvider` (consulta da Seção 4.2) e função de parse de `format_type`. | `core/application/metadata/`, `core/infrastructure/connectors/postgres_connector.py` |
| **TASK-074** | Camada A2: descrever a query por view temporária com `ROLLBACK`, com fallback para `LIMIT 0`. | `schema_inferer.py` |
| **TASK-075** | Camada B: analisador de linhagem com `sqlglot` (coleta de tabelas base, `qualify`, `lineage`, ajuste de nulabilidade por outer join, colunas calculadas). Dependência nova: `sqlglot`. | `core/application/metadata/sql_lineage.py`, `requirements.txt` |
| **TASK-076** | Camada C: modo offline com `annotate_types` e `inference_source = "static"`. | `sql_lineage.py` |
| **TASK-077** | Estender `InferredField`, o DTO da API e o mapeamento no frontend (`length`, `precision`, `scale`, `is_primary_key`, `origin`, `computed`, `inference_source`, `warnings`). Badge de origem e aviso "estimado" na UI. | `schema_inferer.py`, `catalog.py`, `ui/src/api/client.ts`, `SchemaEditor.tsx` |
| **TASK-078** | Provedores de catálogo para Oracle, DuckDB e MySQL. | `core/infrastructure/connectors/` |
| **TASK-079** | Suíte de testes: casos 1 a 16 da Seção 5, com `FakeCatalogProvider` e, para a camada A, container Postgres. | `tests/unit/metadata/` |

**Ordem sugerida:** 070 e 071 primeiro (corrigem o `*` hoje, são pequenos e dão visibilidade ao erro real), depois 072, 073, 074, 075, 077, 076, 078, 079.

---

## 7. Segurança e restrições

- **Segredos (Constituição, 2.5).** O código atual lê `connection_details["password"]` em texto puro e abre a conexão com `psycopg2`. Para a nova camada, resolva a senha pelo `SecretResolver`, como o caminho do Scylla já faz, e nunca registre `connection_details` em log nem em `warnings`.
- **Somente leitura.** Use transação `READ ONLY` na camada A1. Na A2, o `CREATE TEMP VIEW` exige `READ WRITE`; restrinja ao objeto temporário e finalize sempre com `ROLLBACK`.
- **Identificadores.** O nome de tabela vindo do parser entra na consulta de catálogo apenas como **parâmetro ligado**, nunca por concatenação.
- **Limites.** `statement_timeout` de 10 s e `connect_timeout` de 5 s. Limite o número de tabelas base buscadas no catálogo (por exemplo, 50).
- **Mensagens de erro.** Passar pelo `sanitize_message` já existente (`redaction.py`) antes de devolver ao frontend.

---

## 8. Prompt para o agente de implementação

```text
Você é um engenheiro sênior no repositório RocketDataForge (branch feature/16-10-2026T0822). Implemente a evolução da inferência de schema por SQL, conforme PROPOSTA_INFERENCIA_SCHEMA_SQL.md.

PROBLEMA
Em src/core/application/metadata/schema_inferer.py, infer_from_sql_query tenta Postgres, depois DuckDB vazio, depois um regex. Cada etapa tem "except Exception: pass". Quando o Postgres falha, o regex pega o primeiro SELECT...FROM (o da CTE) e devolve "*", brm_person_uid, rn etc. Queremos o schema do SELECT final, com tipo, nullable, PK, tamanho, precisão e origem de cada coluna.

REGRAS
1. Escreva primeiro um teste que reproduz cada problema, depois corrija.
2. Rode os testes existentes (pytest em tests/unit) a cada tarefa.
3. Domínio puro: portas e DTOs fora de infraestrutura; provedores de catálogo em core/infrastructure/connectors (Constituição 2.4).
4. Nenhum segredo em log ou aviso (Constituição 2.5). Resolver senha via SecretResolver. Passar erros por sanitize_message.
5. Consultas de catálogo só com parâmetros ligados.
6. Se algo não bater com o código, pare e me diga.

TAREFAS, NESTA ORDEM
T1. Remover o "except Exception: pass" do caminho Postgres. Devolver a mensagem real do banco (sanitizada) e adicionar warnings[] à resposta. Query com erro de sintaxe deve devolver erro, nunca resultado de regex.
T2. Remover o fallback por regex. Trocar a substituição de {token} de "1" para NULL.
T3. Corrigir o mapeamento de tipos do Postgres: timestamptz -> TIMESTAMP_TZ, int2 -> INT16, uuid -> STRING com physical_type "uuid", json/jsonb -> JSON, bytea -> BINARY, tipo[] -> ARRAY. physical_type deve ser o nome do tipo, não o OID.
T4. Criar a porta CatalogProvider e PostgresCatalogProvider com a consulta de pg_attribute/pg_class/pg_namespace/pg_index (nome, format_type, nullable, is_primary_key, comentário). Parsear length/precision/scale de format_type.
T5. Camada A2: descrever a query por CREATE TEMP VIEW dentro de transação com ROLLBACK e statement_timeout, lendo format_type(atttypid, atttypmod). Fallback para LIMIT 0.
T6. Camada B em core/application/metadata/sql_lineage.py com sqlglot (adicionar ao requirements.txt): coletar tabelas base excluindo nomes de CTE; buscar o catálogo só delas; qualify; lineage por coluna de saída; folhas viram origem; nullable ajustado por LEFT/RIGHT/FULL JOIN; colunas sem tabela viram computed.
T7. Camada C (offline) com annotate_types e inference_source="static".
T8. Estender InferredField, o DTO e o frontend (length, precision, scale, is_primary_key, origin, computed, inference_source, warnings). Mostrar badge de origem e aviso "estimado".
T9. Testes: os 16 casos da seção 5 da proposta.

CRITÉRIO DE ACEITE PRINCIPAL
Para a query com CTE "base" (br.* + bp.person_uid + row_number() as rn) e SELECT final person_code, person_uid, business_status_code, structure_code, structure_level, o schema tem exatamente essas 5 colunas, cada uma com tipo do catálogo e origem na tabela correta, e "rn" não aparece.

Ao final de cada tarefa: rodar os testes, listar o que mudou e os riscos.
```

---

## 9. O que não verifiquei

- **Não executei sqlglot.** O acesso ao PyPI estava bloqueado na minha sessão, então a Camada B (APIs `qualify` e `lineage`) está descrita, não testada. As assinaturas variam um pouco entre versões do `sqlglot`; fixe a versão no `requirements.txt` e confirme com os testes da Seção 5.
- **Não testei contra Postgres.** A consulta de catálogo (4.2) e a técnica da view temporária (A2) vêm do meu conhecimento do catálogo do Postgres. Valide em um banco real, principalmente `format_type` para colunas de view e a permissão `TEMP`.
- **Confirmei por execução** apenas o passo 3 do diagnóstico (o fallback por regex devolve `*` para a sua query). O diagnóstico de que a etapa 1 falha silenciosamente é uma dedução da leitura do código.
- **Escopo:** li `schema_inferer.py` e o endpoint `/schemas/infer`. Não li como a UI dispara a inferência nem o tratamento de `connection_details` fora desse arquivo.
