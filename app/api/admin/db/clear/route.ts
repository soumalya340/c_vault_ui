import { NextResponse } from "next/server";
import { getDb, type DbNetwork } from "@/lib/db";
import { verifyAdminSignature } from "@/lib/db/adminAuth";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toDbNetwork(v: string | undefined): DbNetwork {
  return v === "localhost" ? "localhost" : "mainnet";
}

/**
 * Deletes vaults + pre_approved_token_registry rows for the network (schema
 * kept). Requires an ed25519 signature from ADMIN_PUBKEY over
 * `cvault-admin:clear:<network>:<unix-ms>` — see c_vault_script menus/admin.js
 * choice '9' / menus/db.js choice '9' for the CLI-parity operation.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      network?: string;
      message?: string;
      signature?: string;
    };
    const network = toDbNetwork(body.network);
    if (!body.message || !body.signature) {
      return NextResponse.json({ error: "message and signature are required." }, { status: 400 });
    }

    try {
      verifyAdminSignature({ network, message: body.message, signature: body.signature });
    } catch (authErr) {
      return NextResponse.json({ error: errorMessage(authErr) }, { status: 401 });
    }

    const result = await getDb(network).clearAllData(network);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
