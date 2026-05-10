interface PageHeaderProps {
  title: string;
  description?: string;
  /** Small uppercase eyebrow above the title (e.g. "Properties · 21 active") */
  eyebrow?: string;
  /** Small tag rendered next to the title (e.g. "Coming in Phase 3") */
  phaseTag?: string;
  /** Right-aligned content slot, typically buttons or pill groups */
  actions?: React.ReactNode;
}

/**
 * Executive-feel page header. Small uppercase eyebrow + larger title with
 * a thin gold accent bar to its left. Description sits below in a comfortable
 * reading width. Actions slot floats right.
 */
export default function PageHeader({
  title,
  description,
  eyebrow,
  phaseTag,
  actions,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-700 mb-1.5">
            {eyebrow}
          </div>
        ) : null}
        <div className="flex items-center gap-3 flex-wrap">
          <span
            aria-hidden="true"
            className="hidden sm:block w-1 h-7 md:h-8 rounded-full bg-gradient-to-b from-gold-400 to-gold-600 shrink-0"
          />
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          {phaseTag ? <span className="badge-neutral">{phaseTag}</span> : null}
        </div>
        {description ? (
          <p className="mt-2 text-neutral-600 max-w-2xl pl-0 sm:pl-4">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
