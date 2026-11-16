import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/sqlite";

describe("Supabase-linked staff storage", () => {
  test("keeps application staff ids while linking each member to Supabase Auth", () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sfc-staff-schema-")), "test.db");
    const db = openDatabase(dbPath);
    try {
      const columns = db.prepare("PRAGMA table_info(staff_members)").all() as {
        name: string;
      }[];
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["id", "name", "email", "role", "supabaseUserId", "invitationStatus"]),
      );

      const claimedBy = db.prepare("PRAGMA foreign_key_list(conversations)").all() as {
        table: string;
        from: string;
      }[];
      expect(claimedBy).toContainEqual(expect.objectContaining({ from: "claimed_by", table: "staff_members" }));
    } finally {
      db.close();
    }
  });
});
