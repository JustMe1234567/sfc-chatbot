import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { getChatbotService } from "@/db/service";
import { getEmbedAllowlistOrigins, setEmbedAllowlist } from "@/settings";
import { validateEmbedAllowlist } from "@/domain/embedAllowlist";

/**
 * The owner-managed embed allowlist (ticket 76): which website origins may
 * host the widget. Reading and changing it is owner territory — staff and
 * editors get the normal authorization refusal — and the write replaces the
 * full list, so a saved empty list is a real configuration that persists.
 * The widget frame's ancestor policy and the public eligibility check read
 * the stored value on every request, so a save takes effect on newly loaded
 * widgets with no redeploy.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ origins: await getEmbedAllowlistOrigins(db) });
}

export async function PUT(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => null)) as { origins?: unknown } | null;
  if (!body) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_origins",
          message: "Provide the allowlist as a list of website addresses.",
        },
      },
      { status: 400 },
    );
  }
  const validated = validateEmbedAllowlist(body.origins);
  if (!validated.ok) {
    return NextResponse.json(
      { error: { code: "invalid_origins", message: validated.error } },
      { status: 400 },
    );
  }
  const { db } = await getChatbotService();
  await setEmbedAllowlist(db, validated.origins);
  return NextResponse.json({ origins: validated.origins });
}
