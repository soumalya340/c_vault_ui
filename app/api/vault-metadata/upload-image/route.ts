import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * Uploads a vault's logo image to Vercel Blob and returns its public URL.
 *
 * This URL is for **preview + the Metaplex JSON `image` field** — it is NOT
 * written on-chain as `uri` directly. At create-ETF submit time the client
 * also hosts JSON via `/api/vault-metadata/upload-json` and that JSON URL
 * becomes the on-chain Token-2022 `uri` (Jupiter requires JSON; Phantom will
 * also accept a bare image URI, which is why older vaults showed icons only
 * in Phantom).
 *
 * Server upload path (request body, not multipart) — 4.5 MB body cap; the
 * client compresses images before calling this.
 */

/**
 * Allowed MIME types → the extension the stored object must carry.
 *
 * The blob URL becomes the on-chain `uri`, and consumers that render it
 * (wallets, explorers, aggregators) sniff either the extension or the served
 * content-type. Deriving the extension from the validated MIME type keeps the
 * two from ever disagreeing — a `.png` URL served as `image/jpeg` is the kind
 * of mismatch that makes an image silently fail to render.
 */
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);
const MAX_BYTES = 4.5 * 1024 * 1024;

/** `image/jpeg; charset=utf-8` → `image/jpeg`. Parameters must not defeat the allowlist. */
function normalizeContentType(raw: string): string {
  return raw.split(";")[0]!.trim().toLowerCase();
}

/** Filename without its extension, sanitised for use in a blob key. */
function baseName(filename: string): string {
  const sanitised = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dot = sanitised.lastIndexOf(".");
  const stem = dot > 0 ? sanitised.slice(0, dot) : sanitised;
  return stem || "image";
}

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN is not configured on the server." },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const filename = searchParams.get("filename");
    const contentType = normalizeContentType(request.headers.get("content-type") ?? "");

    if (!filename) {
      return NextResponse.json({ error: "filename query param is required." }, { status: 400 });
    }
    const body = request.body;
    if (!body) {
      return NextResponse.json({ error: "Request body is empty." }, { status: 400 });
    }
    const extension = ALLOWED_TYPES.get(contentType);
    if (!extension) {
      return NextResponse.json(
        { error: `Unsupported content type "${contentType}". Use JPEG, PNG, WebP, or GIF.` },
        { status: 400 },
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return NextResponse.json(
        { error: `Image too large (${(contentLength / 1024 / 1024).toFixed(1)} MB, max 4.5 MB).` },
        { status: 413 },
      );
    }

    // Extension is derived from the validated MIME type (not the caller's
    // filename) so the URL suffix and the served content-type always agree.
    const blob = await put(
      `vault-metadata/${Date.now()}-${baseName(filename)}.${extension}`,
      body,
      {
        // Explicit contentType — never let the store infer one from the bytes.
        access: "public",
        contentType,
      },
    );

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
