import type { DatabaseSync } from "node:sqlite";
import type {
  AnswerRule,
  Conversation,
  Message,
  Store,
} from "../domain/types";

interface ConversationRow {
  id: string;
  state: Conversation["state"];
  created_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Message["role"];
  text: string;
  link: string | null;
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
}

interface SessionRow {
  token_hash: string;
  conversation_id: string;
  created_at: string;
  expires_at: string;
}

function rowToConversation(row: ConversationRow): Conversation {
  return { id: row.id, state: row.state, createdAt: row.created_at };
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    text: row.text,
    ...(row.link ? { link: row.link } : {}),
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
  };
}

export function createSqliteStore(db: DatabaseSync): Store {
  return {
    async createConversation(conversation) {
      db.prepare(
        "INSERT INTO conversations (id, state, created_at) VALUES (?, ?, ?)",
      ).run(conversation.id, conversation.state, conversation.createdAt);
    },

    async getConversation(id) {
      const row = db
        .prepare("SELECT id, state, created_at FROM conversations WHERE id = ?")
        .get(id) as ConversationRow | undefined;
      return row ? rowToConversation(row) : null;
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

    async appendMessage(message) {
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, text, link, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        message.id,
        message.conversationId,
        message.role,
        message.text,
        message.link ?? null,
        message.createdAt,
      );
    },

    async listMessages(conversationId) {
      const rows = db
        .prepare(
          // rowid breaks same-timestamp ties deterministically in SQLite; the
          // Postgres store for ticket 11 needs its own monotonic tie-break.
          "SELECT id, conversation_id, role, text, link, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
        )
        .all(conversationId) as unknown as MessageRow[];
      return rows.map(rowToMessage);
    },

    async upsertAnswerRule(rule) {
      db.prepare(
        `INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           topic = excluded.topic,
           response = excluded.response,
           link = excluded.link,
           phrases = excluded.phrases,
           keywords = excluded.keywords,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      ).run(
        rule.id,
        rule.topic,
        rule.response,
        rule.link ?? null,
        JSON.stringify(rule.phrases),
        rule.keywords ? JSON.stringify(rule.keywords) : null,
        rule.status,
        rule.updatedAt,
      );
    },

    async listPublishedAnswerRules() {
      const rows = db
        .prepare(
          "SELECT id, topic, response, link, phrases, keywords, status, updated_at FROM answer_rules WHERE status = 'published'",
        )
        .all() as unknown as RuleRow[];
      return rows.map(rowToRule);
    },
  };
}
