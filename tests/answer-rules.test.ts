import { beforeAll, describe, expect, it } from "vitest";
import { ask, startConversation, TEST_ORIGIN, useTempDatabase,
  warmChatbotService,
} from "./helpers";
import {
  authRequest,
  CookieJar,
  provisionStaff,
  signInAs,
} from "./auth-helpers";

const ADMIN_EMAIL = "owner@example.edu";
const ADMIN_PASSWORD = "owner-manage-pilot-91";
const ADVISOR_EMAIL = "advisor@example.edu";
const ADVISOR_PASSWORD = "editor-study-puzzle-2z";
const OTHER_ADVISOR_EMAIL = "helper@example.edu";
const OTHER_ADVISOR_PASSWORD = "helper-plain-branch-8m";

interface RulePayload {
  topic: string;
  response: string;
  phrases: string[];
  keywords?: string[][];
  link?: string;
}

/**
 * Unique rule content per call: tests share one database, and a phrase left
 * published by an earlier test would answer the same question later.
 */
function uniqueRuleContent(tag: string): RulePayload {
  return {
    topic: `Parking (${tag})`,
    response: `Visitor parking for ${tag} is free in the Main Street lot. See the parking page for a map.`,
    link: "https://www.example-college.edu/parking",
    phrases: [`Where can I park at the ${tag}`, `${tag} visitor parking`],
    keywords: [["parking", tag]],
  };
}

async function ruleRequest(
  jar: CookieJar | null,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  origin = TEST_ORIGIN,
  bearerToken?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(jar ? { cookie: jar.header() } : {}),
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    origin,
  };
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (path === "/api/staff/answer-rules") {
    const route = await import("../src/app/api/staff/answer-rules/route");
    return method === "GET" ? route.GET(request) : route.POST(request);
  }
  const match = path.match(/^\/api\/staff\/answer-rules\/([^/]+)$/);
  if (match?.[1]) {
    const { PUT } = await import("../src/app/api/staff/answer-rules/[id]/route");
    return PUT(request, { params: Promise.resolve({ id: match[1] }) });
  }
  const actionMatch = path.match(
    /^\/api\/staff\/answer-rules\/([^/]+)\/(publish|unpublish|duplicate|archive|trash|restore|purge)$/,
  );
  if (actionMatch) {
    const { POST } = await import(
      `../src/app/api/staff/answer-rules/[id]/${actionMatch[2]}/route`
    );
    return POST(request, { params: Promise.resolve({ id: actionMatch[1] }) });
  }
  throw new Error(`unmapped answer-rule path: ${path}`);
}

async function topics(): Promise<{ topics: { id: string; topic: string; question: string }[] }> {
  const { GET } = await import("../src/app/api/v1/topics/route");
  const response = await GET(new Request(`${TEST_ORIGIN}/api/v1/topics`));
  expect(response.status).toBe(200);
  return (await response.json()) as { topics: { id: string; topic: string; question: string }[] };
}

interface RuleRecord {
  id: string;
  status: string;
  publishedBy: string | null;
  publishedByName: string | null;
  reviewedAt: string | null;
  trashedAt?: string | null;
  topic?: string;
  phrases?: string[];
  link?: string;
}

async function createRule(jar: CookieJar, payload: RulePayload): Promise<RuleRecord> {
  const response = await ruleRequest(jar, "POST", "/api/staff/answer-rules", payload);
  expect(response.status).toBe(201);
  return (await response.json()) as RuleRecord;
}

async function publishRule(jar: CookieJar, id: string): Promise<RuleRecord> {
  const response = await ruleRequest(jar, "POST", `/api/staff/answer-rules/${id}/publish`);
  expect(response.status).toBe(200);
  return (await response.json()) as RuleRecord;
}

/** One question on a fresh conversation: its state and bot reply, or null. */
async function askFresh(
  text: string,
): Promise<{ state: string; reply: { text: string } | null }> {
  const conversation = await startConversation();
  const response = await ask(conversation, text);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    conversation: { state: string };
    reply: { text: string } | null;
  };
  return { state: body.conversation.state, reply: body.reply };
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
    await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Olive", role: "admin" });
  await provisionStaff({ email: ADVISOR_EMAIL, password: ADVISOR_PASSWORD, name: "Eddie" });
  await provisionStaff({ email: OTHER_ADVISOR_EMAIL, password: OTHER_ADVISOR_PASSWORD, name: "Sam" });
});

describe("an admissions advisor maintains answer rules", () => {
  it("creates a draft rule that never answers visitors", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("draft");
    const question = content.phrases[0]!;
    const rule = await createRule(jar, content);

    expect(rule.status).toBe("draft");
    expect(rule.publishedBy).toBeNull();

    const asked = await askFresh(question);
    expect(asked.state).toBe("bot_active");
    expect(asked.reply?.text ?? "").not.toContain("Main Street lot");
  });

  it("publishing makes the topic button and answer available without a redeploy", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("launch");
    const rule = await createRule(jar, content);
    const published = await publishRule(jar, rule.id);

    expect(published.status).toBe("published");
    expect(published.reviewedAt).toBeTruthy();

    // The public topic list a widget reload fetches includes the new rule's
    // button; clicking it asks the rule's first phrase.
    const list = await topics();
    const button = list.topics.find((topic) => topic.id === rule.id);
    expect(button?.topic).toBe(content.topic);
    expect(button?.question).toBe(content.phrases[0]);

    const asked = await askFresh(button!.question);
    expect(asked.state).toBe("bot_active");
    expect(asked.reply?.text).toContain("Main Street lot");
  });

  it("unpublishing removes the answer from visitors", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("retire");
    const question = content.phrases[0]!;
    const rule = await createRule(jar, content);
    await publishRule(jar, rule.id);

    const unpublish = await ruleRequest(jar, "POST", `/api/staff/answer-rules/${rule.id}/unpublish`);
    expect(unpublish.status).toBe(200);
    expect(((await unpublish.json()) as RuleRecord).status).toBe("draft");

    const asked = await askFresh(question);
    expect(asked.state).toBe("bot_active");
    expect((await topics()).topics.find((topic) => topic.id === rule.id)).toBeUndefined();
  });

  it("creates and publishes a keywords-only rule whose button asks its topic", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("keywordsonly");
    const rule = await createRule(jar, {
      topic: content.topic,
      response: content.response,
      phrases: [],
      keywords: content.keywords,
    });
    await publishRule(jar, rule.id);

    // The spec allows "phrase aliases or keyword conditions": a keywords-only
    // rule is valid, and its topic button falls back to the topic label.
    const button = (await topics()).topics.find((topic) => topic.id === rule.id);
    expect(button?.question).toBe(content.topic);

    const asked = await askFresh(`Please tell me about ${content.keywords![0]!.join(" and ")} options`);
    expect(asked.state).toBe("bot_active");
    expect(asked.reply?.text).toContain("Main Street lot");
  });

  it("revising published content returns it to draft until it is re-published", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("revise");
    const question = content.phrases[0]!;
    const rule = await createRule(jar, content);
    await publishRule(jar, rule.id);

    const revised = await ruleRequest(jar, "PUT", `/api/staff/answer-rules/${rule.id}`, {
      ...content,
      response: "Visitor parking is free after 4pm in the Main Street lot.",
    });
    expect(revised.status).toBe(200);
    expect(((await revised.json()) as RuleRecord).status).toBe("draft");

    const stale = await askFresh(question);
    expect(stale.state).toBe("bot_active");

    await publishRule(jar, rule.id);
    const fresh = await askFresh(question);
    expect(fresh.reply?.text).toContain("free after 4pm");
  });
});

describe("who published a rule, and when it was reviewed", () => {
  it("records the publishing advisor on the rule and resolves their name for the dashboard", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const rule = await createRule(jar, uniqueRuleContent("record"));
    await publishRule(jar, rule.id);

    const list = await ruleRequest(jar, "GET", "/api/staff/answer-rules");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { rules: RuleRecord[] };
    const listed = body.rules.find((item) => item.id === rule.id);
    expect(listed?.status).toBe("published");
    expect(listed?.publishedByName).toBe("Eddie");
    expect(listed?.reviewedAt).toBeTruthy();
  });
});

describe("the answer lifecycle (ticket 58)", () => {
  it("duplicates a rule as a separate draft prefilled with its content", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("dupe");
    const original = await createRule(jar, content);
    await publishRule(jar, original.id);

    const duplicateResponse = await ruleRequest(
      jar,
      "POST",
      `/api/staff/answer-rules/${original.id}/duplicate`,
    );
    expect(duplicateResponse.status).toBe(201);
    const copy = (await duplicateResponse.json()) as RuleRecord;

    // The copy is a distinct draft carrying the original's content.
    expect(copy.id).not.toBe(original.id);
    expect(copy.status).toBe("draft");
    expect(copy.topic).toBe(`${content.topic} (copy)`);
    expect(copy.phrases).toEqual(content.phrases);
    expect(copy.link).toBe(content.link);
    expect(copy.publishedBy).toBeNull();

    // The original is untouched and still live.
    const list = await ruleRequest(jar, "GET", "/api/staff/answer-rules");
    const originalAfter = ((await list.json()) as { rules: RuleRecord[] }).rules.find(
      (item) => item.id === original.id,
    );
    expect(originalAfter?.status).toBe("published");

    // The copy never answers visitors until it is explicitly published.
    const asked = await askFresh(content.phrases[0]!);
    expect(asked.state).toBe("bot_active");
    // One reply only: the original's — not the copy's identical text twice.
    const topicsNow = await topics();
    expect(topicsNow.topics.filter((topic) => topic.topic === content.topic)).toHaveLength(1);
  });

  it("archiving retires the answer from visitors immediately but keeps it restorable", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("archive");
    const question = content.phrases[0]!;
    const rule = await createRule(jar, content);
    await publishRule(jar, rule.id);
    expect((await askFresh(question)).reply?.text).toContain("Main Street lot");

    const archived = await ruleRequest(jar, "POST", `/api/staff/answer-rules/${rule.id}/archive`);
    expect(archived.status).toBe(200);
    const body = (await archived.json()) as RuleRecord;
    expect(body.status).toBe("archived");

    // Gone from the topic suggestions and the visitor matcher at once.
    expect((await topics()).topics.find((topic) => topic.id === rule.id)).toBeUndefined();
    expect((await askFresh(question)).reply?.text ?? "").not.toContain("Main Street lot");

    // Restore returns it as a Draft — never automatically republished.
    const restored = await ruleRequest(jar, "POST", `/api/staff/answer-rules/${rule.id}/restore`);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as RuleRecord).status).toBe("draft");
    expect((await askFresh(question)).reply?.text ?? "").not.toContain("Main Street lot");
  });

  it("Delete moves the answer to Trash with a purge stamp, and restoring cancels the expiry", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("trash");
    const question = content.phrases[0]!;
    const rule = await createRule(jar, content);
    await publishRule(jar, rule.id);

    const trashed = await ruleRequest(jar, "POST", `/api/staff/answer-rules/${rule.id}/trash`);
    expect(trashed.status).toBe(200);
    const body = (await trashed.json()) as RuleRecord;
    expect(body.status).toBe("trashed");
    expect(body.trashedAt).toBeTruthy();

    // Out of visitors and suggestions immediately; transcripts keep flowing.
    expect((await topics()).topics.find((topic) => topic.id === rule.id)).toBeUndefined();
    expect((await askFresh(question)).reply?.text ?? "").not.toContain("Main Street lot");

    // Restoring before the 30 days returns a Draft with no purge stamp.
    const restored = await ruleRequest(jar, "POST", `/api/staff/answer-rules/${rule.id}/restore`);
    const restoredBody = (await restored.json()) as RuleRecord;
    expect(restoredBody.status).toBe("draft");
    expect(restoredBody.trashedAt ?? null).toBeNull();
  });

  it("permanently deletion works from Trash only, for admins and admissions advisors, and really removes", async () => {
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const content = uniqueRuleContent("purge");
    const activeRule = await createRule(adminJar, content);
    await publishRule(adminJar, activeRule.id);

    // Purging an answer that is not in Trash is refused.
    const premature = await ruleRequest(
      adminJar,
      "POST",
      `/api/staff/answer-rules/${activeRule.id}/purge`,
    );
    expect(premature.status).toBe(409);

    const trashedRule = await ruleRequest(
      adminJar,
      "POST",
      `/api/staff/answer-rules/${activeRule.id}/trash`,
    );
    expect(trashedRule.status).toBe(200);

    const purged = await ruleRequest(
      adminJar,
      "POST",
      `/api/staff/answer-rules/${activeRule.id}/purge`,
    );
    expect(purged.status).toBe(200);

    // The rule is gone for good: unknown to every rule listing.
    const list = await ruleRequest(adminJar, "GET", "/api/staff/answer-rules");
    expect(
      ((await list.json()) as { rules: RuleRecord[] }).rules.find((item) => item.id === activeRule.id),
    ).toBeUndefined();

    // An admissions advisor holds the same power (ticket 102 merged the
    // editor into the advisor role; there is no editor-only path left).
    const advisorJar = new CookieJar();
    await signInAs(advisorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const advisorRule = await createRule(advisorJar, uniqueRuleContent("purge-advisor"));
    await ruleRequest(advisorJar, "POST", `/api/staff/answer-rules/${advisorRule.id}/trash`);
    const advisorPurge = await ruleRequest(
      advisorJar,
      "POST",
      `/api/staff/answer-rules/${advisorRule.id}/purge`,
    );
    expect(advisorPurge.status).toBe(200);

    // A second advisor works on a rule created by the admin — the shared
    // answer library has no per-account ownership boundary.
    const otherJar = new CookieJar();
    await signInAs(otherJar, OTHER_ADVISOR_EMAIL, OTHER_ADVISOR_PASSWORD);
    const adminForOther = new CookieJar();
    await signInAs(adminForOther, ADMIN_EMAIL, ADMIN_PASSWORD);
    const otherTarget = await createRule(adminForOther, uniqueRuleContent("purge-other"));
    await ruleRequest(otherJar, "POST", `/api/staff/answer-rules/${otherTarget.id}/trash`);
    const otherPurge = await ruleRequest(
      otherJar,
      "POST",
      `/api/staff/answer-rules/${otherTarget.id}/purge`,
    );
    expect(otherPurge.status).toBe(200);
  });
});

describe("authorization on answer rules", () => {
  it("lets both roles edit and publish, and refuses anonymous and visitor credentials", async () => {
    // Ticket 102: advisors took over the editor's answer permissions — the
    // old staff 403s become full access, and no dashboard role is refused.
    const adminContent = uniqueRuleContent("owner");
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const rule = await createRule(adminJar, adminContent);
    expect((await publishRule(adminJar, rule.id)).status).toBe("published");

    const advisorJar = new CookieJar();
    await signInAs(advisorJar, OTHER_ADVISOR_EMAIL, OTHER_ADVISOR_PASSWORD);
    for (const [method, path] of [
      ["GET", "/api/staff/answer-rules"],
      ["POST", "/api/staff/answer-rules"],
      ["POST", `/api/staff/answer-rules/${rule.id}/publish`],
      ["POST", `/api/staff/answer-rules/${rule.id}/unpublish`],
      ["PUT", `/api/staff/answer-rules/${rule.id}`],
    ] as const) {
      const response = await ruleRequest(
        advisorJar,
        method,
        path,
        method === "GET" ? undefined : adminContent,
      );
      expect(response.status, `${method} ${path}`).toBeLessThan(300);
    }

    const anonymous = await ruleRequest(null, "POST", "/api/staff/answer-rules", adminContent);
    expect(anonymous.status).toBe(401);

    const visitor = await startConversation();
    const visitorResponse = await ruleRequest(
      null,
      "POST",
      "/api/staff/answer-rules",
      adminContent,
      TEST_ORIGIN,
      visitor.token,
    );
    expect(visitorResponse.status).toBe(401);
  });

  it("blocks answer-rule mutations from an untrusted origin", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const rule = await createRule(jar, uniqueRuleContent("csrf"));

    const crossSite = await ruleRequest(
      jar,
      "POST",
      `/api/staff/answer-rules/${rule.id}/publish`,
      undefined,
      "https://evil.example.net",
    );
    expect(crossSite.status).toBe(403);
  });
});

describe("answer-rule input limits", () => {
  it("rejects incomplete or invalid rule content", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const content = uniqueRuleContent("invalid");

    const missingTopic = await ruleRequest(jar, "POST", "/api/staff/answer-rules", {
      ...content,
      topic: "  ",
    });
    expect(missingTopic.status).toBe(400);

    const noPhrases = await ruleRequest(jar, "POST", "/api/staff/answer-rules", {
      ...content,
      phrases: [],
      keywords: undefined,
    });
    expect(noPhrases.status).toBe(400);

    const punctuationOnly = await ruleRequest(jar, "POST", "/api/staff/answer-rules", {
      ...content,
      phrases: ["?!?..."],
    });
    expect(punctuationOnly.status).toBe(400);

    const badLink = await ruleRequest(jar, "POST", "/api/staff/answer-rules", {
      ...content,
      link: "ftp://example-college.edu/parking",
    });
    expect(badLink.status).toBe(400);

    const oversized = await ruleRequest(jar, "POST", "/api/staff/answer-rules", {
      ...content,
      response: "a".repeat(2001),
    });
    expect(oversized.status).toBe(400);
  });

  it("answers 404 for unknown rules", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);

    const publish = await ruleRequest(jar, "POST", "/api/staff/answer-rules/nope/publish");
    expect(publish.status).toBe(404);

    const revise = await ruleRequest(jar, "PUT", "/api/staff/answer-rules/nope", uniqueRuleContent("missing"));
    expect(revise.status).toBe(404);
  });
});
