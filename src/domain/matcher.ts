import type { AnswerRule } from "./types";

/**
 * Matching is deterministic and normalized: lowercase, punctuation collapsed
 * to spaces, whitespace runs collapsed to single spaces. No AI, no guessing.
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsWholePhrase(normalizedQuestion: string, normalizedPhrase: string): boolean {
  return ` ${normalizedQuestion} `.includes(` ${normalizedPhrase} `);
}

function containsEveryKeyword(normalizedQuestion: string, condition: string[]): boolean {
  const questionWords = new Set(normalizedQuestion.split(" "));
  return condition.every((keyword) => questionWords.has(keyword));
}

/**
 * Whether a question contains any configured escalation phrase as a whole
 * phrase after normalization. Explicit handoff wording must win over every
 * answer rule, so the visitor reaches staff even when a rule also matches.
 */
export function matchesEscalationPhrase(question: string, phrases: string[]): boolean {
  const normalized = normalizeText(question);
  if (normalized === "") {
    return false;
  }
  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    return normalizedPhrase !== "" && containsWholePhrase(normalized, normalizedPhrase);
  });
}

/**
 * Returns every published rule the question matches. A rule matches when the
 * question contains one of its phrases as a whole phrase, or contains every
 * keyword of one of its keyword conditions. The caller decides what to do
 * with zero, one, or several matches.
 */
export function matchAnswerRules(question: string, rules: AnswerRule[]): AnswerRule[] {
  const normalized = normalizeText(question);
  if (normalized === "") {
    return [];
  }
  return rules.filter((rule) => {
    const phraseHit = rule.phrases.some((phrase) =>
      containsWholePhrase(normalized, normalizeText(phrase)),
    );
    const keywordHit = (rule.keywords ?? []).some((condition) =>
      containsEveryKeyword(normalized, condition.map(normalizeText)),
    );
    return phraseHit || keywordHit;
  });
}
