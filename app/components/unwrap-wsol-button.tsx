'use client';

import { useRef, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import { unwrapWsol } from '@/lib/wsol_to_sol';
import type { Network } from '@/lib/solscanLink';

const idleClassName =
  'rounded-[2px] border border-border-strong bg-background px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-foreground transition-colors duration-150 hover:border-accent hover:bg-accent hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-strong disabled:hover:bg-background disabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function UnwrapWsolButton({ network }: { network: Network }) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [note, setNote] = useState<{ text: string; link?: string } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = async () => {
    if (!connected || !anchorWallet) {
      setVisible(true);
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState('working');
    setNote(null);
    try {
      const { link, lamports } = await unwrapWsol(connection, anchorWallet, network);
      const sol = (Number(lamports) / 1_000_000_000).toFixed(4);
      setState('done');
      setNote({ text: `Unwrapped ${sol} SOL`, link });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection = msg.toLowerCase().includes('rejected');
      setState('error');
      setNote({ text: isRejection ? 'Cancelled.' : msg });
    } finally {
      resetTimer.current = setTimeout(() => {
        setState('idle');
        setNote(null);
      }, 5000);
    }
  };

  return (
    <div className="relative flex items-center">
      <button type="button" onClick={handleClick} disabled={state === 'working'} className={idleClassName}>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full bg-seal motion-safe:animate-[cert-blink_1.6s_ease_infinite]"
            aria-hidden
          />
          {state === 'working' ? 'Unwrapping…' : 'Unwrap wSOL'}
        </span>
      </button>

      {note && (
        <div
          role="status"
          className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-[2px] border border-border-strong bg-background px-3 py-2 font-mono text-[11px] shadow-xl"
        >
          {note.link ? (
            <a
              href={note.link}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {note.text} ↗
            </a>
          ) : (
            <span className={state === 'error' ? 'text-seal' : 'text-foreground'}>{note.text}</span>
          )}
        </div>
      )}
    </div>
  );
}
