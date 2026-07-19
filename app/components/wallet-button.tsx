'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { ADMIN_PUBKEY } from '@/lib/constants';
import { PORTFOLIO_ROUTE } from './console-routes';
import { useControlledModalTransition } from './use-modal-transition';

const connectClassName =
  'rounded-[2px] border border-border-strong bg-background px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-foreground transition-colors duration-150 hover:border-accent hover:bg-accent hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const connectedClassName =
  'flex items-center gap-2 rounded-[2px] border border-border-strong bg-background px-3.5 py-2 text-sm font-semibold text-foreground transition-colors duration-150 hover:border-accent hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function WalletButton() {
  const { publicKey, connected, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { mounted, modalClassName } = useControlledModalTransition(menuOpen, {
    classPrefix: 'dropdown',
    closeDurationVar: '--dropdown-close-dur',
  });

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  if (!connected || !publicKey) {
    return (
      <button type="button" onClick={() => setVisible(true)} className={connectClassName}>
        Connect wallet
      </button>
    );
  }

  const short = `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className={connectedClassName}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        {wallet?.adapter.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={wallet.adapter.icon}
            alt=""
            className="h-5 w-5 flex-shrink-0 rounded-sm object-contain"
          />
        )}
        <span className="font-mono text-[13px]">{short}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3 text-muted-foreground"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {mounted && (
        <div
          role="menu"
          className={`cert-frame absolute right-0 z-50 mt-2 min-w-[200px] overflow-hidden bg-background py-1 shadow-xl ${modalClassName}`}
        >
          {wallet?.adapter.name && (
            <div className="border-b border-border px-4 py-2">
              <p className="text-xs font-medium text-muted-foreground">{wallet.adapter.name}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-foreground">
                {publicKey.toBase58()}
              </p>
            </div>
          )}
          <Link
            href={PORTFOLIO_ROUTE}
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block w-full border-b border-border px-4 py-2.5 text-left font-[family-name:var(--font-saira-condensed)] text-base font-bold capitalize tracking-[0.02em] text-foreground transition-colors hover:bg-foreground/5"
          >
            Portfolio
          </Link>
          {publicKey.equals(ADMIN_PUBKEY) && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="block w-full border-b border-border px-4 py-2.5 text-left font-[family-name:var(--font-saira-condensed)] text-base font-bold capitalize tracking-[0.02em] text-foreground transition-colors hover:bg-foreground/5"
            >
              Dashboard
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              disconnect();
            }}
            className="w-full px-4 py-2.5 text-left font-[family-name:var(--font-saira-condensed)] text-base font-bold capitalize tracking-[0.02em] text-foreground transition-colors hover:bg-foreground/5"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
