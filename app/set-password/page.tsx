import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { peekAccountLink } from "@/lib/auth-links/account-links";
import SetPasswordForm from "./SetPasswordForm";

export const metadata = {
  title: "Set your password — Alliance Social Analytics",
  robots: { index: false, follow: false },
  // Keep the token out of Referer headers.
  referrer: "no-referrer" as const,
};
export const dynamic = "force-dynamic";

const DEAD_LINK_COPY: Record<string, string> = {
  missing: "This link isn't valid.",
  used: "This link has already been used.",
  expired: "This link has expired.",
  disabled: "This account is disabled.",
};

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  // Read-only check. The token is only consumed when the form is submitted,
  // so a mail scanner opening this URL does not burn it.
  const peek = await peekAccountLink(token);

  if (!peek.valid) {
    return (
      <AuthShell title="That link won't work">
        <p className="text-sm text-neutral-700">{DEAD_LINK_COPY[peek.reason]}</p>
        {peek.reason !== "disabled" ? (
          <Link
            href="/forgot-password"
            className="btn-primary w-full mt-5 inline-flex justify-center"
          >
            Email me a new link
          </Link>
        ) : null}
        <p className="mt-4 text-center text-xs text-neutral-500">
          <Link href="/login" className="hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  const isInvite = peek.kind === "invite";
  const first = (peek.fullName ?? "").trim().split(/\s+/)[0];

  return (
    <AuthShell
      title={
        isInvite
          ? first
            ? `Welcome, ${first}`
            : "Welcome"
          : "Reset your password"
      }
    >
      <SetPasswordForm token={token} email={peek.email} isInvite={isInvite} />
    </AuthShell>
  );
}
