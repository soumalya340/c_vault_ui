import "server-only";
import type { DbDriver, DbNetwork } from "./types";
import { sqliteDriver } from "./sqlite";
import { supabaseDriver } from "./supabase";

export type { DbDriver, DbNetwork, UnifiedVaultRow, UnifiedRegistryRow, TableColumnInfo } from "./types";

export function getDb(network: DbNetwork): DbDriver {
  return network === "localhost" ? sqliteDriver : supabaseDriver;
}
