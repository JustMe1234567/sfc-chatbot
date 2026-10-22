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
    expect(statuses.filter((status) => status === 201)).toHaveLength(100);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
  });
});
