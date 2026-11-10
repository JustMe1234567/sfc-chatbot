import type {
  AnswerRule,
  AuditEntry,
  Conversation,
  Message,
} from "../domain/types";

/**
 * Row-to-domain mappers shared by the SQLite and Postgres stores: both
 * backends hand back the same snake_case columns for the application's own
 * tables, and both must answer identical domain objects.
 */

export interface ConversationRow {
  id: string;
  state: Conversation["state"];
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  visitor_last_seen_at: string | null;
  closed_at: string | null;
  last_activity_at: string | null;
  attention_at: string | null;
  replaced_by: string | null;
}

export const CONVERSATION_COLUMNS =
  "id, state, created_at, claimed_by, claimed_at, visitor_name, visitor_email, visitor_phone, visitor_last_seen_at, closed_at, last_activity_at, attention_at, replaced_by";

export function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    state: row.state,
    createdAt: row.created_at,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    visitorName: row.visitor_name,
    visitorEmail: row.visitor_email,
    visitorPhone: row.visitor_phone,
    visitorLastSeenAt: row.visitor_last_seen_at,
    closedAt: row.closed_at,
    replacedBy: row.replaced_by,
    // The migration backfills every row, so null here only guards a
    // hand-edited database: fall back to creation.
    lastActivityAt: row.last_activity_at ?? row.created_at,
    attentionAt: row.attention_at,
  };
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: Message["role"];
  text: string;
  link: string | null;
  choices: string | null;
  created_at: string;
}

export function rowToMessage(row: MessageRow): Message {
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

export interface RuleRow {
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
  trashed_at: string | null;
}

export const RULE_COLUMNS =
  "id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at, trashed_at";

export function rowToRule(row: RuleRow): AnswerRule {
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
    trashedAt: row.trashed_at,
  };
}

export interface AuditRow {
  id: string;
  conversation_id: string | null;
  rule_id: string | null;
  actor_id: string;
  action: AuditEntry["action"];
  detail: string | null;
  created_at: string;
}

export function rowToAudit(row: AuditRow): AuditEntry {
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
