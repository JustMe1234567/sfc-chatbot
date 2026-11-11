import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "@/paths";
import { BRANDING_DEFAULT_ASSET_PATH, isStoredBrandingImageDataUrl } from "@/domain/branding";

/** The bundled Springfield College crest, the fallback asset for both
 * branding image routes (ticket 70). Shipped under public/, so it is read
 * from the deployment's static files — nothing is written at runtime. */
const DEFAULT_ASSET_FILE = path.join(repoRoot(), "public", BRANDING_DEFAULT_ASSET_PATH);

/**
 * Serves one branding image as raw bytes: the stored canonical data URL
 * (shape re-validated before decoding) or the bundled default. Responses
 * are immutable and cache-busted by the version query the callers append,
 * so a newly saved asset reaches every newly loaded page without a
 * redeploy. Only image bytes and generic headers leave here — no settings,
 * paths, or session data.
 */
export async function brandingAssetResponse(dataUrl: string | null): Promise<Response> {
  if (dataUrl && isStoredBrandingImageDataUrl(dataUrl)) {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const type = dataUrl.slice("data:".length, dataUrl.indexOf(";"));
    const bytes = Buffer.from(base64, "base64");
    return new Response(new Uint8Array(bytes), {
      headers: assetHeaders(type, bytes.length),
    });
  }
  const bytes = await readFile(DEFAULT_ASSET_FILE);
  return new Response(new Uint8Array(bytes), {
    headers: assetHeaders("image/png", bytes.length),
  });
}

/** Shared image headers: the type the content validated to, an immutable
 * cache lifetime (the URLs carry the version), and nosniff so the browser
 * trusts the declared type of user-supplied bytes. */
function assetHeaders(type: string, length: number): HeadersInit {
  return {
    "Content-Type": type,
    "Content-Length": String(length),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
}
