import { beforeAll, describe, expect, it } from "vitest";
import { sameOriginGuard } from "../src/api/staff";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

/**
 * Ticket 30: origin-check hardening and the recorded public-POST posture.
 * The cookie-authentication guard accepts Origin **or** Referer when either
 * matches a trusted origin — both are browser-set and unforgeable by
 * cross-site script — and rejects an unsafe method carrying neither, so an
 * origin-absent request can no longer ride on "browsers always send
 * Origin". The bearer-token public POSTs stay guard-free by decision
 * (recorded in ticket 11): their credential never auto-attaches, so CSRF
 * does not apply, and rate limiting is the defense.
 */

const OWNER_EMAIL = "guard-owner@example.edu";
const OWNER_PASSWORD = "guard-owner-harbor-5w";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;

async function putPhrases(jar: CookieJar, headers: Record<string, string>): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/escalation-phrases/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/escalation-phrases`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), ...headers },
      body: JSON.stringify({ phrases: ["talk to a person", "speak to a human"] }),
    }),
  );
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
});

describe("the same-origin guard's header rule (ticket 30)", () => {
  it("lets safe methods through regardless of headers", () => {
    expect(sameOriginGuard(new Request(`${TEST_ORIGIN}/x`, { method: "GET" }))).toBeNull();
    expect(
      sameOriginGuard(new Request(`${TEST_ORIGIN}/x`, { method: "HEAD" })),
    ).toBeNull();
  });

  it("accepts a trusted Origin and rejects an untrusted one", () => {
    expect(
      sameOriginGuard(
        new Request(`${TEST_ORIGIN}/x`, { method: "POST", headers: { origin: TEST_ORIGIN } }),
      ),
    ).toBeNull();
    const blocked = sameOriginGuard(
      new Request(`${TEST_ORIGIN}/x`, {
        method: "POST",
        headers: { origin: "https://evil.example.net" },
      }),
    );
    expect(blocked?.status).toBe(403);
  });

  it("accepts a trusted-origin Referer when Origin is absent, and rejects an untrusted or malformed one", () => {
    expect(
      sameOriginGuard(
        new Request(`${TEST_ORIGIN}/x`, {
          method: "POST",
          headers: { referer: `${TEST_ORIGIN}/dashboard/answers` },
        }),
      ),
    ).toBeNull();
    const untrusted = sameOriginGuard(
      new Request(`${TEST_ORIGIN}/x`, {
        method: "POST",
        headers: { referer: "https://evil.example.net/form" },
      }),
    );
    expect(untrusted?.status).toBe(403);
    const malformed = sameOriginGuard(
      new Request(`${TEST_ORIGIN}/x`, { method: "POST", headers: { referer: "not-a-url" } }),
    );
    expect(malformed?.status).toBe(403);
  });

  it("rejects an unsafe method carrying neither Origin nor Referer", async () => {
    const blocked = sameOriginGuard(new Request(`${TEST_ORIGIN}/x`, { method: "PUT" }));
    expect(blocked?.status).toBe(403);
    expect(
      ((await blocked?.json()) as { error?: { code?: string } } | undefined)?.error?.code,
    ).toBe("cross_origin_blocked");
  });
});

describe("a cookie-authenticated mutation without an Origin header (ticket 30)", () => {
  it("passes on a trusted Referer alone and fails with neither header", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);

    const refererOnly = await putPhrases(jar, {
      referer: `${TEST_ORIGIN}/dashboard/answers`,
    });
    expect(refererOnly.status).toBe(200);

    const neither = await putPhrases(jar, {});
    expect(neither.status).toBe(403);
    expect(((await neither.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_blocked",
    );

    // A cross-site Origin still loses to a trusted Referer: Origin, when
    // present, is the whole verdict.
    const crossOrigin = await putPhrases(jar, {
      origin: "https://evil.example.net",
      referer: `${TEST_ORIGIN}/dashboard/answers`,
    });
    expect(crossOrigin.status).toBe(403);
  });
});
