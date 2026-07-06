'use client';

import { useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import type { Network } from '@/lib/cvault';
import type { PythFeedRow } from '@/lib/pythFeedsClient';
import { executeVaultFunction, formatResult } from './execute-vault-function';
import { FeedSelectField } from './feed-select-field';
import {
  REQUIRES_WALLET,
  SECTION_STYLE,
  type FunctionDef,
  type SectionId,
} from './function-defs';
import { btnPrimaryClass, inputClass, selectClass } from './ui-classes';

export function AccordionItem({
  fn,
  section,
  network,
  savedFeeds,
}: {
  fn: FunctionDef;
  section: SectionId;
  network: Network;
  savedFeeds: PythFeedRow[];
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
    solscan?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const style = SECTION_STYLE[section];
  const needsWallet = REQUIRES_WALLET.has(fn.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsWallet && !connected) {
      setVisible(true);
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const data = await executeVaultFunction(fn.id, values, {
        connection,
        anchorWallet: anchorWallet ?? null,
        publicKey: publicKey ?? null,
        network,
      });

      const solscanUrl =
        data && typeof data === 'object' && 'solscan' in data
          ? (data as { solscan?: string }).solscan
          : undefined;
      const display =
        data && typeof data === 'object'
          ? { ...(data as object), solscan: undefined }
          : data;

      setResult({ type: 'success', text: formatResult(display), solscan: solscanUrl });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection =
        msg.toLowerCase().includes('user rejected') ||
        msg.toLowerCase().includes('rejected the request') ||
        msg.toLowerCase().includes('transaction cancelled');
      setResult({
        type: isRejection ? 'info' : 'error',
        text: isRejection ? 'Transaction cancelled.' : msg,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors duration-150 ${
        open ? '' : 'border-border hover:bg-foreground/4'
      }`}
      style={open ? { borderColor: `${style.accent}66`, background: `${style.accent}0d` } : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-4 px-4.5 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl font-mono text-xs font-bold"
          style={{
            background: `${style.accent}18`,
            color: style.accent,
            border: `1px solid ${style.accent}44`,
          }}
        >
          {fn.number}
        </span>
        <span className="flex-1 font-medium text-foreground transition-colors group-hover:text-accent">
          {fn.title}
        </span>
        <span
          className="flex-shrink-0 select-none font-mono text-sm"
          style={{ color: open ? style.accent : undefined }}
        >
          {open ? '▴' : '▾'}
        </span>
      </button>

      <div className={`accordion-content ${open ? 'open' : ''}`}>
        <div className="accordion-inner">
          <form onSubmit={handleSubmit} className="space-y-4 border-t border-border px-4.5 pb-4.5 pt-4">
            <p
              className="border-l-2 py-1 pl-3 text-sm leading-relaxed text-muted-foreground"
              style={{ borderColor: `${style.accent}55` }}
            >
              {fn.description}
            </p>

          {fn.fields.length === 0 && (
            <p className="text-xs italic text-muted-foreground">No parameters required.</p>
          )}

          {needsWallet && !connected && (
            <p className="rounded-xl border border-border bg-foreground/4 px-3 py-2 text-xs text-muted-foreground">
              Connect your wallet to run this instruction.
            </p>
          )}

          {needsWallet && connected && publicKey && (
            <p className="rounded-xl border border-border bg-foreground/4 px-3 py-2 font-mono text-xs text-accent">
              {publicKey.toBase58().slice(0, 8)}…{publicKey.toBase58().slice(-8)}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fn.fields.map((field) => (
              <div key={field.name} className={field.wide ? 'sm:col-span-2' : undefined}>
                <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {field.label}
                </label>
                {field.type === 'select' ? (
                  <select
                    value={values[field.name] ?? field.options?.[0]?.value ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                    className={selectClass}
                  >
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'feed' ? (
                  <FeedSelectField
                    value={values[field.name] ?? ''}
                    onChange={(val) => setValues((prev) => ({ ...prev, [field.name]: val }))}
                    savedFeeds={savedFeeds}
                  />
                ) : field.name === 'assets_json' ? (
                  <textarea
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                    rows={6}
                    placeholder={field.hint}
                    className={`${inputClass} text-xs`}
                  />
                ) : (
                  <input
                    type={field.type ?? 'text'}
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                    className={inputClass}
                  />
                )}
                {field.hint && field.name !== 'assets_json' && (
                  <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p>
                )}
              </div>
            ))}
          </div>

          <button type="submit" disabled={loading} className={btnPrimaryClass}>
            {loading
              ? 'Processing…'
              : needsWallet && !connected
                ? 'Connect wallet'
                : fn.submitLabel}
          </button>

          {result && (
            <div
              className={`max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-xl border px-4 py-3 font-mono text-xs leading-relaxed ${
                result.type === 'error'
                  ? 'border-destructive/30 bg-destructive/8 text-destructive'
                  : result.type === 'success'
                    ? 'border-accent/30 bg-accent/8 text-foreground'
                    : 'border-border bg-foreground/4 text-muted-foreground'
              }`}
            >
              {result.text}
              {result.solscan && (
                <div className="mt-2 border-t border-border pt-2">
                  <a
                    href={result.solscan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline transition-colors hover:text-foreground"
                  >
                    View on Solscan
                  </a>
                </div>
              )}
            </div>
          )}
          </form>
        </div>
      </div>
    </div>
  );
}
