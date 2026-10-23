import type { ChatbotService } from "../db/service";
import {
  deliverNotification,
  hasVisitorReturnNotification,
  insertVisitorReturnRow,
} from "./notifications";
import { visitorDeparted } from "../domain/limits";
import { createSessionToken, hashSessionToken, returnLinkExpiry } from "../domain/tokens";
import { appBaseUrl } from "../config";
import type { Conversation, Store } from "../domain/types";

/**
 * Mints one fresh return link: a random single-use token whose hash (and
 * nothing else) is stored, wrapped in the public /return URL. Called at
 * delivery and again at staff retry, so every emailed link is newly minted
 * and no raw token is ever persisted anywhere.
 */
export async function mintReturnLink(
  store: Store,
  conversationId: string,
): Promise<string> {
  const rawToken = createSessionToken();
  const now = new Date().toISOString();
  await store.createReturnToken({
    tokenHash: hashSessionToken(rawToken),
    conversationId,
    createdAt: now,
    expiresAt: returnLinkExpiry(),
  });
  return `${appBaseUrl()}/return?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Ticket 07's single decision point, called after a staff reply lands: email
 * the visitor a secure return link only when they have left the page and left
 * an address, and at most once per conversation. The notification slot is
 * claimed before any token is minted, so racing replies can never produce a
 * second link, and the minted token only exists inside the emailed link.
 */
export async function maybeSendVisitorReturn(
  service: ChatbotService,
  conversation: Conversation,
): Promise<void> {
  if (!conversation.visitorEmail) {
    return;
  }
  if (!visitorDeparted(conversation)) {
    return;
  }
  const notificationId = insertVisitorReturnRow(
    service.db,
    conversation.id,
    conversation.visitorEmail,
  );
  if (!notificationId) {
    // A return notification already exists; never email twice.
    return;
  }
  await deliverNotification(service.db, service.mail, notificationId, (conversationId) =>
    mintReturnLink(service.store, conversationId),
  );
}

export { hasVisitorReturnNotification };
