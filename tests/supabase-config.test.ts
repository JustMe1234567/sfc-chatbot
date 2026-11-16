import { afterEach, describe, expect, test, vi } from "vitest";

vi.unmock("../src/auth/supabase-provider");

import { assertSupabaseConfigured } from "../src/auth/supabase-provider";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function validConfiguration(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklm.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.DATABASE_URL = "postgresql://postgres.abcdefghijklm:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
}

describe("Supabase configuration", () => {
  test("requires every server and browser credential", () => {
    validConfiguration();
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => assertSupabaseConfigured()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  test("refuses a database connection for a different Supabase project", () => {
    validConfiguration();
    process.env.DATABASE_URL = "postgresql://postgres.zyxwvutsrqpon:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
    expect(() => assertSupabaseConfigured()).toThrow(/same Supabase project/i);
  });

  test("accepts a matching project URL and pooler connection", () => {
    validConfiguration();
    expect(() => assertSupabaseConfigured()).not.toThrow();
  });
});
