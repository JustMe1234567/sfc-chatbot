/**
 * The fresh-chat greeting (ticket 41): shown inside the transcript when the
 * widget opens with nothing in it. Presentation-only — the greeting never
 * becomes a stored message, and opening the widget creates no conversation.
 * Editors publish their own wording from the dashboard; everything here is
 * client-safe so the widget can fall back to the default copy.
 */

export const DEFAULT_WELCOME_MESSAGE = "Hi! How can I help you today?";

/** A greeting is one short line, not an essay. */
export const MAX_WELCOME_LENGTH = 280;

export function isValidWelcomeMessage(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input.trim().length > 0 &&
    input.trim().length <= MAX_WELCOME_LENGTH
  );
}
