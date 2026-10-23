import { normalizeText } from "./matcher";
import type { AnswerRule } from "./types";

export const MAX_TOPIC_LENGTH = 80;
export const MAX_RESPONSE_LENGTH = 2000;
export const MAX_PHRASES = 20;
export const MAX_PHRASE_LENGTH = 200;
export const MAX_KEYWORD_CONDITIONS = 10;
export const MAX_KEYWORDS_PER_CONDITION = 10;
export const MAX_KEYWORD_LENGTH = 60;
export const MAX_LINK_LENGTH = 500;

/** Editor-maintained content of a rule, decoupled from storage fields. */
export interface AnswerRuleContent {
  topic: string;
  response: string;
  phrases: string[];
  keywords?: string[][];
  link?: string;
}

export type RuleValidation =
  | { ok: true; content: AnswerRuleContent }
  | { ok: false; code: "invalid_rule"; message: string };

const HTTP_LINK = /^https?:\/\/\S+$/i;

/** Whether a non-empty link value is a web URL the widget can render. */
export function isValidHttpLink(value: string): boolean {
  return HTTP_LINK.test(value.trim());
}

/**
 * Validates editor input for a rule. Everything is trimmed; a phrase or
 * keyword must still exist after normalization so it can never match; a
 * college page link must be an http(s) URL because the widget renders it as
 * one. A rule matches through phrases or keyword conditions, so at least one
 * of the two is required (spec: "phrase aliases or keyword conditions").
 */
export function validateAnswerRuleInput(input: unknown): RuleValidation {
  const invalid = (message: string): RuleValidation => ({
    ok: false,
    code: "invalid_rule",
    message,
  });

  if (typeof input !== "object" || input === null) {
    return invalid("Provide the answer rule's topic, response, and phrases.");
  }
  const body = input as Record<string, unknown>;

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (topic.length === 0 || topic.length > MAX_TOPIC_LENGTH) {
    return invalid(`The topic is required (at most ${MAX_TOPIC_LENGTH} characters).`);
  }

  const response = typeof body.response === "string" ? body.response.trim() : "";
  if (response.length === 0 || response.length > MAX_RESPONSE_LENGTH) {
    return invalid(`The approved response is required (at most ${MAX_RESPONSE_LENGTH} characters).`);
  }

  if (body.phrases !== undefined && body.phrases !== null && !Array.isArray(body.phrases)) {
    return invalid("Phrases must be a list.");
  }
  if (Array.isArray(body.phrases) && body.phrases.length > MAX_PHRASES) {
    return invalid(`At most ${MAX_PHRASES} phrases are allowed.`);
  }
  const phrases: string[] = [];
  for (const phrase of (body.phrases as unknown[]) ?? []) {
    if (typeof phrase !== "string") {
      return invalid("Each phrase must be text.");
    }
    const trimmed = phrase.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PHRASE_LENGTH || normalizeText(trimmed) === "") {
      return invalid(
        `Each phrase is required, at most ${MAX_PHRASE_LENGTH} characters, and must contain a word or number.`,
      );
    }
    phrases.push(trimmed);
  }

  let keywords: string[][] | undefined;
  if (body.keywords !== undefined && body.keywords !== null) {
    if (!Array.isArray(body.keywords) || body.keywords.length > MAX_KEYWORD_CONDITIONS) {
      return invalid(`At most ${MAX_KEYWORD_CONDITIONS} keyword conditions are allowed.`);
    }
    const conditions: string[][] = [];
    for (const condition of body.keywords) {
      if (!Array.isArray(condition) || condition.length === 0 || condition.length > MAX_KEYWORDS_PER_CONDITION) {
        return invalid(
          `Each keyword condition needs 1-${MAX_KEYWORDS_PER_CONDITION} keywords; all must appear for a match.`,
        );
      }
      const words: string[] = [];
      for (const keyword of condition) {
        if (typeof keyword !== "string") {
          return invalid("Each keyword must be text.");
        }
        const trimmed = keyword.trim();
        if (trimmed.length === 0 || trimmed.length > MAX_KEYWORD_LENGTH || normalizeText(trimmed) === "") {
          return invalid(
            `Each keyword is required, at most ${MAX_KEYWORD_LENGTH} characters, and must contain a word or number.`,
          );
        }
        words.push(trimmed);
      }
      conditions.push(words);
    }
    keywords = conditions;
  }

  if (phrases.length === 0 && (!keywords || keywords.length === 0)) {
    return invalid("Provide at least one phrase or keyword condition a visitor might type.");
  }

  let link: string | undefined;
  if (body.link !== undefined && body.link !== null && body.link !== "") {
    if (typeof body.link !== "string") {
      return invalid("The college page link must be a web URL.");
    }
    const trimmed = body.link.trim();
    if (!HTTP_LINK.test(trimmed) || trimmed.length > MAX_LINK_LENGTH) {
      return invalid("The college page link must be an http(s) URL.");
    }
    link = trimmed;
  }

  return { ok: true, content: { topic, response, phrases, ...(keywords ? { keywords } : {}), ...(link ? { link } : {}) } };
}

/** Form textarea (one phrase per line) to the phrase list. */
export function parsePhraseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Form textarea to keyword conditions: one line per condition, keywords
 * separated by commas (all of a line's keywords must appear in a question).
 */
export function parseKeywordLines(text: string): string[][] {
  return text
    .split("\n")
    .map((line) => line.split(",").map((word) => word.trim()).filter((word) => word.length > 0))
    .filter((condition) => condition.length > 0);
}

/**
 * The visitor-facing topic button for a published rule: its label and the
 * canonical question a click sends through the normal matcher path. A
 * keywords-only rule falls back to its topic label as the question.
 */
export function topicButtonFor(rule: AnswerRule): { topic: string; question: string } {
  return { topic: rule.topic, question: rule.phrases[0] ?? rule.topic };
}
