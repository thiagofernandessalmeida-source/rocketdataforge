# Implementation Plan: 006-enterprise-scheduling-codegen-masking

---

## 1. Arquitetura da Solução

### 1.1 Módulo do Agendador
- Localização: `src/core/infrastructure/scheduler/scheduler_service.py`.
- Uso de `BackgroundScheduler` do `apscheduler` persistindo metadados em SQLite.
- Rotas REST em `src/core/infrastructure/web/routers/schedules.py`.

### 1.2 Mecanismo de Data Masking
- Módulo `src/core/application/security/masking.py`.
- Integração no `logical_planner.py`: ao processar as projeções de saída ou nós intermediários marcados com `pii_mask`, injetar operadores de transformação segura:
  ```sql
  -- Exemplo DuckDB para e-mail
  regexp_replace(email, '(?<=.).(?=.*@)', '*', 'g')
  -- Exemplo DuckDB para hash
  sha256(concat(column_value, secret_salt))
  ```

### 1.3 Gerador de Código Autônomo
- Módulo `src/core/application/codegen/`:
  - `standalone_generator.py`: Gera script em Python puro com DuckDB/Polars e Jinja2 template.
  - `airflow_generator.py`: Gera estrutura de DAG para o Airflow.

---

## 2. Diagrama de Integração do Agendador e Exportação

```
                    ┌────────────────────────┐
                    │ Canvas Visual / Job    │
                    └───────────┬────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│ Cron Scheduler│       │ Data Masking  │       │ Codegen Engine│
│ (APScheduler) │       │ (LGPD / PII)  │       │ (Standalone/  │
│               │       │               │       │  Airflow DAG) │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        ▼                       ▼                       ▼
 [ Background Run ]       [ Sanitized Data ]      [ .py / .zip ]
```
