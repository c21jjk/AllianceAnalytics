"use client";

/**
 * Audio Library admin client.
 *
 * Upload form (with in-browser preview + auto-read duration) + a table of
 * existing tracks with preview, active toggle, edit, and delete. All mutations
 * go through the server actions in ./actions; the list re-fetches via
 * router.refresh() after each change.
 *
 * Defaults (audio source, license scope, platform allow/block) are stamped
 * server-side and shown here read-only so the admin sees the compliance scope
 * without being able to clear it.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AUDIO_COMPLIANCE_NOTICE,
  AUDIO_POST_TYPES,
  AUDIO_POST_TYPE_RULES,
  PLATFORM_ALLOWED_DEFAULT,
  PLATFORM_BLOCKED_DEFAULT,
  audioPublicUrl,
  type AudioTrackRow,
} from "@/lib/audio-library/types";
import {
  deleteAudioTrackAction,
  setAudioTrackActiveAction,
  updateAudioTrackAction,
  uploadAudioTrackAction,
} from "./actions";

interface Props {
  tracks: AudioTrackRow[];
}

// Genre / mood suggestions pulled from the post-type rule set.
const GENRE_SUGGESTIONS = Array.from(
  new Set(
    AUDIO_POST_TYPES.flatMap((pt) => AUDIO_POST_TYPE_RULES[pt].preferredGenres),
  ),
).sort();
const MOOD_SUGGESTIONS = Array.from(
  new Set(AUDIO_POST_TYPES.map((pt) => AUDIO_POST_TYPE_RULES[pt].preferredMood)),
).sort();

function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function AudioLibraryClient({ tracks }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [editing, setEditing] = useState<AudioTrackRow | null>(null);
  const [previewDuration, setPreviewDuration] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isEdit = editing !== null;

  const resetForm = () => {
    formRef.current?.reset();
    setEditing(null);
    setPreviewDuration("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    // Read duration off a throwaway audio element.
    const probe = new Audio();
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration)) {
        setPreviewDuration(String(Math.round(probe.duration)));
      }
    };
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setMessage(null);
    startTransition(async () => {
      const res = isEdit
        ? await updateAudioTrackAction(editing!.id, fd)
        : await uploadAudioTrackAction(fd);
      if (res.ok) {
        setMessage({
          ok: true,
          text: isEdit ? "Track updated." : "Track uploaded.",
        });
        resetForm();
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  };

  const onToggleActive = (track: AudioTrackRow) => {
    startTransition(async () => {
      const res = await setAudioTrackActiveAction(track.id, !track.is_active);
      if (!res.ok) setMessage({ ok: false, text: res.error ?? "Failed." });
      else router.refresh();
    });
  };

  const onDelete = (track: AudioTrackRow) => {
    if (
      !window.confirm(
        `Delete "${track.track_name}"? This removes the row and the audio file.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteAudioTrackAction(track.id);
      if (!res.ok) setMessage({ ok: false, text: res.error ?? "Failed." });
      else {
        if (editing?.id === track.id) resetForm();
        router.refresh();
      }
    });
  };

  const startEdit = (track: AudioTrackRow) => {
    setEditing(track);
    setMessage(null);
    setPreviewDuration(track.duration != null ? String(track.duration) : "");
    setPreviewUrl(audioPublicUrl(track.file_path));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const editingPostTypes = useMemo(
    () => new Set(editing?.post_type ?? []),
    [editing],
  );

  return (
    <div className="space-y-8">
      {/* ===== Upload / edit form ===================================== */}
      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
          {isEdit ? `Edit: ${editing!.track_name}` : "Upload a track"}
        </h2>

        <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-4">
          {/* File (create only) */}
          {!isEdit ? (
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                Audio file (.mp3 or .wav)
              </label>
              <input
                type="file"
                name="file"
                accept="audio/mpeg,audio/mp4,audio/aac,audio/x-m4a,audio/wav,audio/x-wav,.mp3,.wav,.m4a"
                onChange={handleFileChange}
                required
                className="mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700"
              />
            </div>
          ) : null}

          {/* Preview */}
          {previewUrl ? (
            <audio
              key={previewUrl}
              controls
              src={previewUrl}
              className="w-full"
            />
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Track name" required>
              <input
                name="track_name"
                required
                defaultValue={editing?.track_name ?? ""}
                className="input"
              />
            </Field>
            <Field label="Artist">
              <input
                name="artist"
                defaultValue={editing?.artist ?? ""}
                className="input"
              />
            </Field>
            <Field label="Genre">
              <input
                name="genre"
                list="genre-suggestions"
                defaultValue={editing?.genre ?? ""}
                className="input"
              />
              <datalist id="genre-suggestions">
                {GENRE_SUGGESTIONS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
            <Field label="Mood">
              <input
                name="mood"
                list="mood-suggestions"
                defaultValue={editing?.mood ?? ""}
                className="input"
              />
              <datalist id="mood-suggestions">
                {MOOD_SUGGESTIONS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Duration (seconds)">
              <input
                type="number"
                name="duration"
                min={0}
                step="0.1"
                value={previewDuration}
                onChange={(e) => setPreviewDuration(e.currentTarget.value)}
                className="input"
              />
            </Field>
          </div>

          {/* Post type use cases */}
          <fieldset>
            <legend className="text-sm font-medium text-neutral-700">
              Post type use cases
            </legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {AUDIO_POST_TYPES.map((pt) => (
                <label
                  key={pt}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-sm text-neutral-700"
                >
                  <input
                    type="checkbox"
                    name="post_types"
                    value={pt}
                    defaultChecked={editingPostTypes.has(pt)}
                  />
                  {AUDIO_POST_TYPE_RULES[pt].label}
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="License notes">
            <textarea
              name="license_notes"
              rows={2}
              defaultValue={editing?.license_notes ?? ""}
              className="input"
            />
          </Field>

          {/* Read-only platform scope */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ReadOnlyChips
              label="Platforms allowed"
              values={[...PLATFORM_ALLOWED_DEFAULT]}
              tone="allow"
            />
            <ReadOnlyChips
              label="Platforms blocked"
              values={[...PLATFORM_BLOCKED_DEFAULT]}
              tone="block"
            />
          </div>

          {/* Compliance notice */}
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
            {AUDIO_COMPLIANCE_NOTICE}
          </p>

          {message ? (
            <p
              className={
                message.ok
                  ? "text-sm font-medium text-green-700"
                  : "text-sm font-medium text-red-600"
              }
            >
              {message.text}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {pending
                ? "Working…"
                : isEdit
                  ? "Save changes"
                  : "Upload track"}
            </button>
            {isEdit ? (
              <button
                type="button"
                onClick={resetForm}
                disabled={pending}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {/* ===== Track list ============================================ */}
      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Tracks ({tracks.length})
          </h2>
        </div>

        {tracks.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No tracks yet. Upload your first Meta Sound Collection track above.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {tracks.map((track) => (
              <li
                key={track.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-neutral-900">
                      {track.track_name}
                    </span>
                    {!track.is_active ? (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                        Inactive
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {[track.artist, track.genre, track.mood]
                      .filter(Boolean)
                      .join(" · ") || "No metadata"}{" "}
                    · {fmtDuration(track.duration)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(track.post_type ?? []).map((pt) => (
                      <span
                        key={pt}
                        className="rounded bg-gold-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-800"
                      >
                        {AUDIO_POST_TYPE_RULES[
                          pt as (typeof AUDIO_POST_TYPES)[number]
                        ]?.label ?? pt}
                      </span>
                    ))}
                  </div>
                  <audio
                    controls
                    preload="none"
                    src={audioPublicUrl(track.file_path)}
                    className="mt-2 h-8 w-full max-w-sm"
                  />
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleActive(track)}
                    disabled={pending}
                    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    {track.is_active ? "Archive" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(track)}
                    disabled={pending}
                    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(track)}
                    disabled={pending}
                    className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function ReadOnlyChips({
  label,
  values,
  tone,
}: {
  label: string;
  values: string[];
  tone: "allow" | "block";
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-neutral-700">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className={
              tone === "allow"
                ? "rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                : "rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 line-through"
            }
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
