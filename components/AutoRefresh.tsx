"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the current server-rendered page on an interval while visible. */
export default function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
