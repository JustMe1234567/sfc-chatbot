"use client";

import { useEffect, useState } from "react";
import { DEFAULT_WELCOME_MESSAGE } from "@/domain/welcome";

/** A published answer rule's topic button, served by /api/v1/topics. */
export interface TopicButton {
  id: string;
  topic: string;
  question: string;
}

/**
 * The widget's published content (ticket 33 extraction of the frame page):
 * the topic buttons, the click-to-handoff options, the configured chatbot
 * icon, and the fresh-chat greeting — everything read from public settings
 * endpoints with a safe fallback, so a failed read never breaks the chat.
 */
export function usePublishedContent(): {
  topics: TopicButton[];
  handoffOptions: string[];
  chatbotIconSrc: string;
  welcome: { text: string; at: string } | null;
  greet: () => void;
  clearWelcome: () => void;
} {
  const [topics, setTopics] = useState<TopicButton[]>([]);
  // The click-to-handoff options (ticket 67): configured wordings whose
  // click hands off to staff, fetched with the topics on every mount.
  const [handoffOptions, setHandoffOptions] = useState<string[]>([]);
  // The configured chatbot icon's URL (ticket 70); null keeps the bundled
  // crest on every surface until a read succeeds.
  const [chatbotIconUrl, setChatbotIconUrl] = useState<string | null>(null);
  // The fresh-chat greeting (ticket 41): null until a conversation the
  // visitor can actually use starts out empty and the published text has
  // settled. The timestamp rides along (ticket 46) so the pair stays atomic.
  const [welcome, setWelcome] = useState<{ text: string; at: string } | null>(null);

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

  /** The configured chatbot icon (ticket 70): fetched once with the same
      safe-fallback rules as the greeting — a failed read leaves the bundled
      crest on the fresh header, the conversation header, and the greeting
      avatar. The public branding read exposes only safe values, and the
      fetched config is forwarded to the launcher: the loader makes no API
      calls of its own (the security property the embed pins guard), so the
      frame — which already talks to the chatbot origin — is the one reader. */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/branding")
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (cancelled || typeof config !== "object" || config === null) {
          return;
        }
        const iconUrl = (config as { chatbotIconUrl?: unknown }).chatbotIconUrl;
        if (typeof iconUrl === "string" && iconUrl.startsWith("/") && iconUrl.length <= 200) {
          setChatbotIconUrl(iconUrl);
        }
        // Public values only; the college page receives nothing else.
        window.parent?.postMessage({ type: "sfcw:branding", config }, "*");
      })
      .catch(() => {
        // Bundled crest stays.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  /** A fresh conversation clears the greeting until it is earned again. */
  function clearWelcome(): void {
    setWelcome(null);
  }

  const chatbotIconSrc = chatbotIconUrl ?? "/brand/cropped-SFC-Final-Logo-Single.png";

  return { topics, handoffOptions, chatbotIconSrc, welcome, greet, clearWelcome };
}
