"use client";

import { useState } from "react";
import MergeWithDialog from "./MergeWithDialog";

interface GroupCardMergeButtonProps {
  groupId: string;
}

/**
 * Client island for the small "Merge with..." control on each homepage card.
 *
 * Owns the open/closed state for MergeWithDialog so the parent GroupCard can
 * stay a server component.
 */
export default function GroupCardMergeButton({
  groupId,
}: GroupCardMergeButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900 underline-offset-2 hover:underline"
      >
        Merge with...
      </button>
      <MergeWithDialog
        groupId={groupId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
