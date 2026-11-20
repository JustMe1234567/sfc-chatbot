import { isWithinSupportHours, scheduleSummary } from "./hours";
import type { ContactMedium, SupportHours } from "./types";

/**
 * The persisted handoff confirmation (ticket 69): a clicked Handoff Option
 * or a typed Handoff phrase no longer escalates immediately — the visitor's
 * wording is recorded and this question is asked, with two descriptive
 * actions. Nothing alerts and no contact request exists until they choose.
 */
export const HANDOFF_PROMPT_TEXT = "Would you like a staff member to join this chat?";

export const HANDOFF_YES_CHOICE = { id: "handoff-yes", topic: "Yes, chat with staff" };
export const HANDOFF_NO_CHOICE = { id: "handoff-no", topic: "No, contact me another way" };

/** The No path's follow-up: the two alternative media, as choices. */
export const CONTACT_MEDIUM_PROMPT_TEXT = "How would you like us to reach you?";

export const CONTACT_EMAIL_CHOICE = { id: "contact-email", topic: "Email" };
export const CONTACT_PHONE_CHOICE = { id: "contact-phone", topic: "Phone" };

/**
 * The truthful reply when a request is already open and the visitor asks
 * for contact again (ticket 69): no second prompt, no duplicate request.
 */
export function contactRequestOpenReply(): string {
  return "Our team already has your contact request and will follow up with you.";
}

/**
 * Masks an email address for confirmation copy: the first character of the
 * local part plus the full domain — "j*****@example.org". Too-short local
 * parts mask entirely. The widget form's validation guarantees a real
 * address shape, but a malformed value degrades to asterisks rather than
 * throwing.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    return "*".repeat(Math.min(email.length || 1, 12));
  }
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const kept = local.slice(0, 1);
  return `${kept}${"*".repeat(Math.max(local.length - 1, 3))}${domain}`;
}

/**
 * Masks a phone number for confirmation copy: only the last four digits
 * stay readable — "******0199". Non-digit scaffolding is dropped so the
 * masked value can't reconstruct the formatting.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const tail = digits.slice(-4);
  const maskedLength = Math.max(digits.length - 4, 6);
  return `${"*".repeat(maskedLength)}${tail}`;
}

/**
 * The bot's confirmation after a visitor requests contact by email or phone
 * (ticket 69): it names the medium with a masked version of the saved
 * destination, confirms the request was saved, and stays honest about
 * support hours — on duty (or unconfigured) it promises no timing; off duty
 * it names the schedule. Deterministic in `now` so tests can sit on
 * schedule boundaries. No chatbot message is added when staff complete the
 * request — this confirmation is the request's only bot reply.
 */
export function contactRequestConfirmation(
  medium: Exclude<ContactMedium, "chat">,
  destination: string,
  hours: SupportHours | null,
  now: Date = new Date(),
): string {
  const masked = medium === "email" ? maskEmail(destination) : maskPhone(destination);
  const verb = medium === "email" ? "email" : "call";
  const lead = `Thanks — our team will ${verb} you at ${masked}.`;
  if (hours && !isWithinSupportHours(hours, now)) {
    return `${lead} Staff answer chats ${scheduleSummary(hours)}; they will follow up when the desk is open.`;
  }
  return `${lead} Someone from our team will follow up as soon as they can.`;
}
