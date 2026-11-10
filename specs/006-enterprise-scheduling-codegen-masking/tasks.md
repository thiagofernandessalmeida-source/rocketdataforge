# Implementation Tasks: 006-enterprise-scheduling-codegen-masking

---

## Fase 1: Agendador Cron & Webhooks
- [x] **T-1.1:** [TEST] Criar teste unitário em `tests/unit/scheduler/test_scheduler_service.py` validando agendamento de jobs e disparo.
- [x] **T-1.2:** [CODE] Implementar `SchedulerService` com `APScheduler` em `src/core/infrastructure/scheduler/scheduler_service.py`.
- [x] **T-1.3:** [CODE] Implementar disparo de Webhooks configuráveis para notificações de status.
- [x] **T-1.4:** [UI] Adicionar modal de gerenciamento de agendamentos no frontend.

## Fase 2: Data Masking (Conformidade LGPD)
- [x] **T-2.1:** [TEST] Criar testes unitários em `tests/unit/security/test_masking_rules.py` cobrindo hash, email, CPF e ruído.
- [x] **T-2.2:** [CODE] Implementar catálogo de funções de mascaramento em `src/core/application/security/masking.py`.
- [x] **T-2.3:** [CODE] Conectar compilação de regras de masking no `logical_planner.py`.
- [x] **T-2.4:** [UI] Adicionar configuração de tipo de máscara no editor de colunas de schema.


## Fase 3: Gerador de Código Autônomo (Python & Airflow)
- [x] **T-3.1:** [TEST] Criar teste em `tests/unit/codegen/test_standalone_codegen.py` validando geração de script Python executável.
- [x] **T-3.2:** [CODE] Implementar templates Jinja2 e gerador autônomo em `src/core/application/codegen/standalone_generator.py`.
- [x] **T-3.3:** [TEST] Criar teste em `tests/unit/codegen/test_airflow_codegen.py` validando sintaxe de DAG gerada.
- [x] **T-3.4:** [CODE] Implementar gerador de DAGs Airflow em `src/core/application/codegen/airflow_generator.py`.
- [x] **T-3.5:** [UI] Adicionar opção "Exportar como Código Autônomo" no menu de exportação do Designer.

