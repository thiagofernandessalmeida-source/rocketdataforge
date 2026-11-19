/**
 * reorderUtils.ts
 * Funções puras para reordenação de itens (colunas, células, etc.)
 * com suporte a seleção múltipla, Drag & Drop e atalhos de teclado (Alt+Up / Alt+Down).
 */

/**
 * Move um conjunto de IDs para antes ou depois de um targetId, preservando a ordem relativa dos itens movidos.
 */
export function reorderItems<T>(
  items: T[],
  idsToMove: string[],
  targetId: string,
  position: "above" | "below",
  getId: (item: T) => string = (item: any) => item.id
): T[] {
  if (!items || items.length <= 1 || !idsToMove || idsToMove.length === 0) {
    return items;
  }

  const moveSet = new Set(idsToMove);

  // Se o target está dentro dos itens a serem movidos, nenhuma alteração é necessária
  if (moveSet.has(targetId) && idsToMove.length === 1) {
    return items;
  }

  // Extrai os itens movidos preservando a ordem que já tinham na lista
  const movingItems = items.filter((item) => moveSet.has(getId(item)));
  // Itens restantes que permanecem no lugar
  const remainingItems = items.filter((item) => !moveSet.has(getId(item)));

  const targetIndexInRemaining = remainingItems.findIndex((item) => getId(item) === targetId);

  if (targetIndexInRemaining === -1) {
    // Fallback: se o target não estiver nos restantes (ex: pertencia aos movidos), anexa no final
    return [...remainingItems, ...movingItems];
  }

  const insertionIndex = position === "above" ? targetIndexInRemaining : targetIndexInRemaining + 1;

  const result = [
    ...remainingItems.slice(0, insertionIndex),
    ...movingItems,
    ...remainingItems.slice(insertionIndex),
  ];

  return result;
}

/**
 * Move os itens selecionados uma posição para cima ou para baixo (ex: Alt+ArrowUp / Alt+ArrowDown).
 * Preserva as posições relativas e respeita os limites da lista.
 */
export function moveItemsDirection<T>(
  items: T[],
  selectedIds: Set<string>,
  direction: "up" | "down",
  getId: (item: T) => string = (item: any) => item.id
): T[] {
  if (!items || items.length <= 1 || selectedIds.size === 0) {
    return items;
  }

  const result = [...items];

  if (direction === "up") {
    // Se o primeiro item já estiver selecionado, não pode subir mais
    const firstSelected = result.findIndex((item) => selectedIds.has(getId(item)));
    if (firstSelected <= 0) return items;

    for (let i = 1; i < result.length; i++) {
      const currentId = getId(result[i]);
      const prevId = getId(result[i - 1]);
      if (selectedIds.has(currentId) && !selectedIds.has(prevId)) {
        // Troca com o anterior
        const temp = result[i - 1];
        result[i - 1] = result[i];
        result[i] = temp;
      }
    }
  } else {
    // Se o último item já estiver selecionado, não pode descer mais
    const lastSelected = result.map((item) => selectedIds.has(getId(item))).lastIndexOf(true);
    if (lastSelected === -1 || lastSelected >= result.length - 1) return items;

    for (let i = result.length - 2; i >= 0; i--) {
      const currentId = getId(result[i]);
      const nextId = getId(result[i + 1]);
      if (selectedIds.has(currentId) && !selectedIds.has(nextId)) {
        // Troca com o próximo
        const temp = result[i + 1];
        result[i + 1] = result[i];
        result[i] = temp;
      }
    }
  }

  return result;
}
