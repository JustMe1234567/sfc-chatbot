"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "@/domain/limits";
import type { MessageChoice, MessageRole } from "@/domain/types";
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
  choices?: MessageChoice[];
}

/** A published answer rule's topic button, served by /api/v1/topics. */
interface TopicButton {
  id: string;
  topic: string;
  question: string;
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
  const [handoff, setHandoff] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [question, setQuestion] = useState("");
  const [topics, setTopics] = useState<TopicButton[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const sessionRef = useRef<StoredSession | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const showError = useCallback(() => {
    setError("The chat is temporarily unavailable. Please try again.");
  }, []);

  const applyHistory = useCallback(
    (body: { conversation: { state: string }; messages: DisplayedMessage[] }) => {
      setMessages(body.messages);
      setHandoff(body.conversation.state === "awaiting_staff");
      setClaimed(body.conversation.state === "claimed");
    },
    [],
  );

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
          dropSession();
          return;
        }
        if (!response.ok) {
          showError();
          return;
        }
        applyHistory(await response.json());
      })
      .catch(showError);
  }, [showError, applyHistory]);

  // Published topic buttons, re-fetched on every widget open so staff
  // publishing changes what visitors see without a redeploy. Failure is
  // silent: the chat remains usable by typing a question.
  useEffect(() => {
    fetch("/api/v1/topics")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { topics: TopicButton[] }) : null,
      )
      .then((body) => {
        if (body) {
          setTopics(body.topics);
        }
      })
      .catch(() => {});
  }, []);

  // Authorized polling: new staff messages appear promptly, and a reload or
  // reconnect recovers everything from the stored conversation.
  useEffect(() => {
    const timer = setInterval(() => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }
      fetch(`/api/v1/conversations/${encodeURIComponent(session.id)}/messages`, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
        .then(async (response) => {
          if (response.status === 401 || response.status === 404) {
            dropSession();
            return;
          }
          if (!response.ok) {
            return; // Transient network trouble; the next tick retries.
          }
          applyHistory(await response.json());
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [applyHistory]);

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

  function dropSession(): void {
    // The stored credential stopped working; the next question starts fresh.
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
    sessionRef.current = null;
  }

  async function postMessage(
    session: StoredSession | null,
    text: string,
    choice?: string,
  ): Promise<Response> {
    if (!session) {
      showError();
      return new Response(null, { status: 400 });
    }
    return fetch(`/api/v1/conversations/${encodeURIComponent(session.id)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      // A selection is just the rule id: the transcript records the picked
      // topic, exactly as the API does server-side.
      body: JSON.stringify(choice ? { choice } : { text }),
    });
  }

  async function send(text: string, choice?: string): Promise<void> {
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
      let response = await postMessage(session, text, choice);
      if (response.status === 401 || response.status === 404) {
        // The stored credential stopped working: start over once.
        dropSession();
        response = await postMessage(await ensureSession(), text, choice);
        if (!response || !response.ok) {
          showError();
          return;
        }
      }
      if (response.status === 409) {
        const conflict = (await response.json()) as { error?: { code?: string } };
        if (conflict.error?.code === "conversation_closed") {
          // Staff closed this conversation: drop the credential, start a
          // fresh one, and carry the visitor's question over so it is not
          // swallowed by the closure.
          dropSession();
          setMessages([]);
          setHandoff(false);
          setClaimed(false);
          setError("");
          const fresh = await ensureSession();
          if (!fresh) {
            return;
          }
          response = await postMessage(fresh, text, choice);
          if (!response.ok) {
            showError();
            return;
          }
        } else {
          showError();
          return;
        }
      } else if (!response.ok) {
        showError();
        return;
      }
      const body = (await response.json()) as {
        conversation: { state: string };
        reply: DisplayedMessage | null;
      };
      setHandoff(body.conversation.state === "awaiting_staff");
      setClaimed(body.conversation.state === "claimed");
      if (body.reply) {
        setMessages((current) => [...current, body.reply as DisplayedMessage]);
      }
    } catch {
      showError();
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await send(question.trim());
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
      <p className={styles.intro}>
        {topics.length > 0 ? "Pick a topic, or type your question." : "Ask us your question."}
      </p>
      {topics.length > 0 && messages.length === 0 ? (
        <div className={styles.topics}>
          {topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              className={styles.topicButton}
              disabled={sending}
              onClick={() => void send(topic.question)}
            >
              {topic.topic}
            </button>
          ))}
        </div>
      ) : null}
      {handoff ? (
        <p className={styles.handoff}>
          College staff will reply in this chat. Automated answers are paused.
        </p>
      ) : null}
      {claimed ? (
        <p className={styles.handoff}>
          A college staff member has joined the conversation and will reply here.
        </p>
      ) : null}
      <ol className={styles.log} ref={logRef} role="log" aria-label="Messages" aria-live="polite">
        {messages.map((message, index) => (
          <li key={message.id} className={`${styles.message} ${styles[message.role]}`}>
            {message.text}
            {message.link && isHttpLink(message.link) && (
              <a href={message.link} target="_blank" rel="noopener noreferrer">
                Visit the college page
              </a>
            )}
            {index === messages.length - 1 && message.choices ? (
              <div className={styles.choices}>
                {message.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    className={styles.topicButton}
                    disabled={sending}
                    onClick={() => void send(choice.topic, choice.id)}
                  >
                    {choice.topic}
                  </button>
                ))}
              </div>
            ) : null}
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
