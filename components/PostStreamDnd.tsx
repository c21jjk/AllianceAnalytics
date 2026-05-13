"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { PostGroup } from "@/lib/types/group";
import type { AudienceOfficeOption } from "./GroupCardSidebar";
import DraggableGroupCard from "./DraggableGroupCard";
import {
  mergeGroupsAction,
  unmergeFromGroupAction,
} from "@/app/(app)/groups/actions";

interface PostStreamDndProps {
  groups: PostGroup[];
  offices: AudienceOfficeOption[];
  isAdmin: boolean;
}

const HINT_DISMISSED_KEY = "post-stream-dnd-hint-dismissed";

/**
 * Client-side wrapper that hosts the grouped post stream inside a DndContext
 * so admins can drag any campaign card onto another to merge them.
 *
 * Direction convention: dragging A onto B = "A merges into B's campaign."
 * After the merge, an undo toast appears for 5 seconds so accidental drops
 * are recoverable in one click.
 *
 * A first-use tooltip ("Drag any card onto another to merge them") appears
 * once and dismisses on first successful merge OR when the user clicks the
 * dismiss X. Stored in localStorage so it doesn't reappear.
 */
export default function PostStreamDnd({
  groups,
  offices,
  isAdmin,
}: PostStreamDndProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [toast, setToast] = useState<
    | { kind: "idle" }
    | {
        kind: "merged";
        groupId: string;
        sourcePostId: string;
        previouslySoloPost: boolean;
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [hintVisible, setHintVisible] = useState<boolean>(false);

  // 250ms activation distance prevents accidental drags when clicking
  // inline controls inside a card (audience dropdown, MLS chip, etc.).
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  useEffect(() => {
    if (!isAdmin) return;
    try {
      const dismissed =
        window.localStorage.getItem(HINT_DISMISSED_KEY) === "1";
      if (!dismissed) setHintVisible(true);
    } catch {
      // localStorage unavailable
    }
  }, [isAdmin]);

  function dismissHint() {
    setHintVisible(false);
    try {
      window.localStorage.setItem(HINT_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function handleDragOver(e: DragOverEvent) {
    setOverId(e.over ? String(e.over.id) : null);
  }
  function handleDragEnd(e: DragEndEvent) {
    const sourceGroupId = (e.active.data.current as { groupId?: string } | undefined)
      ?.groupId;
    const targetGroupId = (e.over?.data.current as { groupId?: string } | undefined)
      ?.groupId;
    setActiveId(null);
    setOverId(null);
    if (!sourceGroupId || !targetGroupId) return;
    if (sourceGroupId === targetGroupId) return;

    // Fire the merge optimistically. We dismiss the first-use hint on the
    // first attempted merge (whether or not it succeeds).
    dismissHint();
    startTransition(async () => {
      const result = await mergeGroupsAction(sourceGroupId, targetGroupId);
      if (!result.ok) {
        setToast({
          kind: "error",
          message: result.error ?? "Merge failed.",
        });
        setTimeout(() => setToast({ kind: "idle" }), 4000);
        return;
      }
      setToast({
        kind: "merged",
        // After merge, the surviving group's ID is the target's. For undo we
        // want the source post id so we can detach it back out.
        groupId: targetGroupId,
        sourcePostId: result.merged_post_id ?? "",
        previouslySoloPost: sourceGroupId.startsWith("solo-"),
      });
      router.refresh();
      setTimeout(() => setToast({ kind: "idle" }), 5000);
    });
  }

  async function handleUndo() {
    if (toast.kind !== "merged") return;
    if (!toast.sourcePostId) return;
    setToast({ kind: "idle" });
    startTransition(async () => {
      const result = await unmergeFromGroupAction(
        toast.groupId,
        toast.sourcePostId,
      );
      if (!result.ok) {
        setToast({
          kind: "error",
          message: result.error ?? "Undo failed.",
        });
        setTimeout(() => setToast({ kind: "idle" }), 4000);
        return;
      }
      router.refresh();
    });
  }

  // Without admin: render plain GroupCards (no DnD overhead) by routing
  // through the same wrapper with disabled drag.
  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {hintVisible && groups.length >= 2 ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-gold-200 bg-gold-50/60 px-3 py-2 text-xs text-neutral-700">
            <span className="inline-flex items-center gap-1.5">
              <DragIcon />
              <strong className="font-semibold">Tip:</strong> Drag any card
              onto another to merge them into a single campaign.
            </span>
            <button
              type="button"
              onClick={dismissHint}
              aria-label="Dismiss tip"
              className="shrink-0 text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              <CloseIcon />
            </button>
          </div>
        ) : null}

        <section className="space-y-3">
          {groups.map((g) => (
            <DraggableGroupCard
              key={g.id}
              group={g}
              offices={offices}
              isAdmin={isAdmin}
              isOver={overId === `drop-${g.id}` && activeId !== `card-${g.id}`}
            />
          ))}
        </section>
      </DndContext>

      {/* Toast — bottom-right, fades in. Undo on merged, dismiss on error. */}
      {toast.kind === "merged" ? (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg bg-neutral-900 text-white shadow-2xl px-4 py-3 text-sm"
        >
          <span>Merged into one campaign.</span>
          <button
            type="button"
            onClick={handleUndo}
            disabled={isPending}
            className="font-semibold text-gold-300 hover:text-gold-200 underline-offset-2 hover:underline disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      ) : null}
      {toast.kind === "error" ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-rose-900 text-white shadow-2xl px-4 py-3 text-sm"
        >
          {toast.message}
        </div>
      ) : null}
    </>
  );
}

function DragIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
