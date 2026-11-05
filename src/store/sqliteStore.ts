import type { DatabaseSync } from "node:sqlite";
import type {
  RetentionRun,
  ReturnToken,
  Store,
} from "../domain/types";
import {
  CONVERSATION_COLUMNS,
  RULE_COLUMNS,
  rowToAudit,
  rowToConversation,
  rowToMessage,
  rowToRule,
  type AuditRow,
  type ConversationRow,
  type MessageRow,
  type RuleRow,
} from "./rows";

/** The visitor_sessions columns read back by findConversationIdByTokenHash. */
type SessionRow = {
  token_hash: string;
  conversation_id: string;
  created_at: string;
  expires_at: string;
};

export function createSqliteStore(db: DatabaseSync): Store {
  return {
    async createConversation(conversation) {
      db.prepare(
        "INSERT INTO conversations (id, state, created_at, visitor_last_seen_at, last_activity_at) VALUES (?, ?, ?, ?, ?)",
      ).run(
        conversation.id,
        conversation.state,
        conversation.createdAt,
        conversation.createdAt,
        conversation.createdAt,
      );
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

    // The Visitor emails list (ticket 53): derived live from the email
    // column, so a conversation purged by any deletion path drops out with
    // no extra bookkeeping. Newest activity first; the id tie-break keeps
    // page boundaries stable when two conversations share an instant (the
    // Postgres store uses the same tie-break — conversations carry no seq).
    async listConversationsWithEmail(page, pageSize) {
      const rows = db
        .prepare(
          `SELECT ${CONVERSATION_COLUMNS} FROM conversations
           WHERE visitor_email IS NOT NULL
           ORDER BY last_activity_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(pageSize, (page - 1) * pageSize) as unknown as ConversationRow[];
      return rows.map(rowToConversation);
    },

    async countConversationsWithEmail() {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM conversations WHERE visitor_email IS NOT NULL")
        .get() as { n: number | bigint };
      return Number(row.n);
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

    // Unordered: the conversation desk's read model shapes and sorts in one
    // pass (newest activity first), so no SQL ordering survives to callers.
    async listConversations() {
      const rows = db
        .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations`)
        .all() as unknown as ConversationRow[];
      return rows.map(rowToConversation);
    },

    // One meaningful message (visitor or staff) moves the inactivity clock
    // and slides the conversation's visitor credentials forward with it, so
    // the credential can outlive its original 24 hours exactly as long as
    // the exchange keeps going.
    async touchConversationActivity(id, at, sessionExpiresAt) {
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE conversations SET last_activity_at = ? WHERE id = ?").run(at, id);
        db.prepare(
          "UPDATE visitor_sessions SET expires_at = ? WHERE conversation_id = ? AND expires_at < ?",
        ).run(sessionExpiresAt, id, sessionExpiresAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    // The guard keeps a burst of visitor messages one alert: the flag is
    // raised only when nothing is standing.
    async setConversationAttention(id, at) {
      db.prepare(
        "UPDATE conversations SET attention_at = ? WHERE id = ? AND attention_at IS NULL",
      ).run(at, id);
    },

    async clearConversationAttention(id) {
      db.prepare("UPDATE conversations SET attention_at = NULL WHERE id = ?").run(id);
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

    // The visitor's Clear conversation (ticket 14) in one transaction. The
    // replaced_by link is what makes retries safe: every request after the
    // first finds the same successor and only mints another credential for
    // it, so one click can never grow a second fresh chat. Revocation drops
    // the old conversation's visitor sessions and any unused return links;
    // used links, transcripts, notifications, and audit rows stay.
    async replaceConversation(oldId, successorId, session, at, closingNotice) {
      db.exec("BEGIN");
      try {
        const old = db
          .prepare("SELECT state, replaced_by FROM conversations WHERE id = ?")
          .get(oldId) as { state: string; replaced_by: string | null } | undefined;
        if (!old) {
          db.exec("ROLLBACK");
          return null;
        }
        let resolvedId = successorId;
        let created = false;
        if (old.replaced_by) {
          // A concurrent or earlier clear already created the successor:
          // join it instead of the proposed id.
          resolvedId = old.replaced_by;
        } else {
          // Guarded writes, matching the claim protocol's shape: they keep a
          // second transaction a no-op even where drivers interleave inside
          // a transaction (the Postgres store for ticket 11 must preserve
          // this; on this driver the whole transaction is synchronous).
          const closed = db
            .prepare(
              "UPDATE conversations SET state = 'closed', closed_at = ? WHERE id = ? AND state <> 'closed'",
            )
            .run(at, oldId);
          if (closed.changes > 0) {
            db.prepare(
              "INSERT INTO messages (id, conversation_id, role, text, created_at) VALUES (?, ?, 'bot', ?, ?)",
            ).run(crypto.randomUUID(), oldId, closingNotice, at);
          }
          db.prepare("DELETE FROM visitor_sessions WHERE conversation_id = ?").run(oldId);
          db.prepare(
            "DELETE FROM return_tokens WHERE conversation_id = ? AND used_at IS NULL",
          ).run(oldId);
          db.prepare(
            "INSERT INTO conversations (id, state, created_at, visitor_last_seen_at, last_activity_at) VALUES (?, 'bot_active', ?, ?, ?)",
          ).run(successorId, at, at, at);
          created = true;
          const linked = db
            .prepare(
              "UPDATE conversations SET replaced_by = ? WHERE id = ? AND replaced_by IS NULL",
            )
            .run(successorId, oldId);
          if (linked.changes === 0) {
            // Unreachable on this driver; the guard exists so the Postgres
            // store inherits the join-don't-duplicate rule.
            throw new Error(`conversation ${oldId} was linked to a successor concurrently`);
          }
        }
        db.prepare(
          "INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        ).run(session.tokenHash, resolvedId, session.createdAt, session.expiresAt);
        db.exec("COMMIT");
        return { successorId: resolvedId, created };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
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

    // The newer instant wins regardless of beat arrival order: ISO strings
    // compare chronologically, so a late-arriving older beat can never pull
    // liveness backwards.
    async recordAnalyticsPresence(visitorHash, at, day) {
      db.prepare(
        `INSERT INTO analytics_seen (visitor_hash, day, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(visitor_hash, day) DO UPDATE SET
           last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
      ).run(visitorHash, day, at, at);
    },

    async recordChatCount(day) {
      db.prepare(
        `INSERT INTO analytics_daily (day, chats, escalations) VALUES (?, 1, 0)
         ON CONFLICT(day) DO UPDATE SET chats = chats + 1`,
      ).run(day);
    },

    async recordEscalationCount(day) {
      db.prepare(
        `INSERT INTO analytics_daily (day, chats, escalations) VALUES (?, 0, 1)
         ON CONFLICT(day) DO UPDATE SET escalations = escalations + 1`,
      ).run(day);
    },

    async analyticsOverview({ liveCutoff, startDay, endDay }) {
      const live = db
        // DISTINCT: one browser beating either side of local midnight has a
        // row per day, and both can sit inside the two-minute window.
        .prepare(
          "SELECT COUNT(DISTINCT visitor_hash) AS live FROM analytics_seen WHERE last_seen_at > ?",
        )
        .get(liveCutoff) as { live: number };
      const total = db
        .prepare(
          "SELECT COUNT(DISTINCT visitor_hash) AS visitors FROM analytics_seen WHERE day >= ? AND day <= ?",
        )
        .get(startDay, endDay) as { visitors: number };
      const dailyVisitors = db
        .prepare(
          "SELECT day, COUNT(DISTINCT visitor_hash) AS visitors FROM analytics_seen WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day",
        )
        .all(startDay, endDay) as unknown as { day: string; visitors: number }[];
      const dailyCounts = db
        .prepare(
          "SELECT day, chats, escalations FROM analytics_daily WHERE day >= ? AND day <= ? ORDER BY day",
        )
        .all(startDay, endDay) as unknown as { day: string; chats: number; escalations: number }[];
      return {
        liveVisitors: live.live,
        totalVisitors: total.visitors,
        dailyVisitors,
        dailyCounts,
      };
    },

    async expireAnalyticsBefore(beforeDay) {
      // Number(): the driver may hand back bigint counts.
      const removedPresence = Number(
        db.prepare("DELETE FROM analytics_seen WHERE day < ?").run(beforeDay).changes,
      );
      const removedDaily = Number(
        db.prepare("DELETE FROM analytics_daily WHERE day < ?").run(beforeDay).changes,
      );
      return { removedPresence, removedDaily };
    },
  };
}
