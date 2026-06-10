import Link from "next/link";

/**
 * Root 404 page. Renders inside the root layout (Barlow + globals.css
 * are available), so Tailwind tokens work here.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="eyebrow mb-2">Alliance Social</div>
        <div className="text-5xl font-semibold tracking-tight text-gold-500">
          404
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-neutral-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          The page you are looking for does not exist or may have moved.
        </p>
        <div className="mt-6">
          <Link href="/" className="btn-primary">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
