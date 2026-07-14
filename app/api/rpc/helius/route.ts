import { NextResponse } from "next/server";

/**
 * Returns the Helius RPC URL built from the server-only HELIUS_API_KEY.
 * Prefer `NEXT_PUBLIC_HELIUS_RPC` as the primary mainnet endpoint for all
 * wallets (see app/providers.tsx). This route is the admin-only failover
 * when mainnet is not already on Helius (see lib/connection.ts).
 *
 * Localhost has no Helius host — callers should not hit this for that network.
 */
export async function GET(request: Request) {
  const network = new URL(request.url).searchParams.get("network") ?? "mainnet";
  if (network !== "mainnet") {
    return NextResponse.json(
      { error: "Helius failover is only available on mainnet" },
      { status: 400 },
    );
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HELIUS_API_KEY not configured" }, { status: 500 });
  }

  return NextResponse.json({
    url: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
  });
}
