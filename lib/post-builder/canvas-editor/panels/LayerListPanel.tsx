"use client";

/**
 * LayerListPanel — Phase 2, Agent C
 * ---------------------------------
 *
 * Drop-in replacement for the inline `LayerPanel` that used to live in
 * CanvasEditor.tsx. Renders the right-side layer list with the EXACT same
 * visual language (kind icon + name + lock indicator + eye toggle + trash,
 * gold-50 selected highlight, "No layers yet" empty state) and adds:
 *
 *   • Drag-to-reorder via @dnd-kit (PointerSensor + KeyboardSensor)
 *   • A 6-dot grip handle on the left of each row — the handle is the ONLY
 *     drag activator, so clicking the row body still selects the layer.
 *   • A small "(N layers)" count badge and help tooltip in the header.
 *
 * The panel is presentational. It does NOT mutate the Fabric canvas. On a
 * successful drag, it fires `onReorder(newOrderedIds)` and lets the
 * orchestrator translate that into Fabric's bringToFront/sendBackwards calls
 * (so the orchestrator's layerVersion-bump-after-canvas-mutation pattern
 * stays in one place).
 *
 * Convention: array index 0 is the TOP of the layer panel = TOP of the
 * canvas stack (Photoshop/Canva-style). The existing CanvasEditor reverses
 * Fabric's getObjects() before passing entries in, so this component never
 * has to think about z-order direction.
 *
 * Why @dnd-kit/sortable was added to the deps:
 *   The contracts file lists `@dnd-kit/core` and `@dnd-kit/utilities`, but
 *   building a sortable list with just `core` means re-implementing the
 *   index-swap + transform math + keyboard A11y from scratch. `@dnd-kit/sortable`
 *   is the official sibling package (same maintainer, same API surface) and is
 *   used by every list-reorder example in their docs. Adding it (v7, matches
 *   @dnd-kit/core v6) is a 30KB tree-shakeable cost for ~150 lines of saved
 *   error-prone code. Package.json updated alongside this file.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, type JSX } from "react";

import type { LayerListEntry, LayerListPanelProps } from "../contracts";
import type { CanvasLayer } from "../types";

// ===========================================================================
// Top-level panel
// ===========================================================================

export default function LayerListPanel(
  props: LayerListPanelProps,
): JSX.Element {
  // why: PointerSensor + KeyboardSensor cover mouse, touch, AND keyboard
  // navigation (arrow keys to move focused item, space to start/end drag).
  // The 4px activation constraint prevents accidental drags when the user
  // is actually trying to click the grip — without it, every mousedown on
  // the handle would start a drag and consume the click.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // why: capture the new order as an array of IDs and hand it to the parent.
  // We deliberately do NOT apply the reorder locally — the orchestrator owns
  // the Fabric canvas state and will re-derive `entries` after the canvas
  // mutates. Pre-applying here would create a stale-state flash if the
  // orchestrator rejects the reorder for any reason (e.g., locked layer).
  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over === null) return;
    if (active.id === over.id) return;
    const oldIndex = props.entries.findIndex((e) => e.id === active.id);
    const newIndex = props.entries.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = props.entries.map((e) => e.id);
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    props.onReorder(next);
  };

  const layerCount = props.entries.length;

  return (
    <aside className="flex w-72 flex-col border-l border-[var(--studio-border)] bg-[var(--studio-panel)]">
      <header className="border-b border-[var(--studio-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
            Layers
          </h2>
          <span className="text-xs text-[var(--studio-text-faint)]">
            ({layerCount} {layerCount === 1 ? "layer" : "layers"})
          </span>
          {/* why: tiny "?" help affordance — surface drag affordance without
              shouting; pure CSS title-attribute tooltip keeps the bundle clean. */}
          <span
            title="Drag the grip to reorder. Click a row to select."
            aria-label="Drag the grip to reorder. Click a row to select."
            className="ml-auto inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[var(--studio-border)] text-[10px] font-semibold text-[var(--studio-text-muted)] hover:border-[var(--studio-text-muted)] hover:text-white"
          >
            ?
          </span>
        </div>
      </header>
      <ul className="flex-1 overflow-y-auto px-2 py-2">
        {layerCount === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-[var(--studio-text-muted)]">
            No layers yet
          </li>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={props.entries.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              {props.entries.map((entry) => (
                <SortableLayerRow
                  key={entry.id}
                  entry={entry}
                  isSelected={entry.id === props.selectedLayerId}
                  onSelect={props.onSelect}
                  onToggleVisibility={props.onToggleVisibility}
                  onDelete={props.onDelete}
                  onHoverEntry={props.onHoverEntry}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </ul>
    </aside>
  );
}

// ===========================================================================
// Sortable row
// ===========================================================================

interface SortableLayerRowProps {
  entry: LayerListEntry;
  isSelected: boolean;
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onDelete: (layerId: string) => void;
  /** Phase B.4 — hover-preview callback. Optional. */
  onHoverEntry?: (layerId: string | null) => void;
}

function SortableLayerRow(props: SortableLayerRowProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: props.entry.id });

  // why: @dnd-kit emits transform + transition on every frame of the drag.
  // CSS.Transform.toString handles the matrix conversion for us. zIndex lifts
  // the dragged row above its siblings so the shadow + ring don't get clipped.
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  // why: composing the row className conditionally rather than via clsx —
  // project uses Tailwind utility strings directly and clsx import noise
  // isn't worth saving 12 characters here.
  // Phase B.4 — `isOver && !isDragging` shows a crisp top border on the
  // drop target so it's obvious WHERE a drag will land. Without this the
  // shuffle animation reads as "things moved" but not "this is the slot."
  const rowClass = [
    "group relative mb-1 flex items-center gap-2 rounded-lg px-2 py-2 transition-colors",
    props.isSelected
      ? "bg-gold-500/10 border-l-2 border-l-gold-500 text-white"
      : "hover:bg-[var(--studio-hover)]",
    isDragging
      ? "scale-[1.02] bg-[var(--studio-popover)] shadow-2xl shadow-black/60 ring-1 ring-gold-500"
      : "",
    isOver && !isDragging ? "border-t-2 border-gold-500" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={rowClass}
      onMouseEnter={() => {
        if (isDragging) return;
        props.onHoverEntry?.(props.entry.id);
      }}
      onMouseLeave={() => {
        if (isDragging) return;
        props.onHoverEntry?.(null);
      }}
    >
      {/* Phase B.4 — grip handle hidden until row hover (or focus-visible
          for keyboard users). Removes the visual noise of a full column
          of dots and matches Notion/Linear's pattern of "grip on hover."
          The button stays in the DOM so dnd-kit's sensors can still
          attach — just hidden via opacity transition. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${props.entry.name}`}
        className={`flex h-6 w-3.5 shrink-0 items-center justify-center text-[var(--studio-text-faint)] opacity-0 transition-opacity hover:text-[var(--studio-text-muted)] focus:outline-none focus-visible:text-white focus-visible:opacity-100 group-hover:opacity-100 ${
          isDragging ? "cursor-grabbing opacity-100" : "cursor-grab"
        }`}
      >
        <GripIcon />
      </button>
      <button
        type="button"
        onClick={() => props.onSelect(props.entry.id)}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <LayerKindIcon kind={props.entry.kind} />
        <span
          className={`truncate text-sm ${
            props.entry.visible
              ? "text-white"
              : "text-[var(--studio-text-faint)] line-through"
          }`}
        >
          {props.entry.name}
        </span>
        {props.entry.locked ? (
          <span className="text-[var(--studio-text-muted)]">
            <LockIcon />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => props.onToggleVisibility(props.entry.id)}
        aria-label={props.entry.visible ? "Hide layer" : "Show layer"}
        className="rounded p-1 text-[var(--studio-text-muted)] hover:bg-[var(--studio-hover)] hover:text-white"
      >
        {props.entry.visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
      <button
        type="button"
        onClick={() => props.onDelete(props.entry.id)}
        aria-label="Delete layer"
        className="rounded p-1 text-[var(--studio-text-faint)] opacity-0 transition-opacity hover:bg-rose-500/20 hover:text-rose-200 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>
    </li>
  );
}

// ===========================================================================
// Inline SVG icons
// ---------------------------------------------------------------------------
// why: project has no icon library and CanvasEditor.tsx uses inline SVGs the
// same way. Duplicating these here keeps LayerListPanel a true standalone
// drop-in — no cross-file imports for a 200-byte SVG.
// ===========================================================================

function GripIcon(): JSX.Element {
  // why: 6-dot vertical grip (Material/Lucide convention). Two columns of
  // three dots is unambiguously a drag handle to anyone who's used Notion,
  // Linear, Trello, etc. — no label needed.
  return (
    <svg
      width="10"
      height="16"
      viewBox="0 0 10 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="3" r="1" />
      <circle cx="3" cy="8" r="1" />
      <circle cx="3" cy="13" r="1" />
      <circle cx="7" cy="3" r="1" />
      <circle cx="7" cy="8" r="1" />
      <circle cx="7" cy="13" r="1" />
    </svg>
  );
}

function LayerKindIcon({ kind }: { kind: CanvasLayer["kind"] }): JSX.Element {
  // why: same switch as in CanvasEditor.tsx; kept here to avoid importing
  // private helpers across the editor boundary.
  switch (kind) {
    case "text":
      return <TextIcon />;
    case "image":
      return <ImageIcon />;
    case "shape":
      return <ShapeIcon />;
    case "group":
      return <GroupIcon />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h10" />
      <path d="M5 4V2.5A.5.5 0 0 1 5.5 2h5a.5.5 0 0 1 .5.5V4" />
      <path d="M4.5 4l.5 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-9" />
    </svg>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function EyeIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 2l12 12" />
      <path d="M6.1 6.1A2 2 0 0 0 8 10a2 2 0 0 0 1.9-1.4" />
      <path d="M1 8s2.5-5 7-5c1.3 0 2.5.4 3.5 1" />
      <path d="M15 8s-2.5 5-7 5c-1.3 0-2.5-.4-3.5-1" />
    </svg>
  );
}

function TextIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4V3h10v1" />
      <path d="M8 3v10" />
      <path d="M6 13h4" />
    </svg>
  );
}

function ImageIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="7" r="1" />
      <path d="M14 11l-3-3-6 5" />
    </svg>
  );
}

function ShapeIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <circle cx="11" cy="11" r="3" />
    </svg>
  );
}

function GroupIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="8" y="8" width="6" height="6" rx="1" />
    </svg>
  );
}
