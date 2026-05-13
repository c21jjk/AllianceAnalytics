"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import type { PostGroup } from "@/lib/types/group";
import GroupCard from "./GroupCard";
import type { AudienceOfficeOption } from "./GroupCardSidebar";

interface DraggableGroupCardProps {
  group: PostGroup;
  offices: AudienceOfficeOption[];
  isAdmin: boolean;
  /** True when this card is the current drop target (dragged-over). */
  isOver?: boolean;
}

/**
 * Wraps the existing <GroupCard> with @dnd-kit useDraggable + useDroppable
 * so Larissa can drag any card onto another to merge them into a single
 * campaign.
 *
 * The drag handle is the entire card surface. Interactive controls inside
 * the card (dropdowns, links, buttons) stop pointer propagation themselves
 * so they don't initiate a drag — dnd-kit's PointerSensor honors that.
 *
 * Visual feedback:
 *   - on drag: slight scale + shadow lift, original card fades to 30% opacity
 *   - on hover-as-drop-target: gold dashed outline + bg highlight
 *
 * isOver is passed in from the parent (DndContext) instead of using the
 * hook's local isOver because dnd-kit collision detection lives on the
 * context, not the droppable.
 */
export default function DraggableGroupCard({
  group,
  offices,
  isAdmin,
  isOver = false,
}: DraggableGroupCardProps) {
  const draggable = useDraggable({
    id: `card-${group.id}`,
    data: { groupId: group.id },
    disabled: !isAdmin,
  });
  const droppable = useDroppable({
    id: `drop-${group.id}`,
    data: { groupId: group.id },
  });

  const dragStyle = draggable.transform
    ? {
        transform: `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0) rotate(1.5deg) scale(1.02)`,
        zIndex: 50,
      }
    : undefined;

  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      style={dragStyle}
      className={clsx(
        "relative transition-shadow rounded-2xl",
        draggable.isDragging && "shadow-2xl cursor-grabbing opacity-95",
        !draggable.isDragging && isAdmin && "cursor-grab",
        // When dragging some OTHER card and hovering over this one
        isOver &&
          !draggable.isDragging &&
          "ring-2 ring-gold-400 ring-offset-2 ring-offset-neutral-50",
      )}
      {...draggable.listeners}
      {...draggable.attributes}
      aria-label={
        isAdmin ? `Drag campaign to merge with another` : undefined
      }
    >
      {/* Gold dashed banner that appears over the card while it's a drop
          target. Doesn't intercept pointer events so the drop still lands. */}
      {isOver && !draggable.isDragging ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 rounded-2xl border-2 border-dashed border-gold-500 bg-gold-50/50 pointer-events-none flex items-center justify-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-500 text-white px-3 py-1.5 text-xs font-semibold shadow-lg">
            <MergeIcon />
            Drop to merge
          </span>
        </div>
      ) : null}

      <GroupCard group={group} offices={offices} isAdmin={isAdmin} />
    </div>
  );
}

function MergeIcon() {
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
      <path d="M8 3l4 4 4-4" />
      <path d="M12 7v6" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  );
}
