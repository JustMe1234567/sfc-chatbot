import { describe, expect, it } from "vitest";
import {
  emptyArrivalState,
  messageKey,
  nextArrivalState,
  type ArrivalMessage,
} from "../src/widget/arrivals";

/**
 * The widget's message-arrival decisions (ticket 15): a brief entrance
 * treatment only for messages that are genuinely new on screen. Restoring
 * history, every polling refresh, and the server's confirmation of a
 * just-sent optimistic message must never replay the animation.
 */

function msg(id: string, role: string, text: string): ArrivalMessage {
  return { id, role, text };
}

describe("message arrivals", () => {
  it("marks nothing new on the initial history load while learning the keys", () => {
    let state = emptyArrivalState();
    ({ state } = nextArrivalState(state, [msg("a", "bot", "Hello"), msg("b", "visitor", "Hi")], false));
    expect(state.known.has(messageKey("bot", "Hello"))).toBe(true);
    expect(state.known.has(messageKey("visitor", "Hi"))).toBe(true);
  });

  it("marks a genuinely new polled message as arriving exactly once", () => {
    let state = emptyArrivalState();
    ({ state } = nextArrivalState(state, [msg("a", "bot", "Hello")], false));
    const polled = nextArrivalState(state, [
      msg("a", "bot", "Hello"),
      msg("b", "staff", "We will check that for you."),
    ], true);
    expect([...polled.arrivals]).toEqual(["b"]);
    // The next refresh of the same list replays nothing.
    const again = nextArrivalState(polled.state, [
      msg("a", "bot", "Hello"),
      msg("b", "staff", "We will check that for you."),
    ], true);
    expect(again.arrivals.size).toBe(0);
  });

  it("stays silent when the server confirms a just-sent optimistic message", () => {
    let state = emptyArrivalState();
    // The visitor's send renders a local bubble immediately, animated.
    const sent = nextArrivalState(state, [msg("local-1", "visitor", "Is the library open?")], true);
    expect([...sent.arrivals]).toEqual(["local-1"]);
    // Polling replaces the local bubble with the persisted twin: same words,
    // different id. The twin must not re-animate.
    const confirmed = nextArrivalState(sent.state, [msg("srv-9", "visitor", "Is the library open?")], true);
    expect(confirmed.arrivals.size).toBe(0);
  });

  it("keeps working when a conversation is cleared and a fresh chat starts", () => {
    let state = emptyArrivalState();
    ({ state } = nextArrivalState(state, [msg("a", "bot", "Hello")], false));
    // The visitor's Clear conversation (ticket 14) swaps to a fresh chat:
    // the arrival state starts over from empty.
    const fresh = nextArrivalState(emptyArrivalState(), [msg("b", "bot", "Fresh greeting")], true);
    expect([...fresh.arrivals]).toEqual(["b"]);
    expect(fresh.state.known.has(messageKey("bot", "Hello"))).toBe(false);
  });

  it("treats the same words from different roles as different messages", () => {
    let state = emptyArrivalState();
    ({ state } = nextArrivalState(state, [msg("a", "visitor", "Thanks")], true));
    const staffed = nextArrivalState(state, [
      msg("a", "visitor", "Thanks"),
      msg("b", "staff", "Thanks"),
    ], true);
    expect([...staffed.arrivals]).toEqual(["b"]);
  });
});
