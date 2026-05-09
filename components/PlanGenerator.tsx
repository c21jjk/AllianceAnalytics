"use client";

import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import {
  generatePlanAction,
  type PlanScopeKind,
} from "@/app/(app)/coach/actions";
import type {
  ContentPillar,
  OfficeStrategySection,
  StrategyPlan,
} from "@/lib/ai/strategy";

interface OfficeOption {
  short_code: string;
  display_name: string;
}

interface PlanGeneratorProps {
  offices: OfficeOption[];
}

const PILLAR_LABELS: Record<ContentPillar, string> = {
  local_expert: "Local expert (40%)",
  personal: "Personal (30%)",
  real_estate: "Real estate (20%)",
  community: "Community (10%)",
};

const OUTCOME_LABELS: Record<string, string> = {
  reach: "Reach",
  engagement: "Engagement",
  listing_leads: "Listing leads",
  recruiting: "Recruiting",
};

export default function PlanGenerator({ offices }: PlanGeneratorProps) {
  const [scope, setScope] = useState<PlanScopeKind>("brand_wide");
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [plan, setPlan] = useState<StrategyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const showOfficePicker = scope !== "brand_wide";
  const buttonDisabled =
    isPending ||
    (scope === "single_office" && selectedCodes.length !== 1) ||
    (scope === "multi_office" && selectedCodes.length === 0);

  const buttonLabel = useMemo(() => {
    if (isPending) return "Thinking…";
    return "Generate this week's plan";
  }, [isPending]);

  function toggleOffice(code: string, mode: "single" | "multi") {
    if (mode === "single") {
      setSelectedCodes([code]);
    } else {
      setSelectedCodes((prev) =>
        prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
      );
    }
  }

  function handleScopeChange(next: PlanScopeKind) {
    setScope(next);
    setSelectedCodes([]);
    setPlan(null);
    setError(null);
  }

  function handleGenerate() {
    setError(null);
    setPlan(null);
    startTransition(async () => {
      const result = await generatePlanAction(scope, selectedCodes);
      if (!result.ok || !result.plan) {
        setError(result.error ?? "Could not generate plan.");
        return;
      }
      setPlan(result.plan);
    });
  }

  return (
    <section
      className="rounded-xl border border-gold-200 bg-gradient-to-br from-gold-50 via-white to-white shadow-card p-5"
      aria-labelledby="plan-heading"
    >
      <header className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white text-gold-700 ring-1 ring-gold-200">
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
          </svg>
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-gold-700">
          Claude AI strategy
        </span>
      </header>

      <h2
        id="plan-heading"
        className="mt-2.5 text-base md:text-lg font-semibold tracking-tight text-neutral-900"
      >
        Generate this week&apos;s plan
      </h2>
      <p className="mt-1 text-sm text-neutral-600 max-w-2xl">
        Pick a scope. Brand-wide plans speak to common themes; office-scoped
        plans lean on each office&apos;s towns, demos, seasonality, and
        signature angles.
      </p>

      {/* Scope picker */}
      <div className="mt-4 flex flex-wrap gap-2">
        <ScopeChip
          active={scope === "brand_wide"}
          onClick={() => handleScopeChange("brand_wide")}
          label="Brand-wide"
        />
        <ScopeChip
          active={scope === "single_office"}
          onClick={() => handleScopeChange("single_office")}
          label="By office"
        />
        <ScopeChip
          active={scope === "multi_office"}
          onClick={() => handleScopeChange("multi_office")}
          label="Pick offices"
        />
      </div>

      {/* Office picker */}
      {showOfficePicker ? (
        <div className="mt-3 rounded-lg ring-1 ring-neutral-200 bg-white p-3">
          <div className="text-xs font-medium text-neutral-700">
            {scope === "single_office" ? "Pick one office" : "Pick offices"}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {offices.length === 0 ? (
              <span className="text-xs text-neutral-500">
                No active offices. Add some in /settings/offices.
              </span>
            ) : (
              offices.map((o) => {
                const checked = selectedCodes.includes(o.short_code);
                return (
                  <button
                    key={o.short_code}
                    type="button"
                    onClick={() =>
                      toggleOffice(
                        o.short_code,
                        scope === "single_office" ? "single" : "multi",
                      )
                    }
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-md ring-1 px-2 py-1 text-xs font-medium",
                      checked
                        ? "bg-gold-50 ring-gold-300 text-gold-800"
                        : "bg-white ring-neutral-200 text-neutral-700 hover:bg-neutral-50",
                    )}
                    aria-pressed={checked}
                  >
                    <span
                      className={clsx(
                        "inline-block w-3 h-3 rounded-sm ring-1",
                        checked
                          ? "bg-gold-500 ring-gold-500"
                          : "bg-white ring-neutral-300",
                      )}
                    />
                    {o.display_name}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={buttonDisabled}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
            buttonDisabled
              ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
              : "bg-gold-500 text-white hover:bg-gold-600",
          )}
        >
          {buttonLabel}
        </button>
        {error ? (
          <span className="text-xs text-rose-700">{error}</span>
        ) : null}
      </div>

      {/* Result */}
      {plan ? (
        <div className="mt-5 space-y-4">
          {plan.notes && plan.notes.length > 0 ? (
            <div className="rounded-md bg-amber-50 ring-1 ring-amber-100 px-3 py-2 text-xs text-amber-800">
              {plan.notes.join(" · ")}
            </div>
          ) : null}
          {plan.sections.map((section) => (
            <PlanSection key={section.scope_label} section={section} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ScopeChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors",
        active
          ? "bg-neutral-900 text-white ring-neutral-900"
          : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50",
      )}
    >
      {label}
    </button>
  );
}

function PlanSection({ section }: { section: OfficeStrategySection }) {
  return (
    <article className="rounded-xl ring-1 ring-neutral-200 bg-white p-4">
      <header>
        <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          {section.scope_label}
        </div>
        <h3 className="text-base font-semibold text-neutral-900">
          {section.display_name}
        </h3>
        {section.summary ? (
          <p className="mt-1 text-sm text-neutral-600">{section.summary}</p>
        ) : null}
      </header>

      <div className="mt-3 space-y-3">
        {section.pillars.map((p) => (
          <div
            key={p.pillar}
            className="rounded-lg bg-neutral-50 ring-1 ring-neutral-200 p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-xs font-semibold text-neutral-800">
                {PILLAR_LABELS[p.pillar]}
              </div>
              <div className="text-[11px] text-neutral-500 tabular-nums">
                {Math.round(p.share * 100)}% share
              </div>
            </div>
            <ul className="mt-2 space-y-2">
              {p.ideas.map((idea, i) => (
                <li
                  key={`${p.pillar}-${i}`}
                  className="rounded-md bg-white ring-1 ring-neutral-200 p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-neutral-900">
                      {idea.title}
                    </div>
                    <span className="shrink-0 inline-flex items-center rounded-full bg-gold-50 ring-1 ring-gold-200 text-gold-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {OUTCOME_LABELS[idea.outcome] ?? idea.outcome}
                    </span>
                  </div>
                  {idea.why ? (
                    <p className="mt-1 text-xs text-neutral-600 leading-relaxed">
                      {idea.why}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {section.recruiting_angles.length > 0 ? (
        <div className="mt-3 rounded-lg ring-1 ring-neutral-200 p-3">
          <div className="text-xs font-semibold text-neutral-800">
            Recruiting angles
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {section.recruiting_angles.map((a, i) => (
              <li
                key={i}
                className="inline-flex items-center rounded-md bg-white ring-1 ring-neutral-200 px-2 py-0.5 text-xs text-neutral-700"
              >
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
