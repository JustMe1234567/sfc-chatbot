import { normalizeText } from "./matcher";

/**
 * The configured click-to-handoff wordings (tickets 67/69): clicking one
 * records the label as the visitor's words and asks the persisted
 * confirmation — the acknowledgment and escalation live behind the
 * visitor's choice now, so this module only carries the chip bookkeeping.
 */

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

