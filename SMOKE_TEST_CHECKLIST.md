# Checklist de Teste de Fumaça (Smoke Test) — CellFlow Data Studio
**Distribuição Standalone / Máquina Limpa (Windows, macOS, Linux)**

Este documento descreve o procedimento de validação operacional do instalador nativo do **CellFlow Data Studio** em uma estação de trabalho limpa (sem Python pré-instalado, sem Node.js e sem ferramentas de build).

---

## 1. Pré-Requisitos do Ambiente de Teste
- **Ambiente:** Máquina física ou VM limpa com Windows 10/11, macOS 13+ ou Ubuntu 22.04/24.04.
- **Isolamento:** Certifique-se de que `python`, `node` e `git` **não** estão no `PATH` do sistema (`where python` / `which python` deve retornar vazio).
- **Instalador:** Obtenha o pacote gerado pelo pipeline de build:
  - Windows: `CellFlow Data Studio Setup 1.0.0.exe`
  - macOS: `CellFlow Data Studio-1.0.0.dmg`
  - Linux: `CellFlow Data Studio-1.0.0.AppImage`

---

## 2. Passo a Passo do Teste

### Etapa 1: Instalação Nativa
- [ ] Executar o instalador nativo com clique duplo.
- [ ] No assistente NSIS (Windows):
  - [ ] Verificar opção de escolha da pasta de instalação.
  - [ ] Verificar se os atalhos foram criados: **Área de Trabalho** e **Menu Iniciar**.
- [ ] Concluir a instalação e permitir a inicialização automática ao finalizar.

### Etapa 2: Inicialização e Inicialização Autônoma do Backend
- [ ] A aplicação abre em tela cheia/maximizada com tema escuro (#0b0f19).
- [ ] **Verificação de Processos do SO:**
  - Abrir o Gerenciador de Tarefas (`taskmgr` no Windows ou `ps aux` no Linux/macOS).
  - Confirmar a execução do executável `cellflow-backend.exe` em background.
  - Confirmar que o backend NÃO solicitou instalação de Python nem exibiu telas de terminal pretas desnecessárias.
- [ ] **Comunicação Segura:**
  - Verificar no console de desenvolvimento (`Ctrl+Shift+I`) que as requisições estão enviando o cabeçalho `X-CellFlow-Token`.
  - Confirmar que `/api/v1/health` retornou status `healthy` e que a UI carregou sem avisos de erro de conexão.

### Etapa 3: Workspace Padrão Neutro e Dados do Usuário
- [ ] Verificar o diretório de dados em `%APPDATA%\CellFlow` (ou `~/.cellflow`):
  - [ ] As pastas `artifacts/`, `policies/`, `db/`, `logs/` e `config/` foram criadas automaticamente.
  - [ ] O banco de agendamento SQLite `db/scheduler.db` foi inicializado dentro de `CELLFLOW_HOME`.
- [ ] Verificar a pasta de documentos do usuário (`Documentos/CellFlow/Workspaces/Meu Workspace`):
  - [ ] O workspace neutro foi criado com as subpastas `jobs/`, `connections/`, `queries/` e `data/`.
  - [ ] O job de exemplo `boas_vindas.rdf` está presente e aberto automaticamente na árvore de jobs.

### Etapa 4: Execução de Job e Operação do tMap
- [ ] No canvas de desenho, abrir o componente Data Mapper (**tMap**).
- [ ] Conectar uma entrada principal (Main) e uma fonte secundária (Lookup).
- [ ] No editor do tMap:
  - [ ] Verificar que o alias explícito é exibido no card do lookup.
  - [ ] Escrever uma expressão condicional: `lkp1.id == null ? 0 : 1`.
  - [ ] Clicar no botão **Ver SQL** da coluna de saída:
    - [ ] Modal visual abre exibindo a expressão original e o SQL compilado DuckDB (`CASE WHEN ... IS NULL THEN 0 ELSE 1 END`).
- [ ] Executar a célula / job clicando em **Executar**:
  - [ ] O motor DuckDB embutido no binário executa o plano relacional.
  - [ ] As métricas de execução e telemetria (linhas/segundo) são exibidas nos painéis inferiores sem falhas.

### Etapa 5: Encerramento Limpo
- [ ] Fechar a janela principal do Electron pelo botão 'X'.
- [ ] No Gerenciador de Tarefas / Monitor de Processos:
  - [ ] Confirmar que o processo `cellflow-backend.exe` foi finalizado imediatamente (sem processos zumbis consumindo memória ou portas presas).
  - [ ] Reabrir a aplicação e confirmar que inicia normalmente sem erro de porta em uso.

---

## 3. Critérios de Aprovação (Go / No-Go)
| Item | Resultado Esperado | Status |
|---|---|:---:|
| **Zero dependência externa** | Executa sem Python/Node instalados | [ ] Aprovado |
| **Segurança de porta e token** | Token criptográfico randômico em cada sessão | [ ] Aprovado |
| **Persistência isolada** | Nada gravado na pasta de instalação (somente CELLFLOW_HOME) | [ ] Aprovado |
| **Workspace limpo** | Nenhuma referência corporativa; template neutro ativo | [ ] Aprovado |
| **Desligamento perfeito** | Encerramento em cascata sem processos órfãos | [ ] Aprovado |
