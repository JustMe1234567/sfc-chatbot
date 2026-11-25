/**
 * The handoff waiting notice (ticket 103): the small, centered line inside
 * the transcript that tells a visitor their message is with staff while an
 * advisor is joining. Presentation-only — it never becomes a stored message.
 * Staff publish their own wording from the dashboard; everything here is
 * client-safe so the widget can fall back to the default copy.
 */

export const DEFAULT_WAITING_NOTICE = "Staff will reply";

/** A notice is one short line, not an essay. */
export const MAX_WAITING_NOTICE_LENGTH = 280;

export function isValidWaitingNotice(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input.trim().length > 0 &&
    input.trim().length <= MAX_WAITING_NOTICE_LENGTH
  );
}
