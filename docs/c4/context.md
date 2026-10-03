# Arquitetura C4: Diagrama de Contexto (Nível 1)

**Documento:** `docs/c4/context.md`  
**Versão:** 1.0.0  
**Status:** Aprovado  

---

## 1. Visão Geral de Contexto

O **RocketDataForge** é uma plataforma visual e Python-native para engenharia de dados e IA. Ele permite a criação, validação, compilação, execução e observabilidade de fluxos de transformação de dados operando localmente no MVP e com arquitetura pronta para expansão remota.

---

## 2. Diagrama C4 Context (Mermaid)

```mermaid
C4Context
    title Diagrama de Contexto do RocketDataForge

    Person(data_engineer, "Engenheiro de Dados", "Cria, testa e publica pipelines visuais de dados e IA.")
    Person(analytics_engineer, "Analytics Engineer", "Define contratos de schemas e transformações analíticas.")
    Person(platform_admin, "Platform Admin", "Configura conexões, políticas de segurança e telemetria.")

    Enterprise_Boundary(b0, "Ecossistema RocketDataForge") {
        System(rocket_data_forge, "RocketDataForge Platform", "Plataforma de design visual, compilação em múltiplos estágios, execução com DuckDB/Polars e observabilidade.")
    }

    SystemDb_Ext(postgres_db, "Bancos de Dados Relacionais", "Fontes e destinos transacionais/analíticos (PostgreSQL, etc.).")
    System_Ext(file_storage, "Armazenamento de Arquivos", "Arquivos de dados locais ou em rede (CSV, JSON, Parquet).")
    System_Ext(secret_store, "Provedor de Segredos", "Ambiente local (.env) ou Vault gerenciado para resolução de senhas.")
    System_Ext(otel_collector, "OpenTelemetry Collector", "Coleta e agregação de logs, métricas e traces distribuídos.")

    Rel(data_engineer, rocket_data_forge, "Desenha, valida e executa pipelines via", "HTTPS / Web UI")
    Rel(analytics_engineer, rocket_data_forge, "Revisa schemas e dados no designer via", "HTTPS / Web UI")
    Rel(platform_admin, rocket_data_forge, "Gerencia conexões e monitora via", "REST API")

    Rel(rocket_data_forge, postgres_db, "Lê e grava dados estruturados via", "SQL / TCP")
    Rel(rocket_data_forge, file_storage, "Lê e grava chunks tabulares via", "Filesystem I/O")
    Rel(rocket_data_forge, secret_store, "Resolve credenciais sob demanda via", "SecretReference Port")
    Rel(rocket_data_forge, otel_collector, "Emite telemetria correlacionada via", "gRPC / OTLP")
```

---

## 3. Descrição dos Elementos

- **Engenheiro de Dados & Analytics Engineer:** Acessam a aplicação visualmente no browser para desenhar nós, conectar portas e inspecionar planos de execução.
- **RocketDataForge Platform:** Núcleo do sistema, responsável pelo gerenciamento de workspaces, drafts, validação de DAGs, compilação em estágios e execução local isolada.
- **Bancos e Arquivos Externos:** Sistemas que contêm os dados a serem processados. O acesso a eles respeita a semântica do motor selecionado (DuckDB/Polars).
- **Provedor de Segredos:** Abstração que impede que credenciais em texto puro entrem nos arquivos de pipeline.
- **OpenTelemetry Collector:** Destino para onde a telemetria é exportada para observabilidade em larga escala.
