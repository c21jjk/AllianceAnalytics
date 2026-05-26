/**
 * Brand-color text lockups for each portal we show on the strip.
 *
 * Tier 1 implementation — no image files, no licensing risk. Each mark is
 * a small typographic component rendered in the portal's official brand
 * color on a clean chip. The component API stays stable so we can swap to
 * real SVG logos later by editing only this file.
 *
 * Brand colors sourced from each portal's public website (May 2026):
 *   - Zillow:        #006AFF (Zillow blue)
 *   - Realtor.com:   #D92228 (Realtor red)
 *   - Trulia:        #00A35C (Trulia green)
 *   - Redfin:        #A02021 (Redfin red)
 *   - CIH:           #C9A84C (Alliance Relentless Gold — neutral umbrella mark)
 */
import clsx from "clsx";
import type { PortalStripKey } from "@/lib/data/portal-metrics-db";

interface PortalMarkProps {
  portal: PortalStripKey;
  /** Visual size — controls the chip dimensions and font size. */
  size?: "xs" | "sm" | "md" | "lg";
  /** Render as a solid color chip vs. just colored text. */
  variant?: "chip" | "text";
  className?: string;
}

interface PortalConfig {
  label: string;
  /** Brand color for the mark. */
  color: string;
  /** Text color when rendered as a solid chip background. */
  chipText: string;
  /** Background color when rendered as a soft chip. */
  chipBg: string;
}

const PORTAL_CONFIGS: Record<PortalStripKey, PortalConfig> = {
  zillow: {
    label: "Zillow",
    color: "#006AFF",
    chipText: "#FFFFFF",
    chipBg: "#006AFF",
  },
  realtor: {
    label: "Realtor.com",
    color: "#D92228",
    chipText: "#FFFFFF",
    chipBg: "#D92228",
  },
  trulia: {
    label: "Trulia",
    color: "#00A35C",
    chipText: "#FFFFFF",
    chipBg: "#00A35C",
  },
  redfin: {
    label: "Redfin",
    color: "#A02021",
    chipText: "#FFFFFF",
    chipBg: "#A02021",
  },
  cih: {
    label: "CIH",
    color: "#C9A84C",
    chipText: "#3B2F0E",
    chipBg: "#FDF6DC",
  },
};

const SIZE_CLASSES: Record<NonNullable<PortalMarkProps["size"]>, {
  chip: string;
  text: string;
}> = {
  xs: {
    chip: "px-1.5 py-0.5 text-[9px] font-semibold tracking-tight rounded",
    text: "text-[10px] font-semibold",
  },
  sm: {
    chip: "px-2 py-0.5 text-[10px] font-semibold tracking-tight rounded-md",
    text: "text-xs font-semibold",
  },
  md: {
    chip: "px-2.5 py-1 text-xs font-bold tracking-tight rounded-md",
    text: "text-sm font-bold",
  },
  lg: {
    chip: "px-3 py-1.5 text-sm font-bold tracking-tight rounded-lg",
    text: "text-base font-bold",
  },
};

export default function PortalMark({
  portal,
  size = "sm",
  variant = "chip",
  className,
}: PortalMarkProps) {
  const cfg = PORTAL_CONFIGS[portal];
  const sz = SIZE_CLASSES[size];

  if (variant === "text") {
    return (
      <span
        className={clsx(sz.text, "whitespace-nowrap", className)}
        style={{ color: cfg.color }}
      >
        {cfg.label}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        sz.chip,
        "inline-flex items-center justify-center whitespace-nowrap leading-none",
        className,
      )}
      style={{
        backgroundColor: cfg.chipBg,
        color: cfg.chipText,
      }}
      aria-label={cfg.label}
    >
      {cfg.label}
    </span>
  );
}

export function getPortalConfig(portal: PortalStripKey): PortalConfig {
  return PORTAL_CONFIGS[portal];
}
