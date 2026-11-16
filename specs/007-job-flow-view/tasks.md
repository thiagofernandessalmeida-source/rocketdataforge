# Implementation Tasks: 007-job-flow-view

---

## Fase 1: Roteador de Arestas "Ortogonal com Barramento"
- [x] **T-1.1:** [TEST] Criar testes unitários em `ui/tests/fase1_bus_router.test.mjs` cobrindo portas, troncos múltiplos, pontos de junção, aresta de retorno, cantos arredondados, posicionamento de rótulos a 44px, segurança contra colisão de nós e orientação TB.
- [x] **T-1.2:** [CODE] Implementar `ui/src/features/designer/edges/busRouter.ts` como módulo puramente funcional sem dependência de React.
- [x] **T-1.3:** [VERIFY] Executar suite de testes e validar conformidade matemática dos caminhos gerados.

## Fase 2: Estilo de Aresta no Canvas
- [x] **T-2.1:** [TEST] Criar testes unitários em `ui/tests/fase2_edge_style.test.mjs` validando persistência do estilo no localStorage e ausência de mutação nos dados da aresta.
- [x] **T-2.2:** [CODE] Criar hook `ui/src/features/designer/hooks/useEdgeStyle.ts` com suporte seguro a localStorage (try/catch).
- [x] **T-2.3:** [CODE] Adicionar variáveis CSS para fluxos em `ui/src/index.css` e estilização com halo (6 px) e traços diferenciados.
- [x] **T-2.4:** [CODE] Integrar roteador ortogonal e controles de estilo em `FlowEdge.tsx`, `TriggerEdge.tsx` e barra da célula em `CanvasCellCard.tsx`.

## Fase 3: Modelo e Layout da View de Fluxo
- [x] **T-3.1:** [TEST] Criar testes unitários em `ui/tests/fase3_job_flow_model_layout.test.mjs` validando mapeamento de nós, resolução de pré-condições (id/nome), detecção de ciclos/inconsistências, posições em colunas e benchmark com 100 células.
- [x] **T-3.2:** [CODE] Implementar `ui/src/features/flow/jobFlowModel.ts` para extração resiliente do grafo macro.
- [x] **T-3.3:** [CODE] Implementar `ui/src/features/flow/jobFlowLayout.ts` para cálculo colunar das coordenadas, centralização e portas.

## Fase 4: Componente JobFlowView
- [x] **T-4.1:** [TEST] Criar testes em `ui/tests/fase4_job_flow_view.test.mjs` validando expansão/recolhimento, persistência por job, renderização do corpo e delegação de duplo clique.
- [x] **T-4.2:** [CODE] Criar componentes `FlowCellNode.tsx`, `FlowCanvasBody.tsx` e `FlowPythonBody.tsx`.
- [x] **T-4.3:** [CODE] Criar `FlowLinksOverlay.tsx` e `FlowLegend.tsx` integrando o `busRouter` e selos E/OU.
- [x] **T-4.4:** [CODE] Implementar o componente principal `JobFlowView.tsx` com barra de ferramentas, controle de expansão global e zoom/ajuste.

## Fase 5: Integração no App
- [x] **T-5.1:** [TEST] Criar testes em `ui/tests/fase5_flow_integration.test.mjs` validando alternância de views no App e preservação do jobStore.
- [x] **T-5.2:** [CODE] Conectar seletor "Canvas | Fluxo" em `ui/src/App.tsx` com persistência em localStorage e desativação de atalhos de canvas no fluxo.

## Fase 6: Documentação e Aceite
- [ ] **T-6.1:** [DOCS] Atualizar `docs/DOCUMENTACAO_TECNICA_E_FUNCIONAL.md` documentando a view de Fluxo, o roteamento ortogonal e o guia de atalhos.
- [ ] **T-6.2:** [VERIFY] Executar validação completa com `npm test` e `npm run build` em `ui/`.
