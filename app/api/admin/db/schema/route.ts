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
    const url = new URL(request.url);
    const network = toDbNetwork(url.searchParams.get("network"));
    const table = url.searchParams.get("table");
    if (!table) {
      return NextResponse.json({ error: "table query param is required." }, { status: 400 });
    }
    const columns = await getDb(network).tableSchema(table);
    return NextResponse.json({ columns });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
