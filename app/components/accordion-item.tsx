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
import {
  btnPrimaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
  selectClass,
} from './ui-classes';

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
      className={`overflow-hidden transition-colors duration-150 ${
        open ? 'bg-foreground/[0.03]' : 'bg-transparent'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-baseline gap-4 px-2 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset md:px-3"
      >
        <span
          className="flex-shrink-0 font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal"
          aria-hidden
        >
          &#8470;&nbsp;{fn.number}
        </span>
        <span className="flex-shrink-0 text-sm font-medium tracking-[-0.01em] text-foreground transition-colors group-hover:text-accent">
          {fn.title}
        </span>
        <span
          className="mx-1 flex-1 self-center border-b border-dotted border-border"
          aria-hidden
        />
        <span
          className="flex-shrink-0 select-none font-mono text-sm text-muted-foreground transition-colors"
          style={open ? { color: style.accent } : undefined}
          aria-hidden
        >
          {open ? '▴' : '▾'}
        </span>
      </button>

      <div className={`accordion-content ${open ? 'open' : ''}`}>
        <div className="accordion-inner">
          <form
            onSubmit={handleSubmit}
            className="space-y-4 border-t border-border px-2 pb-5 pt-4 md:px-3"
          >
            <p
              className="border-l-2 py-0.5 pl-3 text-sm leading-[1.55] text-muted-foreground"
              style={{ borderColor: `${style.accent}44` }}
            >
              {fn.description}
            </p>

            {fn.fields.length === 0 && (
              <p className="font-mono text-xs text-muted-foreground/70">No parameters required.</p>
            )}

            {needsWallet && !connected && (
              <p className="rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-xs text-muted-foreground">
                Connect your wallet to run this instruction.
              </p>
            )}

            {needsWallet && connected && publicKey && (
              <p className="truncate rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-[11px] text-accent">
                <span className="mr-2 font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  bearer
                </span>
                {publicKey.toBase58()}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fn.fields.map((field) => (
                <div key={field.name} className={field.wide ? 'sm:col-span-2' : undefined}>
                  <label className={fieldLabelClass}>{field.label}</label>
                  {field.type === 'select' ? (
                    <select
                      value={values[field.name] ?? field.options?.[0]?.value ?? ''}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
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
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      rows={6}
                      placeholder={field.hint}
                      className={`${inputClass} text-xs`}
                    />
                  ) : (
                    <input
                      type={field.type ?? 'text'}
                      placeholder={field.placeholder}
                      value={values[field.name] ?? ''}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      className={inputClass}
                    />
                  )}
                  {field.hint && field.name !== 'assets_json' && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/80">
                      {field.hint}
                    </p>
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
              <div className={outputPanelClass}>
                <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground md:px-5">
                  OUTPUT
                </div>
                <div
                  className={`whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed md:px-5 ${
                    result.type === 'error'
                      ? 'text-destructive'
                      : result.type === 'success'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                  }`}
                >
                  <span className="mr-2 text-muted-foreground/50">&gt;</span>
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
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
