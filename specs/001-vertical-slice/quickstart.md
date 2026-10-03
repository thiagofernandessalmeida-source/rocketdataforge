# Guia de Inicialização Rápida (Quickstart): Vertical Slice 001

**Documento:** `specs/001-vertical-slice/quickstart.md`  
**Versão:** 1.0.0  
**Status:** Operacional  

---

## 1. Pré-Requisitos

- **Python:** 3.11 ou superior
- **Node.js:** 20.x ou superior (com `npm` ou `pnpm`)
- **Docker & Docker Compose:** para inicializar o PostgreSQL de metadados localmente (ou uma instância local existente do PostgreSQL 15+)
- **Git:** para versionamento de artefatos

---

## 2. Configuração do Ambiente de Desenvolvimento

### 2.1 Backend (Python)
No diretório raiz do projeto:

```powershell
# 1. Criar ambiente virtual
python -m venv .venv

# 2. Ativar ambiente virtual
.\.venv\Scripts\Activate.ps1

# 3. Instalar dependências do projeto
pip install --upgrade pip
pip install -r requirements.txt
```

*(Dependências essenciais instaladas: `fastapi`, `uvicorn`, `pydantic>=2.0`, `duckdb`, `polars`, `sqlalchemy>=2.0`, `asyncpg`, `alembic`, `pyyaml`, `opentelemetry-api`, `opentelemetry-sdk`, `pytest`, `pytest-asyncio`)*

### 2.2 Inicializar o PostgreSQL de Metadados via Docker

```powershell
docker compose up -d postgres
```

*(O compose inicia um container com PostgreSQL escutando na porta `5432`, criando a base `rocketdataforge` e usuário padrão)*

### 2.3 Executar as Migrações de Metadados

```powershell
alembic upgrade head
```

---

## 3. Inicialização dos Serviços Locais

### 3.1 Iniciar a API do Control Plane

```powershell
uvicorn src.core.infrastructure.web.main:app --host 0.0.0.0 --port 8000 --reload
```

- A documentação interativa Swagger/OpenAPI estará acessível em: `http://localhost:8000/docs`
- Health check da API: `http://localhost:8000/api/v1/health`

### 3.2 Iniciar a Interface Visual (Frontend)

Em um novo terminal:

```powershell
cd ui
npm install
npm run dev
```

- A interface gráfica do RocketDataForge abrirá em: `http://localhost:5173`

---

## 4. Executando o Primeiro Pipeline de Demonstração (E2E)

### Cenário de Teste:
Ingestão de dados de clientes a partir de um arquivo CSV, aplicação de filtro para clientes ativos, seleção de colunas essenciais e gravação em arquivo Parquet otimizado.

1. **Acesse o Designer:** Abra o navegador em `http://localhost:5173`.
2. **Crie um Projeto:** Selecione o Workspace padrão e crie o projeto `Analytics Demo`.
3. **Adicione os Componentes no Canvas:**
   - Arraste um **File Source** (configure para `data/samples/customers.csv`).
   - Clique em **Inferir Schema** para detectar os tipos de dados das colunas.
   - Arraste um **Filter** (configure a expressão: `status == 'ACTIVE'`).
   - Arraste um **Select** (projete apenas `id`, `name`, `email`, `created_at`).
   - Arraste um **File Target** (configure para `data/output/active_customers.parquet`).
4. **Conecte as Portas:**
   - Conecte `File Source.main` $\rightarrow$ `Filter.input`.
   - Conecte `Filter.main` $\rightarrow$ `Select.input`.
   - Conecte `Select.main` $\rightarrow$ `File Target.input`.
5. **Valide e Publique:** Clique em **Validar Grafo** e em seguida em **Publicar Versão 1.0.0**.
6. **Execute:** Clique em **Executar Pipeline**.
   - Acompanhe os logs estruturados e as métricas de linhas processadas em tempo real no console inferior.
   - Ao finalizar com sucesso, inspecione o arquivo Parquet gerado na pasta de saída.

---

## 5. Execução da Suíte de Testes Automatizados

```powershell
# Executar todos os testes com relatório de cobertura
pytest tests/ -v --cov=src

# Executar apenas a validação dos Golden Tests do compilador
pytest tests/golden/ -v

# Executar o teste ponta a ponta do Vertical Slice
pytest tests/e2e/test_vertical_slice_e2e.py -v
```
