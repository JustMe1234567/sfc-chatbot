import { beforeAll, describe, expect, it, vi } from "vitest";

// The PG-mode suite runs at the local cluster's connection ceiling: cap this
// file's pools so the whole suite's files keep their warmup budget.
process.env.PG_POOL_MAX = "5";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import { CookieJar, provisionStaff, signInAs } from "./auth-helpers";

/**
 * Ticket 89: the settings page's eight server reads previously raced in one
 * `Promise.all`. On a Postgres pool with no headroom — observed with the
 * deployed-recommended `PG_POOL_MAX=5` against the hosted test project — the
 * authed render starved: eight concurrent leases over-subscribed the pool,
 * the RSC render never completed, and the navigation timed out (a bare-process
 * probe of the same reads took 785 ms, so the queries themselves were never
 * the problem). The fix batches the reads so the render never holds more than
 * four leases at once — half the default pool of 8 — and this file pins that
 * bound around the real page component: the read counter below wraps the
 * exact `db`/`store` handles the page resolves from the service, so the
 * measured maximum is the render's actual concurrency, deterministically
 * (all eight getters are invoked synchronously inside the old `Promise.all`,
 * so every increment lands in the same tick before any read can settle).
 *
 * The same renders pin what the batching must not disturb: every Settings
 * value reaching its card, and — since ticket 102 made Settings an Admin
 * area — that an Admissions Advisor is refused before any settings read.
 */

// Shared with the `@/db/service` mock factory below (vi.mock factories hoist
// above plain module state, so the counters live behind vi.hoisted).
const reads = vi.hoisted(() => ({ inFlight: 0, max: 0 }));

// The direct page-component drive (the ticket-73 pattern in
// empty-successors.test.ts): headers() serves the signed-in staff cookie.
let pageCookie = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: pageCookie }),
}));

// Every consumer — the page, requireStaff's session lookups, the seeding in
// beforeAll — shares one instrumented service: the real one, with the page's
// db/store reads passed through the concurrency counter.
vi.mock("@/db/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/service")>();
  type Service = Awaited<ReturnType<typeof actual.getChatbotService>>;
  let instrumented: Promise<Service> | null = null;
  async function counted<T>(read: () => Promise<T>): Promise<T> {
    reads.inFlight += 1;
    reads.max = Math.max(reads.max, reads.inFlight);
    try {
      return await read();
    } finally {
      reads.inFlight -= 1;
    }
  }
  function instrument(service: Service): Service {
    const db = service.db;
    const store = service.store;
    return {
      ...service,
      db: {
        ...db,
        get: <T>(query: string, ...params: unknown[]) => counted(() => db.get<T>(query, ...params)),
        all: <T>(query: string, ...params: unknown[]) => counted(() => db.all<T>(query, ...params)),
        run: (query: string, ...params: unknown[]) => counted(() => db.run(query, ...params)),
        transaction: db.transaction.bind(db),
      },
      store: {
        ...store,
        getLatestRetentionRun: () => counted(() => store.getLatestRetentionRun()),
      },
    };
  }
  return {
    ...actual,
    getChatbotService: () => {
      instrumented ??= actual.getChatbotService().then(instrument);
      return instrumented;
    },
  };
});

const ADMIN_LOGIN = "pool-admin";
const STAFF_LOGIN = "pool-staff";
const EDITOR_LOGIN = "pool-editor";
const PASSWORD = "pool-render-lantern-9f";

// The seeded values are deliberately distinct so the page tree's props pin
// each read individually — batching must not reorder or drop any of them.
const HOURS = {
  timeZone: "America/Chicago",
  days: [1, 2, 3, 4, 5],
  startMinute: 8 * 60,
  endMinute: 17 * 60,
};
const TRANSCRIPT_DAYS = 45;
const LOGIN_DAYS = 60;
const ALLOWLIST_ORIGIN = "https://pool-regression.example";
// The legal rectangular shape cert70 saved (icon + padding fit 96 × 44).
const CHATHEAD = { backgroundColor: "#123456", iconSize: 32, padding: 0, width: 96, height: 44 };
// A real 1x1 PNG: the version getters only surface updatedAt for a valid
// stored image, so the branding versions need real image bytes.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const jars: Record<string, CookieJar> = {};
// The branding versions as seeded, read back before any render so the page's
// asset URLs can be compared against them.
let seededIconVersion = "";
let seededFaviconVersion = "";

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  // The two operational accounts both hold the Admissions Advisor role now
  // (ticket 102 merged Staff and Editor into it).
  await provisionStaff({ email: `${ADMIN_LOGIN}@example.edu`, password: PASSWORD, name: "Rhea", role: "admin" });
  await provisionStaff({ email: `${STAFF_LOGIN}@example.edu`, password: PASSWORD, name: "Sage" });
  await provisionStaff({ email: `${EDITOR_LOGIN}@example.edu`, password: PASSWORD, name: "Elio" });

  const { getChatbotService } = await import("@/db/service");
  const { db } = await getChatbotService();
  const {
    setSupportHours: seedHours,
    setTranscriptRetentionDays,
    setLoginRetentionDays,
    setEmbedAllowlist,
    setChatheadConfig,
    setChatbotIconDataUrl,
    setDashboardFaviconDataUrl,
    getChatbotIconVersion,
    getDashboardFaviconVersion,
  } = await import("../src/settings");
  await seedHours(db, HOURS);
  await setTranscriptRetentionDays(db, TRANSCRIPT_DAYS);
  await setLoginRetentionDays(db, LOGIN_DAYS);
  await setEmbedAllowlist(db, [ALLOWLIST_ORIGIN]);
  await setChatheadConfig(db, CHATHEAD);
  await setChatbotIconDataUrl(db, PNG_DATA_URL);
  await setDashboardFaviconDataUrl(db, PNG_DATA_URL);
  seededIconVersion = await getChatbotIconVersion(db);
  seededFaviconVersion = await getDashboardFaviconVersion(db);

  for (const login of [ADMIN_LOGIN, STAFF_LOGIN, EDITOR_LOGIN]) {
    const jar = new CookieJar();
    await signInAs(jar, login, PASSWORD);
    jars[login] = jar;
  }
});

/** Renders the real page as a signed-in account and reports the read concurrency peak. */
async function renderSettings(login: string): Promise<{ tree: unknown; maxConcurrent: number }> {
  const jar = jars[login];
  if (!jar) {
    throw new Error(`no signed-in jar for ${login}`);
  }
  pageCookie = jar.header();
  reads.inFlight = 0;
  reads.max = 0;
  const { default: SettingsPage } = await import("../src/app/dashboard/settings/page");
  const tree = await SettingsPage();
  return { tree, maxConcurrent: reads.max };
}

describe("the settings page's server reads stay within the pool headroom (ticket 89)", () => {
  it("holds at most four concurrent store reads on the admin render", async () => {
    const { maxConcurrent } = await renderSettings(ADMIN_LOGIN);
    // The bound the fix pins: at most half the default pool of 8. The old
    // single `Promise.all` measured 8 here — the over-subscription that
    // starved the five-lease deployed pool and hung the authed render.
    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });

  it("delivers every seeded setting to the admin render, batched or not", async () => {
    const { tree } = await renderSettings(ADMIN_LOGIN);
    const rendered = JSON.stringify(tree);
    expect(rendered).toContain('"initialHours":{"timeZone":"America/Chicago"');
    expect(rendered).toContain('"initialDays":45');
    expect(rendered).toContain('"initialDays":60');
    expect(rendered).toContain(ALLOWLIST_ORIGIN);
    expect(rendered).toContain('"backgroundColor":"#123456"');
    // The branding versions ride the card's asset URLs untouched.
    expect(rendered).toContain(`/api/branding/chatbot-icon?v=${encodeURIComponent(seededIconVersion)}`);
    expect(rendered).toContain(
      `/api/branding/dashboard-favicon?v=${encodeURIComponent(seededFaviconVersion)}`,
    );
  });

  it("refuses each admissions advisor before reading or rendering any setting", async () => {
    for (const login of [STAFF_LOGIN, EDITOR_LOGIN]) {
      const { tree } = await renderSettings(login);
      const rendered = JSON.stringify(tree);
      expect(rendered, login).toContain("This page requires the admin role.");
      // Neither the configuration forms, nor ticket 88's former read-only
      // summary, nor any configured value reaches an advisor.
      for (const withheld of [
        "initialHours",
        "initialDays",
        "initialOrigins",
        ALLOWLIST_ORIGIN,
        '"backgroundColor":"#123456"',
        "45 days in History",
      ]) {
        expect(rendered, `${login} → ${withheld}`).not.toContain(withheld);
      }
    }
  });
});
