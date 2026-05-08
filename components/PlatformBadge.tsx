import clsx from "clsx";
import type { Platform } from "@/lib/types/post";

interface PlatformBadgeProps {
  platform: Platform;
  /** Visual size — sm for inline chips, md for thumbnail overlays */
  size?: "sm" | "md";
  /** When true, renders the platform name beside the glyph */
  showLabel?: boolean;
  className?: string;
}

const META: Record<
  Platform,
  { label: string; bg: string; fg: string; icon: React.ReactNode }
> = {
  facebook: {
    label: "Facebook",
    bg: "bg-[#1877F2]",
    fg: "text-white",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.5 21v-7.4h2.5l.4-2.9h-2.9V8.9c0-.84.23-1.4 1.43-1.4H16.5V4.94c-.27-.04-1.18-.11-2.24-.11-2.22 0-3.74 1.36-3.74 3.85v2.12H8v2.9h2.52V21h2.98z" />
      </svg>
    ),
  },
  instagram: {
    label: "Instagram",
    bg: "bg-gradient-to-br from-[#FEDA77] via-[#F58529] to-[#DD2A7B]",
    fg: "text-white",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect
          x="3.5"
          y="3.5"
          width="17"
          height="17"
          rx="5"
          stroke="currentColor"
          strokeWidth={1.7}
        />
        <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth={1.7} />
        <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
      </svg>
    ),
  },
  tiktok: {
    label: "TikTok",
    bg: "bg-neutral-900",
    fg: "text-white",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16.5 3a5.5 5.5 0 005 4.5v3.05a8.7 8.7 0 01-5-1.6v6.6a6 6 0 11-6-6c.34 0 .67.03 1 .09v3.18a2.85 2.85 0 102 2.73V3h3z" />
      </svg>
    ),
  },
};

export default function PlatformBadge({
  platform,
  size = "md",
  showLabel = false,
  className,
}: PlatformBadgeProps) {
  const meta = META[platform];
  const sizing =
    size === "sm"
      ? "w-5 h-5 [&_svg]:w-3 [&_svg]:h-3"
      : "w-7 h-7 [&_svg]:w-4 [&_svg]:h-4";

  if (showLabel) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full pl-0.5 pr-2.5 py-0.5 text-xs font-medium",
          "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200",
          className,
        )}
      >
        <span
          className={clsx(
            "inline-flex items-center justify-center rounded-full",
            meta.bg,
            meta.fg,
            "w-5 h-5 [&_svg]:w-3 [&_svg]:h-3",
          )}
          aria-hidden="true"
        >
          {meta.icon}
        </span>
        {meta.label}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full shadow-sm ring-1 ring-white/40",
        meta.bg,
        meta.fg,
        sizing,
        className,
      )}
      aria-label={meta.label}
      title={meta.label}
    >
      {meta.icon}
    </span>
  );
}

export function platformLabel(platform: Platform): string {
  return META[platform].label;
}
