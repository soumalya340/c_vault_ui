'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

const connectClassName =
  'rounded-lg bg-foreground/5 border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-accent hover:text-background hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const connectedClassName =
  'flex items-center gap-2 rounded-lg border border-border bg-foreground/5 px-3.5 py-2 text-sm font-semibold text-foreground transition-all duration-150 hover:border-accent hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function WalletButton() {
  const { publicKey, connected, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [showMenu, setShowMenu] = useState(false);

  if (!connected || !publicKey) {
    return (
      <button type="button" onClick={() => setVisible(true)} className={connectClassName}>
        Connect wallet
      </button>
    );
  }

  const short = `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowMenu((m) => !m)}
        className={connectedClassName}
        aria-expanded={showMenu}
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
        <span className="font-mono">{short}</span>
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
      {showMenu && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 min-w-[200px] overflow-hidden rounded-xl border border-border bg-background py-1 shadow-xl"
        >
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{wallet?.adapter.name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-foreground">
              {publicKey.toBase58()}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              disconnect();
              setShowMenu(false);
            }}
            className="w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
