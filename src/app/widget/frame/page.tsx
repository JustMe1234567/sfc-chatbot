"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "@/domain/limits";
import type { MessageRole } from "@/domain/types";
import styles from "./frame.module.css";

interface StoredSession {
  id: string;
  token: string;
  expiresAt: string;
}

interface DisplayedMessage {
  id: string;
  role: MessageRole;
  text: string;
  link?: string;
}

const STORAGE_KEY = "sfc_chatbot_v1_session";

function readSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof session.id === "string" &&
      typeof session.token === "string" &&
      typeof session.expiresAt === "string"
    ) {
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return { id: session.id, token: session.token, expiresAt: session.expiresAt };
    }
    return null;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (blocked cookies); the chat still works for
    // this page view, but history will not survive a reload.
  }
}

function isHttpLink(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export default function WidgetFrame() {
  const [messages, setMessages] = useState<DisplayedMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const sessionRef = useRef<StoredSession | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const showError = useCallback(() => {
    setError("The chat is temporarily unavailable. Please try again.");
  }, []);

  // Load the surviving history once on mount: a reload of the WordPress page
  // reloads this iframe, which re-reads chatbot-origin session storage.
  useEffect(() => {
    const session = readSession();
    if (!session) {
      return;
    }
    sessionRef.current = session;
    fetch(`/api/v1/conversations/${encodeURIComponent(session.id)}/messages`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 404) {
          window.sessionStorage.removeItem(STORAGE_KEY);
          sessionRef.current = null;
          return;
        }
        if (!response.ok) {
          showError();
          return;
        }
        const body = (await response.json()) as { messages: DisplayedMessage[] };
        setMessages(body.messages);
      })
      .catch(showError);
  }, [showError]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function requestClose(): void {
    // The loader owns the iframe; Escape inside the frame asks it to close.
    if (window.parent !== window) {
      window.parent.postMessage({ type: "sfcw:close" }, "*");
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        requestClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function ensureSession(): Promise<StoredSession | null> {
    const existing = sessionRef.current ?? readSession();
    if (existing) {
      sessionRef.current = existing;
      return existing;
    }
    try {
      const response = await fetch("/api/v1/conversations", { method: "POST" });
      if (!response.ok) {
        showError();
        return null;
      }
      const session = (await response.json()) as StoredSession;
      writeSession(session);
      sessionRef.current = session;
      return session;
    } catch {
      showError();
      return null;
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const text = question.trim();
    if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH || sending) {
      return;
    }
    const session = await ensureSession();
    if (!session) {
      return;
    }
    setError("");
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "visitor", text },
    ]);
    setQuestion("");
    setSending(true);
    try {
      const response = await fetch(
        `/api/v1/conversations/${encodeURIComponent(session.id)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ text }),
        },
      );
      if (response.status === 401 || response.status === 404) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        sessionRef.current = null;
        showError();
        return;
      }
      if (!response.ok) {
        showError();
        return;
      }
      const body = (await response.json()) as { reply: DisplayedMessage };
      setMessages((current) => [...current, body.reply]);
    } catch {
      showError();
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <main className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.title}>Chat with us</span>
        <button
          type="button"
          className={styles.close}
          aria-label="Close chat"
          onClick={requestClose}
        >
          &times;
        </button>
      </header>
      <p className={styles.intro}>Ask us about admissions, courses, or fees.</p>
      <ol className={styles.log} ref={logRef} role="log" aria-label="Messages" aria-live="polite">
        {messages.map((message) => (
          <li key={message.id} className={`${styles.message} ${styles[message.role]}`}>
            {message.text}
            {message.link && isHttpLink(message.link) && (
              <a href={message.link} target="_blank" rel="noopener noreferrer">
                Visit the college page
              </a>
            )}
          </li>
        ))}
      </ol>
      <p className={styles.status} role="status">
        {error}
      </p>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.srOnly} htmlFor="sfcw-question">
          Your question
        </label>
        <textarea
          id="sfcw-question"
          ref={inputRef}
          className={styles.input}
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Type your question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className={styles.send} disabled={sending}>
          Send
        </button>
      </form>
    </main>
  );
}
