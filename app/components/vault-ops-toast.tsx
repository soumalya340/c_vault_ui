'use client';

import { useEffect, useState } from 'react';

let globalShow: ((msg: string) => void) | null = null;

export function showVaultOpsToast(message: string) {
  globalShow?.(message);
}

export function VaultOpsToast() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    globalShow = (msg: string) => {
      setMessage(msg);
      setVisible(true);
    };
    return () => {
      globalShow = null;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <div
      className={`fixed bottom-8 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 bg-foreground px-6 py-4 font-mono text-[10px] uppercase tracking-[0.2em] text-background shadow-[6px_6px_0_rgba(23,37,28,0.18)] transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${
        visible ? 'translate-y-0' : 'translate-y-[80px]'
      }`}
    >
      <span className="h-2 w-2 bg-seal" />
      <span>{message}</span>
    </div>
  );
}
