import { normalizeText } from "./matcher";
import { isWithinSupportHours, scheduleSummary } from "./hours";
import type { SupportHours } from "./types";

/**
 * Leading wordings whose remainder names what the option is about (ticket
 * 67): "I want to speak to someone in admissions" is about admissions. Only
 * the seeded shapes are recognized — an option that starts with neither
 * yields null and the acknowledgment stays generic rather than guessing at a
 * topic.
 */
const TOPIC_PREFIXES = [
  "i want to speak to someone in",
  "i have a question about",
];

/**
 * The topic an option's label is about, quoted from the label's own words
 * ("admissions", "course prices"), or null when none is extractable. The
 * prefix is matched on a lowercased copy but the remainder is sliced from
 * the raw label, so the acknowledgment quotes the visitor's own casing
 * instead of the matcher's normalized form.
 */
export function handoffOptionTopic(label: string): string | null {
  const lowercased = label.toLowerCase();
  for (const prefix of TOPIC_PREFIXES) {
    const withSpace = `${prefix} `;
    if (!lowercased.startsWith(withSpace)) {
      continue;
    }
    const rest = label.slice(withSpace.length).trim();
    // Trailing punctuation is the sentence's, not the topic's.
    const topic = rest.replace(/[!?,.:;'""]+$/, "").trim();
    if (topic !== "") {
      return topic;
    }
  }
  return null;
}

/**
 * The bot's acknowledgment for a deliberately clicked handoff option
 * (ticket 67): truthful and topic-aware — it confirms staff were notified,
 * never claims a department is busy, and never promises a response time.
 * On duty (or with no schedule at all) it keeps the ticket's availability
 * sentence; off duty it names the desk's schedule instead. Ticket 66 removed
 * return-link emails, so the copy never promises a way back by email.
 * Deterministic in `now` so tests can sit on schedule boundaries.
 */
export function handoffOptionReply(
  label: string,
  hours: SupportHours | null,
  now: Date = new Date(),
): string {
  const topic = handoffOptionTopic(label);
  const lead = topic ? `Thanks for asking about ${topic}.` : "Thanks for reaching out.";
  if (hours && !isWithinSupportHours(hours, now)) {
    return `${lead} I've notified our team, and they will reply here when the desk is open — staff answer chats ${scheduleSummary(hours)}.`;
  }
  return `${lead} I've notified our team, and someone will reply here as soon as they're available.`;
}

/**
 * The configured options in order, with repeat spellings of the same phrase
 * collapsed to their first occurrence (ticket 67's "no duplicate visible
 * chip"): an editor's duplicated line must not render twice. Matching is the
 * matcher's normalization, so casing and punctuation cannot split them.
 */
export function distinctOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const option of options) {
    const key = normalizeText(option);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    distinct.push(option);
  }
  return distinct;
}

/**
 * Published-rule topic labels a configured option already spells (ticket
 * 67): the option wins the shared chip, since clicking it must notify
 * staff — so no duplicate chip renders for the same phrase. Matching is the
 * matcher's normalization, so casing and punctuation cannot split them.
 */
export function topicLabelsShadowedByOptions(
  topics: string[],
  options: string[],
): Set<string> {
  const optionLabels = new Set(options.map((option) => normalizeText(option)));
  return new Set(topics.filter((topic) => optionLabels.has(normalizeText(topic))));
}
