import { useState, useRef, useEffect, useCallback } from "react";

export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface UseDraggableResizableOptions {
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  storageKey?: string;
  initialX?: number;
  initialY?: number;
}

export function useDraggableResizable(options: UseDraggableResizableOptions = {}) {
  const {
    defaultWidth = 520,
    defaultHeight = 680,
    minWidth = 360,
    minHeight = 300,
    maxWidth,
    maxHeight,
    storageKey,
    initialX,
    initialY,
  } = options;

  // Calcula tamanho inicial garantindo limites da tela
  const getInitialSize = () => {
    const w = Math.min(defaultWidth, window.innerWidth - 60);
    const h = Math.min(defaultHeight, window.innerHeight - 80);

    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.size && typeof parsed.size.w === "number" && typeof parsed.size.h === "number") {
            const validW = Math.max(minWidth, Math.min(window.innerWidth - 40, parsed.size.w));
            const validH = Math.max(minHeight, Math.min(window.innerHeight - 60, parsed.size.h));
            return { w: validW, h: validH };
          }
        }
      } catch (_) {}
    }

    return { w: Math.max(minWidth, w), h: Math.max(minHeight, h) };
  };

  // Calcula posição inicial garantindo limites da tela
  const getInitialPos = (currentSize: { w: number; h: number }) => {
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.pos && typeof parsed.pos.x === "number" && typeof parsed.pos.y === "number") {
            const validX = Math.max(10, Math.min(window.innerWidth - currentSize.w - 10, parsed.pos.x));
            const validY = Math.max(10, Math.min(window.innerHeight - currentSize.h - 10, parsed.pos.y));
            return { x: validX, y: validY };
          }
        }
      } catch (_) {}
    }

    const initX = initialX !== undefined ? initialX : Math.max(30, Math.round(window.innerWidth / 2 - currentSize.w / 2));
    const initY = initialY !== undefined ? initialY : Math.max(40, Math.round(window.innerHeight / 2 - currentSize.h / 2));
    return {
      x: Math.max(10, Math.min(window.innerWidth - currentSize.w - 10, initX)),
      y: Math.max(10, Math.min(window.innerHeight - currentSize.h - 10, initY)),
    };
  };

  const [size, setSize] = useState(() => getInitialSize());
  const [pos, setPos] = useState(() => getInitialPos(size));
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const prevLayout = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } }>({
    pos,
    size,
  });

  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Persistência em localStorage
  const saveLayout = useCallback(
    (newPos: { x: number; y: number }, newSize: { w: number; h: number }) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            pos: newPos,
            size: newSize,
          })
        );
      } catch (_) {}
    },
    [storageKey]
  );

  // ── Drag to move ───────────────────────────────────────────────
  const onMouseDownHeader = useCallback(
    (e: React.MouseEvent) => {
      // Apenas botão esquerdo do mouse e não em botões/ações
      if (e.button !== 0 || (e.target as HTMLElement).closest(".floating-node-actions, button, input, select")) {
        return;
      }
      dragging.current = true;
      dragOffset.current = {
        x: e.clientX - pos.x,
        y: e.clientY - pos.y,
      };
      e.preventDefault();
    },
    [pos]
  );

  useEffect(() => {
    let latestPos = pos;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const nextX = Math.max(0, Math.min(window.innerWidth - size.w, e.clientX - dragOffset.current.x));
      const nextY = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.current.y));
      latestPos = { x: Math.round(nextX), y: Math.round(nextY) };
      setPos(latestPos);
    };

    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        saveLayout(latestPos, size);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [size, saveLayout]);

  // ── Maximize toggle ───────────────────────────────────────────
  const handleToggleMaximize = useCallback(() => {
    if (minimized) setMinimized(false);
    if (!maximized) {
      prevLayout.current = { pos, size };
      const maxW = Math.min(maxWidth || 1200, window.innerWidth - 40);
      const maxH = Math.min(maxHeight || 900, window.innerHeight - 60);
      const targetPos = { x: Math.max(20, Math.round((window.innerWidth - maxW) / 2)), y: 30 };
      const targetSize = { w: maxW, h: maxH };
      setPos(targetPos);
      setSize(targetSize);
      setMaximized(true);
      saveLayout(targetPos, targetSize);
    } else {
      setPos(prevLayout.current.pos);
      setSize(prevLayout.current.size);
      setMaximized(false);
      saveLayout(prevLayout.current.pos, prevLayout.current.size);
    }
  }, [maximized, minimized, pos, size, maxWidth, maxHeight, saveLayout]);

  // ── Multi-directional Resizing ────────────────────────────────
  const onStartResize = useCallback(
    (direction: ResizeDirection, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (maximized) setMaximized(false);

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = size.w;
      const startH = size.h;
      const startPosX = pos.x;
      const startPosY = pos.y;

      let latestPos = pos;
      let latestSize = size;

      const onMove = (ev: MouseEvent) => {
        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;

        let newW = startW;
        let newH = startH;
        let newX = startPosX;
        let newY = startPosY;

        // Eixo Horizontal
        if (direction === "e" || direction === "se" || direction === "ne") {
          newW = Math.max(minWidth, Math.min(window.innerWidth - startPosX - 20, startW + deltaX));
        } else if (direction === "w" || direction === "sw" || direction === "nw") {
          const potentialW = startW - deltaX;
          if (potentialW >= minWidth) {
            newW = Math.min(startPosX + startW - 20, potentialW);
            newX = startPosX + (startW - newW);
          } else {
            newW = minWidth;
            newX = startPosX + startW - minWidth;
          }
        }

        // Eixo Vertical
        if (direction === "s" || direction === "se" || direction === "sw") {
          newH = Math.max(minHeight, Math.min(window.innerHeight - startPosY - 20, startH + deltaY));
        } else if (direction === "n" || direction === "ne" || direction === "nw") {
          const potentialH = startH - deltaY;
          if (potentialH >= minHeight) {
            newH = Math.min(startPosY + startH - 20, potentialH);
            newY = startPosY + (startH - newH);
          } else {
            newH = minHeight;
            newY = startPosY + startH - minHeight;
          }
        }

        latestSize = { w: Math.round(newW), h: Math.round(newH) };
        latestPos = { x: Math.round(newX), y: Math.round(newY) };

        setSize(latestSize);
        setPos(latestPos);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        saveLayout(latestPos, latestSize);
      };

      document.body.style.userSelect = "none";
      if (direction === "se") document.body.style.cursor = "nwse-resize";
      else if (direction === "sw") document.body.style.cursor = "nesw-resize";
      else if (direction === "ne") document.body.style.cursor = "nesw-resize";
      else if (direction === "nw") document.body.style.cursor = "nwse-resize";
      else if (direction === "s" || direction === "n") document.body.style.cursor = "ns-resize";
      else document.body.style.cursor = "ew-resize";

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [maximized, pos.x, pos.y, size.w, size.h, minWidth, minHeight, saveLayout]
  );

  return {
    pos,
    setPos,
    size,
    setSize,
    minimized,
    setMinimized,
    maximized,
    setMaximized,
    onMouseDownHeader,
    onStartResize,
    handleToggleMaximize,
    containerRef,
  };
}
