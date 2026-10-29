import type { AppDatabase } from "../db/appDatabase";

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

/**
 * Development mail transport: every message (verification, password reset,
 * later staff alerts) is recorded in the mail_outbox table instead of leaving
 * the machine. Production delivery uses the approved sender (ticket 03).
 */
export function createOutboxTransport(db: AppDatabase): MailTransport {
  return {
    async send(mail) {
      await db.run(
        "INSERT INTO mail_outbox (id, to_address, subject, body, created_at) VALUES (?, ?, ?, ?, ?)",
        crypto.randomUUID(),
        mail.to,
        mail.subject,
        mail.body,
        new Date().toISOString(),
      );
    },
  };
}
