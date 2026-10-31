export type ConversationState = "bot_active" | "awaiting_staff" | "claimed" | "closed";

export interface Conversation {
  id: string;
  state: ConversationState;
  createdAt: string;
  /** User id of the staff member who claimed the conversation, if any. */
  claimedBy: string | null;
  claimedAt: string | null;
  /** Optional follow-up address the visitor left at handoff (ticket 07). */
  visitorEmail: string | null;
  /** Last authenticated visitor request; stale means the visitor departed. */
  visitorLastSeenAt: string | null;
  /** When staff closed the conversation; the retention clock starts here. */
  closedAt: string | null;
  /**
   * The one fresh conversation that replaced this one when the visitor
   * cleared their chat (ticket 14). Deliberately not a foreign key: the
   * retention sweep purges closed conversations independently.
   */
  replacedBy: string | null;
  /**
   * The inactivity clock (ticket 12): the latest visitor or staff message,
   * or creation. The conversation leaves the active lists 24 hours after it;
   * polling and presence never move it.
   */
  lastActivityAt: string;
  /**
   * The in-dashboard alert (ticket 12): set when a visitor message arrives
   * and not duplicated until staff view, reply, or claim the conversation.
   */
  attentionAt: string | null;
}

export type MessageRole = "visitor" | "bot" | "staff";

/** A keyboard-accessible action offered on a bot message. */
export interface MessageChoice {
  /** The published answer rule or reserved visitor action a selection resolves to. */
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

/** When the staff desk is open, in the college's own time zone. */
export interface SupportHours {
  /** IANA time zone the hours are expressed in. */
  timeZone: string;
  /** Open days of week, 0 = Sunday .. 6 = Saturday. */
  days: number[];
  /** Opening minute of day, local, inclusive (0 = midnight). */
  startMinute: number;
  /** Closing minute of day, local, exclusive (24 * 60 = midnight). */
  endMinute: number;
}

/** The accountability record of one security-sensitive staff action. */
export interface AuditEntry {
  id: string;
  conversationId: string | null;
  ruleId: string | null;
  /** Staff account that performed the action. */
  actorId: string;
  action:
    | "conversation_claimed"
    | "conversation_released"
    | "conversation_transferred"
    | "conversation_replied"
    | "rule_created"
    | "rule_revised"
    | "rule_published"
    | "rule_unpublished"
    | "staff_invited"
    | "staff_disabled";
  /** Human-readable context, e.g. the transfer target's display name. */
  detail: string | null;
  createdAt: string;
}

/** A single-use, expiring return credential mailed to the visitor (ticket 07). */
export interface ReturnToken {
  /** SHA-256 hash of the raw token; the raw value exists only in the email. */
  tokenHash: string;
  conversationId: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * The operator-visible record of one cleanup pass that removed something
 * (ticket 10): counts only — never message text or contact details.
 */
export interface RetentionRun {
  id: string;
  ranAt: string;
  retentionDays: number;
  removedConversations: number;
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
  /** Every conversation, any state: the conversation desk's source. */
  listConversations(): Promise<Conversation[]>;
  /**
   * The activity bump for a meaningful message (visitor or staff): moves the
   * inactivity clock and extends the conversation's visitor credentials so
   * an active exchange can run a full day past its latest message.
   */
  touchConversationActivity(id: string, at: string, sessionExpiresAt: string): Promise<void>;
  /** Raises the in-dashboard alert once per burst of visitor messages. */
  setConversationAttention(id: string, at: string): Promise<void>;
  /** Clears the alert: the conversation has been viewed or handled. */
  clearConversationAttention(id: string): Promise<void>;
  /** Records the optional follow-up address the visitor left at handoff. */
  setConversationEmail(id: string, email: string): Promise<void>;
  /** Marks the visitor as present right now (polling and posting count). */
  touchVisitorPresence(id: string): Promise<void>;
  /**
   * Atomic human takeover: claims the conversation only when it is still
   * awaiting staff and unclaimed, and reports whether the caller won.
   */
  claimConversation(id: string, staffId: string): Promise<Conversation | null>;
  /**
   * Returns a claimed conversation to the shared inbox. The conditional
   * UPDATE means only a currently-claimed conversation can be released;
   * returns null otherwise.
   */
  releaseConversation(id: string): Promise<Conversation | null>;
  /**
   * Moves a claimed conversation to another staff member atomically;
   * returns null unless the conversation is currently claimed.
   */
  transferConversation(id: string, toStaffId: string): Promise<Conversation | null>;
  /**
   * Closes a claimed conversation, stamping the moment its retention period
   * starts to run.
   */
  closeConversation(id: string): Promise<void>;
  /**
   * The visitor's Clear conversation action (ticket 14), as one transaction:
   * closes the old conversation unless already closed (staff closure's
   * timestamp is preserved), revokes its visitor sessions and unused return
   * links, and gets-or-creates the single successor conversation with the
   * given credential. Returns the resolved successor id and whether this
   * call created it (a concurrent or retried clear joins the existing
   * successor instead of minting a new one — ticket 17 counts only the
   * creation as a chat started); unknown conversations yield null.
   */
  replaceConversation(
    oldId: string,
    successorId: string,
    session: Omit<VisitorSession, "conversationId">,
    at: string,
    closingNotice: string,
  ): Promise<{ successorId: string; created: boolean } | null>;
  /**
   * Closed conversations whose retention period ended before the cutoff
   * instant: the retention sweep's candidates.
   */
  listConversationsClosedBefore(cutoffIso: string): Promise<Conversation[]>;
  /**
   * Removes one closed conversation with everything that makes it reachable
   * or attributable to a visitor: messages, visitor sessions, return tokens,
   * and notification records. Audit entries survive with their conversation
   * link cleared. Returns false unless a closed conversation was removed.
   */
  purgeClosedConversation(id: string): Promise<boolean>;
  /** Records one cleanup pass for the operator (counts only). */
  recordRetentionRun(run: RetentionRun): Promise<void>;
  /** The most recent recorded cleanup pass, if any. */
  getLatestRetentionRun(): Promise<RetentionRun | null>;
  createSession(session: VisitorSession): Promise<void>;
  findConversationIdByTokenHash(tokenHash: string): Promise<string | null>;
  createReturnToken(token: ReturnToken): Promise<void>;
  /**
   * Redeems a return token exactly once while unexpired, minting the
   * replacement visitor session for that token's conversation in the same
   * transaction; unknown, used, or expired tokens yield null without side
   * effects.
   */
  redeemReturnToken(
    tokenHash: string,
    session: Omit<VisitorSession, "conversationId">,
  ): Promise<string | null>;
  /** Records one security-sensitive staff action for accountability. */
  recordAudit(entry: AuditEntry): Promise<void>;
  listConversationAudit(conversationId: string): Promise<AuditEntry[]>;
  listRuleAudit(ruleId: string): Promise<AuditEntry[]>;
  appendMessage(message: Message): Promise<void>;
  listMessages(conversationId: string): Promise<Message[]>;
  upsertAnswerRule(rule: AnswerRule): Promise<void>;
  getAnswerRule(id: string): Promise<AnswerRule | null>;
  /** Every rule, drafts included: the dashboard's answer-management view. */
  listAnswerRules(): Promise<AnswerRule[]>;
  listPublishedAnswerRules(): Promise<AnswerRule[]>;
  /**
   * Records an anonymous browser's presence beat (ticket 17): one row per
   * browser per reporting day, the newer of the two instants kept. The hash
   * is a SHA-256 of a client-generated random UUID — no IP, email, or chat
   * identity is ever involved.
   */
  recordAnalyticsPresence(visitorHash: string, at: string, day: string): Promise<void>;
  /** Advances the day's chat and escalation rollups (ticket 17). */
  recordChatCount(day: string): Promise<void>;
  recordEscalationCount(day: string): Promise<void>;
  /**
   * The analytics aggregates for one report (ticket 17): the live snapshot
   * at the given cutoff instant, distinct browsers in the day range, and the
   * per-day visitor and rollup counts. Aggregate queries only.
   */
  analyticsOverview(range: {
    liveCutoff: string;
    startDay: string;
    endDay: string;
  }): Promise<{
    liveVisitors: number;
    totalVisitors: number;
    dailyVisitors: { day: string; visitors: number }[];
    dailyCounts: { day: string; chats: number; escalations: number }[];
  }>;
  /**
   * Removes analytics rows from before the retention cutoff day (ticket 17),
   * returning how many rows of each kind went. Runs independently of
   * transcript retention.
   */
  expireAnalyticsBefore(beforeDay: string): Promise<{
    removedPresence: number;
    removedDaily: number;
  }>;
}
