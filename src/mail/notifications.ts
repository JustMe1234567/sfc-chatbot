import type { AppDatabase } from "../db/appDatabase";
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

async function fetchNotification(db: AppDatabase, id: string): Promise<NotificationRecord | undefined> {
  return db.get<NotificationRecord>(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE id = ?`, id);
}

async function listRows(db: AppDatabase): Promise<NotificationRow[]> {
  const rows = await db.all<NotificationRecord>(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications ORDER BY created_at DESC`);
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

function contactRequestBody(conversationId: string, receivedAt: string): string {
  const inboxLink = `${appBaseUrl()}/dashboard/conversations/${conversationId}`;
  return [
    "A visitor in the college website chat asked to be contacted (email or phone).",
    "",
    `Open the conversation: ${inboxLink}`,
    "",
    `Received: ${receivedAt}`,
    "",
    "This alert is sent once per conversation; the desk keeps a persistent",
    "Contact Me status until staff mark the request contacted.",
    "You are receiving this because you are on the chat staff alert list.",
  ].join("\n");
}

/** Why a legacy visitor-return row is never delivered again (ticket 66). */
const VISITOR_RETURN_RETIRED = "Visitor return links are no longer sent.";

/** Subject and body for the staff alert rows. */
function composeMail(record: NotificationRecord): {
  subject: string;
  body: string;
} {
  if (record.type === "contact_request") {
    return {
      subject: "Visitor contact request needs staff (college chat)",
      body: contactRequestBody(record.conversation_id, record.created_at),
    };
  }
  return {
    subject: "Visitor question needs staff (college chat)",
    body: alertBody(record.conversation_id, record.created_at),
  };
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
  db: AppDatabase,
  mail: MailTransport,
  conversationId: string,
): Promise<NotificationRow | null> {
  const recipients = await getAlertRecipients(db);
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const inserted = await db.get<{ id: string }>(
    `INSERT INTO notifications (id, type, conversation_id, recipients, status, attempts, created_at)
     VALUES (?, 'escalation_alert', ?, ?, 'pending', 0, ?)
     ON CONFLICT(type, conversation_id) DO NOTHING
     RETURNING id`,
    id,
    conversationId,
    JSON.stringify(recipients),
    createdAt,
  );
  if (!inserted) {
    // An alert for this conversation already exists; never send twice.
    return null;
  }
  if (recipients.length === 0) {
    await db.run(
      "UPDATE notifications SET last_error = 'No alert recipients configured yet.' WHERE id = ?",
      inserted.id,
    );
    const row = (await fetchNotification(db, inserted.id)) as NotificationRecord;
    return rowToNotification(row);
  }
  return deliverNotification(db, mail, inserted.id);
}

/**
 * The staff email alert for a contact request (ticket 69): same machinery
 * and dedup as the escalation alert, under its own "contact_request" type —
 * one alert per conversation (the unique index makes duplicate calls
 * no-ops), so a conversation's later requests never re-spam the inbox;
 * the desk's persistent Contact Me status is the standing signal. Requests
 * that happen before recipients are configured still get a pending row.
 */
export async function recordContactRequestAlert(
  db: AppDatabase,
  mail: MailTransport,
  conversationId: string,
): Promise<NotificationRow | null> {
  const recipients = await getAlertRecipients(db);
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const inserted = await db.get<{ id: string }>(
    `INSERT INTO notifications (id, type, conversation_id, recipients, status, attempts, created_at)
     VALUES (?, 'contact_request', ?, ?, 'pending', 0, ?)
     ON CONFLICT(type, conversation_id) DO NOTHING
     RETURNING id`,
    id,
    conversationId,
    JSON.stringify(recipients),
    createdAt,
  );
  if (!inserted) {
    // An alert for this conversation already exists; never send twice.
    return null;
  }
  if (recipients.length === 0) {
    await db.run(
      "UPDATE notifications SET last_error = 'No alert recipients configured yet.' WHERE id = ?",
      inserted.id,
    );
    const row = (await fetchNotification(db, inserted.id)) as NotificationRecord;
    return rowToNotification(row);
  }
  return deliverNotification(db, mail, inserted.id);
}

/**
 * Delivers the notification to every configured recipient who has not
 * already confirmed delivery. Each success is recorded before the next send
 * starts, so a mid-list failure never duplicates earlier deliveries when
 * staff retry. Visitor return links are retired (ticket 66): a legacy
 * visitor-return row is marked failed and never mailed, so the staff alert
 * wording can never reach a visitor's address.
 */
export async function deliverNotification(
  db: AppDatabase,
  mail: MailTransport,
  notificationId: string,
): Promise<NotificationRow> {
  const record = await fetchNotification(db, notificationId);
  if (!record) {
    throw new Error(`notification ${notificationId} not found`);
  }
  const recipients = JSON.parse(record.recipients) as string[];
  const deliveredTo = new Set(JSON.parse(record.delivered_to) as string[]);

  if (record.type === "visitor_return") {
    await db.run(
      "UPDATE notifications SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?",
      VISITOR_RETURN_RETIRED,
      notificationId,
    );
    const failed = (await fetchNotification(db, notificationId)) as NotificationRecord;
    return rowToNotification(failed);
  }

  const outstanding = recipients.filter((recipient) => !deliveredTo.has(recipient));
  let failure: string | null = null;
  for (const recipient of outstanding) {
    try {
      const composed = composeMail(record);
      await mail.send({ to: recipient, subject: composed.subject, body: composed.body });
      deliveredTo.add(recipient);
      await db.run("UPDATE notifications SET delivered_to = ? WHERE id = ?",
        JSON.stringify([...deliveredTo]),
        notificationId,
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  const complete = [...recipients].every((recipient) => deliveredTo.has(recipient));
  await db.run(
    `UPDATE notifications SET
       status = ?,
       attempts = attempts + 1,
       last_error = ?,
       sent_at = CASE WHEN ? THEN ? ELSE sent_at END
     WHERE id = ?`,
    complete ? "sent" : "failed",
    failure,
    complete ? 1 : 0,
    new Date().toISOString(),
    notificationId,
  );

  const updated = (await fetchNotification(db, notificationId)) as NotificationRecord;
  return rowToNotification(updated);
}

export async function listNotifications(db: AppDatabase): Promise<NotificationRow[]> {
  return listRows(db);
}

/** Rows shown per Delivery history page (ticket 50). */
export const NOTIFICATIONS_PAGE_SIZE = 10;

/**
 * One Delivery history page's rows: only this page's slice, never the full
 * table. Newest first, matching the unpaginated listing; the id tie-break
 * keeps page boundaries stable when attempts share a created_at instant.
 * The total that drives the pager comes from `notificationStatusCounts`,
 * which the page fetches anyway for its summary badges.
 */
export async function listNotificationPage(
  db: AppDatabase,
  page: number,
): Promise<NotificationRow[]> {
  const offset = (page - 1) * NOTIFICATIONS_PAGE_SIZE;
  const rows = await db.all<NotificationRecord>(
    `SELECT ${NOTIFICATION_COLUMNS} FROM notifications ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    NOTIFICATIONS_PAGE_SIZE,
    offset,
  );
  return rows.map(rowToNotification);
}

/**
 * Status counts across EVERY notification — the Delivery history's summary
 * badges must not shrink to the current page's slice. The total also drives
 * the pager (ticket 50), so a page render runs one aggregate query here and
 * never a second COUNT in the page query.
 */
export async function notificationStatusCounts(
  db: AppDatabase,
): Promise<{ total: number; delivered: number; failed: number }> {
  const rows = await db.all<{ status: NotificationRow["status"]; n: number | string }>(
    "SELECT status, COUNT(*) AS n FROM notifications GROUP BY status",
  );
  const counts = { total: 0, delivered: 0, failed: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    counts.total += n;
    if (row.status === "sent") {
      counts.delivered = n;
    }
    if (row.status === "failed") {
      counts.failed = n;
    }
  }
  return counts;
}

/**
 * Staff retry of a failed alert. Retrying a sent notification is refused so
 * a successful alert can never be duplicated; retrying reuses the same row.
 * Alerts recorded before recipients were configured pick up the current list.
 * A legacy visitor-return row is refused outright (ticket 66): no new return
 * link is ever minted or mailed.
 */
export async function retryNotificationById(
  db: AppDatabase,
  mail: MailTransport,
  notificationId: string,
): Promise<{ status: "sent" | "failed" } | "already_sent" | "not_found" | "visitor_return_retired"> {
  const record = await fetchNotification(db, notificationId);
  if (!record) {
    return "not_found";
  }
  if (record.status === "sent") {
    return "already_sent";
  }
  if (record.type === "visitor_return") {
    return "visitor_return_retired";
  }
  const storedRecipients = JSON.parse(record.recipients) as string[];
  if (storedRecipients.length === 0) {
    const current = await getAlertRecipients(db);
    if (current.length > 0) {
      await db.run("UPDATE notifications SET recipients = ?, last_error = NULL WHERE id = ?",
        JSON.stringify(current),
        notificationId,
      );
    }
  }
  const result = await deliverNotification(db, mail, notificationId);
  return result.status === "sent" ? { status: "sent" } : { status: "failed" };
}
