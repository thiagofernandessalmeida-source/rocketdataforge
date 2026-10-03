# Clarificações, Decisões e Premissas: Vertical Slice 001

**Documento:** `specs/001-vertical-slice/clarifications.md`  
**Versão:** 1.0.0  
**Status:** Normativo para o Vertical Slice 001  

---

## 1. Resolução de Questões em Aberto do PRD

As questões em aberto listadas na Seção 15 do [01_PRD_RocketDataForge.md](file:///c:/Natura/PYTHON/RocketDataForge/01_PRD_RocketDataForge.md#L343) foram avaliadas e resolvidas para o escopo do **Vertical Slice 001** da seguinte forma:

### Q1: A exportação de código Python será o produto principal ou uma visão derivada?
- **Decisão:** Visão derivada estritamente descartável.
- **Racional:** Conforme a [ADR-003](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L47), a fonte única de verdade é a definição declarativa versionada (`pipeline.yaml`). Qualquer script Python gerado (para execução stand-alone via DuckDB ou Polars) é um artefato derivado para conveniência e auditoria do desenvolvedor. O RocketDataForge não fará parsing de código Python livre para atualizar o canvas.

### Q2: Qual a política de compatibilidade e isolamento para plugins no Slice 001?
- **Decisão:** Apenas componentes *core* embutidos e confiáveis.
- **Racional:** Conforme a [ADR-016](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L264), a arquitetura de plugins é desenhada via manifestos e contratos de capabilities, mas a execução de código de terceiros ou sandboxing de plugins externos fica postergada para fases futuras. O catálogo do Slice 001 carrega os conectores padrão do sistema diretamente do módulo `core.connectors`.

### Q3: Quais limites serão aplicados a nós de Python Transform?
- **Decisão:** Foco inicial nos operadores relacionais canônicos (`Select`, `Filter`, `Join`).
- **Racional:** Para o Vertical Slice 001, a prioridade absoluta é garantir a compilação algébrica em planos e a execução eficiente com DuckDB e Polars. Nós com execução arbitrária de código Python (`eval` ou execução dinâmica de funções) terão seus contratos definidos, mas a execução no Slice 001 priorizará expressões de filtro e projeções mapeáveis para o SQL do DuckDB e expressões nativas do Polars.

### Q4: Como transações heterogêneas serão representadas?
- **Decisão:** Sem transações distribuídas (2PC). Cada conector gerencia sua própria fronteira.
- **Racional:** Conforme a [ADR-013](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L214), o sistema adota entrega *at-least-once* e transações restritas a conectores individuais (ex: `auto-commit` ou transação de bloco no PostgreSQL Target). No caso de destinos em arquivo (Parquet/CSV), utiliza-se escrita atômica via arquivo temporário com renomeação final (`write-then-rename`).

### Q5: Qual modelo de licenciamento open source será adotado?
- **Decisão:** Premissa de licença Apache 2.0 para o núcleo da plataforma.
- **Racional:** Garante liberdade total de adoção corporativa, preservando a portabilidade dos pipelines e a integridade do código aberto conforme a [ADR-020](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L332).

### Q6: Quais provedores de LLM e Vector Stores estarão no Slice 001?
- **Decisão:** Nenhum provedor de IA ativo no Slice 001.
- **Racional:** O primeiro vertical slice concentra-se na espinha dorsal de engenharia de dados (ETL relacional e arquivos). As interfaces conceituais do Bounded Context de IA permanecem mapeadas, mas não serão implementadas no runtime inicial.

---

## 2. Premissas Técnicas e Operacionais Adotadas

### 2.1 Modelo de Fila do Worker Local (ADR-009)
- Para o desenvolvimento local inicial do Slice 001, o despachante de tarefas utilizará uma fila assíncrona gerenciada pelo próprio backend (processo de background com `asyncio.Queue` / worker loop de processo separado), mantendo o estado das execuções registrado de forma transacional no PostgreSQL.
- Isso elimina a dependência obrigatória de Redis ou RabbitMQ para rodar a aplicação localmente no MVP, mantendo a porta de abstração `QueuePort` pronta para transição futura.

### 2.2 Armazenamento de Artefatos (ArtifactStore - ADR-008)
- A implementação concreta inicial de `ArtifactStorePort` utilizará o sistema de arquivos local (`LocalFileSystemArtifactStore`), gravando artefatos de plano compilado, logs extensos e arquivos temporários em um diretório configurável do workspace (`.rdf/artifacts/`).
- O acesso é sempre mediado por caminhos relativos sanitizados e hashes SHA-256 de validação de integridade.

### 2.3 Regra de Escolha de Engine: DuckDB vs Polars (ADR-010)
- **DuckDB:** Selecionado como engine preferencial para nós de `Database Source`, junções relacionais (`Join`), agregações complexas e operações onde projeções/filtros possam ser executados via SQL unificado com spill-to-disk.
- **Polars:** Selecionado como engine preferencial para transformações estruturadas em arquivos (`File Source` / `File Target`), leitura em chunks/streaming de CSV e Parquet, e manipulações tabulares rápidas em memória.

### 2.4 Parâmetros Canônicos de Chunking
- **Tamanho padrão de chunk:** 10.000 registros por bloco.
- **Controle de cancelamento:** O worker inspeciona o sinal de cancelamento cooperativo a cada término de chunk. Ao detectar solicitação de cancelamento, descarta os chunks em processamento e finaliza a tarefa com o status `CANCELLED`.

### 2.5 Resolução de Segredos no Ambiente Local
- Para o Slice 001, a resolução de referências do tipo `secret://env/<VAR_NAME>` buscará os valores a partir de variáveis de ambiente do processo do worker ou de um arquivo local criptografado/restrito (`.env.secrets`, ignorado no Git).
- O log de depuração registrará unicamente a chave referenciada (ex: `Resolving secret POSTGRES_PASSWORD from EnvProvider`), sem exibir o valor resultante.
