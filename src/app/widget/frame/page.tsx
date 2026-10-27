"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "@/domain/limits";
import type { MessageChoice, MessageRole } from "@/domain/types";
import {
  dropSession as dropStoredSession,
  readSession,
  writeSession,
  type StoredSession,
} from "@/lib/visitorSession";
import styles from "./frame.module.css";

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
  const [emailPrompt, setEmailPrompt] = useState<"asking" | "saved" | "declined">("asking");
  const [emailAddress, setEmailAddress] = useState("");
  const [emailError, setEmailError] = useState("");
  const sessionRef = useRef<StoredSession | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Bumped whenever the visitor's conversation is replaced (ticket 14): any
  // in-flight request from an older generation must never repaint the chat.
  const generationRef = useRef(0);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "busy">("idle");

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
  // reconnect recovers everything from the stored conversation. Each tick is
  // tagged with the current generation so a response from a cleared
  // conversation can never repaint the fresh chat (ticket 14).
  useEffect(() => {
    const timer = setInterval(() => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }
      const generation = generationRef.current;
      fetch(`/api/v1/conversations/${encodeURIComponent(session.id)}/messages`, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
        .then(async (response) => {
          if (generationRef.current !== generation) {
            return;
          }
          if (response.status === 401 || response.status === 404) {
            dropSession();
            return;
          }
          if (!response.ok) {
            return; // Transient network trouble; the next tick retries.
          }
          const body = await response.json();
          // The clear can land inside the parse await.
          if (generationRef.current !== generation) {
            return;
          }
          applyHistory(body);
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
    dropStoredSession();
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
    const generation = generationRef.current;
    setError("");
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "visitor", text },
    ]);
    setQuestion("");
    setSending(true);
    try {
      let response = await postMessage(session, text, choice);
      if (generationRef.current !== generation) {
        return; // The chat was cleared mid-send; the message dies with it.
      }
      if (response.status === 401 || response.status === 404) {
        // The stored credential stopped working: start over once. The old
        // transcript belongs to the lapsed session, so the fresh chat view
        // starts empty (ticket 12).
        dropSession();
        setMessages([]);
        response = await postMessage(await ensureSession(), text, choice);
        if (generationRef.current !== generation) {
          return;
        }
        if (!response || !response.ok) {
          showError();
          return;
        }
      }
      if (response.status === 409) {
        const conflict = (await response.json()) as { error?: { code?: string } };
        if (
          conflict.error?.code === "conversation_closed" ||
          // Quiet for a day: the old conversation is history; the visitor's
          // question starts a fresh chat instead (ticket 12).
          conflict.error?.code === "conversation_inactive"
        ) {
          // Staff closed this conversation: drop the credential, start a
          // fresh one, and carry the visitor's question over so it is not
          // swallowed by the closure.
          dropSession();
          setMessages([]);
          setHandoff(false);
          setClaimed(false);
          setError("");
          setEmailPrompt("asking");
          const fresh = await ensureSession();
          if (!fresh || generationRef.current !== generation) {
            return;
          }
          response = await postMessage(fresh, text, choice);
          if (generationRef.current !== generation) {
            return;
          }
          if (!response || !response.ok) {
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
      // A clear can land inside the parse await; nothing from the old
      // conversation may repaint the fresh chat afterwards.
      if (generationRef.current !== generation) {
        return;
      }
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

  async function submitEmail(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const session = sessionRef.current ?? readSession();
    const trimmed = emailAddress.trim();
    if (!session) {
      setEmailError("Your chat session expired. Start a new chat to reach staff.");
      return;
    }
    if (trimmed.length === 0) {
      setEmailError("Enter an email address, or choose \u2018No thanks\u2019.");
      return;
    }
    try {
      const response = await fetch(
        `/api/v1/conversations/${encodeURIComponent(session.id)}/email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ email: trimmed }),
        },
      );
      if (response.ok) {
        setEmailPrompt("saved");
        setEmailError("");
        return;
      }
      const failure = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setEmailError(failure?.error?.message ?? "Could not save the email. Try again.");
    } catch {
      setEmailError("Could not save the email. Try again.");
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await send(question.trim());
  }

  /**
   * The visitor's Clear conversation (ticket 14): ends this chat server-side
   * and swaps in the one fresh conversation the server returns, blanking the
   * view. A request that fails with 401/404 already ended server-side (the
   * credential was revoked or expired), so the fallback starts a plain fresh
   * conversation instead — the visitor still sees exactly one new chat. The
   * generation bump strands every in-flight request from the old chat.
   */
  async function confirmClear(): Promise<void> {
    const session = sessionRef.current ?? readSession();
    if (!session || clearState === "busy") {
      return;
    }
    const generation = generationRef.current;
    setClearState("busy");
    try {
      let response = await fetch(
        `/api/v1/conversations/${encodeURIComponent(session.id)}/clear`,
        { method: "POST", headers: { Authorization: `Bearer ${session.token}` } },
      );
      if (response.status === 401 || response.status === 404) {
        response = await fetch("/api/v1/conversations", { method: "POST" });
      }
      if (generationRef.current !== generation) {
        return;
      }
      if (!response.ok) {
        showError();
        return;
      }
      const fresh = (await response.json()) as StoredSession;
      // The double-clear race can land inside the parse await.
      if (generationRef.current !== generation) {
        return;
      }
      generationRef.current = generation + 1;
      writeSession(fresh);
      sessionRef.current = fresh;
      setMessages([]);
      setHandoff(false);
      setClaimed(false);
      setEmailPrompt("asking");
      setQuestion("");
      setError("");
    } catch {
      showError();
    } finally {
      setClearState("idle");
      inputRef.current?.focus();
    }
  }

  return (
    <main className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cropped-SFC-Final-Logo-Single.png" alt="" className={styles.crest} />
          <span className={styles.title}>Chat with us</span>
        </span>
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
      {(handoff || claimed) && emailPrompt === "asking" ? (
        <div className={styles.emailBox}>
          <p className={styles.emailText}>
            Leaving? Add your email and staff can send you a secure one-time
            link back to this conversation if they reply after you go.
          </p>
          <form className={styles.emailForm} onSubmit={submitEmail}>
            <label className={styles.srOnly} htmlFor="sfcw-email">
              Your email (optional)
            </label>
            <input
              id="sfcw-email"
              type="email"
              className={styles.emailInput}
              placeholder="you@example.org"
              value={emailAddress}
              onChange={(event) => setEmailAddress(event.target.value)}
            />
            <button type="submit" className={styles.emailSave}>
              Email me a link later
            </button>
          </form>
          <button
            type="button"
            className={styles.emailDecline}
            onClick={() => setEmailPrompt("declined")}
          >
            No thanks — I&apos;ll stay in the chat
          </button>
          {emailError ? (
            <p className={styles.emailError} role="alert">
              {emailError}
            </p>
          ) : null}
        </div>
      ) : null}
      {(handoff || claimed) && emailPrompt === "saved" ? (
        <p className={styles.emailNote}>
          Thanks — if staff reply after you leave, you&apos;ll get an email with a
          one-time link back to this chat.
        </p>
      ) : null}
      {(handoff || claimed) && emailPrompt === "declined" ? (
        <p className={styles.emailNote}>
          No email saved: staff can reply only while this chat stays open on
          your device. If you leave the page, they cannot follow up with you.
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
      {messages.length > 0 ? (
        <div className={styles.clearRow}>
          {clearState === "idle" ? (
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => setClearState("confirm")}
            >
              Clear conversation
            </button>
          ) : (
            <div className={styles.confirmBox} role="group" aria-label="Confirm clear conversation">
              <p className={styles.confirmText}>
                Staff will keep a record of this chat on their side. You lose
                access to it here, and a fresh chat starts.
              </p>
              <div className={styles.confirmButtons}>
                <button
                  type="button"
                  className={styles.confirmClear}
                  disabled={clearState === "busy"}
                  onClick={() => void confirmClear()}
                >
                  {clearState === "busy" ? "Clearing…" : "Clear chat"}
                </button>
                <button
                  type="button"
                  className={styles.confirmKeep}
                  disabled={clearState === "busy"}
                  onClick={() => setClearState("idle")}
                >
                  Keep chatting
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}
