# Documentação Técnica e Funcional: Componente Data Mapping (tMap)

> **Equivalente Talend:** `tMap` (`org.talend.designer.mapper`)  
> **Identificador Canônico:** `core.tmap` / `transform.tmap`  
> **Motor de Execução:** DuckDB In-Memory C++ Vectorized + Apache Arrow + Polars  

---

## 1. Introdução e Visão Geral

O componente **Data Mapping** é o módulo central de transformação e cruzamento de dados do **RocketDataForge / CellFlow Data Studio**. Ele reproduz **100% dos recursos funcionais do clássico `tMap` do Talend**, mas com uma arquitetura moderna baseada em computação colunar em memória (Zero-Copy), superando as limitações históricas de *heap space* da JVM do Talend.

### Principais Funcionalidades:
- **Fluxo Principal (Main Input):** Dataset condutor que define a granularidade das linhas.
- **Múltiplos Fluxos de Consulta (Lookups / Joins):** Cruzamento em memória com N tabelas secundárias simultâneas.
- **Modelos de Correspondência (Match Models):** `All Rows` (produto cartesiano), `First Match` (deduplicação pela primeira linha) e `Unique Match / Last Match` (última linha).
- **Tabela de Variáveis Intermediárias (Var Table):** Campos calculados encadeados que evitam recálculo de expressões pesadas.
- **Roteamento Multi-Output com Filtros:** Dispersão do dado em múltiplos fluxos de saída simultâneos, cada um com suas próprias expressões e esquemas.
- **Captura Automática de Rejeições (Reject Catchers):**
  - `Catch Inner Join Reject`: Captura registros do Main que não encontraram par nos Lookups com Inner Join.
  - `Catch Output Reject`: Captura registros que foram recusados pelos filtros de todas as outras saídas.

---

## 2. Arquitetura de Dados: Zero-Copy com DuckDB e Arrow

Enquanto o Talend compila código Java procedural iterando linha por linha com objetos `row1Struct`, o RocketDataForge adota um pipeline colunar vetorizado:

```
[Main Input (Polars)]  ────────> Arrow Table ───────┐
[Lookup 1 (Polars)]    ────────> Arrow Table ───────┼──> [DuckDB In-Memory Engine]
[Lookup N (Polars)]    ────────> Arrow Table ───────┘           │
                                                                 ├── 1. Joins & Dedup
                                                                 ├── 2. Var Calculations
                                                                 └── 3. Multi-Output Splits
                                                                         │
[Output: Main]        <──────── Arrow to Polars <────────────────────────┤
[Output: Rejeitados]  <──────── Arrow to Polars <────────────────────────┘
```

1. **Zero-Copy Arrow Bridge:** Os DataFrames de entrada são registrados no DuckDB via ponte C Data Interface (`con.register(name, df.to_arrow())`) sem custos de serialização.
2. **Execução C++ Nativa:** O DuckDB compila a query analítica utilizando instruções vetorizadas SIMD.
3. **Retorno Imediato:** Os resultados são convertidos para DataFrames Polars prontos para os nós a jusante.

---

## 3. Mecanismo de Lookups e Match Models

### 3.1 Tipos de Join (Join Models)
- **Left Outer Join (Padrão):** Todas as linhas do Main são preservadas; se o Lookup não tiver correspondência, seus campos viram `NULL`.
- **Inner Join:** Apenas linhas do Main que possuem correspondência válida na chave de busca continuam para as saídas normais. As linhas sem par são desviadas para a porta `Catch Inner Join Reject`.

### 3.2 Modelos de Correspondência (Match Models)

#### A. All Rows (Todas as Correspondências)
Multiplicação cartesiana. Se 1 linha do Main casar com 3 linhas do Lookup, o resultado terá 3 linhas:
```sql
LEFT JOIN _lk_1_dedup ON _tmap_working."id_cliente" = _lk_1_dedup."id_cliente"
```

#### B. First Match (Primeira Correspondência)
Deduplicação analítica antes do Join:
```sql
CREATE TEMPORARY VIEW _lk_1_dedup AS
SELECT * EXCLUDE (_rn) FROM (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY "id_cliente" 
        ORDER BY _lk_row_id ASC
    ) as _rn
    FROM _lk_1_filtered
) WHERE _rn = 1;
```

#### C. Unique Match / Last Match (Última Correspondência)
```sql
CREATE TEMPORARY VIEW _lk_1_dedup AS
SELECT * EXCLUDE (_rn) FROM (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY "id_cliente" 
        ORDER BY _lk_row_id DESC
    ) as _rn
    FROM _lk_1_filtered
) WHERE _rn = 1;
```

---

## 4. Tabela de Variáveis Intermediárias (Var Table)

1. Declaradas em ordem sequencial de cima para baixo:
   - `Var.nome_completo` = `primeiro_nome || ' ' || sobrenome`
   - `Var.tipo_cliente` = `CASE WHEN Var.nome_completo IS NOT NULL THEN 'VALIDADO' ELSE 'INCOMPLETO' END`
2. Uma variável subsequente pode ler o resultado de variáveis anteriores.
3. Não são enviadas para a saída final a menos que mapeadas explicitamente em uma coluna de output.

---

## 5. Roteamento de Saídas e Rejeições

### 5.1 Saídas com Filtro de Linha (`filter_expression`)
- Saída `out_sp`: `estado = 'SP' AND limite_credito > 5000`
- Saída `out_outros`: `estado <> 'SP'`

### 5.2 Catch Output Reject
Captura as linhas que passaram pelos Joins mas foram recusadas pelos filtros de todas as outras saídas regulares:
```sql
WHERE (Joins_Validos) AND NOT (Filtro_Saida_1 OR Filtro_Saida_2 OR ... OR Filtro_Saida_N)
```

### 5.3 Catch Inner Join Reject
Captura linhas do Main cuja chave não existia no Lookup com Inner Join:
```sql
WHERE NOT (_has_match_1 = 1 AND _has_match_2 = 1)
```

---

## 6. Transpilação de Expressões (Talend / Java -> DuckDB SQL)

| Expressão Estilo Talend / Java | Transpilação DuckDB SQL no RocketDataForge |
| :--- | :--- |
| `cond ? val1 : val2` (Ternário) | `CASE WHEN cond THEN val1 ELSE val2 END` |
| `str.toUpperCase()` | `UPPER(str)` |
| `str.toLowerCase()` | `LOWER(str)` |
| `str.trim()` | `TRIM(str)` |
| `Relational.isNull(campo)` | `campo IS NULL` |
| `!Relational.isNull(campo)` | `campo IS NOT NULL` |
| `str1 + str2` (Concatenação) | `str1 \|\| str2` |
| `TalendDate.getDate("YYYY-MM-DD")` | `strftime(CURRENT_DATE, '%Y-%m-%d')` |

---

## 7. Exemplo Prático de Configuração JSON

```json
{
  "id": "tmap_classificacao",
  "type": "genericNode",
  "data": {
    "label": "Data Mapper - Classificação de Consultoras",
    "componentType": "core.tmap",
    "category": "transform",
    "config": {
      "lookups": [
        {
          "node_id": "postgres_cep_source",
          "name": "lk_regiao",
          "join_model": "inner",
          "match_model": "unique",
          "left_keys": ["cep"],
          "right_keys": ["cep"],
          "lookup_filter": "ativo = true"
        }
      ],
      "variables": [
        {
          "name": "segmento",
          "expression": "CASE WHEN pontos_historico >= 1000 THEN 'DIAMANTE' ELSE 'PRATA' END"
        },
        {
          "name": "nome_higienizado",
          "expression": "UPPER(TRIM(nome))"
        }
      ],
      "outputs": [
        {
          "name": "saida_diamante",
          "filter_expression": "segmento = 'DIAMANTE'",
          "catch_output_reject": false,
          "catch_inner_join_reject": false,
          "columns": [
            { "name": "codigo", "expression": "codigo_consultora" },
            { "name": "nome_completo", "expression": "nome_higienizado" },
            { "name": "regiao", "expression": "lk_regiao.regiao" },
            { "name": "categoria", "expression": "segmento" }
          ]
        },
        {
          "name": "saida_regular",
          "filter_expression": "segmento = 'PRATA'",
          "columns": [
            { "name": "codigo", "expression": "codigo_consultora" },
            { "name": "nome_completo", "expression": "nome_higienizado" },
            { "name": "regiao", "expression": "lk_regiao.regiao" },
            { "name": "categoria", "expression": "segmento" }
          ]
        },
        {
          "name": "rejeicao_cep",
          "catch_inner_join_reject": true,
          "columns": [
            { "name": "codigo", "expression": "codigo_consultora" },
            { "name": "cep_invalido", "expression": "cep" },
            { "name": "motivo_erro", "expression": "'CEP inexistente na base regional homologada'" }
          ]
        }
      ]
    }
  }
}
```

---

## 8. Comparativo de Performance: Talend vs RocketDataForge

| Característica | Talend Open Studio (`tMap`) | RocketDataForge (`Data Mapping`) |
| :--- | :--- | :--- |
| **Motor de Execução** | JVM Java Heap (Procedural Row-by-Row) | DuckDB Vectorized C++ (Columnar SIMD) |
| **Ponto de Memória** | Risco de `OutOfMemoryError` em 1M+ linhas | Zero-Copy via Apache Arrow; streaming fluido |
| **Match Models** | First / Unique / All Rows | First / Unique / All Rows nativos em SQL |
| **Rejeições** | Inner Join Reject e Output Reject | Inner Join Reject e Output Reject nativos |
| **Expressões** | Exige sintaxe Java estrita | Suporta SQL Analítico e sintaxe Java transpilada |
