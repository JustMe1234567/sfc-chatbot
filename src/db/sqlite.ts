import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../paths";

const MIGRATIONS_DIR = path.join(repoRoot(), "migrations");

/**
 * Applies pending versioned migrations (migrations/NNNN_*.sql, tracked in
 * the _migrations table) and returns the opened connection.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
  );

  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}.*\.sql$/.test(name))
    .sort();
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${file} failed: ${String(error)}`);
    }
  }
  return db;
}
