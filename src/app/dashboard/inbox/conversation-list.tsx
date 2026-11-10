"use client";

import { useLayoutEffect, useRef, type ReactNode, type UIEvent } from "react";
import {
  conversationListScroll,
  rememberConversationListScroll,
  type ConversationListView,
} from "./conversation-list-scroll";
import styles from "../dashboard.module.css";

/** The desk list remembers a separate in-session offset for each tab. */
export default function ConversationList({
  view,
  children,
}: {
  view: ConversationListView;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    list.scrollTop = conversationListScroll(view, list.scrollHeight, list.clientHeight);
    return () => rememberConversationListScroll(view, list.scrollTop);
  }, [view]);

  function rememberScroll(event: UIEvent<HTMLElement>) {
    rememberConversationListScroll(view, event.currentTarget.scrollTop);
  }

  return (
    <nav
      ref={listRef}
      className={styles.deskList}
      aria-label="Conversation list"
      onScroll={rememberScroll}
    >
      {children}
    </nav>
  );
}
