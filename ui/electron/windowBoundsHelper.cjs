/**
 * windowBoundsHelper.cjs - Funções puras de cálculo de limites de tela e lotes IPC (Fase 3).
 */

/**
 * Valida se savedBounds está visível em algum display conectado.
 * Se o display foi desconectado ou as coordenadas caíram fora dos monitores conectados,
 * reposiciona a janela centralizada no monitor primário com o tamanho padrão.
 */
function validateWindowBounds(savedBounds, displays, defaultBounds = { width: 960, height: 620 }) {
  if (!displays || displays.length === 0) {
    return { x: 50, y: 50, width: defaultBounds.width, height: defaultBounds.height };
  }

  // Identifica o monitor primário (x: 0, y: 0 ou primeiro da lista)
  const primary = displays.find((d) => d.bounds && d.bounds.x === 0 && d.bounds.y === 0) || displays[0];

  if (
    !savedBounds ||
    typeof savedBounds.x !== "number" ||
    typeof savedBounds.y !== "number" ||
    typeof savedBounds.width !== "number" ||
    typeof savedBounds.height !== "number"
  ) {
    const px = Math.round(primary.bounds.x + (primary.bounds.width - defaultBounds.width) / 2);
    const py = Math.round(primary.bounds.y + (primary.bounds.height - defaultBounds.height) / 2);
    return {
      x: Math.max(primary.bounds.x + 20, px),
      y: Math.max(primary.bounds.y + 20, py),
      width: defaultBounds.width,
      height: defaultBounds.height,
    };
  }

  const { x, y, width, height } = savedBounds;

  // Checa se o cabeçalho/área útil da janela está dentro de algum monitor conectado
  const isContained = displays.some((d) => {
    const db = d.bounds;
    if (!db) return false;
    const headerVisible =
      x >= db.x - 40 &&
      x + Math.min(width, 120) <= db.x + db.width + 40 &&
      y >= db.y - 10 &&
      y + 40 <= db.y + db.height + 10;
    return headerVisible;
  });

  if (isContained) {
    return {
      x,
      y,
      width: Math.max(420, width),
      height: Math.max(300, height),
    };
  }

  // Display anterior foi desconectado ou coordenadas inválidas: fallback no primário
  const px = Math.round(primary.bounds.x + (primary.bounds.width - defaultBounds.width) / 2);
  const py = Math.round(primary.bounds.y + (primary.bounds.height - defaultBounds.height) / 2);
  return {
    x: Math.max(primary.bounds.x + 20, px),
    y: Math.max(primary.bounds.y + 20, py),
    width: defaultBounds.width,
    height: defaultBounds.height,
  };
}

/**
 * Divide uma lista de itens em lotes (chunks) para streaming seguro via IPC.
 */
function batchArray(items, batchSize = 500) {
  if (!items || !Array.isArray(items) || items.length === 0) return [];
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

module.exports = {
  validateWindowBounds,
  batchArray,
};

