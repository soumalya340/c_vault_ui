/**
 * Liveness readout for a streamed number.
 *
 * Sits directly beneath the share price, in the slot a static `sub` label would
 * occupy. A hairline sweeps the width of the readout while the stream is
 * connected — the number is re-derived from chain state every slot, and the
 * sweep is that fact made visible. `slot` is the receipt: the exact slot the
 * simulation was evaluated against.
 *
 * The label always reads "Live" while the card is on a stream — a dropped
 * socket is a transport detail, not something to alarm a reader with. But a
 * stale price is still signalled, because the deposit modal quotes off this
 * number: staleness drops the accent color to `stale` amber and removes the
 * slot number, since the last-known slot is no longer the current one.
 *
 * States are mutually exclusive and never shift layout height:
 * - `live`   accent sweep + breathing dot + slot number
 * - `stale`  amber, static bar, no slot — last-good value still on screen
 * - `static` no bar — a one-off `getTotalNavView` read, not a stream
 */
export function VaultLivePulse({
  state,
  slot,
}: {
  state: 'live' | 'stale' | 'static';
  slot?: number;
}) {
  if (state === 'static') {
    return (
      <div className="mt-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
        on-chain view
      </div>
    );
  }

  const live = state === 'live';

  return (
    <div className="mt-2">
      {/* Track. The sweep is clipped to this 1px rule, so motion stays
          confined to the number's own footprint. */}
      <div
        className={`relative h-px w-full overflow-hidden ${
          live ? 'bg-accent/20' : 'bg-[#B7791F]/25'
        }`}
      >
        {live ? (
          <div
            className="absolute inset-y-0 left-0 w-1/4 bg-accent"
            style={{
              animation: 'nav-pulse-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
            }}
          />
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={`h-1 w-1 rounded-full ${live ? 'bg-accent' : 'bg-[#B7791F]'}`}
          style={
            live
              ? { animation: 'nav-pulse-dot 2.4s ease-in-out infinite' }
              : undefined
          }
        />
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
            live ? 'text-accent' : 'text-[#B7791F]'
          }`}
          // Staleness is visible to sighted users as color; spell it out for
          // screen readers, which get no signal from a hue change.
          title={
            live
              ? 'Streaming — recomputed each slot'
              : 'Last known price — the stream is catching up'
          }
        >
          Live
        </span>
        {live && slot ? (
          <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground tabular-nums">
            · slot {slot.toLocaleString()}
          </span>
        ) : (
          <span className="sr-only">last known price, stream catching up</span>
        )}
      </div>
    </div>
  );
}
