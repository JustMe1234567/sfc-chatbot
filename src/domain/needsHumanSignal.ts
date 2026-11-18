/**
 * The needs-human bell's polling signal (ticket 79), timing- and parse-free
 * of the DOM exactly like the alert cycle (ticket 77): one poll reads the
 * staff-only boolean endpoint, but only while the tab is visible, and a
 * failed or unparseable answer keeps the last state — the bell never
 * flashes off because one request failed. The fetch, the visibility check,
 * and the state sink are injectable so the wiring is testable without a
 * browser.
 */

/** The sidebar's poll cadence while the tab is visible (ticket 79). */
export const NEEDS_HUMAN_POLL_MS = 10_000;

export interface NeedsHumanSignalOptions {
  /** One request for the signal — the raw response, so parse failures
   *  (a non-boolean payload, a network error) count as "no answer". */
  fetchResponse(): Promise<Response>;
  /** Whether the tab is visible right now; hidden tabs poll nothing. */
  visible(): boolean;
  /** Delivers a fresh, verified state. Never called with "no answer". */
  adopt(needsHuman: boolean): void;
}

export interface NeedsHumanSignal {
  /** Run one poll now: skipped entirely while hidden; a failure or a
   *  non-boolean body adopts nothing, leaving the previous state shown. */
  poll(): Promise<void>;
}

export function createNeedsHumanSignal(options: NeedsHumanSignalOptions): NeedsHumanSignal {
  async function poll(): Promise<void> {
    if (!options.visible()) return;
    let next: boolean | null = null;
    try {
      const response = await options.fetchResponse();
      if (response.ok) {
        const body = (await response.json()) as { needsHuman?: unknown };
        if (typeof body.needsHuman === "boolean") {
          next = body.needsHuman;
        }
      }
    } catch {
      // Unreachable server or a junk body: silence, not a state change.
    }
    if (next !== null) {
      options.adopt(next);
    }
  }
  return { poll };
}
