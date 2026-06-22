"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setPropertyBuilding,
  createBuilding,
  mergeBuildings,
} from "@/app/(app)/settings/buildings/actions";

export interface AdminBuildingMember {
  id: string;
  mls_number: string;
  source_mls: string | null;
  address: string | null;
  city: string | null;
  status: string;
  list_price: number | null;
  listing_date: string | null;
  is_primary: boolean;
}

export interface AdminBuilding {
  id: string;
  display_address: string | null;
  display_city: string | null;
  member_count: number;
  members: AdminBuildingMember[];
}

interface BuildingsAdminPanelProps {
  buildings: AdminBuilding[];
}

/**
 * Staff tool to fix building membership. Three operations:
 *   - Detach a unit from its building (sets building_id = null).
 *   - Move a unit into another existing building.
 *   - Merge an entire building into another.
 *
 * This is what lets staff correct address drift (e.g. the "Avenue" vs "Street"
 * split on 511 E 11th) that the automated backfill can't catch.
 */
export default function BuildingsAdminPanel({
  buildings,
}: BuildingsAdminPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<string>("");
  const [mergeTarget, setMergeTarget] = useState<string>("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setMessage(res.error ?? "Action failed.");
      } else {
        setMessage("Saved.");
        router.refresh();
      }
    });
  }

  const buildingOptions = buildings.map((b) => ({
    id: b.id,
    label: `${b.display_address ?? "Untitled"}${
      b.display_city ? `, ${b.display_city}` : ""
    } (${b.member_count})`,
  }));

  return (
    <div className="space-y-6">
      {message ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm text-neutral-700">
          {message}
        </div>
      ) : null}

      {/* Merge two buildings */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        <h3 className="text-sm font-semibold text-neutral-900">
          Merge buildings
        </h3>
        <p className="mt-1 text-xs text-neutral-500">
          Fold every unit of the source building into the target, then delete the
          empty source. Use this when one building was split in two.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Source (folded in)
            <select
              value={mergeSource}
              onChange={(e) => setMergeSource(e.target.value)}
              className="min-w-[16rem] rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {buildingOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Target (kept)
            <select
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              className="min-w-[16rem] rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {buildingOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !mergeSource || !mergeTarget}
            onClick={() => run(() => mergeBuildings(mergeSource, mergeTarget))}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            Merge
          </button>
        </div>
      </div>

      {/* Per-building member management */}
      {buildings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-500">
          No buildings configured. Buildings are seeded from the address backfill;
          once a multi-unit address syncs it appears here.
        </div>
      ) : (
        <div className="space-y-4">
          {buildings.map((b) => (
            <div
              key={b.id}
              className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden"
            >
              <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                <div className="text-sm font-semibold text-neutral-900">
                  {b.display_address ?? "Untitled building"}
                  {b.display_city ? `, ${b.display_city}` : ""}
                </div>
                <div className="text-xs text-neutral-500">
                  {b.member_count} {b.member_count === 1 ? "unit" : "units"}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">MLS#</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Listed</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {b.members.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5 font-mono text-xs text-neutral-800">
                        {m.mls_number}
                        {m.is_primary ? (
                          <span className="ml-1.5 rounded bg-gold-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold-800">
                            primary
                          </span>
                        ) : null}
                        {m.source_mls ? (
                          <span className="ml-1 text-[9px] uppercase text-neutral-400">
                            {m.source_mls}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-neutral-600">
                        {m.status}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-neutral-600">
                        {m.listing_date ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            defaultValue=""
                            disabled={pending}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (!val) return;
                              run(() => setPropertyBuilding(m.id, val));
                              e.target.value = "";
                            }}
                            className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                          >
                            <option value="">Move to…</option>
                            {buildingOptions
                              .filter((o) => o.id !== b.id)
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(() => setPropertyBuilding(m.id, null))
                            }
                            className="text-xs text-rose-600 hover:text-rose-800 disabled:opacity-50"
                          >
                            Detach
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(() => createBuilding(m.id))}
                            className="text-xs text-gold-700 hover:text-gold-900 disabled:opacity-50"
                            title="Split this unit out into a brand new building"
                          >
                            Split out
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
