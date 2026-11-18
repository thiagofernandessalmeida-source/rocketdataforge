export interface VirtualRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface FloatingViewport {
  width: number;
  height: number;
}

export interface ComputeFloatingPositionOptions {
  anchor: VirtualRect;
  menu: FloatingSize;
  viewport: FloatingViewport;
  gap?: number;
  margin?: number;
  preferred?: "below" | "above";
}

export interface FloatingPositionResult {
  left: number;
  top: number;
  maxHeight: number;
  placement: "below" | "above";
}

/**
 * Computa a posição de um menu flutuante relativo à âncora e ao viewport.
 * Função pura, sem dependências de React ou DOM, para máxima testabilidade.
 */
export function computeFloatingPosition({
  anchor,
  menu,
  viewport,
  gap = 2,
  margin = 8,
  preferred = "below",
}: ComputeFloatingPositionOptions): FloatingPositionResult {
  const spaceBelow = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const spaceAbove = Math.max(0, anchor.top - gap - margin);

  let placement: "below" | "above";
  if (preferred === "above") {
    if (menu.height <= spaceAbove) {
      placement = "above";
    } else if (menu.height <= spaceBelow) {
      placement = "below";
    } else {
      placement = spaceAbove >= spaceBelow ? "above" : "below";
    }
  } else {
    // Padrão: preferred === "below"
    if (menu.height <= spaceBelow) {
      placement = "below";
    } else if (menu.height <= spaceAbove) {
      placement = "above";
    } else {
      placement = spaceBelow >= spaceAbove ? "below" : "above";
    }
  }

  let top: number;
  let maxHeight: number;

  if (placement === "below") {
    top = anchor.bottom + gap;
    maxHeight = spaceBelow;
  } else {
    maxHeight = spaceAbove;
    const effectiveHeight = Math.min(menu.height > 0 ? menu.height : spaceAbove, spaceAbove);
    top = anchor.top - gap - effectiveHeight;
  }

  // Posicionamento horizontal
  const effectiveWidth = Math.max(menu.width, anchor.width);
  let left = anchor.left;

  // Se estourar a borda direita da janela, desloca para a esquerda
  if (left + effectiveWidth > viewport.width - margin) {
    left = viewport.width - margin - effectiveWidth;
  }

  // Nunca deixa left menor que margin
  if (left < margin) {
    left = margin;
  }

  return {
    left,
    top,
    maxHeight,
    placement,
  };
}
