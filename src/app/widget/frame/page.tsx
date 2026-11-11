"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH } from "@/domain/limits";
import { distinctOptions, topicLabelsShadowedByOptions } from "@/domain/handoffOptions";
import type { MessageChoice, MessageRole } from "@/domain/types";
import {
  dropSession as dropStoredSession,
  readSession,
  writeSession,
  type StoredSession,
} from "@/lib/visitorSession";
import { startPresenceHeartbeat } from "@/widget/presence";
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
  // The click-to-handoff options (ticket 67): configured wordings whose
  // click hands off to staff, fetched with the topics on every mount.
  const [handoffOptions, setHandoffOptions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // The contact gate (ticket 66): every chat starts at the required contact
  // form, and the composer, topics, and suggestions stay hidden until the
  // server has accepted the details. A stored session flips it off
  // optimistically on mount; the first authorized read confirms it.
  const [contactRequired, setContactRequired] = useState(true);
  const [contact, setContact] = useState({ fullName: "", email: "", phone: "" });
  const [contactError, setContactError] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const sessionRef = useRef<StoredSession | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Bumped whenever the visitor's conversation is replaced (ticket 14): any
  // in-flight request from an older generation must never repaint the chat.
  const generationRef = useRef(0);
  // Synchronous mirror of the sending flag: state updates land after React
  // renders, but the duplicate-send guard must hold during awaits.
  const sendingRef = useRef(false);
  // Synchronous mirror of the gate's pending flag: the duplicate-submit
  // guard must hold during awaits, exactly like the send guard.
  const contactBusyRef = useRef(false);
  // Arrival bookkeeping (ticket 15): which messages have ever been on
  // screen, so entrance animations run once for genuinely new messages and
  // never for history restores, polling refreshes, or the persisted twin of
  // a just-sent optimistic bubble.
  const arrivalStateRef = useRef(emptyArrivalState());
  const [arrivingIds, setArrivingIds] = useState<Set<string>>(new Set());
  const [noticesArrive, setNoticesArrive] = useState(false);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "busy">("idle");
  // The fresh-chat greeting (ticket 41): null until a conversation the
  // visitor can actually use starts out empty and the published text has
  // settled. The timestamp rides along (ticket 46) so the pair stays atomic.
  const [welcome, setWelcome] = useState<{ text: string; at: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const historyRequestRef = useRef<string | null>(null);
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
    (body: {
      conversation: { state: string };
      messages: DisplayedMessage[];
      contactRequired?: boolean;
    }, animate: boolean) => {
      applyArrivals(body.messages, animate);
      setMessages(body.messages);
      applyConversationState(body.conversation.state, animate);
      // The server owns the gate (ticket 66): a conversation without
      // accepted contact details brings the form back, whatever the client
      // assumed.
      setContactRequired(body.contactRequired === true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // One authorized history read (ticket 61), shared by the mount load and
  // the poller. A sessionless visitor fetches nothing; a send in flight
  // holds the poller off so a mid-send read cannot repaint over the
  // optimistic bubble or the bot reply the send response carries. The
  // in-flight latch is keyed by generation and session so requests never
  // stack, and generation checks keep stale responses from repainting a
  // cleared or replaced chat (ticket 14).
  const refreshHistory = useCallback(
    async (animate = true, reportError = false) => {
      const session = sessionRef.current;
      if (!session || sendingRef.current) {
        return;
      }
      const generation = generationRef.current;
      const requestKey = `${generation}:${session.id}`;
      if (historyRequestRef.current === requestKey) {
        return;
      }
      historyRequestRef.current = requestKey;
      try {
        const response = await fetch(
          `/api/v1/conversations/${encodeURIComponent(session.id)}/messages`,
          { headers: { Authorization: `Bearer ${session.token}` } },
        );
        if (generationRef.current !== generation || sessionRef.current?.id !== session.id) {
          return;
        }
        if (response.status === 401 || response.status === 404) {
          dropSession();
          setContactRequired(true);
          return;
        }
        if (!response.ok) {
          if (reportError) showError();
          return;
        }
        const body = await response.json();
        if (generationRef.current === generation && sessionRef.current?.id === session.id) {
          applyHistory(body, animate);
        }
      } catch {
        if (
          reportError &&
          generationRef.current === generation &&
          sessionRef.current?.id === session.id
        ) {
          showError();
        }
      } finally {
        if (historyRequestRef.current === requestKey) {
          historyRequestRef.current = null;
        }
      }
    },
    [applyHistory, showError],
  );

  // Load the surviving history once on mount: a reload of the WordPress page
  // reloads this iframe, which re-reads chatbot-origin session storage. The
  // gate stays on until the server confirms the conversation's accepted
  // details (ticket 66) — a stored session alone proves nothing.
  useEffect(() => {
    const session = readSession();
    if (!session) {
      return;
    }
    sessionRef.current = session;
    void refreshHistory(false, true);
  }, [refreshHistory]);

  // The panel's open state comes from the loader (ticket 61): after
  // hydration the frame asks with sfcw:ready and applies only sfcw:state
  // messages its parent window sent. Outside an embed (a standalone dev
  // preview) the frame is the visible chat, so it reads as open.
  useEffect(() => {
    if (window.parent === window) {
      setPanelOpen(true);
      // The standalone preview is the open panel too (ticket 26): same
      // deliberate target under the keyboard.
      focusPanelTarget(false);
      return;
    }
    function onPanelState(event: MessageEvent): void {
      if (event.source === window.parent && event.data?.type === "sfcw:state") {
        setPanelOpen(event.data.open === true);
        if (event.data.open === true) {
          // The open landed (ticket 26): message tasks run after the loader
          // has already unhidden the frame, so the deliberate target is
          // focusable here — on every open, not just first load. The ring
          // follows the opener's modality via the loader's viaKeyboard
          // flag (absent on stale cached loaders: mouse-safe default).
          focusPanelTarget(event.data.viaKeyboard === true);
        }
      }
    }
    window.addEventListener("message", onPanelState);
    window.parent.postMessage({ type: "sfcw:ready" }, "*");
    return () => window.removeEventListener("message", onPanelState);
  }, []);

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
    // The handoff options (ticket 67) ride along: same public, silent-failure
    // contract, so an editor's change lands on the next widget open.
    fetch("/api/v1/handoff-options")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { options: string[] }) : null,
      )
      .then((body) => {
        if (body) {
          setHandoffOptions(body.options);
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

  // An open chat checks every second (ticket 61). The closed frame keeps
  // its original three-second cadence, and opening a saved chat checks
  // immediately.
  useEffect(() => {
    if (panelOpen) {
      void refreshHistory();
    }
    const timer = setInterval(() => void refreshHistory(), panelOpen ? 1000 : 3000);
    return () => clearInterval(timer);
  }, [panelOpen, refreshHistory]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!contactRequired) {
      inputRef.current?.focus();
    }
  }, [contactRequired]);

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

  /**
   * Ticket 26: an open panel puts a deliberate target under the keyboard —
   * the composer when it is usable, otherwise the always-present close
   * button (fresh contact gate, or the ticket-43 waiting lock). The ring
   * follows the opener's modality: the iframe document has no interaction
   * history of its own, so the plain :focus-visible heuristic would light a
   * ring for mouse users too; focusVisible is pinned from the loader's
   * flag instead. Browsers without the option ignore it (graceful).
   */
  function focusPanelTarget(viaKeyboard: boolean): void {
    const focusOptions: FocusOptions & { focusVisible?: boolean } = {
      focusVisible: viaKeyboard,
    };
    const input = inputRef.current;
    if (input && !input.disabled) {
      input.focus(focusOptions);
      return;
    }
    closeButtonRef.current?.focus(focusOptions);
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

  function dropSession(): void {
    // The stored credential stopped working; the contact form returns
    // (ticket 66) and the next accepted submission starts fresh.
    dropStoredSession();
    sessionRef.current = null;
  }

  async function postMessage(
    session: StoredSession,
    text: string,
    choice?: string,
    handoffClick = false,
  ): Promise<Response> {
    return fetch(`/api/v1/conversations/${encodeURIComponent(session.id)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      // A selection is just the rule id: the transcript records the picked
      // topic, exactly as the API does server-side. A handoff option (67)
      // rides in its own field so the server can tell the deliberate click
      // from typed text, which keeps normal answer matching.
      body: JSON.stringify(choice ? { choice } : handoffClick ? { handoffOption: text } : { text }),
    });
  }

  /**
   * The contact gate's submission (ticket 66). A conversation this mount
   * already holds a credential for — the successor after Clear chat, or a
   * legacy session — is unlocked in place; otherwise the same details start
   * exactly one fresh conversation. A credential that died, or a
   * conversation that closed or went quiet, falls through to the fresh
   * start, so no retry path can duplicate a conversation.
   */
  async function submitContact(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (contactBusyRef.current) {
      return;
    }
    contactBusyRef.current = true;
    setContactBusy(true);
    setContactError("");
    const details = {
      fullName: contact.fullName.trim(),
      email: contact.email.trim(),
      phone: contact.phone.trim(),
    };
    try {
      const existing = sessionRef.current ?? readSession();
      if (existing) {
        const response = await fetch(
          `/api/v1/conversations/${encodeURIComponent(existing.id)}/contact`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${existing.token}`,
            },
            body: JSON.stringify(details),
          },
        );
        if (response.ok) {
          contactAccepted();
          return;
        }
        if (response.status === 401 || response.status === 404 || response.status === 409) {
          // Nothing here is resumable — the credential died or the
          // conversation closed or went quiet: start fresh instead.
          dropSession();
        } else {
          const failure = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setContactError(failure?.error?.message ?? "Could not save your details. Try again.");
          return;
        }
      }
      const response = await fetch("/api/v1/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setContactError(failure?.error?.message ?? "Could not start the chat. Try again.");
        return;
      }
      const session = (await response.json()) as StoredSession;
      writeSession(session);
      sessionRef.current = session;
      showLockedFreshChat();
      contactAccepted();
    } catch {
      setContactError("Could not start the chat. Try again.");
    } finally {
      contactBusyRef.current = false;
      setContactBusy(false);
    }
  }

  /** The gate opens: the entered values carry into the transcript's labels,
      and a conversation that starts (or unlocks) empty greets (ticket 41).
      An unlocked chat with a transcript keeps its history instead. */
  function contactAccepted(): void {
    setContactRequired(false);
    setContactError("");
    setError("");
    if (messages.length === 0) {
      greet();
    }
    inputRef.current?.focus();
  }

  /** Returns a dead conversation to the gate with the visitor's words kept
      in the composer (ticket 66): the form comes back, the transcript view
      starts empty like any fresh chat, and nothing is auto-submitted. A
      handoff click (67) has no words to hand back — restoring the option
      would invite a typed send, which deliberately does not hand off. */
  function returnToGate(text: string, choice?: string, handoffClick = false): void {
    dropSession();
    showLockedFreshChat();
    setError("");
    if (!choice && !handoffClick) {
      setQuestion(text);
    }
  }

  /** A fresh, locked view: empty transcript, clean arrivals, the gate on.
      Every path that ends a usable conversation funnels here. */
  function showLockedFreshChat(): void {
    setMessages([]);
    setWelcome(null);
    resetArrivals();
    applyConversationState("bot_active", false);
    setContactRequired(true);
  }

  async function send(text: string, choice?: string, handoffClick = false): Promise<void> {
    // The ref guard closes the pending-send race (ticket 18): the state flag
    // alone only flips after awaits, so a second chip click during a slow
    // request could double-send.
    if (
      text.length === 0 ||
      text.length > MAX_MESSAGE_LENGTH ||
      sendingRef.current ||
      contactRequired
    ) {
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
    // landed.
    const dropOptimistic = () =>
      setMessages((current) => current.filter((message) => message.id !== localMessage.id));
    try {
      const session = sessionRef.current ?? readSession();
      if (!session) {
        dropOptimistic();
        returnToGate(text, choice, handoffClick);
        return;
      }
      const response = await postMessage(session, text, choice, handoffClick);
      if (generationRef.current !== generation) {
        return; // The chat was cleared mid-send; the message dies with it.
      }
      if (response.status === 401 || response.status === 404) {
        // The stored credential stopped working: the gate returns (66) and
        // the visitor's words stay in the composer for the fresh chat.
        dropOptimistic();
        returnToGate(text, choice, handoffClick);
        return;
      }
      if (response.status === 409) {
        const conflict = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
        if (conflict.error?.code === "contact_required") {
          // The server demanded the details on the conversation this mount
          // already holds: the gate returns, but the credential stays — the
          // form's submission unlocks this conversation in place (66).
          dropOptimistic();
          setError("");
          if (!choice && !handoffClick) {
            setQuestion(text);
          }
          setContactRequired(true);
          return;
        }
        if (
          conflict.error?.code === "conversation_closed" ||
          // Quiet for a day: the old conversation is history (ticket 12) —
          // the gate returns, and the next chat starts with a submission.
          conflict.error?.code === "conversation_inactive"
        ) {
          dropOptimistic();
          returnToGate(text, choice, handoffClick);
          return;
        }
        if (conflict.error?.code === "awaiting_staff") {
          // The waiting lock (ticket 43): the escalation landed while this
          // message was in flight. Drop the bubble and hand the words back.
          dropOptimistic();
          if (!choice && !handoffClick) {
            setQuestion(text);
          }
          setError(
            conflict.error.message ?? "Waiting for a staff member to take over.",
          );
          return;
        }
        dropOptimistic();
        showError();
        return;
      }
      if (!response.ok) {
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

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await send(question.trim());
  }

  /**
   * The visitor's Clear conversation (ticket 14): ends this chat server-side
   * and swaps in the one fresh conversation the server returns. That
   * successor starts without contact details (ticket 66), so the gate
   * returns before anything can be asked. A request that fails with 401/404
   * already ended server-side (the credential was revoked or expired), so
   * the gate simply returns — the visitor still starts exactly one new
   * chat. The generation bump strands every in-flight request from the old
   * chat.
   */
  async function confirmClear(): Promise<void> {
    const session = sessionRef.current ?? readSession();
    if (!session || clearState === "busy") {
      return;
    }
    const generation = generationRef.current;
    setClearState("busy");
    try {
      const response = await fetch(
        `/api/v1/conversations/${encodeURIComponent(session.id)}/clear`,
        { method: "POST", headers: { Authorization: `Bearer ${session.token}` } },
      );
      if (response.status === 401 || response.status === 404) {
        // The credential was already dead (revoked or expired): the clear
        // ended server-side either way, so the gate's next accepted
        // submission starts the one fresh chat.
        dropSession();
        generationRef.current = generation + 1;
        showLockedFreshChat();
        setQuestion("");
        setError("");
        return;
      }
      if (!response.ok) {
        // The conversation survives server-side; the visitor stays in it.
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
      // The successor starts without contact details (ticket 66), so the
      // gate returns before anything can be asked.
      showLockedFreshChat();
      setQuestion("");
      setError("");
    } catch {
      showError();
    } finally {
      setClearState("idle");
    }
  }

  // Staff help requested but nobody claimed yet: the composer locks (ticket
  // 43). Claiming — or a fresh conversation after Clear — re-enables it.
  const composerLocked = handoff && !claimed;

  // A configured option that spells the same suggestion as a published
  // rule's topic wins the shared chip (ticket 67): clicking it must notify
  // staff, so no duplicate chip renders for the same phrase. Repeated
  // spellings inside the configured list collapse to their first occurrence.
  const visibleHandoffOptions = distinctOptions(handoffOptions);
  const shadowedTopics = topicLabelsShadowedByOptions(
    topics.map((topic) => topic.topic),
    visibleHandoffOptions,
  );
  const visibleTopics = topics.filter((topic) => !shadowedTopics.has(topic.topic));

  // The click-to-handoff options (ticket 67): visible on the fresh chat and
  // again after bot answers; hidden while the visitor types a nonblank
  // question or a send/reply is pending — they return once the input is
  // cleared or the bot has answered — and gone for good in the waiting and
  // claimed states, where there is no second handoff to request. They
  // hide rather than disable: a chip that invites a staff handoff must not
  // linger as an affordance it can no longer honor.
  const handoffOptionsVisible =
    !contactRequired &&
    !sending &&
    !handoff &&
    !claimed &&
    question.trim().length === 0 &&
    visibleHandoffOptions.length > 0;

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
              Visit the college page{" "}
              <span className={styles.srOnly}>(opens in a new tab)</span>
            </a>
          )}
          {index === messages.length - 1 && message.choices && !contactRequired ? (
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
              ref={closeButtonRef}
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
              ref={closeButtonRef}
              className={styles.close}
              aria-label="Close chat"
              onClick={requestClose}
            >
              &times;
            </button>
          </span>
        </header>
      )}
      {visibleTopics.length === 0 && !contactRequired ? (
        // Only the topicless widget needs the guidance line (ticket 38): with
        // chips visible they are the affordance, and during a handoff the
        // notice below already says the bot has paused.
        <p className={styles.intro}>Ask us your question.</p>
      ) : null}
      {handoff ? (
        // The awaiting event's one live announcer (ticket 25): the takeover
        // is the service's core escalation event, so this paragraph carries
        // its announcement — the waiting line below stays purely visual,
        // since two polite regions firing together would read it twice.
        <p
          className={`${styles.handoff} ${noticesArrive ? styles.arrive : ""}`}
          role="status"
        >
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
          {!contactRequired && visibleTopics.length > 0 ? (
            <div
              className={`${styles.freshSuggestions} ${styles.arrive}`}
              role="group"
              aria-label="Suggested questions"
            >
              {visibleTopics.map((topic) => (
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
          {handoffOptionsVisible ? (
            // The click-to-handoff options (ticket 67), stacked in their
            // configured order: a click notifies staff and pauses the bot.
            <div
              className={`${styles.freshSuggestions} ${styles.arrive}`}
              role="group"
              aria-label="Options to reach our staff"
            >
              {visibleHandoffOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={styles.freshSuggest}
                  onClick={() => void send(option, undefined, true)}
                >
                  {option}
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
          while no error stands (ticket 38). A failed send is actionable
          now, not whenever (ticket 29), so it announces assertively. */}
      <p className={styles.status} role="alert">
        {error}
      </p>
      {composerLocked ? (
        // Visual companion to the handoff notice's announcement — ticket 43
        // made this line the announcer, ticket 25 moved that duty to the
        // notice above (one announcer per event, no double reading).
        <p className={styles.waiting}>Waiting for a staff member to take over…</p>
      ) : null}
      {!freshStart && !contactRequired && visibleTopics.length > 0 ? (
        // The compact persistent strip is the conversation's suggestion rail
        // (ticket 18); the fresh state stacks its own instead (ticket 46).
        <TopicsStrip
          topics={visibleTopics}
          disabled={sending || composerLocked}
          onPick={(question) => void send(question)}
        />
      ) : null}
      {!freshStart && handoffOptionsVisible ? (
        // The ongoing options rail (ticket 67): the conversation's own
        // click-to-handoff chips, in the same visual language as the
        // suggestion rail above, appearing and hiding with the same rules.
        <div className={styles.topicsShell}>
          <div className={styles.topics} role="group" aria-label="Options to reach our staff">
            {visibleHandoffOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.topicButton}
                onClick={() => void send(option, undefined, true)}
              >
                <span className={styles.topicLabel}>{option}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {contactRequired ? (
        // The gate (ticket 66): every new chat starts here — three clearly
        // labeled required fields and brief copy, with no way to dismiss it.
        // Closing the widget changes nothing: reopening shows the same form.
        <form className={styles.contactForm} onSubmit={submitContact}>
          <p className={styles.contactIntro}>
            Please share your contact details to start this chat.
          </p>
          <label className={styles.contactLabel} htmlFor="sfcw-name">
            Full name
          </label>
          <input
            id="sfcw-name"
            className={styles.contactInput}
            autoComplete="name"
            required
            maxLength={MAX_NAME_LENGTH}
            placeholder="Jane Doe"
            value={contact.fullName}
            onChange={(event) =>
              setContact({ ...contact, fullName: event.target.value })
            }
          />
          <label className={styles.contactLabel} htmlFor="sfcw-email">
            Email
          </label>
          <input
            id="sfcw-email"
            type="email"
            className={styles.contactInput}
            autoComplete="email"
            required
            placeholder="you@example.org"
            value={contact.email}
            onChange={(event) =>
              setContact({ ...contact, email: event.target.value })
            }
          />
          <label className={styles.contactLabel} htmlFor="sfcw-phone">
            Phone
          </label>
          <input
            id="sfcw-phone"
            type="tel"
            className={styles.contactInput}
            autoComplete="tel"
            required
            placeholder="(555) 555-0100"
            value={contact.phone}
            onChange={(event) =>
              setContact({ ...contact, phone: event.target.value })
            }
          />
          <button
            type="submit"
            className={styles.contactSubmit}
            disabled={contactBusy}
            aria-busy={contactBusy || undefined}
          >
            {contactBusy ? (
              <>
                <span className={styles.pendingSpinner} aria-hidden="true" />
                Starting…
              </>
            ) : (
              "Start chat"
            )}
          </button>
          {contactError ? (
            <p className={styles.contactError} role="alert">
              {contactError}
            </p>
          ) : null}
        </form>
      ) : (
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
      )}
    </main>
  );
}
