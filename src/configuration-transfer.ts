import { createHash } from "node:crypto";
import type { AppDatabase } from "./db/appDatabase";

export interface ConfigurationBundle {
  version: 1;
  exportedAt: string;
  answerRules: Array<{
    id: string;
    topic: string;
    response: string;
    link: string | null;
    phrases: string;
    keywords: string | null;
    status: "draft" | "published" | "archived" | "trashed";
    updatedAt: string;
    reviewedAt: string | null;
    trashedAt: string | null;
    order: number;
  }>;
  settings: Array<{
    key: string;
    value: string;
    updatedAt: string;
    sha256: string;
  }>;
}

interface RuleRow {
  id: string;
  topic: string;
  response: string;
  link: string | null;
  phrases: string;
  keywords: string | null;
  status: ConfigurationBundle["answerRules"][number]["status"];
  updatedAt: string;
  reviewedAt: string | null;
  trashedAt: string | null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function orderedRules(db: AppDatabase): Promise<RuleRow[]> {
  const select = `SELECT id, topic, response, link, phrases, keywords, status,
    updated_at AS "updatedAt", reviewed_at AS "reviewedAt", trashed_at AS "trashedAt"
    FROM answer_rules`;
  try {
    return await db.all<RuleRow>(`${select} ORDER BY seq`);
  } catch {
    return db.all<RuleRow>(`${select} ORDER BY rowid`);
  }
}

/** Reads only configuration rows through a caller-owned, read-only source connection. */
export async function exportConfiguration(db: AppDatabase): Promise<ConfigurationBundle> {
  const [rules, settings] = await Promise.all([
    orderedRules(db),
    db.all<{ key: string; value: string; updatedAt: string }>(
      `SELECT key, value, updated_at AS "updatedAt" FROM settings ORDER BY key`,
    ),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    answerRules: rules.map((rule, order) => ({ ...rule, order })),
    settings: settings.map((setting) => ({ ...setting, sha256: hash(setting.value) })),
  };
}

const TARGET_USE_TABLES = [
  "staff_members",
  '"session"',
  '"account"',
  '"verification"',
  '"twoFactor"',
  "conversations",
  "messages",
  "visitor_sessions",
  "return_tokens",
  "contact_requests",
  "audit_log",
  "retention_runs",
  "notifications",
  "mail_outbox",
  "analytics_seen",
  "analytics_daily",
  "rate_limit_hits",
  "answer_rules",
  "settings",
] as const;

async function assertFreshTarget(db: AppDatabase): Promise<void> {
  for (const table of TARGET_USE_TABLES) {
    const row = await db.get<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    );
    if (Number(row?.count ?? 0) > 0) {
      throw new Error(`Target is already in use: ${table} contains data.`);
    }
  }
}

function assertBundle(bundle: ConfigurationBundle): void {
  if (bundle.version !== 1) throw new Error("Unsupported configuration bundle version.");
  for (const setting of bundle.settings) {
    if (hash(setting.value) !== setting.sha256) {
      throw new Error(`Configuration bundle checksum failed for setting ${setting.key}.`);
    }
  }
}

/** Imports into an already-migrated, unused target. The CLI wraps this in a transaction. */
export async function importConfiguration(
  db: AppDatabase,
  bundle: ConfigurationBundle,
): Promise<void> {
  assertBundle(bundle);
  await assertFreshTarget(db);
  for (const rule of [...bundle.answerRules].sort((left, right) => left.order - right.order)) {
    await db.run(
      `INSERT INTO answer_rules
       (id, topic, response, link, phrases, keywords, status, updated_at,
        published_by, reviewed_at, trashed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rule.id,
      rule.topic,
      rule.response,
      rule.link,
      rule.phrases,
      rule.keywords,
      rule.status,
      rule.updatedAt,
      null,
      rule.reviewedAt,
      rule.trashedAt,
    );
  }
  for (const setting of bundle.settings) {
    await db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
      setting.key,
      setting.value,
      setting.updatedAt,
    );
  }
}

export async function validateImportedConfiguration(
  db: AppDatabase,
  bundle: ConfigurationBundle,
): Promise<void> {
  const exported = await exportConfiguration(db);
  if (exported.answerRules.length !== bundle.answerRules.length) {
    throw new Error("Imported answer-rule count does not match the bundle.");
  }
  if (exported.settings.length !== bundle.settings.length) {
    throw new Error("Imported settings count does not match the bundle.");
  }
  for (const [index, expected] of bundle.answerRules.entries()) {
    const actual = exported.answerRules[index];
    if (!actual || actual.id !== expected.id || actual.status !== expected.status) {
      throw new Error(`Imported answer-rule order/status differs at position ${index + 1}.`);
    }
  }
  for (const expected of bundle.settings) {
    const actual = exported.settings.find((setting) => setting.key === expected.key);
    if (!actual || actual.sha256 !== expected.sha256) {
      throw new Error(`Imported setting differs: ${expected.key}.`);
    }
  }
}
