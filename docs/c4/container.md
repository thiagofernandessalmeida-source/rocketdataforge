# Arquitetura C4: Diagrama de Contêineres (Nível 2)

**Documento:** `docs/c4/container.md`  
**Versão:** 1.0.0  
**Status:** Aprovado  

---

## 1. Visão Geral de Contêineres

O RocketDataForge é estruturado como um **Modular Monolith** ([ADR-001](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L9)) composto por contêineres de controle, execução e armazenamento:

---

## 2. Diagrama C4 Container (Mermaid)

```mermaid
C4Container
    title Diagrama de Contêineres do RocketDataForge

    Person(user, "Usuário / Engenheiro", "Utilizador da plataforma.")

    System_Boundary(b1, "RocketDataForge Platform") {
        Container(spa, "Single-Page Application", "React, TypeScript, Vite, React Flow", "Interface visual interativa para desenho de grafos, configuração de nós e monitoramento.")
        Container(api, "Control Plane API", "Python, FastAPI, Pydantic v2", "Servidor REST para gerenciamento de metadados, validação de DAGs, compilação de planos e despacho de execuções.")
        Container(worker, "Execution Worker", "Python, DuckDB, Polars", "Motor de execução assíncrono que processa planos físicos por chunks e coleta métricas locais.")
        ContainerDb(db, "Metadata Store", "PostgreSQL 15+", "Armazenamento relacional de workspaces, projetos, conexões, schemas, drafts, versões e execuções.")
        ContainerDb(artifacts, "Artifact Store", "Local Filesystem", "Armazena planos físicos compilados, arquivos intermediários de execução e exports.")
    }

    SystemDb_Ext(data_sources, "Fontes / Destinos de Dados", "PostgreSQL, arquivos CSV, JSON, Parquet.")

    Rel(user, spa, "Interage via", "HTTPS")
    Rel(spa, api, "Chamadas REST (OpenAPI 3.1)", "HTTP / JSON")
    Rel(api, db, "Lê e grava metadados via", "SQLAlchemy 2.0 / asyncpg")
    Rel(api, artifacts, "Grava planos compilados via", "Local File I/O")
    Rel(api, worker, "Despacha requisição de execução", "Internal Async Queue")

    Rel(worker, db, "Atualiza status e métricas via", "SQLAlchemy / asyncpg")
    Rel(worker, artifacts, "Lê plano físico e buffers via", "Local File I/O")
    Rel(worker, data_sources, "Lê e grava dados em chunks via", "DuckDB / Polars Drivers")
```

---

## 3. Responsabilidades e Fronteiras de Comunicação

### 3.1 Single-Page Application (SPA)
- Executa no browser do cliente.
- Responsável unicamente pela renderização visual dos nós no canvas com React Flow e pela captura de inputs no painel de propriedades.
- Nunca contém lógica de negócios ou segredos de conexão.

### 3.2 Control Plane API
- Ponto central de validação e compilação do sistema.
- Recebe o grafo visual, valida a aciclicidade e portas, e executa a transformação em 4 estágios (`Logical`, `Optimized` e `Physical Plan`).
- Mantém o estado transacional de versões e execuções no PostgreSQL.

### 3.3 Execution Worker
- Processo de execução de dados isolado.
- Instancia os adaptadores do DuckDB e Polars com base no plano físico gerado pelo Control Plane.
- Itera sobre os dados em blocos configuráveis (chunks), coletando métricas a cada etapa e respondendo a comandos de cancelamento cooperativo.
