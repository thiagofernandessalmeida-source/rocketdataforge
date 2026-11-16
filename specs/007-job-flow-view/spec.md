# Feature Specification: 007-job-flow-view

**Status:** Ready for Implementation  
**Data:** 16 de Novembro de 2026  
**Autor:** RocketDataForge Core Team / CellFlow Data Studio  
**Escopo:** View Alternativa "Fluxo" (UC4 Automic / JOBP), Barramento Ortogonal de Arestas e Expansão In-Place de Células.

---

## 1. Visão Geral e Problema

Atualmente, o RocketDataForge organiza as execuções multi-célula em uma visualização empilhada verticalmente (`MultiCanvasContainer`). Embora excelente para a edição aprofundada de componentes individuais dentro de cada canvas, essa representação dificulta:
1. **Visão Holística do Pipeline de Dados:** A visualização de interdependências, ordens de execução e pré-condições entre dezenas de células de forma sequencial e paralela (estilo UC4 Automic / JOBP).
2. **Navegação Rápida entre Código e Grafo:** Alternar rapidamente entre a arquitetura macro do Job e a inspeção dos nós de uma célula Canvas ou das linhas de código de uma célula Python.
3. **Legibilidade de Ligações Densas:** Arestas curvas (Bézier) atuais tendem a se sobrepor e cruzar componentes quando existem múltiplas saídas do mesmo nó.

---

## 2. Requisitos Funcionais

### RF-01: Roteador de Arestas "Ortogonal com Barramento" (Pure Router)
- **RF-01.1:** Algoritmo puro de roteamento ortogonal (sem dependência do React) calculando polilinhas `(x1, y1) -> (gx, y1) -> (gx, y2) -> (x2, y2)` com tronco vertical deslocado em barramento (`gx = x_saída + 26 + 8*i`) para saídas múltiplas.
- **RF-01.2:** Pontos de junção desenhados como círculos no início do tronco quando houver 2 ou mais arestas para a frente.
- **RF-01.3:** Roteamento seguro de retorno (backward/loopback edges) contornando a base ou o topo do destino com margem de segurança de 18 px.
- **RF-01.4:** Cantos arredondados com raio de 9 px (ou metade do menor segmento adjacente), eliminando pontos colineares e repetidos.
- **RF-01.5:** Posicionamento de rótulo fixado a 44 px do término da polilinha ao longo dos segmentos.
- **RF-01.6:** Detecção de colisão com componentes intermediários: fallback primeiro para o ponto médio `(x1+x2)/2`, e se persistir a sobreposição, fallback gracioso para curva Bézier.
- **RF-01.7:** Determinismo completo e suporte a orientações Horizontal (`LR`) e Vertical (`TB`).

### RF-02: Seletor de Estilo de Arestas no Canvas
- **RF-02.1:** Hook `useEdgeStyle()` com persistência em `localStorage` (padrão `"ortogonal"`).
- **RF-02.2:** Alternador visual "Curva" vs "Ortogonal com barramento" integrado à barra da célula Canvas.
- **RF-02.3:** Preservação estrita dos dados atômicos das arestas: IDs, `flowName`, `flowType`, menus de contexto e validação de nome único.
- **RF-02.4:** Halo de separação (contorno de 6 px) e diferenciação visual por padrão de traço (`main` contínuo, `lkp` pontilhado `2 5`, `reject` tracejado `7 4`, `out` contínuo, `iterate` traço-ponto `9 3 2 3`).

### RF-03: Modelo e Layout da View de Fluxo
- **RF-03.1:** Conversão das células e pré-condições do Job em um grafo colunar ordenado por `order`.
- **RF-03.2:** Resolução resiliente de pré-condições por ID ou por nome da célula de origem.
- **RF-03.3:** Tratamento e avisos explícitos para ciclos (`detectCellCycles`), referências inexistentes e inconsistências de ordem paralela (`validateParallelCellConsistency`).
- **RF-03.4:** Layout com alinhamento vertical centralizado de nós em colunas de menor altura, espaçamento horizontal de 64 px e vertical de 28 px.

### RF-04: View Interativa JobFlowView
- **RF-04.1:** Ícone recolhido (200 x 120 px) com avatar do tipo de célula, badge de ordem, status em tempo real, duração e acessibilidade via `<button>`.
- **RF-04.2:** Expansão in-place (540 px de largura) mantendo o alinhamento das colunas subsequentes:
  - Célula Canvas: mini-grafo dos componentes com duplo clique disparando `handleFocusNode`.
  - Célula Python: visualização do código com realce de sintaxe em modo somente leitura.
- **RF-04.3:** Ligações semânticas entre células via pré-condições: verde contínuo para expectativa "OK", vermelho tracejado para "ERROR", com badge "E" (`AND`) ou "OU" (`OR`).
- **RF-04.4:** Controles macro: "Expandir tudo", "Recolher tudo", "Ajustar à tela", "Executar job" e ações rápidas no cabeçalho do ícone expandido.

### RF-05: Integração e Persistência no App
- **RF-05.1:** Toggle "Canvas | Fluxo" na barra de contexto do Job em `App.tsx`.
- **RF-05.2:** Estado de expansão e view ativa persistidos exclusivamente em `localStorage` com tratamento de exceção (`try/catch`).
- **RF-05.3:** Zero modificações no schema salvo do Job, mantendo retrocompatibilidade total com jobs antigos e exportações.

---

## 3. Requisitos Não Funcionais
- **RNF-01 (Desempenho):** O cálculo do layout da view de fluxo para jobs com até 100 células deve executar em menos de 25 ms.
- **RNF-02 (Acessibilidade WCAG 2.1 AA):** Todos os elementos clicáveis devem ser botões semânticos com `aria-expanded` e `aria-label`; nenhuma informação crítica (status ou tipo de ligação) pode depender unicamente da cor.
- **RNF-03 (Imutabilidade do Domínio):** A view de fluxo e o roteador de arestas não gravam nenhuma alteração na estrutura persistida do `jobStore`.
