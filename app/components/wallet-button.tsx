'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { ADMIN_PUBKEY } from '@/lib/constants';
import type { Network } from '@/app/providers';
import { NetworkToggle } from './network-toggle';
import { useControlledModalTransition } from './use-modal-transition';

const connectClassName =
  'inline-flex items-center gap-2 rounded-full border border-border-strong bg-background px-3.5 py-1.5 text-[11.5px] font-medium text-foreground transition-colors duration-150 hover:border-accent hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

const connectedClassName =
  'inline-flex items-center gap-2 rounded-full border border-border-strong bg-background px-[11px] py-1.5 text-sm font-medium text-foreground transition-colors duration-150 hover:border-accent hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

const menuItemClassName =
  'block w-full border-b border-border px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-white/[0.04]';

export function WalletButton({
  network,
  onNetworkChange,
}: {
  network: Network;
  onNetworkChange: (network: Network) => void;
}) {
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
      <div className="flex items-center gap-2">
        <NetworkToggle network={network} onChange={onNetworkChange} />
        <button type="button" onClick={() => setVisible(true)} className={connectClassName}>
          Connect
        </button>
      </div>
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
        <span
          className="wallet-dot-live h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
          aria-hidden
        />
        {wallet?.adapter.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={wallet.adapter.icon}
            alt=""
            className="hidden h-4 w-4 flex-shrink-0 rounded-sm object-contain sm:block"
          />
        )}
        <span className="font-mono text-[11.5px] text-[#DADADE]">{short}</span>
      </button>

      {mounted && (
        <div
          role="menu"
          className={`absolute right-0 z-50 mt-2 min-w-[220px] overflow-hidden rounded-[13px] border border-border-strong bg-bg-elevated py-1 shadow-xl ${modalClassName}`}
        >
          {wallet?.adapter.name && (
            <div className="border-b border-border px-4 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                {wallet.adapter.name}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-foreground">
                {publicKey.toBase58()}
              </p>
            </div>
          )}

          <div className="border-b border-border px-4 py-3">
            <p className="mb-2 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-text-ghost">
              Network
            </p>
            <NetworkToggle network={network} onChange={onNetworkChange} />
          </div>

          {publicKey.equals(ADMIN_PUBKEY) && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className={menuItemClassName}
            >
              Admin Dashboard
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              disconnect();
            }}
            className="w-full px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-white/[0.04]"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
