import type { DatabaseSync } from "node:sqlite";
import { getAlertRecipients } from "../settings";
import type { MailTransport } from "./outbox";
import { appBaseUrl } from "../config";

export interface NotificationRow {
  id: string;
  type: string;
  conversationId: string;
  recipients: string[];
  deliveredTo: string[];
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface NotificationRecord {
  id: string;
  type: string;
  conversation_id: string;
  recipients: string;
  delivered_to: string;
  status: NotificationRow["status"];
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

const NOTIFICATION_COLUMNS =
  "id, type, conversation_id, recipients, delivered_to, status, attempts, last_error, created_at, sent_at";

function rowToNotification(row: NotificationRecord): NotificationRow {
  return {
    id: row.id,
    type: row.type,
    conversationId: row.conversation_id,
    recipients: JSON.parse(row.recipients) as string[],
    deliveredTo: JSON.parse(row.delivered_to) as string[],
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

function fetchNotification(db: DatabaseSync, id: string): NotificationRecord | undefined {
  return db
    .prepare(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE id = ?`)
    .get(id) as unknown as NotificationRecord | undefined;
}

function listRows(db: DatabaseSync): NotificationRow[] {
  const rows = db
    .prepare(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications ORDER BY created_at DESC`)
    .all() as unknown as NotificationRecord[];
  return rows.map(rowToNotification);
}

function alertBody(conversationId: string, receivedAt: string): string {
  const inboxLink = `${appBaseUrl()}/dashboard/conversations/${conversationId}`;
  return [
    "A visitor question in the college website chat needs a staff answer.",
    "",
    `Open the conversation: ${inboxLink}`,
    "",
    `Received: ${receivedAt}`,
    "",
    "This alert is sent once per conversation; sign in to the staff dashboard to reply.",
    "You are receiving this because you are on the chat staff alert list.",
  ].join("\n");
}

/**
 * The single escalation alert for a conversation. The unique
 * (type, conversation_id) index makes duplicate calls no-ops, so retries and
 * repeated escalations can never produce a second alert row. Escalations that
 * happen before the owner configures recipients still get a row — visible as
 * pending so the escalation is never silently lost — and staff retry delivers
 * to whoever is configured at retry time.
 */
export async function recordEscalationAlert(
  db: DatabaseSync,
  mail: MailTransport,
  conversationId: string,
): Promise<NotificationRow | null> {
  const recipients = getAlertRecipients(db);
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const inserted = db
    .prepare(
      `INSERT INTO notifications (id, type, conversation_id, recipients, status, attempts, created_at)
       VALUES (?, 'escalation_alert', ?, ?, 'pending', 0, ?)
       ON CONFLICT(type, conversation_id) DO NOTHING
       RETURNING id`,
    )
    .get(id, conversationId, JSON.stringify(recipients), createdAt) as { id: string } | undefined;
  if (!inserted) {
    // An alert for this conversation already exists; never send twice.
    return null;
  }
  if (recipients.length === 0) {
    db.prepare(
      "UPDATE notifications SET last_error = 'No alert recipients configured yet.' WHERE id = ?",
    ).run(inserted.id);
    const row = fetchNotification(db, inserted.id) as NotificationRecord;
    return rowToNotification(row);
  }
  return deliverNotification(db, mail, inserted.id);
}

/**
 * Delivers the alert to every configured recipient who has not already
 * confirmed delivery on this notification. Each success is recorded before
 * the next send starts, so a mid-list failure never duplicates earlier
 * deliveries when staff retry.
 */
async function deliverNotification(
  db: DatabaseSync,
  mail: MailTransport,
  notificationId: string,
): Promise<NotificationRow> {
  const record = fetchNotification(db, notificationId);
  if (!record) {
    throw new Error(`notification ${notificationId} not found`);
  }
  const recipients = JSON.parse(record.recipients) as string[];
  const deliveredTo = new Set(JSON.parse(record.delivered_to) as string[]);
  const outstanding = recipients.filter((recipient) => !deliveredTo.has(recipient));

  let failure: string | null = null;
  for (const recipient of outstanding) {
    try {
      await mail.send({
        to: recipient,
        subject: "Visitor question needs staff (college chat)",
        body: alertBody(record.conversation_id, record.created_at),
      });
      deliveredTo.add(recipient);
      db.prepare("UPDATE notifications SET delivered_to = ? WHERE id = ?").run(
        JSON.stringify([...deliveredTo]),
        notificationId,
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  const complete = [...recipients].every((recipient) => deliveredTo.has(recipient));
  db.prepare(
    `UPDATE notifications SET
       status = ?,
       attempts = attempts + 1,
       last_error = ?,
       sent_at = CASE WHEN ? THEN ? ELSE sent_at END
     WHERE id = ?`,
  ).run(
    complete ? "sent" : "failed",
    failure,
    complete ? 1 : 0,
    new Date().toISOString(),
    notificationId,
  );

  const updated = fetchNotification(db, notificationId) as NotificationRecord;
  return rowToNotification(updated);
}

export function listNotifications(db: DatabaseSync): NotificationRow[] {
  return listRows(db);
}

/**
 * Staff retry of a failed alert. Retrying a sent notification is refused so
 * a successful alert can never be duplicated; retrying reuses the same row.
 * Alerts recorded before recipients were configured pick up the current list.
 */
export async function retryNotificationById(
  db: DatabaseSync,
  mail: MailTransport,
  notificationId: string,
): Promise<{ status: "sent" | "failed" } | "already_sent" | "not_found"> {
  const record = fetchNotification(db, notificationId);
  if (!record) {
    return "not_found";
  }
  if (record.status === "sent") {
    return "already_sent";
  }
  const storedRecipients = JSON.parse(record.recipients) as string[];
  if (storedRecipients.length === 0) {
    const current = getAlertRecipients(db);
    if (current.length > 0) {
      db.prepare("UPDATE notifications SET recipients = ?, last_error = NULL WHERE id = ?").run(
        JSON.stringify(current),
        notificationId,
      );
    }
  }
  const result = await deliverNotification(db, mail, notificationId);
  return result.status === "sent" ? { status: "sent" } : { status: "failed" };
}
