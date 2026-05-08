interface PageHeaderProps {
  title: string;
  description?: string;
  /** Small tag rendered next to the title (e.g. "Coming in Phase 3") */
  phaseTag?: string;
  /** Right-aligned content slot, typically buttons or pill groups */
  actions?: React.ReactNode;
}

export default function PageHeader({
  title,
  description,
  phaseTag,
  actions,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          {phaseTag ? <span className="badge-neutral">{phaseTag}</span> : null}
        </div>
        {description ? (
          <p className="mt-2 text-neutral-600 max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
