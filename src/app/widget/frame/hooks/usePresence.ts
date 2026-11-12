"use client";

import { useEffect } from "react";
import { startPresenceHeartbeat } from "@/widget/presence";

/**
 * Anonymous presence (ticket 17): the embedded page beats while it is
 * actually visible, so staff see browsers on the site — not only visitors
 * who opened the chat, and never a background tab. This iframe is mounted
 * for the page's life whether or not the chat is open, so liveness follows
 * page visibility, not the frame's; a hidden page stops beating at once.
 * The identifier is a random UUID in this origin's localStorage, shared by
 * the visitor's tabs and rotated on the server's retention schedule.
 */
export function usePresence(): void {
  useEffect(() => {
    return startPresenceHeartbeat({
      storage: window.localStorage,
      visibility: () => document.visibilityState,
      send: async (browserId) => {
        const response = await fetch("/api/v1/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ browserId }),
        });
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as { retentionDays?: number };
      },
    });
  }, []);
}
