import { beforeAll, describe, expect, it } from "vitest";
import { ask, startConversation, TEST_ORIGIN, useTempDatabase } from "./helpers";
import {
  authRequest,
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-manage-pilot-91";
const EDITOR_EMAIL = "editor@example.edu";
const EDITOR_PASSWORD = "editor-study-puzzle-2z";
const STAFF_EMAIL = "helper@example.edu";
const STAFF_PASSWORD = "helper-plain-branch-8m";

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

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let editorTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

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
  const actionMatch = path.match(/^\/api\/staff\/answer-rules\/([^/]+)\/(publish|unpublish)$/);
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
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Eddie", role: "editor" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  editorTotp = await enrollTotp(new CookieJar(), EDITOR_EMAIL, EDITOR_PASSWORD);
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

describe("an editor maintains answer rules", () => {
  it("creates a draft rule that never answers visitors", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    const content = uniqueRuleContent("draft");
    const question = content.phrases[0]!;
    const rule = await createRule(jar, content);

    expect(rule.status).toBe("draft");
    expect(rule.publishedBy).toBeNull();

    const asked = await askFresh(question);
    expect(asked.state).toBe("awaiting_staff");
    expect(asked.reply?.text ?? "").not.toContain("Main Street lot");
  });

  it("publishing makes the topic button and answer available without a redeploy", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
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
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    const content = uniqueRuleContent("retire");
    const question = content.phrases[0]!;
    const rule = await createRule(jar, content);
    await publishRule(jar, rule.id);

    const unpublish = await ruleRequest(jar, "POST", `/api/staff/answer-rules/${rule.id}/unpublish`);
    expect(unpublish.status).toBe(200);
    expect(((await unpublish.json()) as RuleRecord).status).toBe("draft");

    const asked = await askFresh(question);
    expect(asked.state).toBe("awaiting_staff");
    expect((await topics()).topics.find((topic) => topic.id === rule.id)).toBeUndefined();
  });

  it("creates and publishes a keywords-only rule whose button asks its topic", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
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
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
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
    expect(stale.state).toBe("awaiting_staff");

    await publishRule(jar, rule.id);
    const fresh = await askFresh(question);
    expect(fresh.reply?.text).toContain("free after 4pm");
  });
});

describe("who published a rule, and when it was reviewed", () => {
  it("records the publishing editor on the rule and resolves their name for the dashboard", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
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

describe("authorization on answer rules", () => {
  it("lets the owner publish, but refuses plain staff, anonymous, and visitor credentials", async () => {
    const ownerContent = uniqueRuleContent("owner");
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const rule = await createRule(ownerJar, ownerContent);
    expect((await publishRule(ownerJar, rule.id)).status).toBe("published");

    const staffJar = new CookieJar();
    await signInWithTotp(staffJar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    for (const [method, path] of [
      ["GET", "/api/staff/answer-rules"],
      ["POST", "/api/staff/answer-rules"],
      ["POST", `/api/staff/answer-rules/${rule.id}/publish`],
      ["POST", `/api/staff/answer-rules/${rule.id}/unpublish`],
      ["PUT", `/api/staff/answer-rules/${rule.id}`],
    ] as const) {
      const response = await ruleRequest(
        staffJar,
        method,
        path,
        method === "GET" ? undefined : ownerContent,
      );
      expect(response.status).toBe(403);
    }

    const anonymous = await ruleRequest(null, "POST", "/api/staff/answer-rules", ownerContent);
    expect(anonymous.status).toBe(401);

    const visitor = await startConversation();
    const visitorResponse = await ruleRequest(
      null,
      "POST",
      "/api/staff/answer-rules",
      ownerContent,
      TEST_ORIGIN,
      visitor.token,
    );
    expect(visitorResponse.status).toBe(401);
  });

  it("blocks answer-rule mutations from an untrusted origin", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
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
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
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
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);

    const publish = await ruleRequest(jar, "POST", "/api/staff/answer-rules/nope/publish");
    expect(publish.status).toBe(404);

    const revise = await ruleRequest(jar, "PUT", "/api/staff/answer-rules/nope", uniqueRuleContent("missing"));
    expect(revise.status).toBe(404);
  });
});
