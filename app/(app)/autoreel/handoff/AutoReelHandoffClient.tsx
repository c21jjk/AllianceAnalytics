"use client";

/**
 * Client half of the AutoReel handoff (2026-08-05).
 *
 * Resolved listing → auto-import on mount, then hard-forward to the review
 * page. Ambiguous → tiny picker (candidates from the server, plus a search
 * box fallback). Import + search reuse the /api/post-builder/autoreel-import
 * endpoints, so this page is orchestration only.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface HandoffCandidate {
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  hero_image_url: string | null;
  status: string;
}

interface Props {
  videoUrl: string | null;
  projectUrl: string | null;
  title: string | null;
  resolvedMls: string | null;
  candidates: HandoffCandidate[];
}

export default function AutoReelHandoffClient({
  videoUrl,
  projectUrl,
  title,
  resolvedMls,
  candidates,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"importing" | "pick" | "error">(
    videoUrl && resolvedMls ? "importing" : videoUrl ? "pick" : "error",
  );
  const [error, setError] = useState<string | null>(
    videoUrl ? null : "Missing or invalid video link — go back to AutoReel and try the Send button again.",
  );
  const [busyMls, setBusyMls] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<HandoffCandidate[]>(candidates);
  const startedFor = useRef<string | null>(null);

  async function runImport(mls: string) {
    if (!videoUrl) return;
    setBusyMls(mls);
    setError(null);
    try {
      // Best-effort: remember the project link so future lookups are certain.
      if (projectUrl) {
        void fetch("/api/post-builder/autoreel-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_project_link",
            mls_number: mls,
            project_url: projectUrl,
          }),
        }).catch(() => undefined);
      }
      const res = await fetch("/api/post-builder/autoreel-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", mls_number: mls, video_url: videoUrl }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; gp_id?: string };
      if (!j.ok || !j.gp_id) {
        setError(j.error ?? "Import failed — try again.");
        setPhase("pick");
      } else {
        router.replace(`/post-builder/autoreel-review?gp=${j.gp_id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed — try again.");
      setPhase("pick");
    } finally {
      setBusyMls(null);
    }
  }

  // Auto-run for a confidently-resolved listing.
  useEffect(() => {
    if (phase !== "importing" || !resolvedMls) return;
    if (startedFor.current === resolvedMls) return;
    startedFor.current = resolvedMls;
    void runImport(resolvedMls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, resolvedMls]);

  // Picker search (same endpoint the panel uses).
  useEffect(() => {
    if (phase !== "pick" || q.trim().length < 2) return;
    const t = setTimeout(() => {
      void fetch(`/api/post-builder/autoreel-import?q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { results?: HandoffCandidate[] } | null) => {
          if (j?.results) setResults(j.results);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q, phase]);

  if (phase === "importing") {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-card text-center">
        <div
          aria-hidden="true"
          className="mx-auto w-8 h-8 rounded-full border-2 border-gold-500 border-t-transparent animate-spin"
        />
        <p className="mt-4 text-sm font-medium text-neutral-800">
          Importing the video and drafting captions…
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          This takes a few seconds. You'll land on the preview automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      {error ? (
        <div className="rounded-lg bg-red-50 ring-1 ring-red-200 px-3 py-2.5 text-sm text-red-900">
          {error}
        </div>
      ) : null}
      {videoUrl ? (
        <>
          <p className="text-sm text-neutral-600">
            Which listing is this video for
            {title ? (
              <>
                ? The AutoReel project is named{" "}
                <span className="font-medium text-neutral-900">{title}</span>.
              </>
            ) : (
              "?"
            )}
          </p>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by address or MLS #..."
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
          />
          {results.length > 0 ? (
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 overflow-hidden bg-white">
              {results.map((r) => (
                <li key={r.mls_number}>
                  <button
                    type="button"
                    disabled={busyMls !== null}
                    onClick={() => void runImport(r.mls_number)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {r.hero_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.hero_image_url}
                        alt=""
                        className="w-9 h-9 rounded object-cover bg-neutral-100 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded bg-neutral-100 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm text-neutral-900 truncate">
                        {r.address ?? r.mls_number}
                        {r.city ? <span className="text-neutral-500">, {r.city}</span> : null}
                      </span>
                      <span className="block text-[11px] text-neutral-500">
                        #{r.mls_number}
                        {r.status ? ` · ${r.status}` : ""}
                      </span>
                    </span>
                    {busyMls === r.mls_number ? (
                      <span className="ml-auto text-[11px] text-neutral-500 shrink-0">
                        Importing…
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-neutral-400">
              Type at least two characters to search your listings.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
