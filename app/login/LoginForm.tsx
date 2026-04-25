"use client";

import { use, useState, useTransition } from "react";
import { signIn } from "./actions";

export default function LoginForm({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ next?: string }>;
}) {
  const params = use(searchParamsPromise);
  const next = params.next ?? "/";

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await signIn(formData);
      if (!res?.ok && res?.error) {
        setError(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
          placeholder="you@example.com"
          disabled={isPending}
        />
      </div>

      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          placeholder="••••••••"
          disabled={isPending}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
        >
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={isPending} className="btn-primary w-full">
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
