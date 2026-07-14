import { NextResponse } from "next/server";
import { getDb, type DbNetwork } from "@/lib/db";

const MAX_LIMIT = 500;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toDbNetwork(v: string | null): DbNetwork {
  return v === "localhost" ? "localhost" : "mainnet";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const network = toDbNetwork(url.searchParams.get("network"));
    const table = url.searchParams.get("table");
    if (!table) {
      return NextResponse.json({ error: "table query param is required." }, { status: 400 });
    }
    const limitParam = Number(url.searchParams.get("limit") ?? MAX_LIMIT);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), MAX_LIMIT) : MAX_LIMIT;
    const rows = await getDb(network).tableData(table, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
