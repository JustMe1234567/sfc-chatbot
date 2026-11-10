export type ConversationListView = "active" | "history";

const scrollByView: Record<ConversationListView, number> = {
  active: 0,
  history: 0,
};

export function rememberConversationListScroll(
  view: ConversationListView,
  scrollTop: number,
): void {
  scrollByView[view] = Math.max(0, scrollTop);
}

export function conversationListScroll(
  view: ConversationListView,
  scrollHeight: number,
  clientHeight: number,
): number {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return Math.min(scrollByView[view], maximum);
}
