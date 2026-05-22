-- Migration: 20260522034407_run_auto_linker_fan_out_post_listings
-- Applied via Supabase MCP. Captured into the repo on 2026-05-22 for traceability.
--
-- run_auto_linker — extend to write to post_listings.
--
-- The function's tier-by-tier UPDATE of posts.property_id is unchanged
-- (each post still gets a single "anchor" property in that column). After
-- all three tiers complete, two additional INSERTs sync post_listings:
--
--   1. PRIMARY: for every post with property_id set, ensure a
--      post_listings row exists with is_primary=true. Idempotent — the
--      migration backfill already covered existing rows; this handles
--      posts newly linked by this run.
--
--   2. FAN-OUT: for every post, scan its caption for ALL MLS hashtags
--      (Bright/CMC/SJSR). Insert one post_listings row per additional
--      match (is_primary=false) so every featured listing's Owner Story
--      surfaces the post.
--
-- The tier counts (matched_mls / matched_addr_full / matched_addr_partial)
-- still report newly-linked posts only — the fan-out doesn't bump them.

CREATE OR REPLACE FUNCTION public.run_auto_linker()
 RETURNS TABLE(matched_mls bigint, matched_addr_full bigint, matched_addr_partial bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mls bigint := 0;
  v_full bigint := 0;
  v_partial bigint := 0;
  v_round bigint;
BEGIN
  -- Step 0: Stamp mls_number_parsed for every post whose caption contains an
  -- MLS-shaped token, regardless of whether we have a matching properties row.
  UPDATE public.posts p
     SET mls_number_parsed = COALESCE(
           upper((regexp_match(p.caption, '\m(NJ[A-Z]{2}\d{5,8})\M'))[1]),
           CASE
             WHEN p.caption ~* '#?CMC\d{4,8}'
               THEN 'CMC' || (regexp_match(p.caption, '#?CMC(\d{4,8})', 'i'))[1]
             ELSE NULL
           END,
           CASE
             WHEN p.caption ~* '#?SJSR\d{4,8}'
               THEN 'SJSR' || (regexp_match(p.caption, '#?SJSR(\d{4,8})', 'i'))[1]
             ELSE NULL
           END
         ),
         updated_at = now()
   WHERE p.mls_number_parsed IS NULL
     AND p.caption IS NOT NULL
     AND (
       p.caption ~ '\mNJ[A-Z]{2}\d{5,8}\M' OR
       p.caption ~* '#?CMC\d{4,8}' OR
       p.caption ~* '#?SJSR\d{4,8}'
     );

  -- Tier 1: MLS-number link (sets posts.property_id to the first MLS match).
  WITH cand AS (
    SELECT p.id AS post_id, props.id AS property_id
    FROM public.posts p
    JOIN public.properties props
      ON props.mls_number ~ '^NJ[A-Z]{2}\d{5,8}$'
     AND p.caption ~* ('\m' || props.mls_number || '\M')
    WHERE p.property_id IS NULL AND p.caption IS NOT NULL

    UNION ALL

    SELECT p.id, props.id
    FROM public.posts p
    JOIN public.properties props
      ON props.source_mls = 'cmc'
     AND p.caption ~* ('\m#?CMC' || props.mls_number || '\M')
    WHERE p.property_id IS NULL AND p.caption IS NOT NULL

    UNION ALL

    SELECT p.id, props.id
    FROM public.posts p
    JOIN public.properties props
      ON props.source_mls = 'sjsr'
     AND p.caption ~* ('\m#?SJSR' || props.mls_number || '\M')
    WHERE p.property_id IS NULL AND p.caption IS NOT NULL
  ),
  dedup AS (
    SELECT DISTINCT ON (post_id) post_id, property_id FROM cand
  ),
  upd AS (
    UPDATE public.posts
       SET property_id = dedup.property_id,
           link_method = 'auto_mls'::public.post_link_method,
           category    = COALESCE(category, 'property'::public.post_category),
           updated_at  = now()
      FROM dedup
     WHERE public.posts.id = dedup.post_id
       AND public.posts.property_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_round FROM upd;
  v_mls := v_mls + v_round;

  -- Tier 2: full street-address substring.
  WITH cand AS (
    SELECT DISTINCT ON (p.id) p.id AS post_id, props.id AS property_id
    FROM public.posts p
    JOIN public.properties props
      ON props.address IS NOT NULL
     AND length(props.address) >= 8
     AND p.caption ILIKE '%' || props.address || '%'
    WHERE p.property_id IS NULL AND p.caption IS NOT NULL
    ORDER BY p.id, props.created_at DESC
  ),
  upd AS (
    UPDATE public.posts
       SET property_id = cand.property_id,
           link_method = 'auto_address_full'::public.post_link_method,
           category    = COALESCE(category, 'property'::public.post_category),
           updated_at  = now()
      FROM cand
     WHERE public.posts.id = cand.post_id
       AND public.posts.property_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_full FROM upd;

  -- Tier 3: street number + first word of street name.
  WITH cand AS (
    SELECT DISTINCT ON (p.id) p.id AS post_id, props.id AS property_id
    FROM public.posts p
    JOIN public.properties props
      ON props.address IS NOT NULL
     AND props.address ~ '^[0-9]+\s+[A-Za-z]{4,}'
     AND p.caption ~* (
       '\m'
       || (regexp_match(props.address, '^([0-9]+)\s+([A-Za-z]+)'))[1]
       || '\s+'
       || (regexp_match(props.address, '^([0-9]+)\s+([A-Za-z]+)'))[2]
       || '\M'
     )
    WHERE p.property_id IS NULL AND p.caption IS NOT NULL
    ORDER BY p.id, props.created_at DESC
  ),
  upd AS (
    UPDATE public.posts
       SET property_id = cand.property_id,
           link_method = 'auto_address_partial'::public.post_link_method,
           category    = COALESCE(category, 'property'::public.post_category),
           updated_at  = now()
      FROM cand
     WHERE public.posts.id = cand.post_id
       AND public.posts.property_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_partial FROM upd;

  -- 2026-05-21 — sync post_listings.
  --
  -- (a) Primary row for every linked post. Covers posts newly linked
  --     above (tiers 1-3) and is idempotent for posts already linked.
  INSERT INTO public.post_listings (post_id, property_id, link_method, is_primary)
  SELECT
    p.id,
    p.property_id,
    COALESCE(p.link_method, 'auto_mls'::public.post_link_method),
    true
  FROM public.posts p
  WHERE p.property_id IS NOT NULL
  ON CONFLICT (post_id, property_id) DO NOTHING;

  -- (b) Fan-out: every additional MLS hashtag in the caption that points
  --     to an existing properties row gets a non-primary post_listings
  --     row. This is the mechanism that lets a multi-property OH carousel
  --     surface in every featured listing's Owner Story.
  WITH all_mls_matches AS (
    SELECT DISTINCT p.id AS post_id, props.id AS property_id
    FROM public.posts p
    JOIN public.properties props
      ON props.mls_number ~ '^NJ[A-Z]{2}\d{5,8}$'
     AND p.caption ~* ('\m' || props.mls_number || '\M')
    WHERE p.caption IS NOT NULL AND p.property_id IS NOT NULL

    UNION

    SELECT DISTINCT p.id, props.id
    FROM public.posts p
    JOIN public.properties props
      ON props.source_mls = 'cmc'
     AND p.caption ~* ('\m#?CMC' || props.mls_number || '\M')
    WHERE p.caption IS NOT NULL AND p.property_id IS NOT NULL

    UNION

    SELECT DISTINCT p.id, props.id
    FROM public.posts p
    JOIN public.properties props
      ON props.source_mls = 'sjsr'
     AND p.caption ~* ('\m#?SJSR' || props.mls_number || '\M')
    WHERE p.caption IS NOT NULL AND p.property_id IS NOT NULL
  )
  INSERT INTO public.post_listings (post_id, property_id, link_method, is_primary)
  SELECT
    am.post_id,
    am.property_id,
    'auto_mls'::public.post_link_method,
    false
  FROM all_mls_matches am
  ON CONFLICT (post_id, property_id) DO NOTHING;

  RETURN QUERY SELECT v_mls, v_full, v_partial;
END;
$function$;
