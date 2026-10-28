# Feature Specification: 006-enterprise-scheduling-codegen-masking

**Status:** Ready for Implementation
**Data:** 27 de Outubro de 2026
**Autor:** RocketDataForge Core Team
**Escopo:** Agendador Cron Nativo, Mascaramento de Dados LGPD/GDPR e Exportação Autônoma para Python Standalone e Airflow DAGs.

---

## 1. Visão Geral e Problema

Para utilização em escala empresarial, o RocketDataForge precisa transcender o ambiente desktop/local:
1. **Necessidade de Orquestração Autônoma:** Usuários precisam agendar jobs recorrentes sem depender de chamadas externas de cron do sistema operacional.
2. **Conformidade com LGPD/GDPR:** Dados pessoais sensíveis (PII) precisam ser ofuscados/anonimizados declarativamente no pipeline.
3. **Desacoplamento e Portabilidade (Zero Lock-in):** Pipelines criados visualmente precisam ser exportados como código Python limpo ou DAGs do Apache Airflow prontos para rodar em clusters externos.

---

## 2. Requisitos Funcionais

### RF-01: Agendador de Tarefas Nativo (Cron Scheduler)
- **RF-01.1:** Suporte a agendamento de jobs com expressões Cron padrão (5 ou 6 posições) ou intervalos fixos.
- **RF-01.2:** Motor baseado em `APScheduler` integrado ao ciclo de vida do backend FastAPI.
- **RF-01.3:** Política de concorrência configurável por job: `ALLOW`, `SKIP_IF_RUNNING`, `QUEUE`.
- **RF-01.4:** Alertas de execução via Webhook (Slack, Teams, Discord ou HTTP genérico) em caso de falha ou sucesso.

### RF-02: Mascaramento Declarativo de Dados (Data Masking)
- **RF-02.1:** Configuração de regras de proteção diretamente no editor de schema:
  - `MASK_HASH`: SHA-256 com salt configurável.
  - `MASK_EMAIL`: Anonimização parcial (ex: `j***@domain.com`).
  - `MASK_CPF_CNPJ`: Ocultação de dígitos centrais (ex: `123.***.***-00`).
  - `MASK_NULL`: Substituição por nulo ou valor padrão.
  - `MASK_RANDOM_STRING` / `NOISE`: Para testes de carga e sanitização de homologação.
- **RF-02.2:** O compilador DuckDB/Polars injeta funções SQL escalares nativas ou expressões regulares compiladas durante o pipeline.

### RF-03: Exportador Autônomo de Código (Python & Airflow)
- **RF-03.1 (Python Standalone):** Gerar script `.py` completo e auto-contido:
  - Inicialização DuckDB e Polars.
  - Resolução de dados e execução do grafo sem necessidade do servidor RocketDataForge.
  - `requirements.txt` gerado automaticamente.
- **RF-03.2 (Apache Airflow DAG):** Gerar arquivo de DAG Airflow com:
  - Definição de DAG com `schedule_interval`.
  - Operadores `PythonOperator` ou `BashOperator` respeitando as dependências de células e nós.

---

## 3. Requisitos Não Funcionais

- **RNF-01:** O banco de agendamentos (`scheduler.db`) deve ser persistente e recuperar jobs automaticamente após reinicialização do servidor.
- **RNF-02:** Nenhuma credencial exportada nos scripts autônomos deve conter texto puro; utilizar leitura de variáveis de ambiente (`os.getenv(...)`).
