/**
 * What the visitor is told when a conversation ends, however it ends: staff
 * closure and the visitor's own Clear conversation action (ticket 14) both
 * append this to the transcript so the staff-side record shows where the
 * conversation stopped.
 */
export const CLOSING_NOTICE =
  "This conversation has been closed. If you need anything else, just ask a new question and we will pick it up from there.";

/**
 * Ticket 66's server-side gate: a conversation accepts visitor messages and
 * topic choices only once all three contact details are accepted there.
 * Legacy rows from before the gate, and the locked successor that Clear chat
 * creates, carry nulls until the contact endpoint accepts details — so
 * hiding the widget's controls alone can never bypass the requirement.
 */
export function hasAcceptedContact(conversation: {
  visitorName: string | null;
  visitorEmail: string | null;
  visitorPhone: string | null;
}): boolean {
  return (
    conversation.visitorName !== null &&
    conversation.visitorEmail !== null &&
    conversation.visitorPhone !== null
  );
}
