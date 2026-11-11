import { afterEach, describe, expect, it, vi } from "vitest";
import { publicClientKey } from "../src/api/visitor";
import { createRateLimiter } from "../src/domain/limits";
import { TEST_ORIGIN } from "./helpers";

function requestWith(headers: Record<string, string>): Request {
  return new Request(`${TEST_ORIGIN}/api/v1/topics`, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicClientKey (ticket 20)", () => {
  it("in production uses the platform-trusted header, not the spoofable leftmost x-forwarded-for", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = requestWith({
      "x-forwarded-for": "6.6.6.6",
      "x-vercel-forwarded-for": "203.0.113.7",
    });
    expect(publicClientKey(request)).toBe("203.0.113.7");
  });

  it("in production falls back to x-real-ip when the Vercel header is absent", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = requestWith({
      "x-forwarded-for": "6.6.6.6",
      "x-real-ip": "203.0.113.9",
    });
    expect(publicClientKey(request)).toBe("203.0.113.9");
  });

  it("in production a spoofed x-forwarded-for alone cannot mint a client identity", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spoofed = requestWith({ "x-forwarded-for": "6.6.6.6" });
    expect(publicClientKey(spoofed)).not.toBe("6.6.6.6");
    expect(publicClientKey(spoofed)).toBe(publicClientKey(requestWith({})));
  });

  it("in production rotating the spoofed header does not rotate the rate-limit bucket", () => {
    vi.stubEnv("NODE_ENV", "production");
    const limiter = createRateLimiter(1);
    const trusted = "203.0.113.7";
    const first = requestWith({
      "x-forwarded-for": "6.6.6.6",
      "x-vercel-forwarded-for": trusted,
    });
    const second = requestWith({
      "x-forwarded-for": "6.6.6.7",
      "x-vercel-forwarded-for": trusted,
    });
    expect(limiter.check(publicClientKey(first), 0)).toBe(true);
    expect(limiter.check(publicClientKey(second), 0)).toBe(false);
  });

  it("local development keeps today's behavior: leftmost x-forwarded-for, shared bucket without it", () => {
    vi.stubEnv("NODE_ENV", "development");
    const forwarded = requestWith({ "x-forwarded-for": "10.0.0.1, 192.168.0.9" });
    expect(publicClientKey(forwarded)).toBe("10.0.0.1");
    expect(publicClientKey(requestWith({}))).toBe("local");
  });
});
