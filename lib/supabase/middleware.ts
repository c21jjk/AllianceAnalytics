/**
 * Helper used by middleware.ts to refresh Supabase auth cookies
 * on every request, so server components see fresh session state.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

const PUBLIC_PATHS = new Set<string>([
  "/login",
  // why: privacy + terms URLs required by Meta App Review and TikTok app
  // registration. Must be reachable by Meta's reviewer (logged out) and by
  // anyone evaluating the app's data handling policy.
  "/privacy",
  "/terms",
]);

// Public path prefixes — anything starting with these resolves without auth.
// `/r/` is the legacy Compass-style report view; `/home/` is the new
// owner-facing story view. Both are bearer-auth via long random tokens in
// the URL — anyone with the link can read, by design.
//
// `/render/template/` is the Template Builder's server-render landing page;
// headless Chromium hits this URL with an HMAC-signed token that the route
// verifies. There's no session cookie inside Chromium so the route MUST be
// auth-free (the token is the auth). See lib/template-builder/render-token.ts.
//
// (Note: `/outbox` is intentionally NOT here — it's an admin-only surface.)
const PUBLIC_PATH_PREFIXES = ["/r/", "/home/", "/render/"];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // API routes authenticate themselves (requireUser/requireAdmin/
  // getCurrentProfile/CRON_SECRET/signed tokens). The middleware redirect
  // must never apply here: Vercel cron sends no session cookie, so the old
  // behavior 307'd every /api/cron/* call to /login and the handlers never
  // ran (verified 2026-06-10: all five crons had never executed). Session
  // cookie refresh above still applies; only the redirect is skipped.
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/favicon")) return true;
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  // Public assets in /public/* are served before middleware in most cases,
  // but be permissive about file-extension paths just in case.
  if (/\.[a-zA-Z0-9]{2,5}$/.test(pathname)) return true;
  return false;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient() and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Unauthenticated → bounce to /login (preserve intended destination).
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") {
      url.searchParams.set("next", pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }

  // Authenticated user hitting /login → send to dashboard.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
