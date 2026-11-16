# Implementation Plan: 007-job-flow-view

---

## 1. Arquitetura da Solução

### 1.1 Módulo Puro de Roteamento de Arestas (`busRouter.ts`)
- Localização: `ui/src/features/designer/edges/busRouter.ts`.
- Módulo puro (sem JSX/React) para cálculo determinístico de rotas ortogonais com barramento, pontos de junção, arredondamento geométrico e posicionamento de labels a 44 px do fim do trajeto.
- Detecção de colisão contra AABB (Axis-Aligned Bounding Box) de nós intermediários com estratégias de desvio e fallback.

### 1.2 Estilo de Arestas no Canvas (`useEdgeStyle.ts`, `FlowEdge.tsx`, `TriggerEdge.tsx`)
- Hook `useEdgeStyle` lendo de `localStorage` (`cellflow_edge_style`) com chave segura e fallback para `"ortogonal"`.
- Adição de seletores visuais em `CanvasCellCard.tsx`.
- Halo com `stroke: var(--bg-app)` e largura de 6 px sob o traço principal.
- Novas variáveis CSS em `ui/src/index.css` para tipos de fluxo (`--flow-main`, `--flow-lkp`, `--flow-reject`, `--flow-out`, `--flow-iterate`).

### 1.3 Modelagem e Layout Colunar da View de Fluxo (`jobFlowModel.ts`, `jobFlowLayout.ts`)
- Localização: `ui/src/features/flow/`.
- `jobFlowModel.ts`: Extração pura de nós e ligações direcionadas a partir de `job.cells` e `cell.preconditions`. Identificação de ciclos (`detectCellCycles`) e conflitos de paralelismo (`validateParallelCellConsistency`).
- `jobFlowLayout.ts`: Algoritmo de posicionamento colunar por `order` com centralização vertical e suporte a expansão in-place de larguras dinâmicas.

### 1.4 Componentes da View de Fluxo (`JobFlowView.tsx` e subcomponentes)
- `JobFlowView.tsx`: Container principal com viewport escalável e rolagem bi-direcional.
- `FlowCellNode.tsx`: Renderização do card/ícone da célula (estilo UC4 Automic / JOBP) com estados recolhido (200x120) e expandido (540 px).
- `FlowCanvasBody.tsx`: Mini visualizador de componentes com layout automatizado e interatividade (duplo clique focando o nó no Canvas).
- `FlowPythonBody.tsx`: Visualizador de código Python com Monaco / pre somente leitura e métricas.
- `FlowLinksOverlay.tsx`: Camada SVG de renderização das ligações e junções com `busRouter`.

### 1.5 Integração no App (`App.tsx`)
- Seletor de visualização "Canvas | Fluxo" na barra de controle do Job.
- Sincronização reativa com o `jobStore` sem mutação de schema de persistência.

---

## 2. Diagrama da Arquitetura Visual e Roteamento

```
┌─────────────────────────────────────────────────────────────┐
│                    JobFlowView (App.tsx)                    │
│                                                             │
│  [ Canvas | Fluxo ]   [ Expandir tudo ]  [ Recolher tudo ]  │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌────────────────────────┐                   ┌────────────────────────┐
│  jobFlowModel.ts       │                   │  jobFlowLayout.ts      │
│  - Extrai nós & links  │ ───────────────>  │  - Colunas por ordem   │
│  - Resolve por id/nome │                   │  - Centraliza alturas  │
│  - Checa ciclos/avisos │                   │  - Calcula portas      │
└────────────────────────┘                   └───────────┬────────────┘
                                                         │
                                                         ▼
                                             ┌────────────────────────┐
                                             │  busRouter.ts          │
                                             │  - Tronco vertical (gx)│
                                             │  - Junções circulares  │
                                             │  - Bypass de retorno   │
                                             │  - Cantos r=9px        │
                                             └────────────────────────┘
```
