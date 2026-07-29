'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey, type Transaction } from '@solana/web3.js';
import {
  addLiquidity,
  createPool,
  getCpAmm,
  parseUiAmount,
  resolveMintDecimals,
  resolveTokenProgram,
  sendMeteoraTx,
} from '@/lib/meteora';
import type { Network } from '@/lib/constants';
import { solscanLink } from '@/lib/solscanLink';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import { formatResult } from './execute-vault-function';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { showVaultOpsToast } from './vault-ops-toast';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <input
      className="h-11 w-full border border-border-strong bg-background px-3.5 font-mono text-sm text-foreground transition-[color,background-color,border-color,box-shadow] duration-[250ms] placeholder:text-muted-foreground/60 hover:border-foreground/40 focus:border-foreground focus:bg-background focus:outline-none focus:shadow-[3px_3px_0_rgba(23,37,28,0.1)]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      spellCheck={false}
      autoComplete="off"
    />
  );
}

interface OpsResult {
  type: 'success' | 'error' | 'info';
  text: string;
  solscan?: string;
}

function parsePubkey(raw: string, label: string): PublicKey {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`Enter ${label}.`);
  try {
    return new PublicKey(trimmed);
  } catch {
    throw new Error(`Invalid ${label} address.`);
  }
}

function AccordionShell({
  number,
  name,
  tag,
  open,
  onToggle,
  description,
  children,
  result,
  lastError,
  loading,
  network,
  vaultId,
  onTwapRefresh,
}: {
  number: string;
  name: string;
  tag: string;
  open: boolean;
  onToggle: () => void;
  description: string;
  children: React.ReactNode;
  result: OpsResult | null;
  lastError: UserFacingError | null;
  loading: boolean;
  network: Network;
  vaultId: number;
  onTwapRefresh: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  useEffect(() => {
    if (lastError && result?.type === 'error') {
      setErrorOpen(true);
    }
  }, [lastError, result]);

  // Remeasure when open state or payload changes so multi-field forms don't clip.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (open) {
      // Double rAF: wait for form paint after state updates.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.maxHeight = el.scrollHeight + 'px';
        });
      });
    } else {
      el.style.maxHeight = '0px';
    }
  }, [open, result, loading]);

  return (
    <div className="border-b border-border last:border-b-0">
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
          vaultId={vaultId}
          onRefreshSuccess={() => {
            setErrorOpen(false);
            onTwapRefresh();
          }}
        />
      )}

      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-5 px-6 py-5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="font-mono text-[11px] font-semibold text-seal">
          № {number}
        </span>
        <span className="font-display text-lg font-semibold text-foreground">
          {name}
        </span>
        <span className="mx-1 flex-1 self-center border-b border-dotted border-border-strong" />
        <span className="hidden font-mono text-[8.5px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
          {tag}
        </span>
        <span
          className={`text-[11px] text-muted-foreground transition-transform duration-[400ms] ${
            open ? 'rotate-180 text-seal' : ''
          }`}
        >
          ▾
        </span>
      </button>

      <div
        ref={bodyRef}
        className="overflow-hidden transition-[max-height] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
        style={{ maxHeight: open ? undefined : 0 }}
      >
        <div className="space-y-4 px-6 pb-7 pt-2">
          <p className="text-sm leading-relaxed text-foreground/80">
            {description}
          </p>
          {children}
        </div>

        {result && (
          <div className="mx-6 mb-6 max-h-64 overflow-y-auto rounded-[2px] border border-border-strong bg-foreground/[0.04]">
            <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
              OUTPUT
            </div>
            <div className="px-4 py-3">
              <LedgerOutput text={result.text} tone={result.type} />
              {result.type === 'error' && lastError && (
                <div className="mt-2 border-t border-border pt-2">
                  <button
                    type="button"
                    onClick={() => setErrorOpen(true)}
                    className="font-mono text-[11px] text-accent underline transition-colors hover:text-foreground"
                  >
                    View error details
                  </button>
                </div>
              )}
              {result.solscan && (
                <div className="mt-2 border-t border-border pt-2">
                  <a
                    href={result.solscan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline transition-colors hover:text-foreground"
                  >
                    View on explorer
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExecuteButton({
  loading,
  connected,
  label,
  onClick,
}: {
  loading: boolean;
  connected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="h-11 w-full bg-foreground font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-background transition-colors hover:bg-seal disabled:cursor-not-allowed disabled:opacity-40 md:w-[220px] md:justify-self-end"
    >
      {loading ? 'Processing…' : connected ? label : 'Connect wallet'}
    </button>
  );
}

export function CreatePoolAccordion({
  network,
  vaultId,
  open,
  onToggle,
}: {
  network: Network;
  vaultId: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  const [tokenAMint, setTokenAMint] = useState('');
  const [tokenBMint, setTokenBMint] = useState('');
  const [tokenAAmount, setTokenAAmount] = useState('');
  const [tokenBAmount, setTokenBAmount] = useState('');
  const [initPrice, setInitPrice] = useState('1');
  const [startingFeeBps, setStartingFeeBps] = useState('25');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpsResult | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);

  const execute = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setVisible(true);
      return;
    }

    setLoading(true);
    setResult(null);
    setLastError(null);

    try {
      const mintA = parsePubkey(tokenAMint, 'token A mint');
      const mintB = parsePubkey(tokenBMint, 'token B mint');
      if (mintA.equals(mintB)) {
        throw new Error('Token A and token B mints must be different.');
      }
      if (!tokenAAmount.trim() || !tokenBAmount.trim()) {
        throw new Error('Enter seed amounts for both tokens.');
      }

      const feeBps = Number(startingFeeBps);
      if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 10_000) {
        throw new Error('Starting fee must be between 0 and 10000 bps.');
      }

      const [tokenAProgram, tokenBProgram] = await Promise.all([
        resolveTokenProgram(connection, mintA),
        resolveTokenProgram(connection, mintB),
      ]);
      const [decimalsA, decimalsB] = await Promise.all([
        resolveMintDecimals(connection, mintA, tokenAProgram),
        resolveMintDecimals(connection, mintB, tokenBProgram),
      ]);

      const amountA = parseUiAmount(tokenAAmount, decimalsA);
      const amountB = parseUiAmount(tokenBAmount, decimalsB);

      const built = await createPool({
        connection,
        payer: publicKey,
        tokenA: {
          mint: mintA,
          amount: amountA,
          decimals: decimalsA,
          tokenProgram: tokenAProgram,
        },
        tokenB: {
          mint: mintB,
          amount: amountB,
          decimals: decimalsB,
          tokenProgram: tokenBProgram,
        },
        initPrice: initPrice.trim() || '1',
        fee: {
          startingFeeBps: feeBps,
          endingFeeBps: feeBps,
        },
      });

      const signature = await sendMeteoraTx(
        connection,
        { publicKey, signTransaction: signTransaction as (tx: Transaction) => Promise<Transaction> },
        built.tx,
        [built.positionNft],
      );

      const payload = {
        pool: built.pool.toBase58(),
        position: built.position.toBase58(),
        positionNft: built.positionNft.publicKey.toBase58(),
        liquidityDelta: built.liquidityDelta.toString(),
        tokenAAmount: built.tokenAAmount.toString(),
        tokenBAmount: built.tokenBAmount.toString(),
        signature,
      };

      setResult({
        type: 'success',
        text: formatResult(payload),
        solscan: solscanLink(signature, network),
      });
      showVaultOpsToast('DAMM V2 · POOL CREATED');
    } catch (err: unknown) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccordionShell
      number="04"
      name="Create DAMM v2 pool"
      tag="Meteora"
      open={open}
      onToggle={onToggle}
      description="Create a Meteora DAMM v2 customizable pool and seed initial liquidity in one transaction. The position NFT is generated client-side and co-signs with your wallet."
      result={result}
      lastError={lastError}
      loading={loading}
      network={network}
      vaultId={vaultId}
      onTwapRefresh={() =>
        setResult({
          type: 'info',
          text: 'DEX TWAP refreshed — run the action again if needed.',
        })
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel>Token A mint</FieldLabel>
          <TextInput
            value={tokenAMint}
            onChange={setTokenAMint}
            placeholder="Base58 mint…"
          />
        </div>
        <div>
          <FieldLabel>Token B mint</FieldLabel>
          <TextInput
            value={tokenBMint}
            onChange={setTokenBMint}
            placeholder="Base58 mint…"
          />
        </div>
        <div>
          <FieldLabel>Token A amount</FieldLabel>
          <TextInput
            value={tokenAAmount}
            onChange={setTokenAAmount}
            placeholder="1000"
            inputMode="decimal"
          />
        </div>
        <div>
          <FieldLabel>Token B amount</FieldLabel>
          <TextInput
            value={tokenBAmount}
            onChange={setTokenBAmount}
            placeholder="1000"
            inputMode="decimal"
          />
        </div>
        <div>
          <FieldLabel>Init price (B per 1 A)</FieldLabel>
          <TextInput
            value={initPrice}
            onChange={setInitPrice}
            placeholder="1"
            inputMode="decimal"
          />
        </div>
        <div>
          <FieldLabel>Base fee (bps)</FieldLabel>
          <TextInput
            value={startingFeeBps}
            onChange={setStartingFeeBps}
            placeholder="25"
            inputMode="numeric"
          />
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <ExecuteButton
          loading={loading}
          connected={connected}
          label="Create pool"
          onClick={execute}
        />
      </div>
    </AccordionShell>
  );
}

export function AddPositionLiquidityAccordion({
  network,
  vaultId,
  open,
  onToggle,
}: {
  network: Network;
  vaultId: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  const [pool, setPool] = useState('');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [slippage, setSlippage] = useState('1');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpsResult | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);

  const execute = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setVisible(true);
      return;
    }

    setLoading(true);
    setResult(null);
    setLastError(null);

    try {
      const poolPk = parsePubkey(pool, 'pool');
      if (!amountA.trim() || !amountB.trim()) {
        throw new Error('Enter max amounts for both token A and token B.');
      }

      const slip = Number(slippage);
      if (!Number.isFinite(slip) || slip < 0 || slip > 50) {
        throw new Error('Slippage must be between 0 and 50 percent.');
      }

      const cpAmm = getCpAmm(connection);
      const poolState = await cpAmm.fetchPoolState(poolPk);

      const [tokenAProgram, tokenBProgram] = await Promise.all([
        resolveTokenProgram(connection, poolState.tokenAMint),
        resolveTokenProgram(connection, poolState.tokenBMint),
      ]);
      const [decimalsA, decimalsB] = await Promise.all([
        resolveMintDecimals(connection, poolState.tokenAMint, tokenAProgram),
        resolveMintDecimals(connection, poolState.tokenBMint, tokenBProgram),
      ]);

      const maxAmountTokenA = parseUiAmount(amountA, decimalsA);
      const maxAmountTokenB = parseUiAmount(amountB, decimalsB);

      const built = await addLiquidity({
        connection,
        owner: publicKey,
        pool: poolPk,
        maxAmountTokenA,
        maxAmountTokenB,
        slippagePercent: slip,
        mode: { kind: 'new_position' },
      });

      const extraSigners = built.positionNftKeypair
        ? [built.positionNftKeypair]
        : [];

      const signature = await sendMeteoraTx(
        connection,
        {
          publicKey,
          signTransaction: signTransaction as (
            tx: Transaction,
          ) => Promise<Transaction>,
        },
        built.tx,
        extraSigners,
      );

      const payload = {
        pool: built.pool.toBase58(),
        position: built.position.toBase58(),
        positionNft: built.positionNftMint.toBase58(),
        positionNftAccount: built.positionNftAccount.toBase58(),
        liquidityDelta: built.liquidityDelta.toString(),
        maxAmountTokenA: built.maxAmountTokenA.toString(),
        maxAmountTokenB: built.maxAmountTokenB.toString(),
        tokenAMint: built.tokenAMint.toBase58(),
        tokenBMint: built.tokenBMint.toBase58(),
        signature,
      };

      setResult({
        type: 'success',
        text: formatResult(payload),
        solscan: solscanLink(signature, network),
      });
      showVaultOpsToast('DAMM V2 · POSITION + LIQUIDITY');
    } catch (err: unknown) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccordionShell
      number="05"
      name="Add position + liquidity"
      tag="Meteora"
      open={open}
      onToggle={onToggle}
      description="Open a new DAMM v2 position NFT on an existing pool and deposit both sides in one transaction (createPositionAndAddLiquidity). Use the pool address from create pool or any live DAMM v2 pool."
      result={result}
      lastError={lastError}
      loading={loading}
      network={network}
      vaultId={vaultId}
      onTwapRefresh={() =>
        setResult({
          type: 'info',
          text: 'DEX TWAP refreshed — run the action again if needed.',
        })
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <FieldLabel>Pool address</FieldLabel>
          <TextInput
            value={pool}
            onChange={setPool}
            placeholder="DAMM v2 pool pubkey…"
          />
        </div>
        <div>
          <FieldLabel>Max token A amount</FieldLabel>
          <TextInput
            value={amountA}
            onChange={setAmountA}
            placeholder="1000"
            inputMode="decimal"
          />
        </div>
        <div>
          <FieldLabel>Max token B amount</FieldLabel>
          <TextInput
            value={amountB}
            onChange={setAmountB}
            placeholder="1000"
            inputMode="decimal"
          />
        </div>
        <div>
          <FieldLabel>Slippage (%)</FieldLabel>
          <TextInput
            value={slippage}
            onChange={setSlippage}
            placeholder="1"
            inputMode="decimal"
          />
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <ExecuteButton
          loading={loading}
          connected={connected}
          label="Add position + liquidity"
          onClick={execute}
        />
      </div>
    </AccordionShell>
  );
}
