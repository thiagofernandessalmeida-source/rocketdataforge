# Estratégia Abrangente de Testes e Garantia de Qualidade

**Documento:** `docs/testing-strategy.md`  
**Versão:** 1.0.0  
**Status:** Normativo  

---

## 1. Visão Geral e Pirâmide de Testes

A estratégia de testes do **RocketDataForge** assegura que todas as invariantes de domínio, garantias de segurança e determinismo de compilação sejam validados de forma rigorosa e automatizada.

```text
                  ▲
                 / \
                /E2E\             (1) End-to-End Vertical Slice Test
               /-----\
              / Integ \           (2) PostgreSQL & File System Integration
             /---------\
            /  Golden   \         (3) Golden Tests de Compilação & Property-Based
           /-------------\
          /   Contrato    \       (4) OpenAPI, Schemas JSON e Capabilities
         /-----------------\
        /     Unitários     \     (5) Agregados, Invariantes e State Machines
       └─────────────────────┘
```

---

## 2. Tipologia de Testes Automatizados

### 2.1 Testes Unitários de Domínio Puro (Zero Dependências)
- **Alvo:** Agregados (`PipelineDraft`, `PipelineVersion`, `Connection`, `Execution`), Value Objects e Máquinas de Estados.
- **Princípio:** Execução ultrarrápida em memória, sem inicialização de banco de dados ou servidor HTTP.
- **Cobertura Crítica:**
  - Validação de unicidade de nós e integridade de conexões de portas.
  - Cálculo determinístico de `definition_hash` (isolamento de coordenadas visuais).
  - Rejeição de senhas em texto puro ao instanciar `Connection`.
  - Transições válidas e bloqueio de transições a partir de estados terminais na `Execution`.

### 2.2 Golden Tests de Compilação (Determinismo)
- **Alvo:** `PlanCompiler`, `PlanOptimizer` e `PhysicalPlanner`.
- **Mecanismo:** Definições declarativas de teste são compiladas e seus planos de saída (Logical, Optimized e Physical) são comparados contra arquivos canônicos aprovados (*goldens*).
- **Garantia:** Impede regressões em regras de otimização (pushdown) e garante determinismo estrito (mesmo input sempre gera o mesmo output).

### 2.3 Property-Based Testing (Hypothesis)
- **Alvo:** `GraphValidator` e inferência de esquemas.
- **Mecanismo:** Utilização da biblioteca `hypothesis` para gerar milhares de topologias aleatórias de grafos (com e sem ciclos, nós desconectados, matrizes de tipos incompatíveis).
- **Garantia:** Comprovação matemática de que o validador nunca entra em loop infinito e sempre classifica DAGs corretamente.

### 2.4 Testes de Contrato
- **Alvo:** Schemas declarativos e APIs.
- **Ferramentas:** `jsonschema` e validação OpenAPI.
- **Casos de Teste:**
  - Validação de artefatos exportados contra `pipeline.schema.json` e `layout.schema.json`.
  - Validação de conformidade entre os endpoints FastAPI e a especificação `openapi.yaml`.
  - Validação de envelopes de eventos contra `events.schema.json`.

### 2.5 Testes de Integração com Banco e Motores Locais
- **Alvo:** Repositórios SQLAlchemy e adaptadores DuckDB/Polars.
- **Ambiente:** PostgreSQL rodando localmente (via Docker) e diretório temporário isolado para arquivos Parquet/CSV.
- **Casos de Teste:**
  - Persistência e recuperação de drafts com versionamento otimista.
  - Leitura por chunks de arquivo CSV com 50.000 linhas via Polars com `streaming=True`.
  - Execução de Join relacional entre tabela do PostgreSQL e arquivo Parquet via DuckDB.

### 2.6 Testes de Segurança e Redaction
- **Alvo:** `SecretResolver` e interceptores de log.
- **Casos de Teste:**
  - Injeção forçada de falha de conexão de banco: valida se o log e a mensagem de erro retornada contêm `***REDACTED***` no lugar da senha.
  - Inspeção textual de exports e eventos: confirma ausência absoluta de segredos.

### 2.7 Failure Injection e Cancelamento Cooperativo
- **Alvo:** `ExecutionWorker` e loop de processamento.
- **Casos de Teste:**
  - Injeção de cancelamento no meio do processamento de um grande arquivo: confirma que o worker finaliza na fronteira de chunk e transita para `CANCELLED`.
  - Idempotência do cancelamento: múltiplos comandos sucessivos de cancelamento retornam sucesso e mantêm o estado terminal estável.

### 2.8 Teste End-to-End do Vertical Slice
- **Cenário:** Simulação completa de um fluxo de usuário:
  1. Criação do workspace e projeto via API REST.
  2. Construção do pipeline visual via DTOs (Source, Filter, Join, Target).
  3. Inferência de schema da fonte de dados.
  4. Validação e publicação imutável da versão 1.0.0.
  5. Compilação e auditoria dos planos gerados.
  6. Disparo assíncrono da execução local.
  7. Polling de status e telemetria até a conclusão com status `SUCCEEDED`.
  8. Inspeção física do dataset de destino gravado.

---

## 3. Matriz de Rastreabilidade de Testes

| Identificador do Teste | Tipo | Requisitos Cobertos | User Story | Arquivo Alvo |
| :--- | :--- | :--- | :--- | :--- |
| `test_domain_draft_invariants` | Unitário | FR-001, FR-002 | US-001, US-004 | `tests/unit/domain/test_draft.py` |
| `test_domain_version_hash` | Unitário | FR-024, NFR-005 | US-005, US-010 | `tests/unit/domain/test_version.py` |
| `test_domain_execution_fsm` | Unitário | FR-013, NFR-008 | US-007, US-009 | `tests/unit/domain/test_execution_fsm.py` |
| `test_compiler_golden_suites` | Golden | FR-011, NFR-005 | US-006 | `tests/golden/test_compiler_golden.py` |
| `test_graph_validator_property` | Property | FR-010, NFR-007 | US-004 | `tests/property/test_dag_validation.py` |
| `test_contracts_json_schema` | Contrato | NFR-006 | US-010 | `tests/contract/test_schemas.py` |
| `test_security_secrets_redacted` | Segurança | NFR-001 | US-012 | `tests/security/test_redaction.py` |
| `test_worker_cancellation_coop`| Falha/Resiliência | FR-013 | US-009 | `tests/integration/test_cancellation.py` |
| `test_vertical_slice_e2e` | End-to-End | Todos do Slice | US-001 a US-012| `tests/e2e/test_vertical_slice_e2e.py` |

---

## 4. Comandos de Execução no CI/CD

```powershell
# 1. Checagem estática de tipos
mypy src/

# 2. Executar testes rápidos (Unitários, Contratos e Goldens)
pytest tests/unit tests/contract tests/golden -v

# 3. Executar testes de integração com banco de dados
pytest tests/integration -v

# 4. Executar verificação de segurança e sanitização
pytest tests/security -v

# 5. Executar teste E2E final do Vertical Slice
pytest tests/e2e -v
```
