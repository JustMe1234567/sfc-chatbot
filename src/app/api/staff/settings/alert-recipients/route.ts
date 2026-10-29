import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { getAlertRecipients, isValidRecipientList, setAlertRecipients } from "@/settings";
import { getChatbotService } from "@/db/service";

/** Read the staff alert list. Owner or staff. */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ recipients: await getAlertRecipients(db) });
}

/** Configure the staff alert list. Owner only. */
export async function PUT(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => null)) as { recipients?: unknown } | null;
  if (!body || !isValidRecipientList(body.recipients)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_recipients",
          message: "Provide 1-10 valid email addresses.",
        },
      },
      { status: 400 },
    );
  }
  const { db } = await getChatbotService();
  await setAlertRecipients(db, body.recipients);
  return NextResponse.json({ recipients: body.recipients });
}
