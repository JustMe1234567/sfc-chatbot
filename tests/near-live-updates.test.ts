import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 61: active chats update near one second. An open visitor panel
 * checks history every 1s (closed keeps the pre-ticket 3s cadence — ticket
 * 59's 30s closed tier stays gone), a saved chat checks immediately on
 * open, a sessionless visitor fetches nothing, in-flight history requests
 * never stack and stale responses cannot repaint a cleared or replaced
 * chat, the bot answer still rides the send response, and the staff desk
 * refreshes at 1s on the active view (3s on history views) while pausing
 * for hidden tabs and catching up the moment the tab returns.
 */

const FRAME = "src/app/widget/frame/page.tsx";
const LOADER = "src/widget/loader.ts";
const BUILT = "public/widget/v1.js";
const AUTO_REFRESH = "src/app/dashboard/conversations/[id]/auto-refresh.tsx";
const DESK = "src/app/dashboard/inbox/conversation-desk.tsx";

async function read(rel: string): Promise<string> {
  return readFile(path.join(repoRoot(), rel), "utf8");
}

describe("the visitor's polling cadence (ticket 61)", () => {
  it("checks every second while open and the original three while closed", async () => {
    const frame = await read(FRAME);
    // One interval, two cadences, picked by the panel state the loader
    // reports.
    expect(frame).toContain("panelOpen ? 1000 : 3000");
    // Ticket 59's closed tier must stay gone.
    expect(frame).not.toMatch(/30_000|30000/);
    expect(frame).not.toContain("historyPolling");
    // Opening a saved chat checks immediately, not a tick later.
    expect(frame).toMatch(/if \(panelOpen\) \{\s*void refreshHistory\(\);\s*\}/);
    // The tick re-arms on panel transitions and keeps the fresh callback.
    expect(frame).toMatch(/\}, \[panelOpen, refreshHistory\]\);/);
  });

  it("learns the panel state through the loader's ready/state handshake", async () => {
    const frame = await read(FRAME);
    // The frame asks the loader for the current state after hydration and
    // applies only messages the parent window actually sent.
    expect(frame).toContain('window.parent.postMessage({ type: "sfcw:ready" }, "*")');
    expect(frame).toContain('event.data?.type === "sfcw:state"');
    expect(frame).toContain("event.source === window.parent");
    // Standalone (dev preview outside the embed) reads as open.
    expect(frame).toMatch(/if \(window\.parent === window\) \{\s*setPanelOpen\(true\);/);
  });

  it("fetches nothing without a session and never stacks history requests", async () => {
    const frame = await read(FRAME);
    // A fresh visitor has no conversation session: the guard makes every
    // tick a no-op, and a send in flight holds the poller off too (the bot
    // answer arrives with the send response, not a poll).
    expect(frame).toContain("if (!session || sendingRef.current) {");
    // The in-flight latch is keyed by generation and session, so a request
    // for the previous chat never blocks (or answers for) the current one,
    // and only its own key releases the latch in finally.
    expect(frame).toContain("historyRequestRef.current === requestKey");
    expect(frame).toMatch(/const requestKey = `\$\{generation\}:\$\{session\.id\}`;/);
    expect(frame).toMatch(/if \(historyRequestRef\.current === requestKey\) \{\s*historyRequestRef\.current = null;\s*\}/);
    // Stale responses still cannot repaint: both checks gate applyHistory.
    expect(frame).toMatch(
      /if \(generationRef\.current === generation && sessionRef\.current\?\.id === session\.id\) \{\s*applyHistory\(body, animate\);/,
    );
    // The single authorized history endpoint is unchanged.
    expect(frame).toContain("/api/v1/conversations/${encodeURIComponent(session.id)}/messages");
  });

  it("keeps the bot answer on the send request, not a poll", async () => {
    const frame = await read(FRAME);
    // The send path (optimistic bubble, postMessage, inline reply) is
    // ticket 12/18/46 behavior and untouched by this ticket.
    expect(frame).toContain("sendingRef.current = true;");
    expect(frame).toContain("postMessage(session, text, choice)");
    // The visitor's own send still rides the same session credential.
    expect(frame).toContain("Authorization: `Bearer ${session.token}`");
  });
});

describe("the loader reports open state to the frame (ticket 61)", () => {
  it("posts sfcw:state on open, close, and the frame's ready handshake", async () => {
    const loader = await read(LOADER);
    expect(loader).toMatch(/postMessage\(\{ type: "sfcw:state", open: isOpen \}, base\)/);
    expect(loader).toContain("sendOpenState();");
    expect(loader).toMatch(/type === "sfcw:ready"\)\s*\{\s*sendOpenState\(\);/);
    // The close handler keeps its origin check and now also its source
    // check: only the widget iframe's own window can close or query it.
    expect(loader).toContain("event.source !== frame.contentWindow");
  });

  it("ships the handshake in the built loader artifact", async () => {
    const built = await read(BUILT);
    expect(built).toContain("sfcw:state");
    expect(built).toContain("sfcw:ready");
  });
});

describe("the staff desk's near-live refresh (ticket 61)", () => {
  it("refreshes the active view every second and history views every three", async () => {
    const desk = await read(DESK);
    expect(desk).toContain('<AutoRefresh intervalMs={view === "active" ? 1000 : 3000} />');
  });

  it("never stacks refreshes and catches up the moment a hidden tab returns", async () => {
    const autoRefresh = await read(AUTO_REFRESH);
    // The transition latch: a refresh still running suppresses the next
    // tick instead of overlapping it. It is mirrored into a ref so the
    // timer is armed once per cadence — the pending flag in the timer's
    // dependencies would re-arm it on every refresh and stretch each gap.
    expect(autoRefresh).toContain("useTransition()");
    expect(autoRefresh).toMatch(/pendingRef\.current = refreshPending;\s*\}, \[refreshPending\]\);/);
    expect(autoRefresh).toContain('if (document.visibilityState === "visible" && !pendingRef.current)');
    expect(autoRefresh).toContain("}, [router, intervalMs]);");
    // Hidden tabs keep pausing, and visibilitychange triggers the catch-up
    // immediately rather than waiting for the next scheduled tick.
    expect(autoRefresh).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(autoRefresh).toMatch(/function onVisibilityChange\(\): void \{\s*if \(document\.visibilityState === "visible"\) refresh\(\);/);
    // The shared default stays 3s for every other caller.
    expect(autoRefresh).toContain("intervalMs = 3000");
  });
});
