# Arquitetura C4: Diagrama de Componentes (Nível 3)

**Documento:** `docs/c4/component.md`  
**Versão:** 1.0.0  
**Status:** Aprovado  

---

## 1. Visão Geral dos Componentes Internos

O diagrama detalha a estrutura interna modular do backend Python, ilustrando o fluxo de compilação, o isolamento do domínio e os adaptadores de infraestrutura.

---

## 2. Diagrama C4 Component (Mermaid)

```mermaid
C4Component
    title Diagrama de Componentes do Control Plane e Compilador

    Container_Boundary(b2, "Control Plane Backend (Python)") {
        Component(web_router, "FastAPI Routers", "FastAPI / Pydantic v2", "Exponibiliza endpoints REST de pipelines, versões, execuções e conexões.")
        Component(pipeline_svc, "Pipeline Application Service", "Python Service", "Coordena criação de drafts, validação, publicação de versão e hashing.")
        Component(execution_svc, "Execution Application Service", "Python Service", "Coordena disparo, monitoramento e cancelamento de execuções.")

        Component(validator, "GraphValidator", "Domain Service", "Valida aciclicidade (DAG), compatibilidade de tipos de portas e regras estruturais.")
        Component(logical_planner, "LogicalPlanner", "Domain Service", "Converte o grafo de nós em árvore canônica de operadores algébricos.")
        Component(optimizer, "PlanOptimizer", "Domain Service", "Aplica regras de pushdown baseadas em capabilities dos conectores.")
        Component(physical_planner, "PhysicalPlanner", "Domain Service", "Mapeia operadores lógicos para nós concretos DuckDB / Polars e define chunks.")

        Component(repo_adapter, "SQLAlchemy Repositories", "Infrastructure Adapter", "Implementa a persistência transacional das entidades no PostgreSQL.")
        Component(artifact_adapter, "LocalArtifactStore", "Infrastructure Adapter", "Salva e recupera planos físicos e arquivos temporários no filesystem.")
        Component(secret_resolver, "SecretResolver", "Infrastructure Adapter", "Resolve URIs de segredos a partir de variáveis de ambiente seguras.")
        Component(duckdb_runner, "DuckDB Runner", "Engine Adapter", "Executa nós relacionais, SQL scans e joins com spill-to-disk.")
        Component(polars_runner, "Polars Runner", "Engine Adapter", "Executa streaming de arquivos CSV e Parquet em chunks.")
    }

    Rel(web_router, pipeline_svc, "Chama comandos de draft e versão")
    Rel(web_router, execution_svc, "Chama comandos de execução e cancelamento")

    Rel(pipeline_svc, validator, "Valida estrutura do draft")
    Rel(pipeline_svc, repo_adapter, "Persiste draft e versão imutável")

    Rel(execution_svc, logical_planner, "Inicia compilação lógica")
    Rel(logical_planner, optimizer, "Submete plano lógico")
    Rel(optimizer, physical_planner, "Submete plano otimizado")
    Rel(physical_planner, artifact_adapter, "Serializa plano físico compilado")

    Rel(execution_svc, duckdb_runner, "Instancia nós relacionais via")
    Rel(execution_svc, polars_runner, "Instancia nós de streaming via")
    Rel(duckdb_runner, secret_resolver, "Obtém credenciais seguras via")
```

---

## 3. Fluxo de Dados e Interações

1. **Recepção de Requisição:** O `FastAPI Routers` recebe a solicitação HTTP e valida o payload contra os DTOs Pydantic v2.
2. **Ciclo de Compilação:** O `Pipeline Application Service` utiliza os serviços de domínio (`GraphValidator` $\rightarrow$ `LogicalPlanner` $\rightarrow$ `PlanOptimizer` $\rightarrow$ `PhysicalPlanner`). Nenhuma dessas classes de domínio conhece o banco de dados relacional ou detalhes do framework web.
3. **Persistência Limpa:** As portas de repositório são invocadas para salvar as entidades de domínio utilizando `SQLAlchemy Repositories` de forma transacional.
4. **Execução de Dados:** O `Execution Service` orquestra a chamada aos runners de engine (`DuckDB Runner` e `Polars Runner`), processando dados em blocos e garantindo que o `SecretResolver` atue como o único canal de resolução de credenciais.
