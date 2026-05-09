/**
 * Long-form strategy plan generator. Powers the /coach "Generate this week's
 * plan" surface — the second of the five permitted AI surfaces.
 *
 * Per project rules:
 *   - Plans tie back to the four outcomes (reach, engagement, listing leads,
 *     recruiting).
 *   - Brand-wide plans intentionally avoid town-specific claims.
 *   - Single-office plans use that office's market profile heavily.
 *   - Multi-office plans return a per-office section, never one merged plan.
 *   - Content mix follows 40/30/20/10 — local expert / personal / real estate / community.
 *
 * Uses the heavyweight Opus model.
 */
import "server-only";
import { ANTHROPIC_MODELS, getAnthropic } from "./anthropic";
import { listOffices, type OfficeRow } from "@/lib/data/offices";

export type StrategyScope =
  | { kind: "brand_wide" }
  | { kind: "single_office"; office_short_code: string }
  | { kind: "multi_office"; office_short_codes: string[] };

export type ContentPillar =
  | "local_expert"
  | "personal"
  | "real_estate"
  | "community";

export interface PostIdea {
  title: string;
  why: string;
  /** Which of the four outcomes this idea primarily serves. */
  outcome: "reach" | "engagement" | "listing_leads" | "recruiting";
}

export interface PillarPlan {
  pillar: ContentPillar;
  /** Suggested share for the week, decimal (e.g. 0.4 for 40%). */
  share: number;
  ideas: PostIdea[];
}

export interface OfficeStrategySection {
  /** Short code of the office (or "BRAND" for brand-wide). */
  scope_label: string;
  /** Display name shown in the UI heading. */
  display_name: string;
  /** 1-2 sentence framing for the week. */
  summary: string;
  pillars: PillarPlan[];
  /** Recruiting angles specific to this scope. */
  recruiting_angles: string[];
}

export interface StrategyPlan {
  generated_at: string;
  scope: StrategyScope;
  sections: OfficeStrategySection[];
  /** Optional disclaimer (e.g. when offices have empty profiles). */
  notes?: string[];
}

interface ModelSectionShape {
  scope_label?: string;
  display_name?: string;
  summary?: string;
  pillars?: Array<{
    pillar?: string;
    share?: number;
    ideas?: Array<{
      title?: string;
      why?: string;
      outcome?: string;
    }>;
  }>;
  recruiting_angles?: string[];
}

interface ModelPlanShape {
  sections?: ModelSectionShape[];
  notes?: string[];
}

const SYSTEM_PROMPT = `You are the AI marketing strategist for Century 21 Alliance, a New Jersey real estate brokerage with eight offices. Generate a one-week content plan.

Hard rules:
1. Content mix follows 40 / 30 / 20 / 10:
   - 40% local_expert (market data, town spotlights, expert voice)
   - 30% personal (agent stories, behind-the-scenes, faces)
   - 20% real_estate (listings, sold posts, listing tips)
   - 10% community (local events, charity, supporting local biz)
2. Every post idea must specify which of the four outcomes it serves:
   reach | engagement | listing_leads | recruiting
3. NEVER recommend Facebook Groups posting. NEVER recommend posting from
   personal profiles. Only the brand pages.
4. Be specific. "Post about a listing" is bad. "30-second walkthrough of the
   12 Park Ave kitchen reno that highlights the new quartz counters" is good.
5. Multi-office requests must return a section per office, never one merged
   section.
6. For brand-wide scope, do NOT make town-specific claims; speak to common
   themes across all 8 offices.
7. For single-office and multi-office scopes, lean on that office's towns,
   buyer/seller demos, seasonality, price band, and signature angles.
8. Recruiting angles should be 2-3 short phrases tailored to attracting C21
   Alliance agents (think: tech, training, splits, brand, local presence).

Return strict JSON only matching this schema:
{
  "sections": [
    {
      "scope_label": string (e.g. "BRAND" or office short_code like "MARLTON"),
      "display_name": string (e.g. "Brand-wide" or "Marlton office"),
      "summary": string (1-2 sentences setting up the week),
      "pillars": [
        {
          "pillar": "local_expert" | "personal" | "real_estate" | "community",
          "share": number (0-1 decimal — must follow 40/30/20/10),
          "ideas": [
            { "title": string, "why": string, "outcome": "reach"|"engagement"|"listing_leads"|"recruiting" }
          ]
        }
      ],
      "recruiting_angles": [string]
    }
  ],
  "notes": [string] (optional caveats)
}

Each pillar must have ~3 ideas (always between 2 and 4). Return all four pillars in the order: local_expert, personal, real_estate, community.`;

function formatPrice(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(Number(n))) return null;
  return `$${Math.round(Number(n)).toLocaleString()}`;
}

function describeOffice(office: OfficeRow): string {
  const parts: string[] = [];
  parts.push(`Office: ${office.display_name ?? office.name} (${office.short_code})`);
  const towns = (office.towns_served ?? []).filter((t) => t && t.trim());
  if (towns.length > 0) parts.push(`Towns: ${towns.slice(0, 12).join(", ")}`);
  if (office.primary_buyer_demo?.trim())
    parts.push(`Buyer: ${office.primary_buyer_demo.trim()}`);
  if (office.primary_seller_demo?.trim())
    parts.push(`Seller: ${office.primary_seller_demo.trim()}`);
  if (office.seasonal_pattern?.trim())
    parts.push(`Seasonality: ${office.seasonal_pattern.trim()}`);
  const median = formatPrice(office.price_range_median);
  const low = formatPrice(office.price_range_min);
  const high = formatPrice(office.price_range_high);
  if (median || low || high) {
    const bits: string[] = [];
    if (median) bits.push(`median ${median}`);
    if (low && high) bits.push(`range ${low}-${high}`);
    parts.push(`Price band: ${bits.join(", ")}`);
  }
  const angles = (office.signature_angles ?? []).filter((a) => a && a.trim());
  if (angles.length > 0)
    parts.push(`Signature angles: ${angles.slice(0, 8).join("; ")}`);
  return parts.join("\n");
}

function asPillar(value: unknown): ContentPillar {
  if (
    value === "local_expert" ||
    value === "personal" ||
    value === "real_estate" ||
    value === "community"
  ) {
    return value;
  }
  return "real_estate";
}

function asOutcome(value: unknown): PostIdea["outcome"] {
  if (
    value === "reach" ||
    value === "engagement" ||
    value === "listing_leads" ||
    value === "recruiting"
  ) {
    return value;
  }
  return "engagement";
}

function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function fallbackSection(
  scopeLabel: string,
  displayName: string,
  office: OfficeRow | null,
): OfficeStrategySection {
  const towns = office?.towns_served?.filter((t) => t.trim()) ?? [];
  const exampleTown = towns[0] ?? "your service area";
  return {
    scope_label: scopeLabel,
    display_name: displayName,
    summary:
      office === null
        ? "Configure Claude in /settings to generate a real plan. This is a baseline 40/30/20/10 outline."
        : `Baseline plan for ${displayName} — fill the office market profile to unlock specifics.`,
    pillars: [
      {
        pillar: "local_expert",
        share: 0.4,
        ideas: [
          {
            title: `Market snapshot for ${exampleTown}`,
            why: "Position the office as the local data authority.",
            outcome: "reach",
          },
          {
            title: "What buyers got for $500K vs. $700K this month",
            why: "Concrete price-band education drives saves and shares.",
            outcome: "engagement",
          },
          {
            title: "Three common closing-cost surprises",
            why: "Practical seller-side education builds listing leads.",
            outcome: "listing_leads",
          },
        ],
      },
      {
        pillar: "personal",
        share: 0.3,
        ideas: [
          {
            title: "Day-in-the-life reel from a top agent",
            why: "Faces drive engagement and recruiting interest.",
            outcome: "recruiting",
          },
          {
            title: "Why I joined Alliance — agent-voice quote card",
            why: "Direct recruiting angle.",
            outcome: "recruiting",
          },
        ],
      },
      {
        pillar: "real_estate",
        share: 0.2,
        ideas: [
          {
            title: "Walkthrough reel of the freshest active listing",
            why: "Drives listing visibility and seller credibility.",
            outcome: "listing_leads",
          },
          {
            title: "Just-sold post with quick stat overlay",
            why: "Sold proof builds seller leads.",
            outcome: "listing_leads",
          },
        ],
      },
      {
        pillar: "community",
        share: 0.1,
        ideas: [
          {
            title: "Local event highlight (farmers market, fair, parade)",
            why: "Community presence drives reach.",
            outcome: "reach",
          },
        ],
      },
    ],
    recruiting_angles: [
      "Best-in-class tech stack",
      "Strong local brand recognition",
      "Real training — not just a desk",
    ],
  };
}

function fallbackPlan(
  scope: StrategyScope,
  offices: OfficeRow[],
): StrategyPlan {
  if (scope.kind === "brand_wide") {
    return {
      generated_at: new Date().toISOString(),
      scope,
      sections: [fallbackSection("BRAND", "Brand-wide", null)],
      notes: ["Anthropic API key not configured — showing baseline outline."],
    };
  }
  if (scope.kind === "single_office") {
    const office = offices.find((o) => o.short_code === scope.office_short_code) ?? null;
    return {
      generated_at: new Date().toISOString(),
      scope,
      sections: [
        fallbackSection(
          office?.short_code ?? scope.office_short_code,
          office?.display_name ?? office?.name ?? scope.office_short_code,
          office,
        ),
      ],
      notes: ["Anthropic API key not configured — showing baseline outline."],
    };
  }
  // multi_office
  const sections = scope.office_short_codes.map((code) => {
    const office = offices.find((o) => o.short_code === code) ?? null;
    return fallbackSection(
      office?.short_code ?? code,
      office?.display_name ?? office?.name ?? code,
      office,
    );
  });
  return {
    generated_at: new Date().toISOString(),
    scope,
    sections,
    notes: ["Anthropic API key not configured — showing baseline outline."],
  };
}

function parsePlan(
  raw: string,
): { sections: OfficeStrategySection[]; notes?: string[] } | null {
  const parsed = extractJson(raw) as ModelPlanShape | null;
  if (!parsed || !Array.isArray(parsed.sections)) return null;
  const sections: OfficeStrategySection[] = parsed.sections.map((s) => ({
    scope_label: typeof s.scope_label === "string" ? s.scope_label : "BRAND",
    display_name: typeof s.display_name === "string" ? s.display_name : "Brand-wide",
    summary: typeof s.summary === "string" ? s.summary : "",
    pillars: (s.pillars ?? []).map((p) => ({
      pillar: asPillar(p.pillar),
      share: typeof p.share === "number" && Number.isFinite(p.share) ? p.share : 0,
      ideas: (p.ideas ?? []).map((i) => ({
        title: typeof i.title === "string" ? i.title : "Idea",
        why: typeof i.why === "string" ? i.why : "",
        outcome: asOutcome(i.outcome),
      })),
    })),
    recruiting_angles: Array.isArray(s.recruiting_angles)
      ? s.recruiting_angles.filter((x): x is string => typeof x === "string")
      : [],
  }));
  return {
    sections,
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

interface GenerateStrategyOpts {
  /** When true, don't actually call Anthropic — return the baseline outline. */
  forceFallback?: boolean;
}

export async function generateStrategyPlan(
  scope: StrategyScope,
  opts: GenerateStrategyOpts = {},
): Promise<StrategyPlan> {
  // Always pull the office list — used both for the prompt and as fallback.
  const allOffices = await listOffices({ active_only: true });

  if (opts.forceFallback) {
    return fallbackPlan(scope, allOffices);
  }

  const client = await getAnthropic();
  if (!client) {
    return fallbackPlan(scope, allOffices);
  }

  // Build user prompt by scope.
  let scopeBlock = "";
  if (scope.kind === "brand_wide") {
    scopeBlock = [
      "SCOPE: brand_wide",
      "Generate ONE section labeled BRAND covering all of Century 21 Alliance.",
      "Do NOT make town-specific claims. Speak to themes that apply across all 8 offices.",
    ].join("\n");
  } else if (scope.kind === "single_office") {
    const office = allOffices.find((o) => o.short_code === scope.office_short_code);
    if (!office) {
      return fallbackPlan(scope, allOffices);
    }
    scopeBlock = [
      "SCOPE: single_office",
      `Return ONE section for the office below. Lean on the market profile.`,
      "",
      describeOffice(office),
    ].join("\n");
  } else {
    // multi_office
    const targeted = allOffices.filter((o) =>
      scope.office_short_codes.includes(o.short_code),
    );
    if (targeted.length === 0) {
      return fallbackPlan(scope, allOffices);
    }
    scopeBlock = [
      "SCOPE: multi_office",
      `Return ONE section per office below. Each section's scope_label must be that office's short_code. Do NOT merge offices.`,
      "",
      targeted.map(describeOffice).join("\n\n---\n\n"),
    ].join("\n");
  }

  const userPrompt = [
    scopeBlock,
    "",
    "Build the week's content plan. Return only the JSON object.",
  ].join("\n");

  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODELS.opus,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = parsePlan(raw);
    if (!parsed || parsed.sections.length === 0) {
      console.error("[strategy] failed to parse opus output:", raw.slice(0, 600));
      return fallbackPlan(scope, allOffices);
    }
    return {
      generated_at: new Date().toISOString(),
      scope,
      sections: parsed.sections,
      notes: parsed.notes,
    };
  } catch (e) {
    console.error("[strategy] anthropic call failed:", e);
    return fallbackPlan(scope, allOffices);
  }
}
