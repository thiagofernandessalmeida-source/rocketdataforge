# 📋 Plano de Testes e Cenários de Validação de Jobs (RocketDataForge)

Este documento estabelece o roteiro de testes funcionais e manuais para validação de **Jobs**, cobrindo arquitetura **Multi-Canvas**, persistência de **Draft/Save**, **Banco de Queries**, sincronização reativa de **Schema**, execução isolada e telemetria.

---

## 📌 Sumário
1. [Bloco 1: Persistência e Salvamento (Save & Concurrency)](#-bloco-1-persistência-e-salvamento-save--concurrency)
2. [Bloco 2: Banco de Queries e Reatividade de Schemas](#-bloco-2-banco-de-queries-e-reatividade-de-schemas)
3. [Bloco 3: Topologia Multi-Canvas e Ciclo de Vida de Células](#-bloco-3-topologia-multi-canvas-e-ciclo-de-vida-de-células)
4. [Bloco 4: Execução, Reset de Status e Métricas](#-bloco-4-execução-reset-de-status-e-métricas)
5. [Bloco 5: Casos de Borda e Resiliência](#-bloco-5-casos-de-borda-e-resiliência)
6. [Resumo dos Testes Automatizados Complementares](#-resumo-dos-testes-automatizados-complementares)

---

## 🔹 Bloco 1: Persistência e Salvamento (Save & Concurrency)

### Cenário 1.1: Adição de Nós e Salvamento com Multi-Canvas
* **Pré-condição:** Estar com um Job aberto contendo pelo menos uma célula (`canvas-cell-01`).
* **Passos:**
  1. Arraste 2 novos nós da paleta para o canvas da célula (ex: `PostgreSQL Source` e `Parquet Target`).
  2. Conecte ambos através de uma aresta de fluxo (`main`).
  3. Clique no botão **Salvar** na barra superior ou pressione `Ctrl + S`.
  4. Recarregue a página (`F5`).
* **Critério de Sucesso:**
  - Toast de confirmação: *"Job salvo localmente!"* e *"Draft salvo! Revisão: rev X"*.
  - Nenhum componente ou aresta sofre reset visual.
  - Após o `F5`, a célula mantém exatamente os 2 nós e a conexão criada.

---

### Cenário 1.2: Edição de Propriedades e Persistência de Configuração
* **Pré-condição:** Ter um nó existente no canvas.
* **Passos:**
  1. Clique no nó para abrir o painel **Propriedades** à direita.
  2. Altere o identificador ou label do nó (ex: `db_source_1` ➔ `raw_customers`).
  3. Altere um campo de configuração (ex: `batch_size: 5000` ou `path: data/customers.csv`).
  4. Pressione `Ctrl + S`.
  5. Deselecione o nó e selecione-o novamente.
* **Critério de Sucesso:**
  - O label do nó no canvas exibe `raw_customers`.
  - As propriedades abertas no painel mantêm os valores recém-editados sem reverter aos defaults.

---

## 🔹 Bloco 2: Banco de Queries e Reatividade de Schemas

### Cenário 2.1: Importação Global via Menu ("Usar no Node")
* **Pré-condição:** Ter um nó de banco ou DuckDB selecionado no canvas e queries cadastradas no Banco de Queries.
* **Passos:**
  1. Selecione o nó no canvas (para que fique com borda ativa de seleção).
  2. Na barra de menu superior, abra a opção **Banco de Queries**.
  3. Selecione uma query que possua SQL e colunas de schema cadastradas.
  4. Clique no botão **"Usar no Node"**.
* **Critério de Sucesso:**
  - O modal fecha automaticamente e um toast exibe: *"Query '[nome]' importada para o nó '[label]'."*.
  - O campo **Query SQL** do nó no painel de propriedades é preenchido de imediato com o texto da query.
  - A aba **Schema** do nó é preenchida automaticamente com as colunas definidas no banco de queries.

---

### Cenário 2.2: Importação Integrada no Painel de Propriedades (`PropertyPanel`)
* **Pré-condição:** Painel de propriedades aberto em um componente de leitura SQL (`core.database.source` ou conector DB).
* **Passos:**
  1. No painel de propriedades, localize o bloco **Query SQL**.
  2. Clique no seletor suspenso **"Usar query do banco (X disponíveis)"**.
  3. Selecione uma das queries listadas.
* **Critério de Sucesso:**
  - O `DebouncedTextarea` do SQL atualiza de forma reativa sem perder o foco de digitação.
  - Se a query tiver `connectionRef`, o seletor de conexão atualiza para a conexão referenciada.
  - O schema de output do nó é atualizado com a estrutura de colunas da query.

---

### Cenário 2.3: Inferência Direta de Schema da Query SQL
* **Pré-condição:** Conexão ativa configurada e query SQL válida inserida no nó.
* **Passos:**
  1. Com a query preenchida, clique no botão **"🔍 Inferir Schema da Query SQL"**.
  2. Aguarde a requisição para o backend.
* **Critério de Sucesso:**
  - O botão exibe estado de loading (*"Inspecionando query..."*).
  - Um badge verde exibe a confirmação de colunas inferidas.
  - A tabela de schema do nó passa a listar o tipo lógico, tipo físico e nullability de cada coluna retornada.

---

## 🔹 Bloco 3: Topologia Multi-Canvas e Ciclo de Vida de Células

### Cenário 3.1: Adição de Célula e Dependência Automática
* **Pré-condição:** Job aberto com `canvas-cell-01`.
* **Passos:**
  1. Clique em **"+ Nova Célula"** no painel de células do job.
* **Critério de Sucesso:**
  - Criação da `canvas-cell-02` com ordem `2`.
  - Inclusão automática de pré-condição apontando para `canvas-cell-01` com `expectedStatus = SUCCESS`.

---

### Cenário 3.2: Renomeação em Cadeia (Cascading Rename)
* **Pré-condição:** `canvas-cell-02` dependendo de `canvas-cell-01`.
* **Passos:**
  1. No cabeçalho da `canvas-cell-01`, altere o nome da célula para `etapa_extracao`.
  2. Abra a configuração de pré-condições da `canvas-cell-02`.
* **Critério de Sucesso:**
  - A referência da pré-condição em `canvas-cell-02` foi atualizada automaticamente para `etapa_extracao`.
  - Nenhuma regra órfã apontando para o nome antigo permanece no estado.

---

### Cenário 3.3: Prevenção de Ciclos Globais (Validação Anti-Deadlock)
* **Pré-condição:** 3 células criadas (`C1`, `C2`, `C3`) em sequência linear (`C1 ➔ C2 ➔ C3`).
* **Passos:**
  1. Tente adicionar em `C1` uma pré-condição que exija `C3`.
* **Critério de Sucesso:**
  - A aplicação bloqueia a adição ou emite um erro de validação informando dependência circular detectada.

---

## 🔹 Bloco 4: Execução, Reset de Status e Métricas

### Cenário 4.1: Execução Isolada de Célula (Single Cell Run)
* **Pré-condição:** Célula configurada com nós válidos (ex: Leitura CSV ➔ Target Parquet/DuckDB).
* **Passos:**
  1. No card da célula desejada, clique no botão **Executar Célula** (ícone Play no cabeçalho do card).
* **Critério de Sucesso:**
  - Apenas o card da célula acionada exibe o badge `running` e posteriormente `success`.
  - As demais células mantêm-se em estado `idle`.
  - Badges de telemetria aparecem no rodapé do card: contagem de linhas processadas, throughput (rows/sec) e tempo de execução.

---

### Cenário 4.2: Execução Completa do Pipeline (Full Job Run)
* **Pré-condição:** Duas ou mais células configuradas com pré-condições encadeadas.
* **Passos:**
  1. Na barra superior principal, clique em **Executar Job**.
* **Critério de Sucesso:**
  - A execução ocorre na ordem topológica das células.
  - A célula dependente só inicia após a antecessora satisfazer a regra configurada (`AND` ou `OR`).
  - O console inferior de diagnóstico registra os logs em tempo real de cada worker.

---

### Cenário 4.3: Reset de Status (Individual vs Todas as Células)
* **Pré-condição:** Células em estado `success` ou `error` após execução.
* **Passos:**
  1. Abra a barra de menu superior na opção **Reset Status**.
  2. Clique em **Célula Selecionada**.
  3. Depois clique em **Todas as Células**.
* **Critério de Sucesso:**
  - No passo 2: apenas a célula em foco tem seu status visual redefinido para `idle`.
  - No passo 3: todas as células do Job voltam ao estado neutro `idle` e as métricas visuais são limpas.

---

## 🔹 Bloco 5: Casos de Borda e Resiliência

| ID | Cenário | Ação de Teste | Critério de Sucesso |
|---|---|---|---|
| **5.1** | **Exclusão de Célula Única** | Tentar excluir a única célula existente em um Job. | Ação bloqueada pelo sistema com aviso de que o Job requer ao menos uma célula ativa. |
| **5.2** | **Troca de Abas de Jobs** | Abrir dois Jobs distintos em abas separadas e alternar entre eles. | Os nós, células, coordenadas e seleções de cada Job são preservados sem vazamento de estado. |
| **5.3** | **Duplicação de Célula** | Utilizar a ação "Duplicar Célula" no menu do card. | Nova célula é instanciada com novo ID único, nós clonados e ordem de execução incrementada. |
| **5.4** | **Reordenação de Células** | Reordenar a sequência de execução das células. | O motor atualiza as prioridades de execução sem quebrar as regras de pré-condições válidas. |

---

## 🧪 Resumo dos Testes Automatizados Complementares

Para validação em esteiras de integração ou pré-commit, execute os scripts automatizados disponíveis no projeto:

```bash
# 1. Validação de ciclo de vida Multi-Canvas, reordenação e propagação (Node.js)
cd ui
node tests/multi_canvas.test.mjs

# 2. Validação do Banco de Queries, compatibilidade de dialetos e schema (Node.js)
node tests/query_feature.test.mjs

# 3. Compilação e tipagem estática do Frontend (TypeScript + Vite)
npm run build

# 4. Testes do Backend FastAPI, SQLAlchemy e Engine de Execução (Pytest)
cd ..
.venv\Scripts\python -m pytest tests/unit/
```
