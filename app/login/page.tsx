import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const metadata = {
  title: "Sign in — Alliance Social",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-neutral-25">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gold-500 text-white text-lg font-semibold tracking-tight">
            A
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Alliance Social
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Century 21 Alliance · Social analytics
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          <Suspense fallback={<div className="h-40" />}>
            <LoginForm searchParamsPromise={searchParams} />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Accounts are provisioned by your administrator.
        </p>
      </div>
    </div>
  );
}
