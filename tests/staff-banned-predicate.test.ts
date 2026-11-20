import { describe, expect, test } from "vitest";
import { isStaffBanned } from "../src/api/staff";

/**
 * Ticket 96: one shared staff banned-value predicate at all three check
 * sites. The shape table pins the canonical semantic that lived inline at
 * src/api/staff.ts — BOOLEAN true/false on Postgres, INTEGER 0/1 on SQLite,
 * plus the string "1" — so the two sites that had dropped the string shape
 * (the reset-password route and the recover-staff-credentials script)
 * refuse exactly what the dashboard refuses.
 */
describe("isStaffBanned", () => {
  test.each([true, 1, "1"] as const)("refuses banned flag %p", (value) => {
    expect(isStaffBanned(value)).toBe(true);
  });

  test.each([false, 0, "0", null, undefined] as const)(
    "admits active flag %p",
    (value) => {
      expect(isStaffBanned(value)).toBe(false);
    },
  );
});
