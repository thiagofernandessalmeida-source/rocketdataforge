# Modelagem de Ameaças de Segurança (STRIDE) e Política de Segredos

**Documento:** `docs/security-threat-model.md`  
**Versão:** 1.0.0  
**Status:** Normativo de Segurança  

---

## 1. Visão Geral e Fronteiras de Confiança

O RocketDataForge processa metadados corporativos, definições de fluxos de dados e dados analíticos confidenciais. A segurança é orientada por dois princípios centrais:
1. **O cliente (Frontend) é um ambiente não-confiável:** Toda validação e autorização ocorrem no servidor ([ADR-018](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L298)).
2. **Zero Segredos em Texto Puro:** Segredos nunca são persistidos em definições funcionais, nós, layouts, metadados expostos, logs, traces ou eventos ([ADR-014](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L230)).

```text
       [ AMBIENTE NÃO CONFIÁVEL ]
          Frontend / Browser
                  │
══════════════════╪═════════════════════  Fronteira de Confiança 1 (TLS / Autenticação)
                  │
       [ AMBIENTE DO CONTROL PLANE ]
          FastAPI / Backend
          PostgreSQL Metadata Store
                  │
══════════════════╪═════════════════════  Fronteira de Confiança 2 (Isolamento de Processo)
                  │
       [ DATA PLANE / WORKER ]
          DuckDB / Polars Runtime
          SecretResolver (Acesso a ENV / Vault)
```

---

## 2. Análise de Ameaças STRIDE

| Categoria STRIDE | Ameaça Identificada | Impacto | Mitigação Implementada |
| :--- | :--- | :--- | :--- |
| **S - Spoofing** | Requisições forjadas alegando pertencer a outro Workspace/Projeto. | Acesso não autorizado a artefatos e dados de outro tenant. | Validação estrita de contexto de Workspace em todos os endpoints REST com checagem de propriedade de chaves estrangeiras. |
| **T - Tampering** | Alteração não autorizada de uma versão publicada ou plano de execução. | Execução de pipelines alterados sem auditoria. | Imutabilidade estrita de `pipeline_versions` no banco de dados e conferência do `definition_hash` (SHA-256) antes do despacho do plano. |
| **R - Repudiation** | Usuário nega ter executado ou publicado um pipeline com erro. | Falha de conformidade e auditoria. | Registro obrigatório de `published_by`, `published_at`, `correlation_id` e trilha de auditoria em todas as operações de ciclo de vida. |
| **I - Information Disclosure** | Vazamento de credenciais de banco em logs, mensagens de erro ou artefatos exportados para Git. | Comprometimento de credenciais corporativas críticas. | Conexões utilizam `SecretReference` exclusivamente. Pipeline de *redaction* automático substitui padrões sensíveis por `***REDACTED***` em logs e exceptions. |
| **D - Denial of Service** | Pipeline consome toda a memória RAM da máquina host ao ler dataset massivo. | Queda do servidor backend e parada de outros pipelines. | Processamento mandatório por chunks (10.000 linhas) via Polars Streaming e DuckDB Spill-to-Disk; limites configuráveis de memória. |
| **E - Elevation of Privilege** | Injeção de SQL malicioso em consultas de nós `Database Source` ou path traversal em arquivos. | Acesso indevido ao sistema de arquivos do servidor ou banco de dados externo. | Validação sintática de queries, uso estrito de queries parametrizadas e sanitização de caminhos de arquivos para bloquear `../`. |

---

## 3. Ciclo de Vida do Gerenciamento de Segredos

### 3.1 Anatomia da `SecretReference`
Conexões de banco e fontes externas registram apenas URIs semânticas:
```yaml
connection:
  id: "conn-dw-postgres"
  endpoint: "dw.corp.internal:5432/analytics"
  secret_ref: "secret://env/ANALYTICS_DW_PASSWORD"
```

### 3.2 Resolução no Worker (Just-in-Time)
1. Durante a modelagem visual e compilação do plano, apenas a URI `secret://...` é transmitida.
2. A resolução do valor real da credencial ocorre no momento exato em que o worker instancia o driver de conexão com a fonte de dados.
3. O valor em texto puro permanece apenas na memória local do objeto de conexão durante o tempo de vida da conexão, sendo destruído assim que o nó é finalizado.
4. O cache de segredos em memória respeita TTL curto e proteção contra dump.

### 3.3 Filtro de Redaction Automático
Todo componente que produz saída textual ou estruturada para telemetria passa pelo filtro de sanitização:
```python
SENSITIVE_PATTERNS = [
    r"(?i)(password|secret|token|api_key|pwd)\s*[:=]\s*['\"]?([^'\"\s&]+)",
    r"(?i)(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)"
]

def sanitize_message(raw_text: str) -> str:
    sanitized = raw_text
    for pattern in SENSITIVE_PATTERNS:
        sanitized = re.sub(pattern, r"\1***REDACTED***\3", sanitized)
    return sanitized
```

---

## 4. Prevenção de Path Traversal e Injeção de Arquivos

Para os componentes `File Source` e `File Target`:
1. É estritamente proibido o uso de caminhos relativos arbitrários que contenham `../` ou apontem para fora dos diretórios permitidos do workspace.
2. Todo caminho de arquivo fornecido pelo usuário é normalizado através de `os.path.abspath` e validado contra a lista de caminhos-base permitidos (`allowed_storage_roots`).
3. Qualquer tentativa de acesso fora do root autorizado resulta em `SecurityError: Acesso negado ao caminho fora do workspace`.

---

## 5. Auditoria e Telemetria de Segurança

- Todo evento sensível (`ConnectionCreated`, `PipelineVersionPublished`, `ExecutionRequested`, `ExecutionCancellationRequested`) é emitido com `correlation_id` e identificador do ator.
- Spans e métricas do OpenTelemetry são configurados para não capturar payloads brutos de dados de clientes, capturando unicamente metadados estatísticos (`rows_in`, `rows_out`, `duration_ms`).
