"use client";

import { useRef, useState, type RefObject } from "react";
import {
  readSession,
  writeSession,
  type StoredSession,
} from "@/lib/visitorSession";

/**
 * The contact gate's submission flow (ticket 66; ticket 33 extraction of
 * the frame page): the three required details, their pending/failure
 * feedback, and the accept path that unlocks the conversation this mount
 * already holds — or starts exactly one fresh one. The composer state and
 * the session substrate live in useConversationStream.
 */
export function useContactGate({
  sessionRef,
  dropSession,
  showLockedFreshChat,
  setContactRequired,
  clearError,
  hasMessages,
  greet,
  inputRef,
}: {
  sessionRef: RefObject<StoredSession | null>;
  dropSession: () => void;
  showLockedFreshChat: () => void;
  setContactRequired: (required: boolean) => void;
  clearError: () => void;
  hasMessages: boolean;
  greet: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}): {
  contact: { fullName: string; email: string; phone: string };
  setContact: (contact: { fullName: string; email: string; phone: string }) => void;
  contactError: string;
  contactBusy: boolean;
  submitContact: (event: React.FormEvent) => Promise<void>;
} {
  const [contact, setContact] = useState({ fullName: "", email: "", phone: "" });
  const [contactError, setContactError] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  // Synchronous mirror of the gate's pending flag: the duplicate-submit
  // guard must hold during awaits, exactly like the send guard.
  const contactBusyRef = useRef(false);

  /** The gate opens: the entered values carry into the transcript's labels,
      and a conversation that starts (or unlocks) empty greets (ticket 41).
      An unlocked chat with a transcript keeps its history instead. */
  function contactAccepted(): void {
    setContactRequired(false);
    setContactError("");
    clearError();
    if (!hasMessages) {
      greet();
    }
    inputRef.current?.focus();
  }

  /**
   * A conversation this mount already holds a credential for — the
   * successor after Clear chat, or a legacy session — is unlocked in place;
   * otherwise the same details start exactly one fresh conversation. A
   * credential that died, or a conversation that closed or went quiet,
   * falls through to the fresh start, so no retry path can duplicate a
   * conversation.
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

  return { contact, setContact, contactError, contactBusy, submitContact };
}
