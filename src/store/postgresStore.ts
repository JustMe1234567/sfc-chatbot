import type { ContactRequest, RetentionRun, ReturnToken, Store } from "../domain/types";
import type { PostgresSql } from "../db/postgres";
import type { TransactionSql } from "postgres";
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

/**
 * The Postgres store (ticket 11): the Store port over Supabase-style
 * Postgres, through postgres.js. The SQLite store is the semantic reference
 * — every guarded write here keeps its shape:
 *
 * - Conditional UPDATEs decide races (claim, release, transfer, the clear's
 *   successor link): the winner is whoever the WHERE clause matches, and a
 *   zero count loses. Multi-step invariants (the clear protocol, the
 *   retention purge, redemption-plus-mint) run inside `sql.begin`.
 * - `seq` (bigserial) replaces SQLite's rowid as the monotonic tie-break
 *   for same-timestamp ordering.
 * - Timestamps are ISO-8601 UTC text in TEXT columns, identical to the
 *   SQLite schema, so comparisons stay lexicographic and the data migration
 *   copies values verbatim.
 *
 * Queries interpolate only values (postgres.js parameterizes them) plus two
 * constants shared with the SQLite store (CONVERSATION_COLUMNS,
 * RULE_COLUMNS); those constant fragments go through `sql.unsafe`, which is
 * safe because they contain no user input.
 */

/** Affected-row count of a write query (postgres.js tags it on the result). */
function changesOf(result: unknown): number {
  const count = (result as { count?: number }).count;
  return count ?? 0;
}

/** The contact_requests columns read back by the request queries (ticket 69). */
type ContactRequestRow = {
  id: string;
  conversation_id: string;
  medium: ContactRequest["medium"];
  status: ContactRequest["status"];
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
};

function rowToContactRequest(row: ContactRequestRow): ContactRequest {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    medium: row.medium,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
  };
}

const CONTACT_REQUEST_COLUMNS =
  "id, conversation_id, medium, status, created_at, completed_at, completed_by";

export function createPostgresStore(sql: PostgresSql): Store {
  return {
    async createConversation(conversation) {
      await sql`INSERT INTO conversations (id, state, created_at, visitor_name, visitor_email, visitor_phone, visitor_last_seen_at, last_activity_at)
                VALUES (${conversation.id}, ${conversation.state}, ${conversation.createdAt}, ${conversation.visitorName}, ${conversation.visitorEmail}, ${conversation.visitorPhone}, ${conversation.createdAt}, ${conversation.createdAt})`;
    },

    async getConversation(id) {
      const rows = await sql.unsafe(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1`,
        [id],
      );
      const row = rows[0] as ConversationRow | undefined;
      return row ? rowToConversation(row) : null;
    },

    // The reverse replaced_by lookup (ticket 73): the predecessor is the
    // row whose forward link points at the asked-for conversation.
    async findPredecessorId(id) {
      const rows = await sql.unsafe(
        "SELECT id FROM conversations WHERE replaced_by = $1",
        [id],
      );
      const row = rows[0] as { id: string } | undefined;
      return row ? row.id : null;
    },

    async updateConversationState(id, state) {
      await sql`UPDATE conversations SET state = ${state} WHERE id = ${id}`;
    },

    async setConversationContact(id, contact) {
      await sql`UPDATE conversations SET visitor_name = ${contact.name}, visitor_email = ${contact.email}, visitor_phone = ${contact.phone} WHERE id = ${id}`;
    },

    // The Visitor emails list (ticket 53): the SQLite store's live-derived
    // page query, with the same last_activity_at/id ordering — conversations
    // carry no seq, so the id is the shared deterministic tie-break.
    // The Visitor contacts list (tickets 69 and 74): the same statement
    // shape as the SQLite store — an inner query pairing each conversation
    // with its latest request's medium and created_at (plus the search
    // filter, case-insensitive across name, email, and phone), and an
    // outer query sorting by the displayed column with the conversation
    // id as the final tie-break.
    async listConversationsWithContactRequest(page, pageSize, options) {
      const search = options?.query ?? "";
      const sort = options?.sort ?? "requested";
      const direction = options?.direction ?? (sort === "requested" ? "desc" : "asc");
      const sortExpressions: Record<string, string> = {
        name: "lower(visitor_name)",
        email: "lower(visitor_email)",
        phone: "lower(visitor_phone)",
        medium: "latest_medium",
        requested: "latest_requested_at",
      };
      // Escape LIKE wildcards in the trimmed query before lowering.
      const lowerLike = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`).toLowerCase()}%`;
      const searchParams = search ? [lowerLike, lowerLike, lowerLike] : [];
      const searchClause = search
        ? `AND (lower(visitor_name) LIKE $3 ESCAPE '\\' OR lower(visitor_email) LIKE $4 ESCAPE '\\' OR lower(visitor_phone) LIKE $5 ESCAPE '\\')`
        : "";
      const rows = await sql.unsafe(
        `SELECT * FROM (
           SELECT ${CONVERSATION_COLUMNS},
             (SELECT cr.medium FROM contact_requests cr
              WHERE cr.conversation_id = conversations.id
              ORDER BY cr.created_at DESC, cr.id DESC LIMIT 1) AS latest_medium,
             (SELECT cr.created_at FROM contact_requests cr
              WHERE cr.conversation_id = conversations.id
              ORDER BY cr.created_at DESC, cr.id DESC LIMIT 1) AS latest_requested_at
           FROM conversations
           WHERE id IN (SELECT conversation_id FROM contact_requests)
           ${searchClause}
         )
         ORDER BY ${sortExpressions[sort]} ${direction.toUpperCase()}, id DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, (page - 1) * pageSize, ...searchParams],
      );
      return (rows as unknown as (ConversationRow & {
        latest_medium: ContactRequest["medium"];
        latest_requested_at: string;
      })[]).map((row) => ({
        conversation: rowToConversation(row),
        medium: row.latest_medium,
        requestedAt: row.latest_requested_at,
      }));
    },

    async countConversationsWithContactRequest(options) {
      // Cast to int: bigint comes back as a string through postgres.js. The
      // search clause is conditional (a LIKE against NULL would exclude
      // rows from the unfiltered count); parameters bind only when
      // searching.
      const search = options?.query ?? "";
      // Positional parameters via unsafe: postgres.js would bind a string
      // interpolated into its template as a VALUE, so the conditional
      // clause has to ship as statement text with its own placeholders.
      const like = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`).toLowerCase()}%`;
      const searchClause = search
        ? `WHERE (lower(visitor_name) LIKE $1 ESCAPE '\\' OR lower(visitor_email) LIKE $1 ESCAPE '\\' OR lower(visitor_phone) LIKE $1 ESCAPE '\\')`
        : "";
      const rows = (await sql.unsafe(
        `SELECT COUNT(DISTINCT conversation_id)::int AS n FROM contact_requests
        WHERE conversation_id IN (
          SELECT id FROM conversations
          ${searchClause}
        )`,
        search ? [like] : [],
      )) as unknown as { n: number }[];
      return Number(rows[0]?.n ?? 0);
    },

    // The one-open-request guarantee (ticket 69) is the guarded INSERT:
    // the row only lands when the conversation has no open request, and the
    // partial unique index backs the same rule at the database level. Under
    // READ COMMITTED two concurrent inserts can both pass the NOT EXISTS
    // check, so the conflict clause turns the loser into a zero-row result
    // (false) instead of a thrown constraint error.
    async createContactRequest(request) {
      const inserted = await sql`
        INSERT INTO contact_requests (id, conversation_id, medium, status, created_at, completed_at, completed_by)
        SELECT ${request.id}, ${request.conversationId}, ${request.medium}, 'open', ${request.createdAt}, NULL, NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM contact_requests WHERE conversation_id = ${request.conversationId} AND status = 'open'
        )
        ON CONFLICT (conversation_id) WHERE status = 'open' DO NOTHING`;
      return changesOf(inserted) === 1;
    },

    async getOpenContactRequest(conversationId) {
      const rows = await sql.unsafe(
        `SELECT ${CONTACT_REQUEST_COLUMNS} FROM contact_requests
         WHERE conversation_id = $1 AND status = 'open'`,
        [conversationId],
      );
      const row = (rows as unknown as ContactRequestRow[])[0];
      return row ? rowToContactRequest(row) : null;
    },

    async listContactRequests(conversationId) {
      const rows = await sql.unsafe(
        `SELECT ${CONTACT_REQUEST_COLUMNS} FROM contact_requests
         WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC`,
        [conversationId],
      );
      return (rows as unknown as ContactRequestRow[]).map(rowToContactRequest);
    },

    async listOpenContactRequests() {
      const rows = await sql.unsafe(
        `SELECT ${CONTACT_REQUEST_COLUMNS} FROM contact_requests
         WHERE status = 'open' ORDER BY created_at ASC, id ASC`,
      );
      return (rows as unknown as ContactRequestRow[]).map(rowToContactRequest);
    },

    // Completing is guarded: the open request is identified first and the
    // UPDATE repeats the open check, so a completed or absent request
    // returns null unchanged.
    async completeOpenContactRequest(conversationId, completedBy, at) {
      return sql.begin(async (tx: TransactionSql) => {
        const open = (
          (await tx.unsafe(
            `SELECT id FROM contact_requests WHERE conversation_id = $1 AND status = 'open' FOR UPDATE`,
            [conversationId],
          )) as unknown as { id: string }[]
        )[0];
        if (!open) {
          return null;
        }
        await tx`
          UPDATE contact_requests SET status = 'completed', completed_at = ${at}, completed_by = ${completedBy}
          WHERE id = ${open.id} AND status = 'open'`;
        const row = (
          (await tx.unsafe(`SELECT ${CONTACT_REQUEST_COLUMNS} FROM contact_requests WHERE id = $1`, [
            open.id,
          ])) as unknown as ContactRequestRow[]
        )[0];
        return row ? rowToContactRequest(row) : null;
      });
    },

    async touchVisitorPresence(id) {
      await sql`UPDATE conversations SET visitor_last_seen_at = ${new Date().toISOString()} WHERE id = ${id}`;
    },

    async listConversationsByState(state) {
      const rows = await sql.unsafe(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE state = $1 ORDER BY created_at DESC`,
        [state],
      );
      return (rows as unknown as ConversationRow[]).map(rowToConversation);
    },

    // Unordered: the conversation desk's read model shapes and sorts in one
    // pass (newest activity first), so no SQL ordering survives to callers.
    async listConversations() {
      const rows = await sql.unsafe(`SELECT ${CONVERSATION_COLUMNS} FROM conversations`);
      return (rows as unknown as ConversationRow[]).map(rowToConversation);
    },

    // One meaningful message (visitor or staff) moves the inactivity clock
    // and slides the conversation's visitor credentials forward with it, so
    // the credential can outlive its original 24 hours exactly as long as
    // the exchange keeps going.
    async touchConversationActivity(id, at, sessionExpiresAt) {
      await sql.begin(async (tx: TransactionSql) => {
        await tx`UPDATE conversations SET last_activity_at = ${at} WHERE id = ${id}`;
        await tx`UPDATE visitor_sessions SET expires_at = ${sessionExpiresAt}
                 WHERE conversation_id = ${id} AND expires_at < ${sessionExpiresAt}`;
      });
    },

    // The guard keeps a burst of visitor messages one alert: the flag is
    // raised only when nothing is standing.
    async setConversationAttention(id, at) {
      await sql`UPDATE conversations SET attention_at = ${at}
                WHERE id = ${id} AND attention_at IS NULL`;
    },

    async clearConversationAttention(id) {
      await sql`UPDATE conversations SET attention_at = NULL WHERE id = ${id}`;
    },

    // The conditional UPDATE is the whole claim protocol: whichever request
    // flips the row owns it, and concurrent callers see zero rows changed.
    async claimConversation(id, staffId) {
      const claimed = await sql`UPDATE conversations
                SET state = 'claimed', claimed_by = ${staffId}, claimed_at = ${new Date().toISOString()}
                WHERE id = ${id} AND state = 'awaiting_staff' AND claimed_by IS NULL`;
      if (changesOf(claimed) === 0) {
        return null;
      }
      const rows = await sql.unsafe(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1`,
        [id],
      );
      return rowToConversation(rows[0] as unknown as ConversationRow);
    },

    // Release and transfer share the claim protocol's shape: the conditional
    // UPDATE only fires on a currently-claimed conversation, so a racing
    // release/transfer/claim can never clobber another's decision.
    async releaseConversation(id) {
      const released = await sql`UPDATE conversations
                SET state = 'awaiting_staff', claimed_by = NULL, claimed_at = NULL
                WHERE id = ${id} AND state = 'claimed'`;
      if (changesOf(released) === 0) {
        return null;
      }
      const rows = await sql.unsafe(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1`,
        [id],
      );
      return rowToConversation(rows[0] as unknown as ConversationRow);
    },

    async transferConversation(id, toStaffId) {
      const transferred = await sql`UPDATE conversations
                SET claimed_by = ${toStaffId}, claimed_at = ${new Date().toISOString()}
                WHERE id = ${id} AND state = 'claimed'`;
      if (changesOf(transferred) === 0) {
        return null;
      }
      const rows = await sql.unsafe(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1`,
        [id],
      );
      return rowToConversation(rows[0] as unknown as ConversationRow);
    },

    // Closure is the only writer of closed_at. The state guard makes a second
    // close a no-op rather than a silent restart of the retention clock, so
    // the stamp always measures from the real closure.
    async closeConversation(id) {
      await sql`UPDATE conversations SET state = 'closed', closed_at = ${new Date().toISOString()}
                WHERE id = ${id} AND state <> 'closed'`;
    },

    // The visitor's Clear conversation (ticket 14) in one transaction. The
    // replaced_by link is what makes retries safe: every request after the
    // first finds the same successor and only mints another credential for
    // it, so one click can never grow a second fresh chat. Revocation drops
    // the old conversation's visitor sessions and any unused return links;
    // used links, transcripts, notifications, and audit rows stay.
    async replaceConversation(oldId, successorId, session, at, closingNotice) {
      return sql.begin(async (tx: TransactionSql) => {
        const existing = await tx.unsafe(
          "SELECT state, replaced_by FROM conversations WHERE id = $1 FOR UPDATE",
          [oldId],
        );
        const old = existing[0] as
          | { state: string; replaced_by: string | null }
          | undefined;
        if (!old) {
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
          // a transaction.
          const closed = await tx`UPDATE conversations SET state = 'closed', closed_at = ${at}
                                  WHERE id = ${oldId} AND state <> 'closed'`;
          if (changesOf(closed) > 0) {
            await tx`INSERT INTO messages (id, conversation_id, role, text, created_at)
                     VALUES (${crypto.randomUUID()}, ${oldId}, 'bot', ${closingNotice}, ${at})`;
          }
          await tx`DELETE FROM visitor_sessions WHERE conversation_id = ${oldId}`;
          await tx`DELETE FROM return_tokens WHERE conversation_id = ${oldId} AND used_at IS NULL`;
          await tx`INSERT INTO conversations (id, state, created_at, visitor_last_seen_at, last_activity_at)
                   VALUES (${successorId}, 'bot_active', ${at}, ${at}, ${at})`;
          const linked = await tx`UPDATE conversations SET replaced_by = ${successorId}
                                  WHERE id = ${oldId} AND replaced_by IS NULL`;
          if (changesOf(linked) === 0) {
            // Unreachable under the row lock taken above; the guard exists so
            // any future store keeps the join-don't-duplicate rule.
            throw new Error(`conversation ${oldId} was linked to a successor concurrently`);
          }
          created = true;
        }
        await tx`INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at)
                 VALUES (${session.tokenHash}, ${resolvedId}, ${session.createdAt}, ${session.expiresAt})`;
        return { successorId: resolvedId, created };
      });
    },

    async listExpiredHistoryConversations(closedBefore, quietBefore) {
      const rows = await sql.unsafe(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations
         WHERE (state = 'closed' AND closed_at IS NOT NULL AND closed_at < $1)
            OR (state <> 'closed' AND COALESCE(last_activity_at, created_at) < $2)
         ORDER BY COALESCE(closed_at, last_activity_at, created_at)`,
        [closedBefore, quietBefore],
      );
      return (rows as unknown as ConversationRow[]).map(rowToConversation);
    },

    // One transaction removes the transcript together with every path back to
    // it. The audit rows are detached, not deleted: accountability must
    // outlive the transcript, and the explicit UPDATE (rather than a cascade)
    // keeps the foreign key strict for every other deletion path. History
    // membership is checked first under a row lock (ticket 62): returning
    // from sql.begin COMMITS, so a refusal must happen before any write — the
    // old closed-only version deleted the transcript and sessions, then
    // returned false and committed them away. The lock makes a concurrent
    // activity touch wait for this decision; the final DELETE's condition is
    // a backstop that throws, rolling everything back.
    async purgeHistoryConversation(id, quietBefore) {
      return sql.begin(async (tx: TransactionSql) => {
        const eligible = await tx`SELECT id FROM conversations
          WHERE id = ${id}
            AND (state = 'closed' OR COALESCE(last_activity_at, created_at) < ${quietBefore})
          FOR UPDATE`;
        if (eligible.length === 0) {
          return false;
        }
        await tx`UPDATE audit_log SET conversation_id = NULL WHERE conversation_id = ${id}`;
        await tx`DELETE FROM notifications WHERE conversation_id = ${id}`;
        await tx`DELETE FROM contact_requests WHERE conversation_id = ${id}`;
        await tx`DELETE FROM return_tokens WHERE conversation_id = ${id}`;
        await tx`DELETE FROM visitor_sessions WHERE conversation_id = ${id}`;
        await tx`DELETE FROM messages WHERE conversation_id = ${id}`;
        const removed = await tx`DELETE FROM conversations WHERE id = ${id}
          AND (state = 'closed' OR COALESCE(last_activity_at, created_at) < ${quietBefore})`;
        if (changesOf(removed) === 0) {
          throw new Error(`conversation ${id} left History while locked for its purge`);
        }
        return true;
      });
    },

    async recordRetentionRun(run) {
      await sql`INSERT INTO retention_runs (id, ran_at, retention_days, removed_conversations)
                VALUES (${run.id}, ${run.ranAt}, ${run.retentionDays}, ${run.removedConversations})`;
    },

    // seq breaks same-timestamp ties; the SQLite store uses rowid for this.
    async getLatestRetentionRun() {
      const rows = await sql`SELECT id, ran_at, retention_days, removed_conversations
                             FROM retention_runs ORDER BY ran_at DESC, seq DESC LIMIT 1`;
      // Counts arrive as strings through the driver (bigint-safe parsing);
      // the port's contract is numbers.
      const row = rows[0] as
        | { id: string; ran_at: string; retention_days: number | string; removed_conversations: number | string }
        | undefined;
      return row
        ? {
            id: row.id,
            ranAt: row.ran_at,
            retentionDays: Number(row.retention_days),
            removedConversations: Number(row.removed_conversations),
          }
        : null;
    },

    async createSession(session) {
      await sql`INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at)
                VALUES (${session.tokenHash}, ${session.conversationId}, ${session.createdAt}, ${session.expiresAt})`;
    },

    // An expired session no longer unlocks its conversation; the row is
    // simply ignored so the retention sweep can purge it.
    async findConversationIdByTokenHash(tokenHash) {
      const rows = await sql`SELECT conversation_id FROM visitor_sessions
                             WHERE token_hash = ${tokenHash} AND expires_at > ${new Date().toISOString()}`;
      const row = rows[0] as { conversation_id: string } | undefined;
      return row ? row.conversation_id : null;
    },

    async createReturnToken(token) {
      await sql`INSERT INTO return_tokens (token_hash, conversation_id, created_at, expires_at)
                VALUES (${token.tokenHash}, ${token.conversationId}, ${token.createdAt}, ${token.expiresAt})`;
    },

    // One transaction redeems the token AND mints the replacement visitor
    // session: a crash can never burn the link without restoring access.
    // The conditional UPDATE is atomic, so a replayed or racing link sees
    // zero rows changed and loses.
    async redeemReturnToken(tokenHash, session) {
      const now = new Date().toISOString();
      return sql.begin(async (tx: TransactionSql) => {
        const redeemed = await tx`UPDATE return_tokens SET used_at = ${now}
                                  WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > ${now}
                                  RETURNING conversation_id`;
        const row = redeemed[0] as { conversation_id: string } | undefined;
        if (!row) {
          return null;
        }
        await tx`INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at)
                 VALUES (${session.tokenHash}, ${row.conversation_id}, ${session.createdAt}, ${session.expiresAt})`;
        return row.conversation_id;
      });
    },

    async appendMessage(message) {
      await sql`INSERT INTO messages (id, conversation_id, role, text, link, choices, created_at)
                VALUES (${message.id}, ${message.conversationId}, ${message.role}, ${message.text},
                        ${message.link ?? null}, ${message.choices ? JSON.stringify(message.choices) : null},
                        ${message.createdAt})`;
    },

    async listMessages(conversationId) {
      const rows = await sql`SELECT id, conversation_id, role, text, link, choices, created_at
                             FROM messages WHERE conversation_id = ${conversationId}
                             ORDER BY created_at, seq`;
      return (rows as unknown as MessageRow[]).map(rowToMessage);
    },

    async upsertAnswerRule(rule) {
      await sql`INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at, trashed_at)
                VALUES (${rule.id}, ${rule.topic}, ${rule.response}, ${rule.link ?? null},
                        ${JSON.stringify(rule.phrases)}, ${rule.keywords ? JSON.stringify(rule.keywords) : null},
                        ${rule.status}, ${rule.updatedAt}, ${rule.publishedBy}, ${rule.reviewedAt}, ${rule.trashedAt})
                ON CONFLICT(id) DO UPDATE SET
                  topic = EXCLUDED.topic,
                  response = EXCLUDED.response,
                  link = EXCLUDED.link,
                  phrases = EXCLUDED.phrases,
                  keywords = EXCLUDED.keywords,
                  status = EXCLUDED.status,
                  updated_at = EXCLUDED.updated_at,
                  published_by = EXCLUDED.published_by,
                  reviewed_at = EXCLUDED.reviewed_at,
                  trashed_at = EXCLUDED.trashed_at`;
    },

    async getAnswerRule(id) {
      const rows = await sql.unsafe(`SELECT ${RULE_COLUMNS} FROM answer_rules WHERE id = $1`, [id]);
      const row = rows[0] as RuleRow | undefined;
      return row ? rowToRule(row) : null;
    },

    async deleteAnswerRule(id) {
      // Permanent deletion keeps the accountability record (ticket 58): the
      // audit rows are detached — the same treatment the transcript purge
      // gives them — before the rule row itself is removed. One transaction,
      // the ADR 0003 shape for multi-step invariants.
      await sql.begin(async (tx: TransactionSql) => {
        await tx`UPDATE audit_log SET rule_id = NULL WHERE rule_id = ${id}`;
        await tx`DELETE FROM answer_rules WHERE id = ${id}`;
      });
    },

    async listAnswerRules() {
      const rows = await sql.unsafe(
        `SELECT ${RULE_COLUMNS} FROM answer_rules ORDER BY updated_at DESC, seq DESC`,
      );
      return (rows as unknown as RuleRow[]).map(rowToRule);
    },

    async listPublishedAnswerRules() {
      const rows = await sql.unsafe(
        `SELECT ${RULE_COLUMNS} FROM answer_rules WHERE status = 'published'`,
      );
      return (rows as unknown as RuleRow[]).map(rowToRule);
    },

    async recordAnalyticsPresence(visitorHash, at, day) {
      // The newer instant wins regardless of beat arrival order: ISO strings
      // compare chronologically, so a late-arriving older beat can never pull
      // liveness backwards.
      await sql`INSERT INTO analytics_seen (visitor_hash, day, first_seen_at, last_seen_at)
                VALUES (${visitorHash}, ${day}, ${at}, ${at})
                ON CONFLICT(visitor_hash, day) DO UPDATE SET
                  last_seen_at = GREATEST(analytics_seen.last_seen_at, EXCLUDED.last_seen_at)`;
    },

    async recordChatCount(day) {
      await sql`INSERT INTO analytics_daily (day, chats, escalations) VALUES (${day}, 1, 0)
                ON CONFLICT(day) DO UPDATE SET chats = analytics_daily.chats + 1`;
    },

    async recordEscalationCount(day) {
      await sql`INSERT INTO analytics_daily (day, chats, escalations) VALUES (${day}, 0, 1)
                ON CONFLICT(day) DO UPDATE SET escalations = analytics_daily.escalations + 1`;
    },

    async analyticsOverview({ liveCutoff, startDay, endDay }) {
      // Counts cast to int: bigint comes back as a string through postgres.js.
      const live = (await sql`SELECT COUNT(DISTINCT visitor_hash)::int AS live FROM analytics_seen
                              WHERE last_seen_at > ${liveCutoff}`)[0] as { live: number };
      // DISTINCT: one browser beating either side of local midnight has a row
      // per day, and both can sit inside the two-minute window.
      const total = (await sql`SELECT COUNT(DISTINCT visitor_hash)::int AS visitors FROM analytics_seen
                               WHERE day >= ${startDay} AND day <= ${endDay}`)[0] as { visitors: number };
      const dailyVisitors = await sql`SELECT day, COUNT(DISTINCT visitor_hash)::int AS visitors
                                      FROM analytics_seen WHERE day >= ${startDay} AND day <= ${endDay}
                                      GROUP BY day ORDER BY day`;
      const dailyCounts = await sql`SELECT day, chats, escalations FROM analytics_daily
                                    WHERE day >= ${startDay} AND day <= ${endDay} ORDER BY day`;
      return {
        liveVisitors: live.live,
        totalVisitors: total.visitors,
        dailyVisitors: dailyVisitors as unknown as { day: string; visitors: number }[],
        dailyCounts: dailyCounts as unknown as { day: string; chats: number; escalations: number }[],
      };
    },

    async expireAnalyticsBefore(beforeDay) {
      const presence = await sql`DELETE FROM analytics_seen WHERE day < ${beforeDay}`;
      const daily = await sql`DELETE FROM analytics_daily WHERE day < ${beforeDay}`;
      return { removedPresence: changesOf(presence), removedDaily: changesOf(daily) };
    },

    async recordAudit(entry) {
      await sql`INSERT INTO audit_log (id, conversation_id, rule_id, actor_id, action, detail, created_at)
                VALUES (${entry.id}, ${entry.conversationId}, ${entry.ruleId}, ${entry.actorId},
                        ${entry.action}, ${entry.detail}, ${entry.createdAt})`;
    },

    async listConversationAudit(conversationId) {
      const rows = await sql`SELECT id, conversation_id, rule_id, actor_id, action, detail, created_at
                             FROM audit_log WHERE conversation_id = ${conversationId}
                             ORDER BY created_at, seq`;
      return (rows as unknown as AuditRow[]).map(rowToAudit);
    },

    async listRuleAudit(ruleId) {
      const rows = await sql`SELECT id, conversation_id, rule_id, actor_id, action, detail, created_at
                             FROM audit_log WHERE rule_id = ${ruleId}
                             ORDER BY created_at, seq`;
      return (rows as unknown as AuditRow[]).map(rowToAudit);
    },
  };
}
