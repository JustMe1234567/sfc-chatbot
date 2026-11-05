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
import { startPresenceHeartbeat } from "@/widget/presence";
import { historyPollDue, OPEN_HISTORY_INTERVAL_MS } from "@/widget/historyPolling";
import { DEFAULT_WELCOME_MESSAGE } from "@/domain/welcome";
import {
  emptyArrivalState,
  nextArrivalState,
  type ArrivalMessage,
} from "@/widget/arrivals";
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

/** How long the email saved/declined confirmations stay on screen before
    removing themselves (ticket 38): one glance is enough, and the transcript
    reclaims the space for the rest of the conversation. */
const EMAIL_NOTE_TTL_MS = 10_000;

/**
 * The suggested-questions strip (ticket 18): a two-row, horizontally
 * scrollable rail pinned directly above the composer, rendered once the
 * conversation exists — the fresh state stacks its own suggestions instead
 * (ticket 46). Tracks where the horizontal overflow stands so a soft edge
 * fade can hint at more content without relying on a scrollbar that touch
 * devices hide.
 */
function TopicsStrip({
  topics,
  disabled,
  onPick,
}: {
  topics: TopicButton[];
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const updateEdges = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }
    // One-pixel tolerances keep sub-pixel scroll rounding from flickering
    // the fades on and off at either end.
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    setEdges({ start: strip.scrollLeft > 1, end: strip.scrollLeft < maxScroll - 1 });
  }, []);

  useEffect(() => {
    updateEdges();
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateEdges);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [updateEdges, topics.length]);

  return (
    <div className={styles.topicsShell}>
      <div
        ref={stripRef}
        className={styles.topics}
        role="group"
        aria-label="Suggested questions"
        onScroll={updateEdges}
      >
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className={styles.topicButton}
            disabled={disabled}
            onClick={() => onPick(topic.question)}
            onFocus={(event) => {
              event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
          >
            <span className={styles.topicLabel}>{topic.topic}</span>
          </button>
        ))}
      </div>
      <span
        className={`${styles.topicsFade} ${styles.fadeStart} ${edges.start ? styles.fadeOn : ""}`}
        aria-hidden="true"
      />
      <span
        className={`${styles.topicsFade} ${styles.fadeEnd} ${edges.end ? styles.fadeOn : ""}`}
        aria-hidden="true"
      />
    </div>
  );
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
  // Once the saved/declined confirmation has outlived its stay (ticket 38),
  // it stays gone for the conversation; a fresh chat shows it again. The
  // leaving flag plays the exit fade before the unmount (one frame of slack
  // past the 180ms motion, the loader's convention).
  const [emailNoteExpired, setEmailNoteExpired] = useState(false);
  const [emailNoteLeaving, setEmailNoteLeaving] = useState(false);
  const sessionRef = useRef<StoredSession | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Bumped whenever the visitor's conversation is replaced (ticket 14): any
  // in-flight request from an older generation must never repaint the chat.
  const generationRef = useRef(0);
  const historyInFlightRef = useRef(false);
  const lastHistoryRequestAtRef = useRef(0);
  // Synchronous mirror of the sending flag: state updates land after React
  // renders, but the duplicate-send guard must hold during awaits.
  const sendingRef = useRef(false);
  // Arrival bookkeeping (ticket 15): which messages have ever been on
  // screen, so entrance animations run once for genuinely new messages and
  // never for history restores, polling refreshes, or the persisted twin of
  // a just-sent optimistic bubble.
  const arrivalStateRef = useRef(emptyArrivalState());
  const [arrivingIds, setArrivingIds] = useState<Set<string>>(new Set());
  const [noticesArrive, setNoticesArrive] = useState(false);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "busy">("idle");
  // The fresh-chat greeting (ticket 41): null until this mount has decided
  // the widget is genuinely empty and the published text has settled. The
  // timestamp rides along (ticket 46) so the pair stays atomic.
  const [welcome, setWelcome] = useState<{ text: string; at: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const confirmClearRef = useRef<HTMLButtonElement>(null);

  const showError = useCallback(() => {
    setError("The chat is temporarily unavailable. Please try again.");
  }, []);

  function applyArrivals(messages: ArrivalMessage[], animate: boolean): void {
    const { state, arrivals } = nextArrivalState(arrivalStateRef.current, messages, animate);
    arrivalStateRef.current = state;
    if (arrivals.size > 0) {
      setArrivingIds((current) => new Set([...current, ...arrivals]));
    }
  }

  /** A fresh conversation starts with a clean arrival slate. */
  function resetArrivals(): void {
    arrivalStateRef.current = emptyArrivalState();
    setArrivingIds(new Set());
    setNoticesArrive(false);
  }

  /** The handoff/claim notice animates only when it appears live, never on
      a history restore; every conversation-state application funnels here. */
  function applyConversationState(state: string, animate: boolean): void {
    setHandoff(state === "awaiting_staff");
    setClaimed(state === "claimed");
    if (animate && state !== "bot_active") {
      setNoticesArrive(true);
    }
    if (!animate) {
      setNoticesArrive(false);
    }
  }

  const applyHistory = useCallback(
    (body: { conversation: { state: string }; messages: DisplayedMessage[] }, animate: boolean) => {
      applyArrivals(body.messages, animate);
      setMessages(body.messages);
      applyConversationState(body.conversation.state, animate);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Load the surviving history once on mount: a reload of the WordPress page
  // reloads this iframe, which re-reads chatbot-origin session storage. A
  // mount with no stored session is a genuinely fresh chat, eligible for the
  // greeting (ticket 41).
  const welcomeEligibleRef = useRef(false);
  useEffect(() => {
    const session = readSession();
    if (!session) {
      welcomeEligibleRef.current = true;
      return;
    }
    sessionRef.current = session;
    const generation = generationRef.current;
    historyInFlightRef.current = true;
    lastHistoryRequestAtRef.current = Date.now();
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
          showError();
          return;
        }
        const body = await response.json();
        if (generationRef.current === generation) {
          applyHistory(body, false);
        }
      })
      .catch(() => {
        if (generationRef.current === generation) {
          showError();
        }
      })
      .finally(() => {
        historyInFlightRef.current = false;
      });
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

  /** The published greeting text, or the default when the read fails —
      ticket 41's safe fallback keeps the chat usable either way. */
  async function fetchWelcomeText(): Promise<string> {
    try {
      const response = await fetch("/api/v1/welcome");
      if (!response.ok) {
        return DEFAULT_WELCOME_MESSAGE;
      }
      return ((await response.json()) as { text: string }).text ?? DEFAULT_WELCOME_MESSAGE;
    } catch {
      return DEFAULT_WELCOME_MESSAGE;
    }
  }

  /** Shows the greeting with its captured-at local timestamp (ticket 46):
      the stamp is presentation-only and captured once per fresh cycle so
      re-renders never shift it. */
  function greet(): void {
    void fetchWelcomeText().then((text) => {
      setWelcome({
        text,
        at: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      });
    });
  }

  // The fresh-chat greeting (ticket 41): fetched from the published setting
  // so a dashboard edit reaches the next widget open without a redeploy.
  // Only a genuinely empty widget greets — an existing conversation restores
  // its history instead — and the greeting never opens a conversation or
  // mints a visitor credential; the first question does that.
  useEffect(() => {
    if (!welcomeEligibleRef.current) {
      return;
    }
    greet();
  }, []);

  // The saved/declined email confirmations leave on their own (ticket 38):
  // the timer starts when the visitor's choice renders the note, plays the
  // exit fade, then unmounts; each stage's cleanup cancels it if the note's
  // reason disappears mid-stay.
  useEffect(() => {
    if (emailPrompt === "asking" || emailNoteExpired) {
      return;
    }
    if (emailNoteLeaving) {
      const unmount = setTimeout(() => setEmailNoteExpired(true), 200);
      return () => clearTimeout(unmount);
    }
    const timer = setTimeout(() => setEmailNoteLeaving(true), EMAIL_NOTE_TTL_MS);
    return () => clearTimeout(timer);
  }, [emailPrompt, emailNoteExpired, emailNoteLeaving]);

  // Anonymous presence (ticket 17): the embedded page beats while it is
  // actually visible, so staff see browsers on the site — not only visitors
  // who opened the chat, and never a background tab. This iframe is mounted
  // for the page's life whether or not the chat is open, so liveness follows
  // page visibility, not the frame's; a hidden page stops beating at once.
  // The identifier is a random UUID in this origin's localStorage, shared by
  // the visitor's tabs and rotated on the server's retention schedule.
  useEffect(() => {
    return startPresenceHeartbeat({
      storage: window.localStorage,
      visibility: () => document.visibilityState,
      send: async (browserId) => {
        const response = await fetch("/api/v1/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ browserId }),
        });
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as { retentionDays?: number };
      },
    });
  }, []);

  // Keep the open chat live, but stop fetching its entire history every three
  // seconds while the panel is closed. A closed, visible panel still refreshes
  // within the server's 60-second visitor-presence window; a hidden host page
  // pauses requests and catches up on return (ticket 59).
  useEffect(() => {
    let panelOpen = window.parent === window;
    let hostVisible = document.visibilityState === "visible";
    const poll = (immediate = false) => {
      const session = sessionRef.current;
      const now = Date.now();
      if (!historyPollDue({
        hasSession: session !== null,
        visible: hostVisible && document.visibilityState === "visible",
        inFlight: historyInFlightRef.current,
        open: panelOpen,
        lastRequestAt: lastHistoryRequestAtRef.current,
        now,
        immediate,
      })) {
        return;
      }
      if (!session) {
        return;
      }
      historyInFlightRef.current = true;
      lastHistoryRequestAtRef.current = now;
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
          applyHistory(body, true);
        })
        .catch(() => {})
        .finally(() => {
          historyInFlightRef.current = false;
        });
    };
    const onState = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== "sfcw:state") {
        return;
      }
      const wasOpen = panelOpen;
      const wasVisible = hostVisible;
      panelOpen = event.data.open === true;
      hostVisible = event.data.visible === true;
      if (hostVisible && (!wasVisible || (panelOpen && !wasOpen))) {
        poll(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        poll(true);
      }
    };
    window.addEventListener("message", onState);
    document.addEventListener("visibilitychange", onVisibility);
    if (window.parent !== window) {
      window.parent.postMessage({ type: "sfcw:ready" }, "*");
    }
    const timer = window.setInterval(() => poll(), OPEN_HISTORY_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("message", onState);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyHistory]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (menuOpen) {
      menuItemRef.current?.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    if (clearState === "confirm") {
      confirmClearRef.current?.focus();
    }
  }, [clearState]);

  function requestClose(): void {
    // The loader owns the iframe; Escape inside the frame asks it to close.
    if (window.parent !== window) {
      window.parent.postMessage({ type: "sfcw:close" }, "*");
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }
      if (menuOpen) {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (clearState === "confirm") {
        event.preventDefault();
        setClearState("idle");
        menuButtonRef.current?.focus();
        return;
      }
      requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearState, menuOpen]);

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

  /** A fresh conversation asks about the email again, with the note's
      lifecycle state reset alongside the prompt (they always travel). */
  function resetEmailPrompt(): void {
    setEmailPrompt("asking");
    setEmailNoteLeaving(false);
    setEmailNoteExpired(false);
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
    // The ref guard closes the pending-send race (ticket 18): the state flag
    // alone only flips after ensureSession's await, so a second chip click
    // during the very first message's session setup could double-send.
    if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH || sendingRef.current) {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    const generation = generationRef.current;
    setError("");
    // The optimistic bubble is a genuine arrival; the poller's later
    // persisted twin is silenced by the arrival state's word-based key.
    const localMessage: DisplayedMessage = {
      id: `local-${Date.now()}`,
      role: "visitor",
      text,
    };
    applyArrivals([localMessage], true);
    setMessages((current) => [...current, localMessage]);
    setQuestion("");
    // A failed send must not leave a ghost bubble (ticket 43's failure
    // recovery): the optimistic entry is removed on every final failure
    // path, and the poller restores the truth if the request actually
    // landed. The carried-over paths (closure, inactive) keep it on purpose.
    const dropOptimistic = () =>
      setMessages((current) => current.filter((message) => message.id !== localMessage.id));
    try {
      const session = await ensureSession();
      if (!session) {
        dropOptimistic();
        return;
      }
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
        resetArrivals();
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
        const conflict = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
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
          resetArrivals();
          applyConversationState("bot_active", false);
          setError("");
          resetEmailPrompt();
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
        } else if (conflict.error?.code === "awaiting_staff") {
          // The waiting lock (ticket 43): the escalation landed while this
          // message was in flight. Drop the bubble and hand the words back.
          dropOptimistic();
          if (!choice) {
            setQuestion(text);
          }
          setError(
            conflict.error.message ?? "Waiting for a staff member to take over.",
          );
          return;
        } else {
          dropOptimistic();
          showError();
          return;
        }
      } else if (!response.ok) {
        dropOptimistic();
        const failure = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(
          failure?.error?.message ?? "The chat is temporarily unavailable. Please try again.",
        );
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
      applyConversationState(body.conversation.state, true);
      if (body.reply) {
        const reply = body.reply as DisplayedMessage;
        applyArrivals([reply], true);
        setMessages((current) => [...current, reply]);
      }
    } catch {
      dropOptimistic();
      showError();
    } finally {
      sendingRef.current = false;
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
      resetArrivals();
      applyConversationState("bot_active", false);
      resetEmailPrompt();
      setQuestion("");
      setError("");
      // A fresh conversation greets again (ticket 41): fetch the published
      // wording so the visitor sees the current setting, timestamp fresh
      // with it (ticket 46).
      greet();
    } catch {
      showError();
    } finally {
      setClearState("idle");
      inputRef.current?.focus();
    }
  }

  // The confirmations render only while a handoff/claim stands and their
  // stay has not run out (ticket 38); the leaving flag plays the exit fade.
  const showEmailNote = (handoff || claimed) && !emailNoteExpired;
  const emailNoteClass = `${styles.emailNote} ${emailNoteLeaving ? styles.noteLeave : ""}`;
  // Staff help requested but nobody claimed yet: the composer locks (ticket
  // 43). Claiming — or a fresh conversation after Clear — re-enables it.
  const composerLocked = handoff && !claimed;

  // The fresh state (ticket 46): no transcript yet. It gets the reference's
  // composed layout — substantial header, greeting with avatar and
  // timestamp, stacked suggestions — and flips to the normal conversation
  // layout the moment the first visitor message exists.
  const freshStart = messages.length === 0;

  // The ticket-39 overflow menu, shared by both header compositions. Its
  // gating (only with messages) and behavior are unchanged; a genuinely
  // fresh chat has nothing to clear yet.
  const headerMenu = (
    <span className={styles.menuWrap}>
      <button
        ref={menuButtonRef}
        type="button"
        className={styles.menuButton}
        aria-label="Conversation options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={sending || clearState === "busy"}
        onClick={() => {
          if (!sendingRef.current && clearState !== "busy") {
            setMenuOpen((open) => !open);
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {menuOpen ? (
        <span
          className={styles.menuPanel}
          role="menu"
          aria-label="Conversation options"
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              event.preventDefault();
              menuItemRef.current?.focus();
            }
          }}
        >
          <button
            ref={menuItemRef}
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={sending || clearState === "busy"}
            onClick={() => {
              if (sendingRef.current || clearState === "busy") {
                return;
              }
              setMenuOpen(false);
              setClearState("confirm");
            }}
          >
            Clear conversation
          </button>
        </span>
      ) : null}
      {clearState !== "idle" ? (
        <span
          className={styles.confirmBox}
          role="group"
          aria-label="Confirm clear conversation"
        >
          <span className={styles.confirmText}>
            Staff will keep a record of this chat on their side. You lose
            access to it here, and a fresh chat starts.
          </span>
          <span className={styles.confirmButtons}>
            <button
              ref={confirmClearRef}
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
              onClick={() => {
                setClearState("idle");
                menuButtonRef.current?.focus();
              }}
            >
              Keep chatting
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );

  // The transcript's children, shared by the fresh and conversation layouts.
  // The greeting row (ticket 46) composes the reference's hierarchy: crest
  // avatar left, the bot bubble, then the subtle local timestamp. Still
  // presentation-only — announced by the log's live region, never stored.
  const logContent = (
    <>
      {welcome !== null ? (
        <li key="welcome" className={`${styles.messageFresh} ${styles.arrive}`}>
          <span className={styles.botAvatar} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/cropped-SFC-Final-Logo-Single.png"
              alt=""
              className={styles.botAvatarImg}
            />
          </span>
          <span className={`${styles.message} ${styles.bot} ${styles.welcomeBubble}`}>
            {welcome.text}
          </span>
          <time className={styles.welcomeTime} aria-hidden="true">
            {welcome.at}
          </time>
        </li>
      ) : null}
      {messages.map((message, index) => (
        <li
          key={message.id}
          className={`${styles.message} ${styles[message.role]}`}
          data-arrive={arrivingIds.has(message.id) ? "" : undefined}
          onAnimationEnd={
            arrivingIds.has(message.id)
              ? () =>
                  setArrivingIds((current) => {
                    if (!current.has(message.id)) {
                      return current;
                    }
                    const next = new Set(current);
                    next.delete(message.id);
                    return next;
                  })
              : undefined
          }
        >
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
                  disabled={sending || composerLocked}
                  onClick={() => void send(choice.topic, choice.id)}
                >
                  {choice.topic}
                </button>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </>
  );

  return (
    <main className={styles.panel}>
      {freshStart ? (
        // The reference's substantial header (ticket 46): the college identity
        // centered on its white plate, the close control at the corner. The
        // ticket-39 overflow menu appears with the conversation chrome — a
        // genuinely fresh chat has nothing to clear yet, and the menu's one
        // action needs a conversation to act on.
        <header className={`${styles.header} ${styles.headerFresh}`}>
          <span className={styles.headerFreshTop}>
            <button
              type="button"
              className={styles.close}
              aria-label="Close chat"
              onClick={requestClose}
            >
              &times;
            </button>
          </span>
          <span className={styles.brandPlate} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/cropped-SFC-Final-Logo-Single.png"
              alt=""
              className={styles.brandPlateImg}
            />
          </span>
          <span className={styles.brandNameFresh}>Springfield College</span>
        </header>
      ) : (
        <header className={styles.header}>
          <span className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/cropped-SFC-Final-Logo-Single.png" alt="" className={styles.crest} />
            <span className={styles.title}>Chat with us</span>
          </span>
          <span className={styles.headerActions}>
            {messages.length > 0 ? headerMenu : null}
            <button
              type="button"
              className={styles.close}
              aria-label="Close chat"
              onClick={requestClose}
            >
              &times;
            </button>
          </span>
        </header>
      )}
      {topics.length === 0 ? (
        // Only the topicless widget needs the guidance line (ticket 38): with
        // chips visible they are the affordance, and during a handoff the
        // notice below already says the bot has paused.
        <p className={styles.intro}>Ask us your question.</p>
      ) : null}
      {handoff ? (
        <p className={`${styles.handoff} ${noticesArrive ? styles.arrive : ""}`}>
          College staff will reply in this chat. Automated answers are paused.
        </p>
      ) : null}
      {claimed ? (
        // Announced once when staff take over (ticket 43) — the moment the
        // composer unlocks.
        <p
          className={`${styles.handoff} ${noticesArrive ? styles.arrive : ""}`}
          role="status"
        >
          A college staff member has joined the conversation and will reply here.
        </p>
      ) : null}
      {(handoff || claimed) && emailPrompt === "asking" ? (
        <div className={`${styles.emailBox} ${noticesArrive ? styles.arrive : ""}`}>
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
      {showEmailNote && emailPrompt === "saved" ? (
        <p className={emailNoteClass}>
          Thanks — if staff reply after you leave, you&apos;ll get an email with a
          one-time link back to this chat.
        </p>
      ) : null}
      {showEmailNote && emailPrompt === "declined" ? (
        <p className={emailNoteClass}>
          No email saved: staff can reply only while this chat stays open on
          your device. If you leave the page, they cannot follow up with you.
        </p>
      ) : null}
      {freshStart ? (
        // The fresh start area (ticket 46): greeting and stacked suggestions
        // scroll together while the composer stays put below.
        <div className={styles.startArea}>
          <ol
            className={`${styles.log} ${styles.logFresh}`}
            ref={logRef}
            role="log"
            aria-label="Messages"
            aria-live="polite"
          >
            {logContent}
          </ol>
          {topics.length > 0 ? (
            <div
              className={`${styles.freshSuggestions} ${styles.arrive}`}
              role="group"
              aria-label="Suggested questions"
            >
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  className={styles.freshSuggest}
                  disabled={sending || composerLocked}
                  onClick={() => void send(topic.question)}
                >
                  {topic.topic}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <ol className={styles.log} ref={logRef} role="log" aria-label="Messages" aria-live="polite">
          {logContent}
        </ol>
      )}
      {/* The live region stays mounted so announcements are reliable; an
          empty region is zero-height, so it costs the transcript nothing
          while no error stands (ticket 38). */}
      <p className={styles.status} role="status">
        {error}
      </p>
      {composerLocked ? (
        // Announced once when the lock begins (ticket 43); it leaves the
        // stage to the claimed notice when staff take over.
        <p className={styles.waiting} role="status">
          Waiting for a staff member to take over…
        </p>
      ) : null}
      {!freshStart && topics.length > 0 ? (
        // The compact persistent strip is the conversation's suggestion rail
        // (ticket 18); the fresh state stacks its own instead (ticket 46).
        <TopicsStrip
          topics={topics}
          disabled={sending || composerLocked}
          onPick={(question) => void send(question)}
        />
      ) : null}
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
          disabled={composerLocked}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          className={styles.send}
          disabled={sending || composerLocked}
          aria-busy={sending || undefined}
        >
          {sending ? (
            // Conversation-first pending feedback (ticket 42): the active
            // verb plus the shared spinner pattern, locally styled because
            // the iframe is self-contained (ticket 16).
            <>
              <span className={styles.pendingSpinner} aria-hidden="true" />
              Sending…
            </>
          ) : (
            "Send"
          )}
        </button>
      </form>
    </main>
  );
}
