import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * listing_notes / listing_holds — the shared per-listing scratchpad.
 *
 * 2026-08-07 (John): "We're now going to start having Cheryl helping Larissa
 * out to post some of our still posts and I think there needs to be some sort
 * of simple 'notes' section for each listing so Cheryl, Larissa and I can say
 * something about a particular property post."
 *
 * Append-only rather than one editable text field: three people sharing one box
 * means somebody eventually overwrites somebody else, and "who said this, and
 * when" is most of the value. Each entry is its own row; the dashboard shows
 * only the newest one.
 *
 * Keyed on mls_number, NOT property id — same choice as listing_post_marks. A
 * note follows the listing through Just Listed -> Under Contract -> Just Sold
 * instead of belonging to one milestone section.
 *
 * A row in listing_holds means "don't post this yet". It is a WARNING, never a
 * block: the Post Builder surfaces it and asks for a confirm, but publishing is
 * always possible. Deleting the row releases the hold.
 */

export interface ListingNoteAuthor {
  id: string | null;
  name: string;
}

export interface ListingNoteEntry {
  id: string;
  body: string;
  created_at: string;
  author: ListingNoteAuthor;
}

/** The compact shape the dashboard rows need — newest entry + a count. */
export interface ListingNoteSummary {
  latest: ListingNoteEntry;
  count: number;
}

export interface ListingHold {
  set_at: string;
  set_by_name: string;
}

/** Everything a row needs to render its note control in one object. */
export interface ListingNoteState {
  note_latest: ListingNoteEntry | null;
  note_count: number;
  on_hold: ListingHold | null;
}

export const EMPTY_NOTE_STATE: ListingNoteState = {
  note_latest: null,
  note_count: 0,
  on_hold: null,
};

/** Author display name, falling back to the email local-part, then "Someone". */
function authorName(profile: {
  full_name: string | null;
  email: string | null;
} | null): string {
  if (!profile) return "Someone";
  const full = (profile.full_name ?? "").trim();
  if (full) return full;
  const email = (profile.email ?? "").trim();
  if (email) return email.split("@")[0];
  return "Someone";
}

type RawNoteRow = {
  id: string;
  mls_number: string;
  body: string;
  created_at: string;
  author_id: string | null;
  profiles: { id: string; full_name: string | null; email: string | null } | null;
};

/**
 * Batched note state for a set of listings.
 *
 * The dashboard renders five milestone sections in one pass, so this does
 * exactly TWO round trips for the whole page (notes + holds) rather than one
 * per row. Same reasoning as getListingPostMarks.
 *
 * Returns a Map keyed on mls_number. Listings with nothing to say are simply
 * absent — callers should fall back to EMPTY_NOTE_STATE.
 */
export async function getListingNoteStates(
  mlsNumbers: string[],
): Promise<Map<string, ListingNoteState>> {
  const out = new Map<string, ListingNoteState>();
  const unique = Array.from(new Set(mlsNumbers.filter(Boolean)));
  if (unique.length === 0) return out;

  const supabase = createAdminClient();
  // listing_notes / listing_holds aren't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const [notesRes, holdsRes] = await Promise.all([
    untyped
      .from("listing_notes")
      .select(
        "id, mls_number, body, created_at, author_id, profiles:author_id (id, full_name, email)",
      )
      .in("mls_number", unique)
      .order("created_at", { ascending: false }),
    untyped
      .from("listing_holds")
      .select("mls_number, set_at, profiles:set_by (full_name, email)")
      .in("mls_number", unique),
  ]);

  if (notesRes.error) {
    console.error("[listing-notes] fetch failed:", notesRes.error.message);
  } else {
    // Rows arrive newest-first, so the FIRST row seen for an mls is the latest.
    for (const row of (notesRes.data ?? []) as RawNoteRow[]) {
      const existing = out.get(row.mls_number);
      if (existing) {
        existing.note_count += 1;
        continue;
      }
      out.set(row.mls_number, {
        note_latest: {
          id: row.id,
          body: row.body,
          created_at: row.created_at,
          author: { id: row.author_id, name: authorName(row.profiles) },
        },
        note_count: 1,
        on_hold: null,
      });
    }
  }

  if (holdsRes.error) {
    console.error("[listing-notes] hold fetch failed:", holdsRes.error.message);
  } else {
    for (const row of (holdsRes.data ?? []) as Array<{
      mls_number: string;
      set_at: string;
      profiles: { full_name: string | null; email: string | null } | null;
    }>) {
      const hold: ListingHold = {
        set_at: row.set_at,
        set_by_name: authorName(row.profiles),
      };
      const existing = out.get(row.mls_number);
      if (existing) {
        existing.on_hold = hold;
      } else {
        // A hold with no note is legal — someone ticked the box and saved
        // nothing. The row still needs to show its HOLD chip.
        out.set(row.mls_number, {
          note_latest: null,
          note_count: 0,
          on_hold: hold,
        });
      }
    }
  }

  return out;
}

/**
 * Full newest-first thread for one listing, for the expanded panel and the
 * property detail page. Capped at 50 — a listing with more notes than that has
 * a different problem, and the cap keeps the payload bounded.
 */
export async function getListingNoteThread(
  mlsNumber: string,
): Promise<{ entries: ListingNoteEntry[]; on_hold: ListingHold | null }> {
  if (!mlsNumber) return { entries: [], on_hold: null };

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const [notesRes, holdRes] = await Promise.all([
    untyped
      .from("listing_notes")
      .select(
        "id, mls_number, body, created_at, author_id, profiles:author_id (id, full_name, email)",
      )
      .eq("mls_number", mlsNumber)
      .order("created_at", { ascending: false })
      .limit(50),
    untyped
      .from("listing_holds")
      .select("set_at, profiles:set_by (full_name, email)")
      .eq("mls_number", mlsNumber)
      .maybeSingle(),
  ]);

  if (notesRes.error) {
    console.error("[listing-notes] thread fetch failed:", notesRes.error.message);
    return { entries: [], on_hold: null };
  }

  const entries: ListingNoteEntry[] = ((notesRes.data ?? []) as RawNoteRow[]).map(
    (row) => ({
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      author: { id: row.author_id, name: authorName(row.profiles) },
    }),
  );

  // A missing hold row is the normal case, not an error — maybeSingle returns
  // null data with no error, so only a real failure logs.
  const holdRow = holdRes.error ? null : holdRes.data;
  const on_hold: ListingHold | null = holdRow
    ? {
        set_at: (holdRow as { set_at: string }).set_at,
        set_by_name: authorName(
          (
            holdRow as {
              profiles: { full_name: string | null; email: string | null } | null;
            }
          ).profiles,
        ),
      }
    : null;

  return { entries, on_hold };
}

/**
 * Single-listing convenience wrapper for the Post Builder, which only ever
 * cares about the one listing the user has selected.
 */
export async function getListingNoteState(
  mlsNumber: string,
): Promise<ListingNoteState> {
  if (!mlsNumber) return EMPTY_NOTE_STATE;
  const map = await getListingNoteStates([mlsNumber]);
  return map.get(mlsNumber) ?? EMPTY_NOTE_STATE;
}
