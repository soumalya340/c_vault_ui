import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * Hosts Metaplex-compatible off-chain token metadata JSON on Vercel Blob.
 *
 * Indexers (Jupiter, Birdeye, Dexscreener) expect the on-chain Token-2022
 * `uri` to point at **JSON** shaped like:
 *   { "name", "symbol", "description", "image" }
 * not at a raw image file. Phantom is lenient and will render a direct image
 * URI; Jupiter is not — it only populates `icon` after parsing JSON.image.
 *
 * The create-ETF flow uploads the image first (for preview), then calls this
 * route at submit time and writes the returned JSON URL on-chain as `uri`.
 */

const MAX_NAME = 32;
const MAX_SYMBOL = 10;
const MAX_DESCRIPTION = 512;
const MAX_IMAGE_URL = 256;

type Body = {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
};

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN is not configured on the server." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as Body;
    const name = body.name?.trim() ?? "";
    const symbol = body.symbol?.trim() ?? "";
    const description = body.description?.trim() ?? "";
    const image = body.image?.trim() ?? "";

    if (!name || name.length > MAX_NAME) {
      return NextResponse.json(
        { error: `name is required (≤ ${MAX_NAME} chars).` },
        { status: 400 },
      );
    }
    if (!symbol || symbol.length > MAX_SYMBOL) {
      return NextResponse.json(
        { error: `symbol is required (≤ ${MAX_SYMBOL} chars).` },
        { status: 400 },
      );
    }
    if (description.length > MAX_DESCRIPTION) {
      return NextResponse.json(
        { error: `description too long (≤ ${MAX_DESCRIPTION} chars).` },
        { status: 400 },
      );
    }
    if (!image || image.length > MAX_IMAGE_URL || !isHttpsUrl(image)) {
      return NextResponse.json(
        { error: "image must be a short https:// URL (the uploaded vault image)." },
        { status: 400 },
      );
    }

    // Metaplex Token Metadata JSON standard — what Jupiter/Birdeye crawl.
    const metadata = {
      name,
      symbol,
      description,
      image,
      // Extra hints some indexers still read.
      properties: {
        category: "image",
        files: [{ uri: image, type: guessImageMime(image) }],
      },
    };

    const payload = JSON.stringify(metadata);
    const slug = symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "token";
    const blob = await put(
      `vault-metadata/${Date.now()}-${slug}.json`,
      payload,
      {
        access: "public",
        contentType: "application/json",
        // Avoid content-disposition:attachment — crawlers should GET JSON inline.
        addRandomSuffix: true,
      },
    );

    return NextResponse.json({ url: blob.url, image, metadata });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function guessImageMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
