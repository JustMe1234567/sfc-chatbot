"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { MAX_MESSAGE_LENGTH } from "@/domain/limits";
import type { MessageChoice, MessageRole } from "@/domain/types";
import {
  dropSession as dropStoredSession,
  readSession,
  writeSession,
  type StoredSession,
} from "@/lib/visitorSession";
import { emptyArrivalState, nextArrivalState, type ArrivalMessage } from "@/widget/arrivals";

/** One message shown in the transcript: a persisted message or the
    optimistic local bubble (its id carries the `local-` prefix). */
export interface DisplayedMessage {
  id: string;
  role: MessageRole;
  text: string;
  link?: string;
  choices?: MessageChoice[];
}

// The history poll's two cadences, named like the dashboard's AutoRefresh
// intervals (ticket 34).
const OPEN_POLL_MS = 1_000;
const CLOSED_POLL_MS = 3_000;

/**
 * The visitor's conversation stream (ticket 33 extraction of the frame
 * page): the loaded history, its poll cadence, the send-retry ladder with
 * its optimistic bubble, the arrival bookkeeping, and the conversation
 * session itself. The contact-gate and clear-conversation hooks build on
 * the session substrate this hook exposes; the page renders from its state.
 */
export function useConversationStream({
  panelOpen,
  clearWelcome,
  inputRef,
}: {
  panelOpen: boolean;
  clearWelcome: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}): {
  messages: DisplayedMessage[];
  handoff: boolean;
  claimed: boolean;
  error: string;
  sending: boolean;
  contactRequired: boolean;
  question: string;
  setQuestion: (text: string) => void;
  arrivingIds: Set<string>;
  noticesArrive: boolean;
  send: (text: string, choice?: string, handoffClick?: boolean) => Promise<void>;
  dismissArrival: (id: string) => void;
  showError: () => void;
  clearError: () => void;
  isSending: () => boolean;
  sessionRef: RefObject<StoredSession | null>;
  generationRef: RefObject<number>;
  dropSession: () => void;
  adoptSession: (session: StoredSession) => void;
  bumpGeneration: () => void;
  showLockedFreshChat: () => void;
  setContactRequired: (required: boolean) => void;
} {
  const [messages, setMessages] = useState<DisplayedMessage[]>([]);
  const [handoff, setHandoff] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // The contact gate (ticket 66): every chat starts at the required contact
  // form, and the composer, topics, and suggestions stay hidden until the
  // server has accepted the details. A stored session flips it off
  // optimistically on mount; the first authorized read confirms it.
  const [contactRequired, setContactRequired] = useState(true);
  const sessionRef = useRef<StoredSession | null>(null);
  // Bumped whenever the visitor's conversation is replaced (ticket 14): any
  // in-flight request from an older generation must never repaint the chat.
  const generationRef = useRef(0);
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
  const historyRequestRef = useRef<string | null>(null);

  const showError = useCallback(() => {
    setError("The chat is temporarily unavailable. Please try again.");
  }, []);

  const clearError = useCallback(() => {
    setError("");
  }, []);

  /** A synchronous read of the send-in-flight latch, for guards that must
      hold inside the same tick (the header menu's duplicate-click armor). */
  const isSending = useCallback(() => sendingRef.current, []);

  /** The end of one arrival's animation window: the page's onAnimationEnd
      handler retires the id so the flag never re-fires. */
  const dismissArrival = useCallback((id: string) => {
    setArrivingIds((current) => {
      if (!current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.delete(id);
      return next;
    });
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

  // An open chat checks every second (ticket 61). The closed frame keeps
  // its original three-second cadence, and opening a saved chat checks
  // immediately.
  useEffect(() => {
    if (panelOpen) {
      void refreshHistory();
    }
    const timer = setInterval(
      () => void refreshHistory(),
      panelOpen ? OPEN_POLL_MS : CLOSED_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [panelOpen, refreshHistory]);

  function dropSession(): void {
    // The stored credential stopped working; the contact form returns
    // (ticket 66) and the next accepted submission starts fresh.
    dropStoredSession();
    sessionRef.current = null;
  }

  /** The clear flow's successor session becomes this hook's credential:
      stored and adopted, with the generation already bumped by the caller
      so nothing from the replaced chat can repaint afterwards. */
  function adoptSession(session: StoredSession): void {
    writeSession(session);
    sessionRef.current = session;
  }

  function bumpGeneration(): void {
    generationRef.current = generationRef.current + 1;
  }

  /** A fresh, locked view: empty transcript, clean arrivals, the gate on.
      Every path that ends a usable conversation funnels here. */
  function showLockedFreshChat(): void {
    setMessages([]);
    clearWelcome();
    resetArrivals();
    applyConversationState("bot_active", false);
    setContactRequired(true);
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

  return {
    messages,
    handoff,
    claimed,
    error,
    sending,
    contactRequired,
    question,
    setQuestion,
    arrivingIds,
    noticesArrive,
    send,
    dismissArrival,
    showError,
    clearError,
    isSending,
    sessionRef,
    generationRef,
    dropSession,
    adoptSession,
    bumpGeneration,
    showLockedFreshChat,
    setContactRequired,
  };
}
