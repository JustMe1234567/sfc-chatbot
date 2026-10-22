export type ConversationState = "bot_active" | "awaiting_staff" | "claimed" | "closed";

export interface Conversation {
  id: string;
  state: ConversationState;
  createdAt: string;
}

export type MessageRole = "visitor" | "bot" | "staff";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  link?: string;
  createdAt: string;
}

export type AnswerRuleStatus = "draft" | "published";

export interface AnswerRule {
  id: string;
  topic: string;
  response: string;
  link?: string;
  /** Approved question wordings; matched as whole phrases after normalization. */
  phrases: string[];
  /**
   * Keyword conditions. A question satisfies the rule when it contains every
   * keyword of at least one condition as a whole word.
   */
  keywords?: string[][];
  status: AnswerRuleStatus;
  updatedAt: string;
}

/**
 * Opaque visitor session credential. Only the SHA-256 hash of the token is
 * stored; the raw token exists solely in the chatbot-origin iframe's session
 * storage and expires with `expiresAt`.
 */
export interface VisitorSession {
  tokenHash: string;
  conversationId: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Persistence port for the application. The in-memory implementation backs
 * tests and local development; a Postgres-backed implementation can be added
 * without touching the HTTP layer.
 */
export interface Store {
  createConversation(conversation: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | null>;
  updateConversationState(id: string, state: ConversationState): Promise<void>;
  listConversationsByState(state: ConversationState): Promise<Conversation[]>;
  createSession(session: VisitorSession): Promise<void>;
  findConversationIdByTokenHash(tokenHash: string): Promise<string | null>;
  appendMessage(message: Message): Promise<void>;
  listMessages(conversationId: string): Promise<Message[]>;
  upsertAnswerRule(rule: AnswerRule): Promise<void>;
  listPublishedAnswerRules(): Promise<AnswerRule[]>;
}
