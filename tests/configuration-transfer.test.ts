import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { sqliteAppDatabase } from "../src/db/appDatabase";
import { openDatabase } from "../src/db/sqlite";
import {
  exportConfiguration,
  importConfiguration,
  validateImportedConfiguration,
} from "../src/configuration-transfer";

function database(label: string) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), `sfc-${label}-`)), "test.db");
  const raw = openDatabase(file);
  return { raw, db: sqliteAppDatabase(raw) };
}

describe("configuration-only transfer", () => {
  test("preserves ordered rules and branding without changing the source", async () => {
    const source = database("config-source");
    const target = database("config-target");
    try {
      await source.db.run("DELETE FROM answer_rules");
      await source.db.run("DELETE FROM settings");
      await source.db.run(
        `INSERT INTO answer_rules
         (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "rule-first",
        "First",
        "First response",
        null,
        '["first"]',
        null,
        "published",
        "2026-01-01T00:00:00.000Z",
        "old-staff-id",
        "2026-01-02T00:00:00.000Z",
      );
      await source.db.run(
        `INSERT INTO answer_rules
         (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "rule-second",
        "Second",
        "Second response",
        null,
        '["second"]',
        null,
        "draft",
        "2026-01-03T00:00:00.000Z",
        null,
        null,
      );
      await source.db.run(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
        "branding_chatbot_icon",
        "data:image/png;base64,c3ByaW5nZmllbGQ=",
        "2026-01-04T00:00:00.000Z",
      );

      const before = source.raw.serialize();
      const bundle = await exportConfiguration(source.db);
      await importConfiguration(target.db, bundle);
      await expect(validateImportedConfiguration(target.db, bundle)).resolves.toBeUndefined();

      const rules = await target.db.all<{ id: string; status: string; published_by: string | null }>(
        "SELECT id, status, published_by FROM answer_rules ORDER BY rowid",
      );
      expect(rules).toEqual([
        { id: "rule-first", status: "published", published_by: null },
        { id: "rule-second", status: "draft", published_by: null },
      ]);
      expect(source.raw.serialize()).toEqual(before);
      await expect(importConfiguration(target.db, bundle)).rejects.toThrow(/already in use/i);
    } finally {
      source.raw.close();
      target.raw.close();
    }
  });

  test("refuses a target containing excluded runtime data", async () => {
    const source = database("config-runtime-source");
    const target = database("config-runtime-target");
    try {
      await source.db.run("DELETE FROM answer_rules");
      await source.db.run("DELETE FROM settings");
      const bundle = await exportConfiguration(source.db);
      await target.db.run(
        `INSERT INTO rate_limit_hits (scope, bucket_key, window_start, hits)
         VALUES (?, ?, ?, ?)`,
        "welcome",
        "synthetic-test",
        "2026-01-01T00:00:00.000Z",
        1,
      );

      await expect(importConfiguration(target.db, bundle)).rejects.toThrow(
        /rate_limit_hits contains data/i,
      );
    } finally {
      source.raw.close();
      target.raw.close();
    }
  });
});
