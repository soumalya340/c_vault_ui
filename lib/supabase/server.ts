import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client using the anon key. Requests are subject to Row Level
 * Security — `token_registry` and `vaults` must have policies granting the
 * `anon` role access (see forge/supabase/migrations). Never import from a
 * "use client" file.
 */
export function createServiceClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.");
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}
