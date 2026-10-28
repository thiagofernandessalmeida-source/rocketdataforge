# Feature Specification: 004-engine-stability-data-quality

**Status:** Ready for Implementation
**Data:** 27 de Outubro de 2026
**Autor:** RocketDataForge Core Team
**Escopo:** Estabilidade de Memória DuckDB, Connection Pooling, Profiling Estatístico e Componentes Canônicos (tFilterRow, tAggregateRow).

---

## 1. Visão Geral e Problema

O executor do RocketDataForge enfrenta riscos operacionais em ambientes de produção com grandes volumes de dados:
1. **OOM em Execuções DuckDB:** O uso default em memória (`:memory:`) sem teto parametrizado (`max_memory`) e sem diretório temporário (`temp_directory`) causa crash abrupto do worker sob joins volumosos.
2. **Ausência de Cancelamento Thread-Safe:** Cancelamentos disparados pela API assíncrona não chamam `duckdb.interrupt()` na conexão física síncrona ativa, mantendo o processo preso em 100% de CPU.
3. **Connection Leaks:** Conexões com Postgres e ScyllaDB abertas em tempo de design/inferência de schema não utilizam pooling centralizado.
4. **Lacuna de Componentes Declarativos:** Usuários dependem de SQL livre para filtros simples ou agregações básicas, limitando a produtividade visual e a paridade com Talend/DataStage.

---

## 2. Requisitos Funcionais

### RF-01: Governança de Recursos DuckDB
- **RF-01.1:** O `duckdb_runner.py` deve ler limites de memória configurados no ambiente (`RDF_DUCKDB_MAX_MEMORY`, default: `75%` da RAM disponível) e aplicar `SET max_memory = '...'`.
- **RF-01.2:** Deve ser configurado obrigatoriamente um diretório em disco para spillover temporário (`SET temp_directory = '...'`), apontando para o diretório de scratch do workspace.
- **RF-01.3:** O `cancellation_manager` deve registrar o identificador da conexão ativa DuckDB por `execution_id`. Ao receber um sinal de cancelamento, deve invocar `conn.interrupt()` imediatamente de forma thread-safe.

### RF-02: Connection Pool Unificado
- **RF-02.1:** Criação de um `ConnectionPoolManager` singleton gerenciando pools para Postgres (`psycopg_pool.ConnectionPool`) e instâncias de sessão reutilizáveis para ScyllaDB/Cassandra.
- **RF-02.2:** Timeout rigoroso de aquisição de conexão (default: 10 segundos) e encerramento com `try/finally` ou context managers (`with pool.connection()`).

### RF-03: Componente Declarativo tFilterRow (FilterCell)
- **RF-03.1:** Operador visual com suporte a múltiplos predicados lógicos combinados por `AND` ou `OR`.
- **RF-03.2:** Operadores suportados: `==`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`.
- **RF-03.3:** Portas de saída: porta `output` (linhas aprovadas) e porta `reject` opcional (linhas reprovadas no filtro).

### RF-04: Componente Declarativo tAggregateRow (AggregateCell)
- **RF-04.1:** Definição declarativa de chaves de agrupamento (`GROUP BY`).
- **RF-04.2:** Funções de agregação suportadas: `COUNT`, `COUNT_DISTINCT`, `SUM`, `AVG`, `MIN`, `MAX`, `FIRST`, `LAST`, `STRING_AGG` (com delimitador configurável).
- **RF-04.3:** Validação automática de conflitos de nomenclatura de colunas de saída.

### RF-05: Profiling Estatístico e Detecção de Schema Drift
- **RF-05.1:** Ao inspecionar uma fonte de dados no Canvas/PropertyPanel, expor métricas por coluna: contagem total, valores nulos (% e abs), cardinalidade (distinct count), valores mínimos/máximos e tipos inferidos.
- **RF-05.2:** Comparar o schema inferido atual contra o schema congelado do nó. Caso haja colunas removidas, adicionadas ou alteração de tipo incompatível, sinalizar visualmente `schema_drift = true` com diff estruturado.

---

## 3. Requisitos Não Funcionais e Segurança

- **RNF-01:** O spillover em disco do DuckDB deve limpar seus arquivos temporários após o término da execução (normal ou via erro/cancelamento).
- **RNF-02:** Isolamento DuckDB: manter `enable_external_access = false` para execuções de preview e computações intermediárias.
- **RNF-03:** Todas as senhas de conexão no pool devem ser resolvidas exclusivamente via `secret_resolver.py`.
