"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Authorized polling for the staff side: refreshes the server-rendered
 * transcript so new visitor messages appear promptly. Missed messages are
 * recovered from the stored conversation on every refresh.
 */
export default function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
