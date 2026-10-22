import type {
  AnswerRule,
  Conversation,
  Message,
  Store,
  VisitorSession,
} from "../domain/types";

export function createMemoryStore(): Store {
  const conversations = new Map<string, Conversation>();
  const sessionsByTokenHash = new Map<string, VisitorSession>();
  const messagesByConversation = new Map<string, Message[]>();
  const answerRules = new Map<string, AnswerRule>();

  return {
    async createConversation(conversation) {
      conversations.set(conversation.id, { ...conversation });
    },

    async getConversation(id) {
      const conversation = conversations.get(id);
      return conversation ? { ...conversation } : null;
    },

    async createSession(session) {
      sessionsByTokenHash.set(session.tokenHash, { ...session });
    },

    async findConversationIdByTokenHash(tokenHash) {
      return sessionsByTokenHash.get(tokenHash)?.conversationId ?? null;
    },

    async appendMessage(message) {
      const list = messagesByConversation.get(message.conversationId) ?? [];
      list.push({ ...message });
      messagesByConversation.set(message.conversationId, list);
    },

    async listMessages(conversationId) {
      return (messagesByConversation.get(conversationId) ?? []).map((message) => ({ ...message }));
    },

    async upsertAnswerRule(rule) {
      answerRules.set(rule.id, { ...rule });
    },

    async listPublishedAnswerRules() {
      return [...answerRules.values()]
        .filter((rule) => rule.status === "published")
        .map((rule) => ({ ...rule }));
    },
  };
}
