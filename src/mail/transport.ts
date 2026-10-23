import type { DatabaseSync } from "node:sqlite";
import { createOutboxTransport, type MailTransport } from "./outbox";

/**
 * Production transport for the approved transactional sender. The Resend
 * HTTP API is a plain POST; the key and verified from-address live in server
 * environment settings only. Swap or add senders here once the college signs
 * off on a provider.
 */
function createResendTransport(apiKey: string, from: string): MailTransport {
  return {
    async send(mail) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.body,
        }),
      });
      if (!response.ok) {
        throw new Error(`email sender refused: HTTP ${response.status}`);
      }
    },
  };
}

/** Test transport: the first send fails (as an unreachable provider would),
 *  every later send is delivered to the outbox. */
function createFailThenSucceedTransport(db: DatabaseSync): MailTransport {
  const outbox = createOutboxTransport(db);
  let failedOnce = false;
  return {
    async send(mail) {
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("email sender refused: connection reset by peer");
      }
      await outbox.send(mail);
    },
  };
}

/**
 * The transport the running app sends with. Outbox (development) unless the
 * approved sender is configured via environment settings; production refuses
 * to start without the approved sender configured, so alerts can never be
 * silently written to a local table instead of emailed.
 * CHATBOT_MAIL_TRANSPORT exists so automated tests and local production-build
 * browser checks can pick a transport explicitly: "fail-then-succeed"
 * exercises failed deliveries end to end, "outbox" records mail locally.
 */
export function createMailTransportFromEnv(db: DatabaseSync): MailTransport {
  const mode = process.env.CHATBOT_MAIL_TRANSPORT;
  if (mode === "fail-then-succeed") {
    return createFailThenSucceedTransport(db);
  }
  if (mode === "outbox") {
    return createOutboxTransport(db);
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (apiKey && from) {
    return createResendTransport(apiKey, from);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Production requires an approved email sender: set RESEND_API_KEY and MAIL_FROM.",
    );
  }
  return createOutboxTransport(db);
}
