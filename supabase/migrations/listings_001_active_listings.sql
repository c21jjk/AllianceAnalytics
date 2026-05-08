-- Schema for the dedicated "Alliance Listings" Supabase project.
-- Apply this to the Listings DB only (project_id: umziekblnbobkezbbupg).
-- AllianceAnalytics replicates from this table into its own properties table.
--
-- Minimal field set — only what's needed to power the seller-facing report
-- and link posts to listings. Photos for now = a single hero_image_url.

CREATE TYPE public.listing_status AS ENUM (
  'active',
  'pending',
  'sold',
  'expired',
  'withdrawn'
);

CREATE TYPE public.mls_source AS ENUM (
  'cmc',     -- CMC MLS (Cape May County / Wildwood etc)
  'sjsr',    -- SJSR / Paragon (Ocean City etc)
  'bright',  -- Bright MLS (most NJ offices, when access lands)
  'manual'   -- Hand-entered, no MLS feed
);

CREATE TABLE public.active_listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source-of-truth identifier
  mls_number      text NOT NULL UNIQUE,
  source_mls      public.mls_source NOT NULL DEFAULT 'manual',

  -- Listing details (minimal)
  address         text NOT NULL,
  city            text,
  state           text,
  zip             text,
  list_price      numeric(12, 2),
  status          public.listing_status NOT NULL DEFAULT 'active',
  listing_date    date,

  -- Agent + office attribution
  list_agent_name  text,
  list_agent_email text,
  list_office_id   text,

  -- The hero photo (URL only — could be MLS CDN or pasted)
  hero_image_url   text,

  -- Bookkeeping
  synced_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Forensic / future-fields stash for whatever the MLS feed returns
  raw_payload     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX active_listings_status_idx       ON public.active_listings(status);
CREATE INDEX active_listings_source_mls_idx   ON public.active_listings(source_mls);
CREATE INDEX active_listings_list_office_idx  ON public.active_listings(list_office_id);
CREATE INDEX active_listings_synced_at_idx    ON public.active_listings(synced_at DESC);
CREATE INDEX active_listings_listing_date_idx ON public.active_listings(listing_date DESC);

COMMENT ON TABLE public.active_listings IS
  'Active (and recently-pended) MLS listings for Alliance offices. Source for AllianceAnalytics property reports. Populated by manual entry today; RETS/Bright sync replaces this in a future phase.';

ALTER TABLE public.active_listings ENABLE ROW LEVEL SECURITY;

-- updated_at auto-touch
CREATE OR REPLACE FUNCTION public.set_active_listings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER active_listings_updated_at_trigger
BEFORE UPDATE ON public.active_listings
FOR EACH ROW EXECUTE FUNCTION public.set_active_listings_updated_at();
