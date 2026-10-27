/**
 * What the visitor is told when a conversation ends, however it ends: staff
 * closure and the visitor's own Clear conversation action (ticket 14) both
 * append this to the transcript so the staff-side record shows where the
 * conversation stopped.
 */
export const CLOSING_NOTICE =
  "This conversation has been closed. If you need anything else, just ask a new question and we will pick it up from there.";
