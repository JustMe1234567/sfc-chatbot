import type { AnswerRule } from "@/domain/types";

/** The rule-form's field values: arrays flattened into editable text. */
export interface RuleFormValues {
  topic: string;
  response: string;
  phrasesText: string;
  keywordsText: string;
  link: string;
}

/** Maps a stored rule to the edit form's initial values. Shared by the
 *  server page (which loads the rule) and the client form. */
export function ruleToFormValues(rule: AnswerRule): RuleFormValues {
  return {
    topic: rule.topic,
    response: rule.response,
    phrasesText: rule.phrases.join("\n"),
    keywordsText: (rule.keywords ?? []).map((condition) => condition.join(", ")).join("\n"),
    link: rule.link ?? "",
  };
}
