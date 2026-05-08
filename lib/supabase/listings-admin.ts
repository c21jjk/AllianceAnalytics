/**
 * Service-role client for the SEPARATE "Alliance Listings" Supabase project.
 *
 * This is a different project from the main AllianceAnalytics DB. The Listings
 * project (umziekblnbobkezbbupg) holds active MLS listings; AllianceAnalytics
 * replicates from it via the listings-sync Edge Function.
 *
 * Why separate? AllianceDash currently holds closed-transaction history
 * (cmc_closings) and is going out to Alliance managers — we don't want any
 * coupling that could break that. The Listings project is dedicated to the
 * forward pipeline of currently-listed properties.
 *
 * Required env vars:
 *   - LISTINGS_SUPABASE_URL                 (project URL)
 *   - LISTINGS_SUPABASE_SERVICE_ROLE_KEY    (service role key for that project)
 *
 * STRICT RULES:
 *   1. NEVER import this from a "use client" file.
 *   2. Do not pass listing rows containing internal-only fields (raw_payload,
 *      list_agent_email if private) back to the browser unfiltered. Manual
 *      whitelisting in server actions only.
 */
import "server-only";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { ListingsDatabase } from "./listings-types";

type ListingsAdminClient = SupabaseClient<ListingsDatabase>;

let cached: ListingsAdminClient | null = null;

export function createListingsAdminClient(): ListingsAdminClient {
  if (cached) return cached;

  const url = process.env.LISTINGS_SUPABASE_URL;
  const serviceKey = process.env.LISTINGS_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Listings Supabase env vars. Required: " +
        "LISTINGS_SUPABASE_URL, LISTINGS_SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cached = createSupabaseClient<ListingsDatabase>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
