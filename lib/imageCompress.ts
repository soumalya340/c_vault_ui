/**
 * Client-side image compression via Canvas — no dependency. Downscales to
 * `maxDimension` on the longest side and re-encodes as JPEG at `quality`.
 * Used before uploading vault metadata images so the Blob store and page
 * loads stay small regardless of the source photo's size.
 */

export interface CompressImageOptions {
  /** Longest-edge cap in pixels. Default 1024 — plenty for a vault icon/banner. */
  maxDimension?: number;
  /** JPEG quality 0–1. Default 0.82 — visually lossless for UI thumbnails. */
  quality?: number;
}

const DEFAULT_MAX_DIMENSION = 1024;
const DEFAULT_QUALITY = 0.82;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image file.'));
    };
    img.src = url;
  });
}

/**
 * Resize + re-encode an image file. Falls back to the original file if the
 * browser can't produce a smaller result (e.g. already-tiny source, or an
 * environment without canvas support) — never throws for a valid image input
 * other than genuine decode failures.
 */
export async function compressImage(
  file: File,
  { maxDimension = DEFAULT_MAX_DIMENSION, quality = DEFAULT_QUALITY }: CompressImageOptions = {},
): Promise<File> {
  const img = await loadImage(file);

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob || blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
}
