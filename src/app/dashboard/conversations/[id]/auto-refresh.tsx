"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Authorized polling for the staff side: refreshes the server-rendered
 * transcript so new visitor messages appear promptly. Missed messages are
 * recovered from the stored conversation on every refresh.
 */
export default function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [refreshPending, startRefresh] = useTransition();
  // A refresh still settling suppresses the next tick instead of stacking
  // on it (ticket 61). The latch mirrors the transition into a ref so the
  // interval is armed once per cadence — keeping the pending flag in the
  // effect's dependencies re-armed the timer on every refresh, stretching
  // each gap by the refresh's own round trip.
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = refreshPending;
  }, [refreshPending]);
  useEffect(() => {
    function refresh(): void {
      if (document.visibilityState === "visible" && !pendingRef.current) {
        startRefresh(() => router.refresh());
      }
    }
    const timer = setInterval(refresh, intervalMs);
    // A hidden tab catches up as soon as staff return, instead of waiting
    // for the next scheduled tick.
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalMs]);
  return null;
}
