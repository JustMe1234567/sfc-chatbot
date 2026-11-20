// Postgres-mode files must not multiply at the cluster's connection ceiling:
// two workers per pool keeps parallel provisioning inside max_connections.
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX ?? "2";
process.env.PG_AUTH_POOL_MAX = process.env.PG_AUTH_POOL_MAX ?? "2";

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "../src/db/appDatabase";
import {
  clearLoginEvents,
  isIpBlocked,
  listLoginEvents,
  recordLoginFailure,
  recordLoginSuccess,
  sweepLoginEvents,
} from "../src/domain/loginLog";
import { DEFAULT_LOGIN_RETENTION_DAYS, setLoginRetentionDays, setSetting } from "../src/settings";
import { countQuery, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  authRequest,
  CookieJar,
  provisionStaff,
  signInAs,
} from "./auth-helpers";

/**
 * Ticket 81: the login log, the suspicious criteria, and the IP block.
 * Every test pins its own client IP so the per-IP counters and views stay
 * isolated; domain-level tests drive the injectable clock so windows,
 * thresholds, and expiry are exact. The whole file runs on SQLite and —
 * with CHATBOT_TEST_POSTGRES_URL — on Postgres, which is the store parity:
 * identical portable SQL, identical behavior, both dialects.
 */

const OWNER_EMAIL = "owner.log@example.edu";
const OWNER_PASSWORD = "owner-log-staple-42";
const STAFF_EMAIL = "desk.log@example.edu";
const STAFF_PASSWORD = "desk-log-placid-88";
const EDITOR_EMAIL = "pen.log@example.edu";
const EDITOR_PASSWORD = "pen-log-cartoon-15";
const OWNER_USERNAME = "owner.log";
const DAY_MS = 24 * 60 * 60 * 1000;

let ownerJar: CookieJar;
let staffJar: CookieJar;
let editorJar: CookieJar;

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Log Owner", role: "owner" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Log Desk", role: "staff" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Log Editor", role: "editor" });
  ownerJar = new CookieJar();
  await signInAs(ownerJar, OWNER_EMAIL, OWNER_PASSWORD);
  staffJar = new CookieJar();
  await signInAs(staffJar, STAFF_EMAIL, STAFF_PASSWORD);
  editorJar = new CookieJar();
  await signInAs(editorJar, EDITOR_EMAIL, EDITOR_PASSWORD);
}, 120_000);

async function testDb(): Promise<AppDatabase> {
  const { getChatbotService } = await import("../src/db/service");
  return (await getChatbotService()).db;
}

interface RawEvent {
  username: string;
  outcome: string;
  reason: string;
  suspicious: number;
  userAgent: string | null;
}

async function eventsForIp(db: AppDatabase, ip: string): Promise<RawEvent[]> {
  return db.all<RawEvent>(
    `SELECT username, outcome, reason, suspicious, user_agent AS "userAgent"
     FROM login_events WHERE ip = ? ORDER BY created_at, id`,
    ip,
  );
}

async function logsGet(jar: CookieJar): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/logs/route");
  return GET(new Request(`${TEST_ORIGIN}/api/staff/logs`, { headers: { cookie: jar.header() } }));
}

async function logsDelete(jar: CookieJar, body: unknown): Promise<Response> {
  const { DELETE } = await import("../src/app/api/staff/logs/route");
  return DELETE(
    new Request(`${TEST_ORIGIN}/api/staff/logs`, {
      method: "DELETE",
      headers: { cookie: jar.header(), origin: TEST_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function loginRetentionGet(jar: CookieJar): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/settings/login-retention/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/login-retention`, {
      headers: { cookie: jar.header() },
    }),
  );
}

async function loginRetentionPut(jar: CookieJar, body: unknown): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/login-retention/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/login-retention`, {
      method: "PUT",
      headers: { cookie: jar.header(), origin: TEST_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("the login log records every attempt (ticket 81)", () => {
  it("rejects impossible outcomes at the schema level on both dialects", { timeout: 120_000 }, async () => {
    const db = await testDb();
    await expect(
      db.run(
        `INSERT INTO login_events
           (id, username, outcome, reason, ip, user_agent, username_known, suspicious, created_at)
         VALUES (?, 'x', 'bogus', '', '10.81.90.1', NULL, 0, 0, '2026-01-01T00:00:00.000Z')`,
        randomUUID(),
      ),
    ).rejects.toThrow();
  });

  it("logs a successful sign-in with its username, outcome, ip, user agent, and time", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.1.1";
    const jar = new CookieJar();
    const response = await authRequest(jar, "/api/auth/sign-in/username", {
      body: { username: OWNER_USERNAME, password: OWNER_PASSWORD },
      ip,
    });
    expect(response.status).toBe(200);
    const events = await eventsForIp(db, ip);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.username).toBe(OWNER_USERNAME);
    expect(event.outcome).toBe("success");
    expect(event.reason).toBe("");
    expect(event.userAgent).toBe("sfc-test-suite/1");
    // Criterion (b) through the seam: a first-ever successful IP for the
    // account is flagged.
    expect(event.suspicious).toBe(1);
  });

  it("logs failures with the reason the credential path classified", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const wrong = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: OWNER_USERNAME, password: "not-the-password" },
      ip: "10.81.1.2",
    });
    expect(wrong.status).toBe(401);
    const unknown = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: "ghost-user", password: "whatever" },
      ip: "10.81.1.3",
    });
    expect(unknown.status).toBe(401);
    // A disabled account: the username is real but the account is banned.
    await provisionStaff({ email: "gate.log@example.edu", password: "gate-log-tin-73", name: "Gate" });
    const dbNow = await testDb();
    await dbNow.run(`UPDATE staff_members SET "banned" = ? WHERE "username" = ?`, true, "gate.log");
    const disabled = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: "gate.log", password: "gate-log-tin-73" },
      ip: "10.81.1.4",
    });
    expect(disabled.status).toBe(401);

    const wrongEvents = await eventsForIp(dbNow, "10.81.1.2");
    expect(wrongEvents[0]?.outcome).toBe("failure");
    expect(wrongEvents[0]?.reason).toBe("invalid_password");
    const unknownEvents = await eventsForIp(dbNow, "10.81.1.3");
    expect(unknownEvents[0]?.outcome).toBe("failure");
    expect(unknownEvents[0]?.reason).toBe("unknown_username");
    const disabledEvents = await eventsForIp(dbNow, "10.81.1.4");
    expect(disabledEvents[0]?.outcome).toBe("failure");
    expect(disabledEvents[0]?.reason).toBe("disabled_account");
    // The disabled username is not a live staff account: it feeds the
    // non-staff population (and is not flagged on its first attempt).
    expect(disabledEvents[0]?.suspicious).toBe(0);
  });

  it("passes the browser's user agent through per request", { timeout: 120_000 }, async () => {
    const db = await testDb();
    await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: "ghost-ua", password: "whatever" },
      ip: "10.81.1.5",
      userAgent: "cert-probe/9",
    });
    const events = await eventsForIp(db, "10.81.1.5");
    expect(events[0]?.userAgent).toBe("cert-probe/9");
  });

  it("does not log a request that never submitted credentials", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const response = await authRequest(null, "/api/auth/sign-in/username", {
      body: {},
      ip: "10.81.1.6",
    });
    expect(response.status).toBe(400);
    expect(await eventsForIp(db, "10.81.1.6")).toHaveLength(0);
  });

  it("rejects blocked attempts with the ordinary failure body and logs outcome blocked", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.1.7";
    for (let i = 0; i < 10; i++) {
      const response = await authRequest(null, "/api/auth/sign-in/username", {
        body: { username: `ghost-block-${i}`, password: "whatever" },
        ip,
      });
      expect(response.status).toBe(401);
    }
    const blocked = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: "ghost-block-x", password: "whatever" },
      ip,
    });
    // No 429 anywhere: the fake previously invented one the real provider
    // never had. The blocked response is byte-identical to an ordinary
    // failure so the block leaks nothing about usernames.
    const ordinary = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: "ghost-ordinary", password: "whatever" },
      ip: "10.81.1.8",
    });
    expect(blocked.status).toBe(401);
    expect(await blocked.text()).toBe(await ordinary.text());

    const events = await eventsForIp(db, ip);
    // The ten triggering failures, then the blocked eleventh; the owner's
    // carve-out rows below are separate usernames at the same ip.
    expect(events.filter((event) => event.username.startsWith("ghost-block") && event.outcome === "failure")).toHaveLength(10);
    const blockedEvents = events.filter((event) => event.outcome === "blocked");
    expect(blockedEvents).toHaveLength(1);
    expect(blockedEvents[0]?.reason).toBe("ip_blocked");
    // Blocked attempts never carry the suspicious flag: the outcome itself
    // is the evidence.
    expect(blockedEvents[0]?.suspicious).toBe(0);

    // The carve-out, through the seam: a valid username is processed
    // normally from the blocked IP — wrong password is an ordinary logged
    // failure, correct password signs in.
    const wrongPassword = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: OWNER_USERNAME, password: "not-the-password" },
      ip,
    });
    expect(wrongPassword.status).toBe(401);
    const processed = (await eventsForIp(db, ip)).filter(
      (event) => event.username === OWNER_USERNAME,
    );
    expect(processed).toHaveLength(1);
    expect(processed[0]?.outcome).toBe("failure");
    expect(processed[0]?.reason).toBe("invalid_password");
    const jar = new CookieJar();
    const success = await authRequest(jar, "/api/auth/sign-in/username", {
      body: { username: OWNER_USERNAME, password: OWNER_PASSWORD },
      ip,
    });
    expect(success.status).toBe(200);
  });
});

describe("the suspicious criteria (ticket 81)", () => {
  it("flags the 5th and later failures against one valid username from one ip", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const start = Date.now();
    for (let i = 1; i <= 6; i++) {
      const result = await recordLoginFailure(db, {
        username: "flag-a-user",
        ip: "10.81.2.1",
        userAgent: null,
        reason: "invalid_password",
        usernameIsStaff: true,
      }, start + i);
      expect(result.suspicious).toBe(i >= 5);
    }
    // A different ip is its own count.
    const otherIp = await recordLoginFailure(db, {
      username: "flag-a-user",
      ip: "10.81.2.2",
      userAgent: null,
      reason: "invalid_password",
      usernameIsStaff: true,
    }, start + 10);
    expect(otherIp.suspicious).toBe(false);
    // The window rolls: four failures, then one after the window has slid
    // past them, is a first failure again.
    for (let i = 1; i <= 4; i++) {
      await recordLoginFailure(db, {
        username: "flag-a-window",
        ip: "10.81.2.3",
        userAgent: null,
        reason: "invalid_password",
        usernameIsStaff: true,
      }, start + 20 * 60 * 1000 + i);
    }
    const later = await recordLoginFailure(db, {
      username: "flag-a-window",
      ip: "10.81.2.3",
      userAgent: null,
      reason: "invalid_password",
      usernameIsStaff: true,
    }, start + 31 * 60 * 1000);
    expect(later.suspicious).toBe(false);
  });

  it("flags the 3rd and later unknown-or-disabled failures from one ip", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const start = Date.now();
    const usernames = ["ghost-c-1", "ghost-c-2", "ghost-c-3", "ghost-c-4"];
    for (let i = 1; i <= 4; i++) {
      const result = await recordLoginFailure(db, {
        username: usernames[i - 1]!,
        ip: "10.81.3.1",
        userAgent: null,
        reason: "unknown_username",
        usernameIsStaff: false,
      }, start + i);
      expect(result.suspicious).toBe(i >= 3);
    }
    // Disabled accounts feed the same per-ip population.
    const disabledElsewhere = await recordLoginFailure(db, {
      username: "disabled-c",
      ip: "10.81.3.2",
      userAgent: null,
      reason: "disabled_account",
      usernameIsStaff: false,
    }, start + 10);
    expect(disabledElsewhere.suspicious).toBe(false);
    const disabledSame = await recordLoginFailure(db, {
      username: "disabled-c",
      ip: "10.81.3.1",
      userAgent: null,
      reason: "disabled_account",
      usernameIsStaff: false,
    }, start + 11);
    expect(disabledSame.suspicious).toBe(true);
  });

  it("flags a success from an ip the account never succeeded from, until the baseline covers it", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const start = Date.now();
    const first = await recordLoginSuccess(db, { username: "flag-b-alice", ip: "10.81.4.1", userAgent: null }, start);
    expect(first.suspicious).toBe(true);
    const repeat = await recordLoginSuccess(db, { username: "flag-b-alice", ip: "10.81.4.1", userAgent: null }, start + 1);
    expect(repeat.suspicious).toBe(false);
    const newIp = await recordLoginSuccess(db, { username: "flag-b-alice", ip: "10.81.4.2", userAgent: null }, start + 2);
    expect(newIp.suspicious).toBe(true);
    // The baseline is per account: another account's first success from the
    // same ip is still flagged.
    const otherAccount = await recordLoginSuccess(db, { username: "flag-b-bob", ip: "10.81.4.1", userAgent: null }, start + 3);
    expect(otherAccount.suspicious).toBe(true);
    // Clearing the log resets the baseline (accepted at grilling).
    await clearLoginEvents(db);
    const afterClear = await recordLoginSuccess(db, { username: "flag-b-alice", ip: "10.81.4.1", userAgent: null }, start + 4);
    expect(afterClear.suspicious).toBe(true);
  });

  it("serves the suspicious view as exactly the flagged subset", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const all = await listLoginEvents(db);
    const flagged = await listLoginEvents(db, { suspiciousOnly: true });
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((event) => event.suspicious)).toBe(true);
    expect(flagged.length).toBe(all.filter((event) => event.suspicious).length);
  });
});

describe("the ip block rule (ticket 81)", () => {
  it("blocks on the tenth non-staff-username failure inside the window", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.5.1";
    const start = Date.now();
    for (let i = 1; i <= 9; i++) {
      const result = await recordLoginFailure(db, {
        username: `hammer-a-${i}`,
        ip,
        userAgent: null,
        reason: "unknown_username",
        usernameIsStaff: false,
      }, start + i);
      expect(result.blocked).toBe(false);
    }
    expect(await isIpBlocked(db, ip, start + 10)).toBe(false);
    const tenth = await recordLoginFailure(db, {
      username: "hammer-a-10",
      ip,
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, start + 10);
    expect(tenth.blocked).toBe(true);
    expect(await isIpBlocked(db, ip, start + 10)).toBe(true);
  });

  it("expires the block after the hour with no manual release", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.5.2";
    const start = Date.now();
    for (let i = 1; i <= 10; i++) {
      await recordLoginFailure(db, {
        username: `hammer-b-${i}`,
        ip,
        userAgent: null,
        reason: "unknown_username",
        usernameIsStaff: false,
      }, start + i);
    }
    expect(await isIpBlocked(db, ip, start + 59 * 60 * 1000)).toBe(true);
    expect(await isIpBlocked(db, ip, start + 61 * 60 * 1000)).toBe(false);
    // After expiry a fresh attempt is an ordinary first failure: the old
    // burst has slid out of the window and nothing re-blocks.
    const fresh = await recordLoginFailure(db, {
      username: "hammer-b-late",
      ip,
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, start + 61 * 60 * 1000 + 1);
    expect(fresh.blocked).toBe(false);
    expect(fresh.suspicious).toBe(false);
  });

  it("never extends the block, no matter how much a blocked ip hammers", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.5.3";
    const start = Date.now();
    for (let i = 1; i <= 10; i++) {
      await recordLoginFailure(db, {
        username: `hammer-c-${i}`,
        ip,
        userAgent: null,
        reason: "unknown_username",
        usernameIsStaff: false,
      }, start + i);
    }
    // Sustained hammering during the block flows through the same keyed
    // transaction that records failures: every attempt lands as a blocked
    // event and none of them re-stamps the block it arrived into.
    for (let i = 0; i < 20; i++) {
      const result = await recordLoginFailure(db, {
        username: `hammer-c-more-${i}`,
        ip,
        userAgent: null,
        reason: "unknown_username",
        usernameIsStaff: false,
      }, start + 30 * 60 * 1000 + i);
      expect(result.blocked).toBe(true);
    }
    const blockedEvents = (await eventsForIp(db, ip)).filter((event) => event.outcome === "blocked");
    expect(blockedEvents).toHaveLength(20);
    // If any of that extended the block, the hour mark would not release.
    expect(await isIpBlocked(db, ip, start + 59 * 60 * 1000)).toBe(true);
    expect(await isIpBlocked(db, ip, start + 61 * 60 * 1000)).toBe(false);
  });

  it("never blocks or extends on valid-username failures", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.5.4";
    const start = Date.now();
    for (let i = 1; i <= 15; i++) {
      const result = await recordLoginFailure(db, {
        username: OWNER_USERNAME,
        ip,
        userAgent: null,
        reason: "invalid_password",
        usernameIsStaff: true,
      }, start + i);
      expect(result.blocked).toBe(false);
    }
    expect(await isIpBlocked(db, ip, start + 20)).toBe(false);
  });

  it("counts the block window as a rolling ten minutes", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const start = Date.now();
    for (let i = 1; i <= 9; i++) {
      await recordLoginFailure(db, {
        username: `hammer-d-${i}`,
        ip: "10.81.5.5",
        userAgent: null,
        reason: "unknown_username",
        usernameIsStaff: false,
      }, start + i);
    }
    const inside = await recordLoginFailure(db, {
      username: "hammer-d-10",
      ip: "10.81.5.5",
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, start + 5 * 60 * 1000);
    expect(inside.blocked).toBe(true);
    for (let i = 1; i <= 9; i++) {
      await recordLoginFailure(db, {
        username: `hammer-e-${i}`,
        ip: "10.81.5.6",
        userAgent: null,
        reason: "unknown_username",
        usernameIsStaff: false,
      }, start + 60 * 60 * 1000 + i);
    }
    const outside = await recordLoginFailure(db, {
      username: "hammer-e-10",
      ip: "10.81.5.6",
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, start + 60 * 60 * 1000 + 11 * 60 * 1000);
    expect(outside.blocked).toBe(false);
  });
});

describe("concurrent attempts cannot miss the thresholds (ticket 81 amendment)", () => {
  it("blocks at the tenth concurrent non-staff-username failure from one ip", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.90.1";
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        recordLoginFailure(db, {
          username: `ghost-concurrent-${i}`,
          ip,
          userAgent: null,
          reason: "unknown_username",
          usernameIsStaff: false,
        }, now),
      ),
    );
    // The events must count one another: exactly the tenth failure crosses
    // the boundary, exactly one call reports it, and the block expires one
    // hour after the triggering failure with no manual release.
    expect(results.filter((result) => result.blocked)).toHaveLength(1);
    expect(await isIpBlocked(db, ip, now)).toBe(true);
    expect(await isIpBlocked(db, ip, now + 60 * 60 * 1000)).toBe(false);
    // Criterion (c) under the same concurrency: of the ten, the 3rd and
    // later carry the flag — eight flagged, two not.
    const events = await eventsForIp(db, ip);
    expect(events).toHaveLength(10);
    expect(events.filter((event) => event.suspicious === 1)).toHaveLength(8);
  });

  it("flags the fifth concurrent valid-username failure without ever blocking", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.90.2";
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordLoginFailure(db, {
          username: "flag-concurrent-valid",
          ip,
          userAgent: null,
          reason: "invalid_password",
          usernameIsStaff: true,
        }, now),
      ),
    );
    // Criterion (a): exactly the fifth of five carries the flag, and the
    // valid-username carve-out holds — no call blocks, no block row exists.
    expect(results.filter((result) => result.suspicious)).toHaveLength(1);
    expect(results.filter((result) => result.blocked)).toHaveLength(0);
    expect(await isIpBlocked(db, ip, now)).toBe(false);
    const events = await eventsForIp(db, ip);
    expect(events).toHaveLength(5);
    expect(events.filter((event) => event.suspicious === 1)).toHaveLength(1);
  });
});

describe("an attempt queued behind the block threshold is recorded blocked (ticket 81 second amendment)", () => {
  it("records the queued attempt as blocked instead of an eleventh failure", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.91.1";
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        recordLoginFailure(db, {
          username: `ghost-queued-${i}`,
          ip,
          userAgent: null,
          reason: "unknown_username",
          usernameIsStaff: false,
        }, now),
      ),
    );
    // Whatever order the eleven acquire the ip's boundary in, exactly ten
    // of them are ordinary failures — the tenth sets the block — and the
    // one queued behind it is recorded blocked, not an eleventh failure
    // that re-stamps the block from its own clock.
    const events = await eventsForIp(db, ip);
    expect(events.filter((event) => event.outcome === "failure")).toHaveLength(10);
    const blockedEvents = events.filter((event) => event.outcome === "blocked");
    expect(blockedEvents).toHaveLength(1);
    expect(blockedEvents[0]?.reason).toBe("ip_blocked");
    // The trigger and the rejection both report the block rule engaging;
    // no third attempt does.
    expect(results.filter((result) => result.blocked)).toHaveLength(2);
    // The expiry is the threshold-setting attempt's hour, unmoved: live one
    // instant before it, gone exactly at it.
    const block = await db.get<{ blockedUntil: string }>(
      `SELECT blocked_until AS "blockedUntil" FROM login_ip_blocks WHERE ip = ?`,
      ip,
    );
    expect(block?.blockedUntil).toBe(new Date(now + 60 * 60 * 1000).toISOString());
    expect(await isIpBlocked(db, ip, now + 60 * 60 * 1000 - 1)).toBe(true);
    expect(await isIpBlocked(db, ip, now + 60 * 60 * 1000)).toBe(false);
  });

  it("keeps a blocked attempt's rejection from moving the expiry", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.91.2";
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        recordLoginFailure(db, {
          username: `ghost-expiry-${i}`,
          ip,
          userAgent: null,
          reason: "unknown_username",
          usernameIsStaff: false,
        }, now),
      ),
    );
    expect(results.filter((result) => result.blocked)).toHaveLength(1);
    // A later attempt during the block is rejected through the keyed
    // transaction five minutes into the hour; its clock never touches the
    // block the threshold-setting attempt created.
    const later = await recordLoginFailure(db, {
      username: "ghost-expiry-later",
      ip,
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, now + 5 * 60 * 1000);
    expect(later.blocked).toBe(true);
    const block = await db.get<{ blockedUntil: string }>(
      `SELECT blocked_until AS "blockedUntil" FROM login_ip_blocks WHERE ip = ?`,
      ip,
    );
    expect(block?.blockedUntil).toBe(new Date(now + 60 * 60 * 1000).toISOString());
    const events = await eventsForIp(db, ip);
    expect(events.filter((event) => event.outcome === "failure")).toHaveLength(10);
    expect(events.filter((event) => event.outcome === "blocked")).toHaveLength(1);
    expect(await isIpBlocked(db, ip, now + 60 * 60 * 1000)).toBe(false);
  });

  it("keeps a valid-username failure an ordinary failure even interleaved with the block boundary", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const ip = "10.81.91.3";
    const now = Date.now();
    // Ten non-staff-username failures race one valid-username failure at
    // the same instant: wherever the valid one lands in the queue, the
    // carve-out holds — it is never block-checked and never rejected, and
    // it never feeds the block's count.
    const results = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        recordLoginFailure(db, {
          username: `ghost-carveout-${i}`,
          ip,
          userAgent: null,
          reason: "unknown_username",
          usernameIsStaff: false,
        }, now),
      ),
      recordLoginFailure(db, {
        username: OWNER_USERNAME,
        ip,
        userAgent: null,
        reason: "invalid_password",
        usernameIsStaff: true,
      }, now),
    ]);
    const events = await eventsForIp(db, ip);
    expect(events.filter((event) => event.outcome === "failure")).toHaveLength(11);
    expect(events.filter((event) => event.outcome === "blocked")).toHaveLength(0);
    const valid = events.filter((event) => event.username === OWNER_USERNAME);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.outcome).toBe("failure");
    expect(valid[0]?.reason).toBe("invalid_password");
    // Still exactly the tenth non-staff-username failure that engages the
    // block, at the triggering attempt's hour.
    expect(results.filter((result) => result.blocked)).toHaveLength(1);
    const block = await db.get<{ blockedUntil: string }>(
      `SELECT blocked_until AS "blockedUntil" FROM login_ip_blocks WHERE ip = ?`,
      ip,
    );
    expect(block?.blockedUntil).toBe(new Date(now + 60 * 60 * 1000).toISOString());
  });
});

describe("the owner-only logs api (ticket 81)", () => {
  it("refuses staff, editors, and the unauthenticated; serves owners", { timeout: 120_000 }, async () => {
    expect((await logsGet(new CookieJar())).status).toBe(401);
    expect((await logsGet(staffJar)).status).toBe(403);
    expect((await logsGet(editorJar)).status).toBe(403);
    const ownerResponse = await logsGet(ownerJar);
    expect(ownerResponse.status).toBe(200);
    const body = (await ownerResponse.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("deletes single entries, selections, and everything — owners only", { timeout: 120_000 }, async () => {
    const db = await testDb();
    expect((await logsDelete(new CookieJar(), { all: true })).status).toBe(401);
    expect((await logsDelete(staffJar, { all: true })).status).toBe(403);
    expect((await logsDelete(editorJar, { all: true })).status).toBe(403);
    // Malformed bodies are refused for owners too.
    expect((await logsDelete(ownerJar, {})).status).toBe(400);
    expect((await logsDelete(ownerJar, { ids: [] })).status).toBe(400);
    expect((await logsDelete(ownerJar, { ids: [42] })).status).toBe(400);

    const username = `delete-${randomUUID().slice(0, 8)}`;
    await recordLoginSuccess(db, { username, ip: "10.81.6.1", userAgent: null });
    await recordLoginSuccess(db, { username, ip: "10.81.6.2", userAgent: null });
    await recordLoginSuccess(db, { username, ip: "10.81.6.3", userAgent: null });
    const seeded = (await listLoginEvents(db)).filter((event) => event.username === username);
    expect(seeded).toHaveLength(3);

    const single = (await logsDelete(ownerJar, { ids: [seeded[0]!.id] })).status;
    expect(single).toBe(200);
    const afterSingle = (await listLoginEvents(db)).filter((event) => event.username === username);
    expect(afterSingle).toHaveLength(2);

    const multi = await logsDelete(ownerJar, { ids: [afterSingle[0]!.id, afterSingle[1]!.id] });
    expect(((await multi.json()) as { removed: number }).removed).toBe(2);
    expect((await listLoginEvents(db)).filter((event) => event.username === username)).toHaveLength(0);

    // Clear-all removes the log's remaining rows exactly.
    const before = (await listLoginEvents(db)).length;
    expect(before).toBeGreaterThan(0);
    const cleared = await logsDelete(ownerJar, { all: true });
    expect(((await cleared.json()) as { removed: number }).removed).toBe(before);
    expect(await listLoginEvents(db)).toHaveLength(0);
  });

  it("gates the login retention setting and validates its value", { timeout: 120_000 }, async () => {
    expect((await loginRetentionGet(new CookieJar())).status).toBe(401);
    expect((await loginRetentionGet(staffJar)).status).toBe(403);
    expect((await loginRetentionGet(editorJar)).status).toBe(403);
    const ownerGet = await loginRetentionGet(ownerJar);
    expect(ownerGet.status).toBe(200);
    expect(((await ownerGet.json()) as { days: number | null }).days).toBeNull();

    expect((await loginRetentionPut(staffJar, { days: 45 })).status).toBe(403);
    expect((await loginRetentionPut(editorJar, { days: 45 })).status).toBe(403);
    const saved = await loginRetentionPut(ownerJar, { days: 45 });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { days: number | null }).days).toBe(45);
    expect((await loginRetentionPut(ownerJar, { days: 0 })).status).toBe(400);
    expect((await loginRetentionPut(ownerJar, { days: 3651 })).status).toBe(400);
    const reset = await loginRetentionPut(ownerJar, { days: null });
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as { days: number | null }).days).toBeNull();
  });
});

describe("login retention (ticket 81)", () => {
  it("sweeps events older than the owner's period and keeps the rest", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const now = Date.now();
    await setLoginRetentionDays(db, 5);
    await recordLoginFailure(db, {
      username: "ret-old",
      ip: "10.81.7.1",
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, now - 6 * DAY_MS);
    await recordLoginFailure(db, {
      username: "ret-new",
      ip: "10.81.7.2",
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, now - DAY_MS);
    const removed = await sweepLoginEvents(db, now);
    expect(removed).toBeGreaterThanOrEqual(1);
    const usernames = (await listLoginEvents(db)).map((event) => event.username);
    expect(usernames).not.toContain("ret-old");
    expect(usernames).toContain("ret-new");
  });

  it("keeps the 90-day default while nothing is configured", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const now = Date.now();
    await setLoginRetentionDays(db, null);
    expect(DEFAULT_LOGIN_RETENTION_DAYS).toBe(90);
    await recordLoginFailure(db, {
      username: "ret-ancient",
      ip: "10.81.7.3",
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, now - 91 * DAY_MS);
    await recordLoginFailure(db, {
      username: "ret-recent",
      ip: "10.81.7.4",
      userAgent: null,
      reason: "unknown_username",
      usernameIsStaff: false,
    }, now - 89 * DAY_MS);
    await sweepLoginEvents(db, now);
    const usernames = (await listLoginEvents(db)).map((event) => event.username);
    expect(usernames).not.toContain("ret-ancient");
    expect(usernames).toContain("ret-recent");
  });

  it("refuses to delete on a corrupt setting", { timeout: 120_000 }, async () => {
    const db = await testDb();
    await setSetting(db, "login_retention_days", "not-a-number");
    const before = await listLoginEvents(db);
    expect(before.length).toBeGreaterThan(0);
    const removed = await sweepLoginEvents(db);
    expect(removed).toBeNull();
    expect(await listLoginEvents(db)).toHaveLength(before.length);
    await setLoginRetentionDays(db, null);
  });
});

describe("the portable store queries agree across dialects", () => {
  it("counts login events identically through the portable surface", { timeout: 120_000 }, async () => {
    const db = await testDb();
    const username = `parity-${randomUUID().slice(0, 8)}`;
    for (let i = 1; i <= 3; i++) {
      await recordLoginSuccess(db, { username, ip: `10.81.8.${i}`, userAgent: null }, Date.now() + i);
    }
    const counted = await db.get<{ hits: number }>(
      countQuery(
        'SELECT COUNT(*)::int AS hits FROM login_events WHERE username = ?',
        "SELECT COUNT(*) AS hits FROM login_events WHERE username = ?",
      ),
      username,
    );
    expect(counted?.hits).toBe(3);
  });
});
