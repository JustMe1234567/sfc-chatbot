export type ConversationState = "bot_active" | "awaiting_staff" | "claimed" | "closed";

export interface Conversation {
  id: string;
  state: ConversationState;
  createdAt: string;
  /** User id of the staff member who claimed the conversation, if any. */
  claimedBy: string | null;
  claimedAt: string | null;
}

export type MessageRole = "visitor" | "bot" | "staff";

/** A topic choice offered on a bot message when several rules matched. */
export interface MessageChoice {
  /** The published answer rule a selection resolves to. */
  id: string;
  topic: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  link?: string;
  /** Offered topics; a selection is answered from the chosen rule. */
  choices?: MessageChoice[];
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
  /** Staff account that last published the rule; null while never published. */
  publishedBy: string | null;
  /** When the live content was last approved by publishing; null while draft-only. */
  reviewedAt: string | null;
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
  /**
   * Atomic human takeover: claims the conversation only when it is still
   * awaiting staff and unclaimed, and reports whether the caller won.
   */
  claimConversation(id: string, staffId: string): Promise<Conversation | null>;
  createSession(session: VisitorSession): Promise<void>;
  findConversationIdByTokenHash(tokenHash: string): Promise<string | null>;
  appendMessage(message: Message): Promise<void>;
  listMessages(conversationId: string): Promise<Message[]>;
  upsertAnswerRule(rule: AnswerRule): Promise<void>;
  getAnswerRule(id: string): Promise<AnswerRule | null>;
  /** Every rule, drafts included: the dashboard's answer-management view. */
  listAnswerRules(): Promise<AnswerRule[]>;
  listPublishedAnswerRules(): Promise<AnswerRule[]>;
}
