import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { sweepTranscripts } from "@/domain/retention";
import { expireAnalytics } from "@/domain/analytics";
import { sweepExpiredTrash } from "@/domain/answerLifecycle";
import { pruneRateLimitWindows } from "@/domain/limits";
import { trustedOrigins } from "@/config";

/** Constant-time bearer comparison for the network-visible cron secret. */
function bearerMatches(header: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= header.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * The scheduled maintenance endpoint (ticket 11): runs the transcript
 * retention sweep and the analytics expiry. On Vercel it fires on a cron
 * schedule (see vercel.json); without a configured CRON_SECRET, same-origin
 * dashboard traffic triggers the same sweeps (the pre-existing staff-traffic
 * path). Once CRON_SECRET is set, only its bearer is accepted — the secret
 * takes over entirely so a leaked origin value cannot trigger work.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? bearerMatches(request.headers.get("authorization"), secret)
    : trustedOrigins().includes(request.headers.get("origin") ?? "");
  if (!authorized) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Maintenance is scheduled or staff-triggered." } },
      { status: 401 },
    );
  }

  const { db, store } = await getChatbotService();
  const transcripts = await sweepTranscripts(db, store);
  const analytics = await expireAnalytics(db, store);
  // The Trash sweep (ticket 58) rides the same passes: answers sitting in
  // Trash past the fixed 30-day threshold are purged for good.
  const trash = await sweepExpiredTrash(store);
  // Spent shared rate-limit windows (ticket 24) are pure debris once they
  // can no longer recur.
  const rateLimitWindows = await pruneRateLimitWindows(db);
  return NextResponse.json({
    ok: true,
    removedConversations: transcripts?.removedConversations ?? null,
    analyticsRemoved: analytics,
    answersPurged: trash?.purgedAnswers ?? null,
    rateLimitWindowsRemoved: rateLimitWindows,
  });
}
