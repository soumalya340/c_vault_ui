import { NextResponse } from "next/server";

/**
 * Returns the Helius RPC URL built from the server-only HELIUS_API_KEY.
 * The key never reaches the client bundle — only the connected admin
 * wallet's failover connection calls this, and only after 3 failed
 * attempts against the public RPC (see lib/connection.ts).
 */
export async function GET(request: Request) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HELIUS_API_KEY not configured" }, { status: 500 });
  }

  const network = new URL(request.url).searchParams.get("network") ?? "devnet";
  const host = network === "mainnet" ? "mainnet.helius-rpc.com" : "devnet.helius-rpc.com";

  return NextResponse.json({ url: `https://${host}/?api-key=${apiKey}` });
}
