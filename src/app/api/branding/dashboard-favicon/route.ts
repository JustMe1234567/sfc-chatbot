import { brandingAssetResponse } from "@/api/brandingAssets";
import { getDashboardFaviconDataUrl } from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The dashboard favicon asset (ticket 70): the stored upload's bytes or the
 * bundled crest, referenced only by the dashboard layouts' metadata — the
 * login page and the authenticated admin tabs.
 */
export async function GET() {
  const { db } = await getChatbotService();
  return brandingAssetResponse(await getDashboardFaviconDataUrl(db));
}
