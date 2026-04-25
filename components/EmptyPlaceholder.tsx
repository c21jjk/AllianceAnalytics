export default function EmptyPlaceholder({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="card p-8 sm:p-10 text-center">
      <div className="mx-auto w-10 h-10 rounded-full bg-gold-50 text-gold-600 flex items-center justify-center mb-3">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
          <path
            d="M12 8v4m0 4h.01M3 12a9 9 0 1118 0 9 9 0 01-18 0z"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h3 className="font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1.5 text-sm text-neutral-500 max-w-md mx-auto">{body}</p>
    </div>
  );
}
