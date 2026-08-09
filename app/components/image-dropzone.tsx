'use client';

import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { compressImage } from '@/lib/imageCompress';
import { uploadVaultMetadataImage } from '@/lib/registryClient';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SOURCE_BYTES = 20 * 1024 * 1024; // pre-compression cap; compressed output is far smaller

export interface ImageDropzoneProps {
  /**
   * Uploaded **image** URL (Vercel Blob). Used for the form preview and as the
   * Metaplex JSON `image` field. On-chain Token-2022 `uri` is a separate JSON
   * URL published at create-ETF submit time — bare image URIs work in Phantom
   * but not Jupiter.
   */
  value: string;
  onChange: (url: string) => void;
  /** Reports upload-in-flight state so callers can gate submission on it. */
  onUploadingChange?: (uploading: boolean) => void;
  className?: string;
}

/**
 * Click-or-drag image upload: compresses client-side (lib/imageCompress),
 * uploads to Vercel Blob (`/api/vault-metadata/upload-image`), and reports
 * back the public image URL for preview. Create-ETF then wraps it in Metaplex
 * JSON before writing on-chain `uri`.
 */
export function ImageDropzone({ value, onChange, onUploadingChange, className }: ImageDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Unsupported file type. Use JPEG, PNG, WebP, or GIF.');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 20 MB).`);
      return;
    }

    setUploading(true);
    onUploadingChange?.(true);
    try {
      const compressed = await compressImage(file);
      const url = await uploadVaultMetadataImage(compressed);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  const openPicker = () => {
    if (!uploading) inputRef.current?.click();
  };

  return (
    <div className={`flex min-h-0 flex-col ${className ?? 'h-40 w-40'}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="sr-only"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />

      {value ? (
        <div className="relative flex h-full w-full min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[10px] border border-white/[0.09] bg-bg-elevated">
          {/* eslint-disable-next-line @next/next/no-img-element -- external Blob URL, no next/image domain config needed for a preview thumbnail */}
          <img src={value} alt="Vault metadata preview" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Remove image"
            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-background/90 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          disabled={uploading}
          aria-label="Upload vault image"
          aria-busy={uploading}
          className={`flex h-full w-full min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 ${
            dragOver
              ? 'border-accent bg-accent/10'
              : 'border-white/[0.18] bg-bg-elevated hover:border-accent/40 hover:bg-accent/[0.04]'
          }`}
        >
          {uploading ? (
            <>
              <div
                className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
                aria-hidden="true"
              />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-dim">
                Uploading…
              </span>
            </>
          ) : (
            <>
              <span
                className="text-[26px] font-light leading-none text-accent"
                aria-hidden="true"
              >
                +
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-dim">
                Add image
              </span>
            </>
          )}
        </button>
      )}

      {error && (
        <p id={`${inputId}-error`} className="mt-1.5 max-w-[10rem] text-xs leading-relaxed text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
