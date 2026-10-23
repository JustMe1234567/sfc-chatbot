import type { DatabaseSync } from "node:sqlite";
import type {
  AnswerRule,
  AuditEntry,
  Conversation,
  Message,
  RetentionRun,
  ReturnToken,
  Store,
} from "../domain/types";

interface AuditRow {
  id: string;
  conversation_id: string | null;
  rule_id: string | null;
  actor_id: string;
  action: AuditEntry["action"];
  detail: string | null;
  created_at: string;
}

function rowToAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ruleId: row.rule_id,
    actorId: row.actor_id,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

interface ConversationRow {
  id: string;
  state: Conversation["state"];
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  visitor_email: string | null;
  visitor_last_seen_at: string | null;
  closed_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Message["role"];
  text: string;
  link: string | null;
  choices: string | null;
  created_at: string;
}

interface RuleRow {
  id: string;
  topic: string;
  response: string;
  link: string | null;
  phrases: string;
  keywords: string | null;
  status: AnswerRule["status"];
  updated_at: string;
  published_by: string | null;
  reviewed_at: string | null;
}

interface SessionRow {
  token_hash: string;
  conversation_id: string;
  created_at: string;
  expires_at: string;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    state: row.state,
    createdAt: row.created_at,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    visitorEmail: row.visitor_email,
    visitorLastSeenAt: row.visitor_last_seen_at,
    closedAt: row.closed_at,
  };
}

const CONVERSATION_COLUMNS =
  "id, state, created_at, claimed_by, claimed_at, visitor_email, visitor_last_seen_at, closed_at";

function rowToMessage(row: MessageRow): Message {
  let choices: Message["choices"];
  if (row.choices) {
    try {
      choices = JSON.parse(row.choices) as Message["choices"];
    } catch {
      // A corrupt offer must not take the whole transcript down; the text
      // still reads and a fresh question re-offers topics.
      choices = undefined;
    }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    text: row.text,
    ...(row.link ? { link: row.link } : {}),
    ...(choices ? { choices } : {}),
    createdAt: row.created_at,
  };
}

function rowToRule(row: RuleRow): AnswerRule {
  return {
    id: row.id,
    topic: row.topic,
    response: row.response,
    ...(row.link ? { link: row.link } : {}),
    phrases: JSON.parse(row.phrases) as string[],
    ...(row.keywords ? { keywords: JSON.parse(row.keywords) as string[][] } : {}),
    status: row.status,
    updatedAt: row.updated_at,
    publishedBy: row.published_by,
    reviewedAt: row.reviewed_at,
  };
}

const RULE_COLUMNS =
  "id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at";

export function createSqliteStore(db: DatabaseSync): Store {
  return {
    async createConversation(conversation) {
      db.prepare(
        "INSERT INTO conversations (id, state, created_at, visitor_last_seen_at) VALUES (?, ?, ?, ?)",
      ).run(conversation.id, conversation.state, conversation.createdAt, conversation.createdAt);
    },

    async getConversation(id) {
      const row = db
        .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`)
        .get(id) as ConversationRow | undefined;
      return row ? rowToConversation(row) : null;
    },

    async updateConversationState(id, state) {
      db.prepare("UPDATE conversations SET state = ? WHERE id = ?").run(state, id);
    },

    async setConversationEmail(id, email) {
      db.prepare("UPDATE conversations SET visitor_email = ? WHERE id = ?").run(email, id);
    },

    async touchVisitorPresence(id) {
      db.prepare("UPDATE conversations SET visitor_last_seen_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        id,
      );
    },

    async listConversationsByState(state) {
      const rows = db
        .prepare(
          `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE state = ? ORDER BY created_at DESC`,
        )
        .all(state) as unknown as ConversationRow[];
      return rows.map(rowToConversation);
    },

    // The conditional UPDATE is the whole claim protocol: whichever request
    // flips the row owns it, and concurrent callers see zero rows changed.
    async claimConversation(id, staffId) {
      const result = db
        .prepare(
          `UPDATE conversations SET state = 'claimed', claimed_by = ?, claimed_at = ?
           WHERE id = ? AND state = 'awaiting_staff' AND claimed_by IS NULL`,
        )
        .run(staffId, new Date().toISOString(), id);
      if (result.changes === 0) {
        return null;
      }
      const row = db
        .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`)
        .get(id) as unknown as ConversationRow;
      return rowToConversation(row);
    },

    // Release and transfer share the claim protocol's shape: the conditional
    // UPDATE only fires on a currently-claimed conversation, so a racing
    // release/transfer/claim can never clobber another's decision.
    async releaseConversation(id) {
      const result = db
        .prepare(
          `UPDATE conversations
           SET state = 'awaiting_staff', claimed_by = NULL, claimed_at = NULL
           WHERE id = ? AND state = 'claimed'`,
        )
        .run(id);
      if (result.changes === 0) {
        return null;
      }
      const row = db
        .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`)
        .get(id) as unknown as ConversationRow;
      return rowToConversation(row);
    },

    async transferConversation(id, toStaffId) {
      const result = db
        .prepare(
          `UPDATE conversations
           SET claimed_by = ?, claimed_at = ?
           WHERE id = ? AND state = 'claimed'`,
        )
        .run(toStaffId, new Date().toISOString(), id);
      if (result.changes === 0) {
        return null;
      }
      const row = db
        .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`)
        .get(id) as unknown as ConversationRow;
      return rowToConversation(row);
    },

    // Closure is the only writer of closed_at. The state guard makes a second
    // close a no-op rather than a silent restart of the retention clock, so
    // the stamp always measures from the real closure.
    async closeConversation(id) {
      db.prepare(
        "UPDATE conversations SET state = 'closed', closed_at = ? WHERE id = ? AND state <> 'closed'",
      ).run(new Date().toISOString(), id);
    },

    async listConversationsClosedBefore(cutoffIso) {
      const rows = db
        .prepare(
          `SELECT ${CONVERSATION_COLUMNS} FROM conversations
           WHERE state = 'closed' AND closed_at IS NOT NULL AND closed_at < ?
           ORDER BY closed_at`,
        )
        .all(cutoffIso) as unknown as ConversationRow[];
      return rows.map(rowToConversation);
    },

    // One transaction removes the transcript together with every path back to
    // it. The audit rows are detached, not deleted: accountability must
    // outlive the transcript, and the explicit UPDATE (rather than a cascade)
    // keeps the foreign key strict for every other deletion path. The
    // conditional final DELETE re-verifies the closed state so a conversation
    // that reopened between listing and purging survives untouched.
    async purgeClosedConversation(id) {
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE audit_log SET conversation_id = NULL WHERE conversation_id = ?").run(id);
        db.prepare("DELETE FROM notifications WHERE conversation_id = ?").run(id);
        db.prepare("DELETE FROM return_tokens WHERE conversation_id = ?").run(id);
        db.prepare("DELETE FROM visitor_sessions WHERE conversation_id = ?").run(id);
        db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
        const removed = db
          .prepare("DELETE FROM conversations WHERE id = ? AND state = 'closed'")
          .run(id);
        if (removed.changes === 0) {
          db.exec("ROLLBACK");
          return false;
        }
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    async recordRetentionRun(run) {
      db.prepare(
        "INSERT INTO retention_runs (id, ran_at, retention_days, removed_conversations) VALUES (?, ?, ?, ?)",
      ).run(run.id, run.ranAt, run.retentionDays, run.removedConversations);
    },

    // rowid breaks same-timestamp ties; the Postgres store for ticket 11
    // needs its own monotonic tie-break.
    async getLatestRetentionRun() {
      const row = db
        .prepare(
          "SELECT id, ran_at, retention_days, removed_conversations FROM retention_runs ORDER BY ran_at DESC, rowid DESC LIMIT 1",
        )
        .get() as
        | { id: string; ran_at: string; retention_days: number; removed_conversations: number }
        | undefined;
      return row
        ? {
            id: row.id,
            ranAt: row.ran_at,
            retentionDays: row.retention_days,
            removedConversations: row.removed_conversations,
          }
        : null;
    },

    async createSession(session) {
      db.prepare(
        "INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(
        session.tokenHash,
        session.conversationId,
        session.createdAt,
        session.expiresAt,
      );
    },

    // An expired session no longer unlocks its conversation; the row is
    // simply ignored so a later retention job (ticket 10) can purge it.
    async findConversationIdByTokenHash(tokenHash) {
      const row = db
        .prepare(
          "SELECT token_hash, conversation_id, created_at, expires_at FROM visitor_sessions WHERE token_hash = ? AND expires_at > ?",
        )
        .get(tokenHash, new Date().toISOString()) as SessionRow | undefined;
      return row ? row.conversation_id : null;
    },

    async createReturnToken(token) {
      db.prepare(
        "INSERT INTO return_tokens (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(token.tokenHash, token.conversationId, token.createdAt, token.expiresAt);
    },

    // One transaction redeems the token AND mints the replacement visitor
    // session: a crash can never burn the link without restoring access.
    // The conditional UPDATE is atomic, so a replayed or racing link sees
    // zero rows changed and loses.
    async redeemReturnToken(tokenHash, session) {
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const row = db
          .prepare(
            `UPDATE return_tokens SET used_at = ?
             WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
             RETURNING conversation_id`,
          )
          .get(now, tokenHash, now) as { conversation_id: string } | undefined;
        if (!row) {
          db.exec("ROLLBACK");
          return null;
        }
        db.prepare(
          "INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        ).run(session.tokenHash, row.conversation_id, session.createdAt, session.expiresAt);
        db.exec("COMMIT");
        return row.conversation_id;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    async appendMessage(message) {
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, text, link, choices, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        message.id,
        message.conversationId,
        message.role,
        message.text,
        message.link ?? null,
        message.choices ? JSON.stringify(message.choices) : null,
        message.createdAt,
      );
    },

    async listMessages(conversationId) {
      const rows = db
        .prepare(
          // rowid breaks same-timestamp ties deterministically in SQLite; the
          // Postgres store for ticket 11 needs its own monotonic tie-break.
          "SELECT id, conversation_id, role, text, link, choices, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
        )
        .all(conversationId) as unknown as MessageRow[];
      return rows.map(rowToMessage);
    },

    async upsertAnswerRule(rule) {
      db.prepare(
        `INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           topic = excluded.topic,
           response = excluded.response,
           link = excluded.link,
           phrases = excluded.phrases,
           keywords = excluded.keywords,
           status = excluded.status,
           updated_at = excluded.updated_at,
           published_by = excluded.published_by,
           reviewed_at = excluded.reviewed_at`,
      ).run(
        rule.id,
        rule.topic,
        rule.response,
        rule.link ?? null,
        JSON.stringify(rule.phrases),
        rule.keywords ? JSON.stringify(rule.keywords) : null,
        rule.status,
        rule.updatedAt,
        rule.publishedBy,
        rule.reviewedAt,
      );
    },

    async getAnswerRule(id) {
      const row = db
        .prepare(`SELECT ${RULE_COLUMNS} FROM answer_rules WHERE id = ?`)
        .get(id) as RuleRow | undefined;
      return row ? rowToRule(row) : null;
    },

    async listAnswerRules() {
      const rows = db
        .prepare(
          // rowid breaks same-timestamp ties deterministically in SQLite; the
          // Postgres store for ticket 11 needs its own monotonic tie-break.
          `SELECT ${RULE_COLUMNS} FROM answer_rules ORDER BY updated_at DESC, rowid DESC`,
        )
        .all() as unknown as RuleRow[];
      return rows.map(rowToRule);
    },

    async listPublishedAnswerRules() {
      const rows = db
        .prepare(`SELECT ${RULE_COLUMNS} FROM answer_rules WHERE status = 'published'`)
        .all() as unknown as RuleRow[];
      return rows.map(rowToRule);
    },

    async recordAudit(entry) {
      db.prepare(
        "INSERT INTO audit_log (id, conversation_id, rule_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        entry.id,
        entry.conversationId,
        entry.ruleId,
        entry.actorId,
        entry.action,
        entry.detail,
        entry.createdAt,
      );
    },

    // rowid breaks same-timestamp ties so the trail reads in true order; the
    // Postgres store for ticket 11 needs its own monotonic tie-break.
    async listConversationAudit(conversationId) {
      const rows = db
        .prepare(
          "SELECT id, conversation_id, rule_id, actor_id, action, detail, created_at FROM audit_log WHERE conversation_id = ? ORDER BY created_at, rowid",
        )
        .all(conversationId) as unknown as AuditRow[];
      return rows.map(rowToAudit);
    },

    async listRuleAudit(ruleId) {
      const rows = db
        .prepare(
          "SELECT id, conversation_id, rule_id, actor_id, action, detail, created_at FROM audit_log WHERE rule_id = ? ORDER BY created_at, rowid",
        )
        .all(ruleId) as unknown as AuditRow[];
      return rows.map(rowToAudit);
    },
  };
}
