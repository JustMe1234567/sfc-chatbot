"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { readSession, type StoredSession } from "@/lib/visitorSession";

/**
 * The visitor's Clear conversation flow (ticket 33 extraction of the frame
 * page): the header overflow menu, its confirm step, and the Escape cascade
 * that unwinds them before closing the widget. The clear itself ends this
 * chat server-side (ticket 14) and swaps in the fresh successor session
 * through the stream substrate (ticket 66's gate returns first).
 */
export function useClearFlow({
  sessionRef,
  generationRef,
  dropSession,
  adoptSession,
  bumpGeneration,
  showLockedFreshChat,
  showError,
  clearError,
  setQuestion,
  isSending,
  requestClose,
}: {
  sessionRef: RefObject<StoredSession | null>;
  generationRef: RefObject<number>;
  dropSession: () => void;
  adoptSession: (session: StoredSession) => void;
  bumpGeneration: () => void;
  showLockedFreshChat: () => void;
  showError: () => void;
  clearError: () => void;
  setQuestion: (text: string) => void;
  isSending: () => boolean;
  requestClose: () => void;
}): {
  menuOpen: boolean;
  setMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  menuItemRef: RefObject<HTMLButtonElement | null>;
  confirmClearRef: RefObject<HTMLButtonElement | null>;
  clearState: "idle" | "confirm" | "busy";
  setClearState: (state: "idle" | "confirm" | "busy") => void;
  confirmClear: () => Promise<void>;
} {
  const [menuOpen, setMenuOpen] = useState(false);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "busy">("idle");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const confirmClearRef = useRef<HTMLButtonElement>(null);

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

  // Escape unwinds the flow's own layers first — the open menu, then the
  // confirm box — and only then asks the loader to close the widget.
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
  }, [clearState, menuOpen, requestClose]);

  /**
   * Ticket 14: ends this chat server-side and swaps in the one fresh
   * conversation the server returns. That successor starts without contact
   * details (ticket 66), so the gate returns before anything can be asked.
   * A request that fails with 401/404 already ended server-side (the
   * credential was revoked or expired), so the gate simply returns — the
   * visitor still starts exactly one new chat. The generation bump strands
   * every in-flight request from the old chat.
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
        bumpGeneration();
        showLockedFreshChat();
        setQuestion("");
        clearError();
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
      bumpGeneration();
      adoptSession(fresh);
      // The successor starts without contact details (ticket 66), so the
      // gate returns before anything can be asked.
      showLockedFreshChat();
      setQuestion("");
      clearError();
    } catch {
      showError();
    } finally {
      setClearState("idle");
    }
  }

  return {
    menuOpen,
    setMenuOpen,
    menuButtonRef,
    menuItemRef,
    confirmClearRef,
    clearState,
    setClearState,
    confirmClear,
  };
}
