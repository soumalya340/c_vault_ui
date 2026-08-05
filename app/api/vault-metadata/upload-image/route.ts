import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * Uploads a vault's metadata image to Vercel Blob and returns its public URL
 * — used as the on-chain `uri` for `create_etf` so vault managers never have
 * to host an image elsewhere and paste a link by hand. Server upload path
 * (request body, not the client/multipart flow), so the 4.5 MB request-body
 * cap applies; the client compresses images before calling this.
 */

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 4.5 * 1024 * 1024;

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
    const contentType = request.headers.get("content-type") ?? "";

    if (!filename) {
      return NextResponse.json({ error: "filename query param is required." }, { status: 400 });
    }
    const body = request.body;
    if (!body) {
      return NextResponse.json({ error: "Request body is empty." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(contentType)) {
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

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const blob = await put(`vault-metadata/${Date.now()}-${safeName}`, body, {
      access: "public",
      contentType,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
