import { NextResponse } from "next/server";
import { getDb, type DbNetwork } from "@/lib/db";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toDbNetwork(v: string | null): DbNetwork {
  return v === "localhost" ? "localhost" : "mainnet";
}

export async function GET(request: Request) {
  try {
    const network = toDbNetwork(new URL(request.url).searchParams.get("network"));
    const db = getDb(network);
    const tables = await db.listTables();
    return NextResponse.json({ tables, backend: db.backend, label: db.label });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
