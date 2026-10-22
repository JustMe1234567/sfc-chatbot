import { beforeAll, describe, expect, it } from "vitest";
import { TEST_ORIGIN, useTempDatabase } from "./helpers";

beforeAll(() => {
  useTempDatabase();
});

describe("unauthenticated conversation creation", () => {
  it("throttles creation bursts", async () => {
    const { POST } = await import("../src/app/api/v1/conversations/route");
    const statuses: number[] = [];
    for (let i = 0; i < 101; i++) {
      const response = await POST(
        new Request(`${TEST_ORIGIN}/api/v1/conversations`, { method: "POST" }),
      );
      statuses.push(response.status);
    }
    // The first window's worth of creations always succeeds; the throttle
    // engages within the burst. (If the run is slow enough to straddle the
    // 60 s window, counting legitimately restarts, so later 201s are fine.)
    expect(statuses.slice(0, 100).every((status) => status === 201)).toBe(true);
    expect(statuses).toContain(429);
  });
});
