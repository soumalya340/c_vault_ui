'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base';
import { useControlledModalTransition } from './use-modal-transition';

function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const items = Array.from(
        container?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}

export function WalletModal() {
  const { visible, setVisible } = useWalletModal();
  const { wallets, select, connecting } = useWallet();
  const dialogRef = useRef<HTMLDivElement>(null);
  const client = useIsClient();
  const { mounted: transitionMounted, modalClassName, backdropClassName } =
    useControlledModalTransition(visible);

  useFocusTrap(visible, dialogRef);

  useEffect(() => {
    if (!visible) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setVisible(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [visible, setVisible]);

  const { detected, undetected } = useMemo(() => {
    const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed);
    const undetected = wallets.filter((w) => w.readyState !== WalletReadyState.Installed);
    return { detected, undetected };
  }, [wallets]);

  function handleSelect(name: WalletName) {
    select(name);
    setVisible(false);
  }

  if (!client || !transitionMounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => setVisible(false)}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        className={`cert-frame relative z-10 w-full max-w-[420px] overflow-hidden bg-background shadow-2xl ${modalClassName}`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-1 pt-6">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-seal">
              bearer registration
            </div>
            <h2
              id="wallet-modal-title"
              className="mt-1.5 font-display text-xl font-semibold leading-tight tracking-[0.02em] text-foreground"
            >
              Connect a wallet on Solana
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label="Close"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[2px] border border-border bg-foreground/5 text-muted-foreground transition-colors duration-100 hover:border-foreground/20 hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4 px-6 pb-6">
          {detected.length > 0 && (
            <ul className="flex flex-col gap-2">
              {detected.map((w) => (
                <li key={w.adapter.name}>
                  <button
                    type="button"
                    onClick={() => handleSelect(w.adapter.name)}
                    disabled={connecting}
                    className="group flex w-full items-center gap-3 rounded-[2px] border border-border bg-foreground/[0.03] px-4 py-3 text-left transition-colors duration-100 hover:border-accent hover:bg-accent/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={w.adapter.icon}
                      alt=""
                      className="h-7 w-7 flex-shrink-0 rounded-md object-contain"
                    />
                    <span className="flex-1 text-sm font-medium text-foreground">
                      {w.adapter.name}
                    </span>
                    <span className="rounded-[2px] border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
                      Detected
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {undetected.length > 0 && (
            <details className="group/details">
              <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-100 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
                More options
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5 transition-transform duration-150 group-open/details:rotate-180"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                    clipRule="evenodd"
                  />
                </svg>
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {undetected.map((w) => (
                  <li key={w.adapter.name}>
                    <button
                      type="button"
                      onClick={() => handleSelect(w.adapter.name)}
                      disabled={connecting}
                      className="group flex w-full items-center gap-3 rounded-[2px] border border-border bg-foreground/[0.03] px-4 py-3 text-left transition-colors duration-100 hover:border-foreground/25 hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={w.adapter.icon}
                        alt=""
                        className="h-7 w-7 flex-shrink-0 rounded-md object-contain opacity-70"
                      />
                      <span className="flex-1 text-sm font-medium text-muted-foreground">
                        {w.adapter.name}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground/60">
                        Install
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function subscribeNoop() {
  return () => {};
}

function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
