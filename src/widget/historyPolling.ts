/** The open chat stays near-live; a closed panel only needs to keep presence
    alive (ticket 59): the frame ticks the 3-second interval and this gate
    decides whether a tick actually fetches — closed panels wait for the
    30-second cadence, hidden host pages wait entirely, and an in-flight
    request blocks another from starting. */
export const OPEN_HISTORY_INTERVAL_MS = 3000;
export const CLOSED_HISTORY_INTERVAL_MS = 30_000;

export function historyPollDue({
  hasSession,
  visible,
  inFlight,
  open,
  lastRequestAt,
  now,
  immediate = false,
}: {
  hasSession: boolean;
  visible: boolean;
  inFlight: boolean;
  open: boolean;
  lastRequestAt: number;
  now: number;
  immediate?: boolean;
}): boolean {
  if (!hasSession || !visible || inFlight) {
    return false;
  }
  return immediate || now - lastRequestAt >= (open ? OPEN_HISTORY_INTERVAL_MS : CLOSED_HISTORY_INTERVAL_MS);
}
