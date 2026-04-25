export default function PageHeader({
  title,
  description,
  phaseTag,
}: {
  title: string;
  description?: string;
  phaseTag?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
          {title}
        </h1>
        {phaseTag ? <span className="badge-neutral">{phaseTag}</span> : null}
      </div>
      {description ? (
        <p className="mt-2 text-neutral-600 max-w-2xl">{description}</p>
      ) : null}
    </div>
  );
}
