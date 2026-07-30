/** Source provenance badge — every number declares where it came from. */
export function VaultSourceTag({
  kind,
}: {
  kind: 'rpc' | 'mock' | 'db';
}) {
  const map = {
    rpc: {
      text: 'RPC',
      title: 'On-chain read at current slot',
      className: 'border-foreground/50 text-foreground/70',
    },
    mock: {
      text: 'MOCK',
      title: 'Placeholder data — not wired yet',
      className: 'border-dashed border-seal text-seal',
    },
    db: {
      text: 'DB',
      title: 'From vaults registry / database',
      className: 'border-accent/60 text-accent',
    },
  } as const;
  const s = map[kind];
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-px font-mono text-[8px] font-bold uppercase tracking-[0.14em] ${s.className}`}
      title={s.title}
    >
      {s.text}
    </span>
  );
}
