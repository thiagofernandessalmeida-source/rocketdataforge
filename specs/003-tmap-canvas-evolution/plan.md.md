# Implementation Plan: 003-tmap-canvas-evolution

---

## 1. Arquitetura da Solução

### 1.1 Frontend: Fluxo Unidirecional de Estado (ReactFlow + Zustand)
- **Eliminação do Estado Derivado Local:** Remover `useNodesState` e `useEdgesState` de `CanvasCellCard.tsx`.
- **Controle pelo Store:** `Canvas.tsx` consome diretamente os nós e arestas da célula ativa via seletores memoizados. Mutação de drag/posição é enviada via `onNodeDragStop` diretamente para `saveCellGraph`.
- **Sanitização de Schema:** No momento da persistência e serialização, passar nós e arestas por um sanitizer puro:
  ```ts
  const sanitizeNode = ({ selected, dragging, measured, ...node }: CanvasNode) => node;