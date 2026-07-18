'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function readCloseMs(): number {
  if (typeof document === 'undefined') return 150;
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur'),
  );
  return Number.isFinite(v) ? v : 150;
}

/**
 * transitions-dev modal open/close for components that mount when visible.
 * Opens on mount; `requestClose` runs the close animation then calls `onClose`.
 */
export function useModalTransition(onClose: () => void) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Double rAF: paint the pre-open scale first, then transition in.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setIsOpen(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsOpen(false);
    setIsClosing(true);
    const ms = readCloseMs();
    window.setTimeout(() => {
      onCloseRef.current();
    }, ms);
  }, []);

  const stateClass =
    isOpen && !isClosing ? 'is-open' : isClosing ? 'is-closing' : '';

  return {
    requestClose,
    isClosing,
    modalClassName: `t-modal ${stateClass}`.trim(),
    backdropClassName: `t-modal-backdrop ${stateClass}`.trim(),
  };
}

/**
 * Controlled modal (e.g. wallet adapter `visible`). Stays mounted through
 * the close animation when `visible` flips false.
 */
export function useControlledModalTransition(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const [phase, setPhase] = useState<'hidden' | 'open' | 'closing'>('hidden');
  const [prevVisible, setPrevVisible] = useState(visible);

  // Adjust local state when the controlled prop changes (React render-time pattern).
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMounted(true);
      setPhase('hidden');
    } else if (mounted) {
      setPhase('closing');
    }
  }

  useEffect(() => {
    if (visible && phase === 'hidden' && mounted) {
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setPhase('open'));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    if (!visible && phase === 'closing') {
      const ms = readCloseMs();
      const t = window.setTimeout(() => {
        setMounted(false);
        setPhase('hidden');
      }, ms);
      return () => window.clearTimeout(t);
    }
  }, [visible, phase, mounted]);

  const stateClass =
    phase === 'open' ? 'is-open' : phase === 'closing' ? 'is-closing' : '';

  return {
    mounted,
    modalClassName: `t-modal ${stateClass}`.trim(),
    backdropClassName: `t-modal-backdrop ${stateClass}`.trim(),
  };
}
