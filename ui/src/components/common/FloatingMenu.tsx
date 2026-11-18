import React, { useLayoutEffect, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  computeFloatingPosition,
  VirtualRect,
  FloatingPositionResult,
} from "./floatingPosition";

export type AnchorType =
  | React.RefObject<HTMLElement | null>
  | HTMLElement
  | VirtualRect
  | (() => VirtualRect | null)
  | null
  | undefined;

export interface FloatingMenuProps {
  open: boolean;
  anchorRef: AnchorType;
  onRequestClose?: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  preferred?: "below" | "above";
  gap?: number;
  margin?: number;
  matchAnchorWidth?: boolean;
  role?: string;
  ariaLabel?: string;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  autoFocus?: boolean;
}

export function resolveAnchor(anchor: AnchorType): {
  rect: VirtualRect | null;
  element: HTMLElement | null;
} {
  if (!anchor) return { rect: null, element: null };
  if (typeof anchor === "function") {
    const res = anchor();
    return { rect: res, element: null };
  }
  if (typeof anchor === "object" && "current" in anchor) {
    const el = anchor.current;
    if (!el || typeof el.getBoundingClientRect !== "function") return { rect: null, element: null };
    const b = el.getBoundingClientRect();
    return {
      rect: {
        left: b.left,
        top: b.top,
        right: b.right,
        bottom: b.bottom,
        width: b.width,
        height: b.height,
      },
      element: el,
    };
  }
  if (typeof (anchor as any).getBoundingClientRect === "function") {
    const el = anchor as HTMLElement;
    const b = el.getBoundingClientRect();
    return {
      rect: {
        left: b.left,
        top: b.top,
        right: b.right,
        bottom: b.bottom,
        width: b.width,
        height: b.height,
      },
      element: el,
    };
  }
  // Se for um VirtualRect literal
  if ("left" in anchor && "top" in anchor && "width" in anchor && "height" in anchor) {
    const v = anchor as VirtualRect;
    return {
      rect: {
        left: v.left,
        top: v.top,
        right: v.right ?? v.left + v.width,
        bottom: v.bottom ?? v.top + v.height,
        width: v.width,
        height: v.height,
      },
      element: null,
    };
  }
  return { rect: null, element: null };
}

export interface UseFloatingMenuOptions {
  open: boolean;
  anchorRef: AnchorType;
  onRequestClose?: () => void;
  preferred?: "below" | "above";
  gap?: number;
  margin?: number;
}

export function useFloatingMenu({
  open,
  anchorRef,
  onRequestClose,
  preferred = "below",
  gap = 2,
  margin = 8,
}: UseFloatingMenuOptions) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<FloatingPositionResult & { ready: boolean; anchorWidth: number }>({
    left: 0,
    top: 0,
    maxHeight: 300,
    placement: preferred,
    ready: false,
    anchorWidth: 0,
  });

  const updatePosition = useCallback(() => {
    if (!open) return;
    const { rect: anchorRect } = resolveAnchor(anchorRef);
    if (!anchorRect) return;

    if (typeof window !== "undefined") {
      const isOffscreen =
        anchorRect.bottom < 0 ||
        anchorRect.top > window.innerHeight ||
        anchorRect.right < 0 ||
        anchorRect.left > window.innerWidth;

      if (isOffscreen) {
        onRequestClose?.();
        return;
      }

      const menuEl = menuRef.current;
      const menuWidth = menuEl ? menuEl.offsetWidth : 0;
      const menuHeight = menuEl ? menuEl.offsetHeight : 0;

      const pos = computeFloatingPosition({
        anchor: anchorRect,
        menu: { width: menuWidth, height: menuHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        gap,
        margin,
        preferred,
      });

      setPosition({
        ...pos,
        ready: true,
        anchorWidth: anchorRect.width,
      });
    }
  }, [open, anchorRef, onRequestClose, preferred, gap, margin]);

  // useLayoutEffect para medição imediata e sem flicker antes do paint
  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    } else {
      setPosition((prev) => ({ ...prev, ready: false }));
    }
  }, [open, updatePosition]);

  // Listeners de scroll (fase de captura para pegar scroll em qualquer container interno), resize e ResizeObserver
  useEffect(() => {
    if (!open) return;

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    const { element: anchorEl } = resolveAnchor(anchorRef);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        updatePosition();
      });
      if (menuRef.current) ro.observe(menuRef.current);
      if (anchorEl) ro.observe(anchorEl);
    }

    // Clique fora: considera dentro tanto o menu quanto a âncora
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      const { element: currentAnchorEl } = resolveAnchor(anchorRef);
      if (currentAnchorEl && currentAnchorEl.contains(target)) return;
      onRequestClose?.();
    };

    // Tecla Escape para fechar
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onRequestClose?.();
      }
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      document.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      if (ro) ro.disconnect();
    };
  }, [open, anchorRef, updatePosition, onRequestClose]);

  return { menuRef, position, updatePosition };
}

export const FloatingMenu: React.FC<FloatingMenuProps> = ({
  open,
  anchorRef,
  onRequestClose,
  children,
  className = "",
  style = {},
  preferred = "below",
  gap = 2,
  margin = 8,
  matchAnchorWidth = false,
  role,
  ariaLabel,
  tabIndex,
  onKeyDown,
  autoFocus = false,
}) => {
  const { menuRef, position } = useFloatingMenu({
    open,
    anchorRef,
    onRequestClose,
    preferred,
    gap,
    margin,
  });

  useLayoutEffect(() => {
    if (open && autoFocus && menuRef.current) {
      menuRef.current.focus();
    }
  }, [open, autoFocus]);

  if (typeof document === "undefined" || !open) return null;

  const combinedStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 100001,
    left: position.left,
    top: position.top,
    maxHeight: position.maxHeight,
    overflowY: "auto",
    minWidth: matchAnchorWidth && position.anchorWidth ? position.anchorWidth : undefined,
    visibility: position.ready ? "visible" : "hidden",
    ...style,
  };

  const combinedClassName = `rdf-floating-menu nowheel ${className}`.trim();

  return createPortal(
    <div
      ref={menuRef}
      className={combinedClassName}
      style={combinedStyle}
      role={role}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onWheel={(e) => {
        // Evita que a rolagem do mouse faça zoom ou pan no canvas do React Flow
        e.stopPropagation();
      }}
    >
      {children}
    </div>,
    document.body
  );
};
