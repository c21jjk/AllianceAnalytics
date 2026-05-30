export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: "Unsubscribed", robots: { index: false } };
}

/**
 * Confirmation page shown after a seller clicks the one-click unsubscribe link
 * in their Owner Story email. The removal already happened in the API route;
 * this page just confirms it.
 */
export default function UnsubscribedPage() {
  return (
    <main className="mx-auto max-w-lg px-5 py-16 text-center">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-neutral-900">
          You&apos;re unsubscribed
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          You won&apos;t receive any more weekly Owner Story emails. If this was
          a mistake, just ask your agent to add you back any time.
        </p>
      </div>
    </main>
  );
}
