import React, { useState, useCallback, useRef } from "react";
import { reorderItems, moveItemsDirection } from "./reorderUtils";

export interface UseReorderableListOptions<T> {
  items: T[];
  onReorder: (newItems: T[]) => void;
  getId?: (item: T) => string;
}

export interface DropIndicator {
  targetId: string;
  position: "above" | "below";
}

export function useReorderableList<T extends { id?: string }>({
  items,
  onReorder,
  getId = (item: any) => item.id || "",
}: UseReorderableListOptions<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Seleção de itens com clique normal, Ctrl/Meta (toggle) e Shift (intervalo)
  const handleItemSelect = useCallback(
    (id: string, e?: React.MouseEvent) => {
      if (!e) {
        setSelectedIds(new Set([id]));
        setLastSelectedId(id);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        setLastSelectedId(id);
      } else if (e.shiftKey && lastSelectedId) {
        const currentItems = itemsRef.current;
        const startIdx = currentItems.findIndex((it) => getId(it) === lastSelectedId);
        const endIdx = currentItems.findIndex((it) => getId(it) === id);
        if (startIdx !== -1 && endIdx !== -1) {
          const [min, max] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const rangeIds = new Set(selectedIdsRef.current);
          for (let i = min; i <= max; i++) {
            rangeIds.add(getId(currentItems[i]));
          }
          setSelectedIds(rangeIds);
        }
      } else {
        setSelectedIds(new Set([id]));
        setLastSelectedId(id);
      }
    },
    [lastSelectedId, getId]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      // Se o item arrastado já está selecionado, arrasta todos os selecionados; caso contrário, arrasta só ele
      const currentSelected = selectedIdsRef.current;
      const idsToDrag = currentSelected.has(id) && currentSelected.size > 0
        ? Array.from(currentSelected)
        : [id];

      setDraggedIds(idsToDrag);
      if (!currentSelected.has(id)) {
        setSelectedIds(new Set([id]));
        setLastSelectedId(id);
      }

      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-rdf-reorder-ids", JSON.stringify(idsToDrag));
      e.stopPropagation();
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";

      // Calcula se o cursor está na metade superior ou inferior do elemento
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const position: "above" | "below" = relativeY < rect.height / 2 ? "above" : "below";

      setDropIndicator((prev) => {
        if (prev?.targetId === targetId && prev.position === position) return prev;
        return { targetId, position };
      });
    },
    []
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    // Limpa apenas se saiu do próprio container
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !(e.currentTarget as HTMLElement).contains(relatedTarget)) {
      setDropIndicator(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();

      const raw = e.dataTransfer.getData("application/x-rdf-reorder-ids");
      let idsToMove = draggedIds;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            idsToMove = parsed;
          }
        } catch (_) {}
      }

      const currentIndicator = dropIndicator;
      const position = currentIndicator?.position || "below";

      if (idsToMove.length > 0) {
        const reordered = reorderItems(itemsRef.current, idsToMove, targetId, position, getId);
        onReorder(reordered);
      }

      setDraggedIds([]);
      setDropIndicator(null);
    },
    [draggedIds, dropIndicator, onReorder, getId]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIds([]);
    setDropIndicator(null);
  }, []);

  // Atalhos de teclado Alt+ArrowUp e Alt+ArrowDown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        const direction = e.key === "ArrowUp" ? "up" : "down";
        const moved = moveItemsDirection(itemsRef.current, selectedIdsRef.current, direction, getId);
        if (moved !== itemsRef.current) {
          onReorder(moved);
        }
      }
    },
    [onReorder, getId]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  return {
    selectedIds,
    setSelectedIds,
    draggedIds,
    dropIndicator,
    handleItemSelect,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleKeyDown,
    clearSelection,
  };
}
