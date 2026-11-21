import { describe, expect, test, vi } from "vitest";

// The suite globally mocks the provider with the fake auth provider (the
// API-flow tests drive that one); this file pins the REAL module's
// transient-retry helper, which ticket 100 adds around the session-lookup
// read so a stalled transaction-pooler query (ticket 90 weather, bounded by
// ticket 90's 10 s query_timeout) cannot masquerade as a logged-out staff
// member.
vi.unmock("../src/auth/supabase-provider");

import { withTransientDbRetry } from "../src/auth/supabase-provider";

function withCode(code: string): Error & { code: string } {
  return Object.assign(new Error(`simulated failure (${code})`), { code });
}

function withCauseCode(causeCode: string): Error & { cause: { code: string } } {
  return Object.assign(new Error("simulated wrapped failure"), {
    cause: { code: causeCode },
  });
}

describe("withTransientDbRetry (ticket 100)", () => {
  test("healthy database: one read, no retry, no delay", async () => {
    const read = vi.fn().mockResolvedValue({ email: "owner@example.edu" });
    const result = await withTransientDbRetry(() => read());
    expect(result).toEqual({ email: "owner@example.edu" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("retries a named driver bound (QUERY_TIMEOUT) once and recovers", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(withCode("QUERY_TIMEOUT"))
      .mockResolvedValueOnce({ email: "owner@example.edu" });
    const result = await withTransientDbRetry(() => read());
    expect(result).toEqual({ email: "owner@example.edu" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("retries a bare SQLSTATE code (53300 pooler pressure) once", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(withCode("53300"))
      .mockResolvedValueOnce({ email: "owner@example.edu" });
    expect(await withTransientDbRetry(() => read())).toEqual({ email: "owner@example.edu" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("retries through the bound's wrapped cause SQLSTATE (57014)", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(withCauseCode("57014"))
      .mockResolvedValueOnce({ email: "owner@example.edu" });
    expect(await withTransientDbRetry(() => read())).toEqual({ email: "owner@example.edu" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("retries socket-class failures reported in the message (ECONNRESET)", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("read ECONNRESET"))
      .mockResolvedValueOnce({ email: "owner@example.edu" });
    expect(await withTransientDbRetry(() => read())).toEqual({ email: "owner@example.edu" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("rethrows non-transient errors immediately without a second read", async () => {
    const read = vi.fn().mockRejectedValue(withCode("23505"));
    await expect(withTransientDbRetry(() => read())).rejects.toMatchObject({ code: "23505" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("a second consecutive transient failure propagates (no loop)", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(withCode("QUERY_TIMEOUT"))
      .mockRejectedValueOnce(withCode("QUEUE_TIMEOUT"));
    await expect(withTransientDbRetry(() => read())).rejects.toMatchObject({
      code: "QUEUE_TIMEOUT",
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
