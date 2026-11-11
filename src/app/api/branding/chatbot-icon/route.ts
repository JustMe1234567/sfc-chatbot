import { brandingAssetResponse } from "@/api/brandingAssets";
import { getChatbotIconDataUrl } from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The chatbot icon asset (ticket 70): the stored upload's bytes or the
 * bundled crest. Public by design — the launcher and the widget frame load
 * it from the college page — and it carries nothing but image bytes.
 */
export async function GET() {
  const { db } = await getChatbotService();
  return brandingAssetResponse(await getChatbotIconDataUrl(db));
}
