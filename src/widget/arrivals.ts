/**
 * Which messages get the arrival treatment (ticket 15). Kept pure so the
 * "only when new" rule is unit-testable: restoring history and every polling
 * refresh must never replay the entrance animation, and the persisted twin
 * of a just-sent optimistic bubble must not re-animate either.
 */

export interface ArrivalMessage {
  id: string;
  role: string;
  text: string;
}

/** A message's identity for arrival purposes: role and words, not id — the
    persisted twin of a local bubble gets a fresh id from the server. */
export function messageKey(role: string, text: string): string {
  return `${role}|${text}`;
}

export interface ArrivalState {
  /** Keys of every message ever shown on screen. */
  known: Set<string>;
}

export function emptyArrivalState(): ArrivalState {
  return { known: new Set() };
}

/**
 * Folds a full incoming message list into the arrival state. `animate` is
 * false while restoring history (and after a clear, which starts from an
 * empty state) and true for live additions; either way every incoming key
 * becomes known, so later refreshes of the same list replay nothing.
 * Consequence of the word-based key: a genuinely new message whose role and
 * words repeat something already shown arrives silently — the cosmetic cost
 * of never re-animating the persisted twin of an optimistic bubble.
 */
export function nextArrivalState(
  state: ArrivalState,
  incoming: ArrivalMessage[],
  animate: boolean,
): { state: ArrivalState; arrivals: Set<string> } {
  const known = new Set(state.known);
  const arrivals = new Set<string>();
  for (const message of incoming) {
    const key = messageKey(message.role, message.text);
    if (!known.has(key)) {
      if (animate) {
        arrivals.add(message.id);
      }
      known.add(key);
    }
  }
  return { state: { known }, arrivals };
}
