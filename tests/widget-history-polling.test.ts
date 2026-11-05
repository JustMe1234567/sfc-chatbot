import { describe, expect, it } from "vitest";
import {
  CLOSED_HISTORY_INTERVAL_MS,
  historyPollDue,
  OPEN_HISTORY_INTERVAL_MS,
} from "../src/widget/historyPolling";
import { VISITOR_PRESENCE_WINDOW_MS } from "../src/domain/limits";

function countHour(open: boolean, visible: boolean, hasSession: boolean): number {
  let lastRequestAt = 0;
  let requests = 0;
  for (let now = OPEN_HISTORY_INTERVAL_MS; now <= 3_600_000; now += OPEN_HISTORY_INTERVAL_MS) {
    if (historyPollDue({ hasSession, visible, inFlight: false, open, lastRequestAt, now })) {
      requests += 1;
      lastRequestAt = now;
    }
  }
  return requests;
}

describe("widget history request cadence", () => {
  it("keeps the open chat near-live and cuts closed-panel requests tenfold", () => {
    expect(countHour(true, true, true)).toBe(1200);
    expect(countHour(false, true, true)).toBe(120);
    expect(CLOSED_HISTORY_INTERVAL_MS).toBeLessThan(VISITOR_PRESENCE_WINDOW_MS);
  });

  it("makes no periodic history requests without a session or when hidden", () => {
    expect(countHour(true, true, false)).toBe(0);
    expect(countHour(false, false, true)).toBe(0);
  });

  it("fetches immediately on reopen or visibility return without overlapping", () => {
    const state = {
      hasSession: true,
      visible: true,
      open: false,
      lastRequestAt: 29_000,
      now: 30_000,
    };
    expect(historyPollDue({ ...state, immediate: false, inFlight: false })).toBe(false);
    expect(historyPollDue({ ...state, immediate: true, inFlight: false })).toBe(true);
    expect(historyPollDue({ ...state, immediate: true, inFlight: true })).toBe(false);
    expect(historyPollDue({ ...state, immediate: true, inFlight: false, visible: false })).toBe(false);
  });
});
