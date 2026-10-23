"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  isValidHttpLink,
  MAX_RESPONSE_LENGTH,
  MAX_TOPIC_LENGTH,
  parseKeywordLines,
  parsePhraseLines,
} from "@/domain/answerRules";
import type { RuleFormValues } from "./rule-values";
import styles from "../dashboard.module.css";

function optionalLink(value: string): boolean {
  return value.trim() === "" || isValidHttpLink(value);
}

/**
 * Editor form for a rule's content, with a live preview of what a visitor
 * sees: the topic button, the approved response, and its college page link.
 * Saving always produces a draft; publishing is the separate review act.
 */
export default function RuleForm({
  mode,
  ruleId,
  initial,
}: {
  mode: "create" | "edit";
  ruleId?: string;
  initial: RuleFormValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState<RuleFormValues>(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const phrases = parsePhraseLines(values.phrasesText);
  const keywords = parseKeywordLines(values.keywordsText);
  const topic = values.topic.trim();
  const response = values.response.trim();
  const link = values.link.trim();

  const contentComplete =
    topic.length > 0 &&
    response.length > 0 &&
    (phrases.length > 0 || keywords.length > 0) &&
    optionalLink(link);

  function set<K extends keyof RuleFormValues>(key: K, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !contentComplete) {
      return;
    }
    setBusy(true);
    setMessage("");
    const body = {
      topic,
      response,
      phrases,
      keywords,
      ...(link ? { link } : {}),
    };
    const result = await fetch(
      mode === "create" ? "/api/staff/answer-rules" : `/api/staff/answer-rules/${ruleId}`,
      {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setBusy(false);
    if (!result.ok) {
      const failure = (await result.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(failure?.error?.message ?? "Could not save the answer rule.");
      return;
    }
    const saved = (await result.json()) as { id: string };
    if (mode === "create") {
      router.push(`/dashboard/answers/${saved.id}`);
    } else {
      setMessage("Saved as a draft. Publish to make it live.");
      router.refresh();
    }
  }

  return (
    <div className={styles.ruleGrid}>
      <form className={styles.ruleCard} onSubmit={save}>
        <label htmlFor="rule-topic">Topic (the button visitors see)</label>
        <input
          id="rule-topic"
          type="text"
          maxLength={MAX_TOPIC_LENGTH}
          value={values.topic}
          onChange={(event) => set("topic", event.target.value)}
        />

        <label htmlFor="rule-response">Approved response</label>
        <textarea
          id="rule-response"
          rows={5}
          maxLength={MAX_RESPONSE_LENGTH}
          value={values.response}
          onChange={(event) => set("response", event.target.value)}
        />

        <label htmlFor="rule-phrases">Phrases (one per line; each answers this rule)</label>
        <textarea
          id="rule-phrases"
          rows={4}
          value={values.phrasesText}
          onChange={(event) => set("phrasesText", event.target.value)}
        />

        <label htmlFor="rule-keywords">
          Keyword conditions (one per line; a line matches when every word appears)
        </label>
        <textarea
          id="rule-keywords"
          rows={2}
          value={values.keywordsText}
          onChange={(event) => set("keywordsText", event.target.value)}
        />

        <label htmlFor="rule-link">College page link (optional)</label>
        <input
          id="rule-link"
          type="text"
          value={values.link}
          onChange={(event) => set("link", event.target.value)}
          placeholder="https://www.example-college.edu/..."
        />

        <button type="submit" disabled={busy || !contentComplete}>
          {mode === "create" ? "Create draft" : "Save changes"}
        </button>
        {!contentComplete ? (
          <p className={styles.hint}>
            A topic, response, and at least one phrase or keyword condition are required; a link
            must be an http(s) URL.
          </p>
        ) : null}
        {message ? (
          <p className={styles.hint} role="status">
            {message}
          </p>
        ) : null}
      </form>

      <aside className={styles.ruleCard} aria-label="Visitor preview">
        <h2>Visitor preview</h2>
        <p className={styles.hint}>What the widget shows once this rule is published.</p>
        <div className={styles.previewPanel}>
          <span className={styles.previewTopicButton}>{topic || "Topic"}</span>
          <p className={styles.previewBubble}>
            {response || "The approved response appears here."}
            {optionalLink(link) && link ? (
              <a href={link} target="_blank" rel="noopener noreferrer">
                Visit the college page
              </a>
            ) : null}
          </p>
          <p className={styles.hint}>
            Clicking the button asks: {phrases[0] ?? (topic || "the topic")}
          </p>
          {keywords.length > 0 ? (
            <p className={styles.hint}>
              Keyword conditions:{" "}
              {keywords.map((condition) => condition.join(" + ")).join("; ")}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
