# Guia de Início Rápido: Vertical Slice 002

**Documento:** `specs/002-iteration-inference-fixes/quickstart.md`  
**Versão:** 2.0.0  

---

## 1. Iteração Direta entre Inputs (`Input -> Input`)
1. Adicione um componente `tPostgresqlInput` (`tpostgresinput_1`) com a query:
   ```sql
   SELECT person_code, operational_cycle FROM consultoras WHERE ativo = 1
   ```
2. Adicione um segundo `tPostgresqlInput` (`tpostgresinput_2`) e ligue a saída do primeiro nele.
3. No segundo componente, use a interpolação:
   ```sql
   SELECT * FROM cadwf WHERE id = {tpostgresinput_1.person_code} AND ciclo = {tpostgresinput_1.operational_cycle}
   ```
4. Ao executar, a iteração ocorrerá de forma natural e agregada.

---

## 2. DuckDB em Arquivos e Componentes Dedicados
1. **Em arquivos:** No componente `tFileInputCSV` ou `tFileInputParquet`, marque *"Tratar como Tabela DuckDB em Memória"* e informe sua query SQL analítica:
   ```sql
   SELECT categoria, COUNT(*) as qtd, SUM(valor) as total FROM source_data GROUP BY categoria
   ```
2. **Componente Dedicado:** Arraste `tDuckDbInput` para conectar a um banco `.duckdb` local ou consultar múltiplos arquivos com SQL puro.
3. **Gravação:** Arraste `tDuckDbOutput` para gravar os resultados diretamente em arquivo DuckDB ou memória.

---

## 3. Ações de Tabela e Dados no Padrão Studio
1. No seu nó de saída (ex: `tPostgresqlOutput` ou `tDuckDbOutput`), selecione:
   - **Ação na Tabela:** `Truncar Tabela (Truncate)` ou `Deletar e Criar Tabela (Drop and Create)`.
   - **Ação nos Dados:** `Inserir (Insert)` ou `Inserir ou Atualizar (Upsert)`.
2. O sistema executará a ação DDL preparatória antes de iniciar o streaming de registros.

---

## 4. Transformação Visual com `tMap`
1. Arraste um componente `tMap` (`tmap_1`).
2. Conecte o fluxo principal (`row1`) e um ou mais fluxos de lookup (`row2`).
3. Dê duplo clique no `tMap` para abrir o **tMap Studio**:
   - Defina as junções de lookup (Left Outer Join, Inner Join).
   - Crie variáveis intermediárias na tabela `Var`.
   - Crie múltiplos fluxos de saída (ex: `out_validos`, `out_rejeitados`) com filtros booleanos por saída.
   - Mapeie colunas arrastando ou clicando em *Auto Map*.

---

## 5. Renomeação de IDs Simples
1. Clique no nó desejado no canvas.
2. No painel de propriedades, clique no campo **ID do Nó** (ex: `tpostgresinput_1`) e renomeie para o identificador desejado (ex: `brm_consultoras`).
3. O sistema atualiza o ID do nó e todas as referências de variáveis associadas.
