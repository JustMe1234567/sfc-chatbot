import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { clearLoginEvents, deleteLoginEvents, listLoginEvents } from "@/domain/loginLog";
import { getChatbotService } from "@/db/service";

/**
 * The owner-only login log (ticket 81). GET serves the two Logs views: the
 * complete attempt log by default, the flagged subset with
 * `?view=suspicious`. DELETE removes entries — a list of ids (one entry or a
 * checkbox selection) or every entry with `all: true`; each shape is a
 * separate confirm dialog in the dashboard. Deletions are not tracked
 * anywhere, and they never touch the IP-block table: auto-expiry is the
 * only release for a block.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  const view = new URL(request.url).searchParams.get("view");
  const events = await listLoginEvents(db, { suspiciousOnly: view === "suspicious" });
  return NextResponse.json({ events });
}

export async function DELETE(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => null)) as
    | { ids?: unknown; all?: unknown }
    | null;
  const { db } = await getChatbotService();
  if (body?.all === true) {
    return NextResponse.json({ removed: await clearLoginEvents(db) });
  }
  const ids = body?.ids;
  if (Array.isArray(ids) && ids.length > 0 && ids.every((id): id is string => typeof id === "string")) {
    return NextResponse.json({ removed: await deleteLoginEvents(db, ids) });
  }
  return NextResponse.json(
    {
      error: {
        code: "invalid_delete",
        message: "Provide the entry ids to delete, or all: true to clear the log.",
      },
    },
    { status: 400 },
  );
}
