/**
 * Branding domain (ticket 70): the chathead appearance settings, the
 * uploadable-image content rules, and the contrast choice for launcher
 * foreground marks. Client-safe on purpose — the widget frame and the
 * dashboard settings form import these constants and validators — so the
 * module sticks to pure functions over plain data (atob/TextDecoder are
 * available in every runtime this repo targets).
 */

/** The confirmed chathead defaults (ticket 70); the color is kept in its
 * canonical lowercase hex form, the same shape every write normalizes to.
 * Ticket 71 adds explicit width and height defaults (64 × 64) — rows saved
 * before it carry no dimensions and resolve to their derived outer size. */
export const CHATHEAD_DEFAULT_BG = "#013c78";
export const CHATHEAD_DEFAULT_ICON_SIZE = 48;
export const CHATHEAD_DEFAULT_PADDING = 4;

/** Bounded appearance controls: the outer chathead stays within 32-88px,
 * comfortably a touch target at every combination and well clear of the
 * 360px widget viewport. Ticket 71 adds independent width and height
 * bounds (44-96 px) with 64 × 64 as the default configuration. */
export const CHATHEAD_MIN_ICON_SIZE = 32;
export const CHATHEAD_MAX_ICON_SIZE = 64;
export const CHATHEAD_MIN_PADDING = 0;
export const CHATHEAD_MAX_PADDING = 12;
export const CHATHEAD_MIN_DIMENSION = 44;
export const CHATHEAD_MAX_DIMENSION = 96;
export const CHATHEAD_DEFAULT_WIDTH = 64;
export const CHATHEAD_DEFAULT_HEIGHT = 64;

/** Upload ceiling (ticket 70): raw decoded bytes. */
export const MAX_BRANDING_IMAGE_BYTES = 500 * 1024;
/** The base64 transport is refused before decoding past this length
 * (~683KB of base64 for the 500KB ceiling, with slack for the prefix). */
export const MAX_BRANDING_DATA_URL_LENGTH = 700_000;

/** The bundled Springfield College crest every branding surface falls back
 * to (ticket 16's asset); the asset routes serve it when nothing is saved. */
export const BRANDING_DEFAULT_ASSET_PATH = "/brand/cropped-SFC-Final-Logo-Single.png";

/** The dark foreground used when the background is light (the dashboard's
 * ink color, matching the widget frame's text). */
export const BRANDING_DARK_FOREGROUND = "#1f2933";
export const BRANDING_LIGHT_FOREGROUND = "#ffffff";

export interface ChatheadConfig {
  backgroundColor: string;
  iconSize: number;
  padding: number;
  /** Explicit container dimensions (ticket 71). Absent on rows saved
   * before the ticket — those resolve to the derived outer size so
   * deployed chatheads do not unexpectedly resize. */
  width?: number;
  height?: number;
}

/** The resolved shape every consumer sees: dimensions always present. */
export interface ResolvedChatheadConfig {
  backgroundColor: string;
  iconSize: number;
  padding: number;
  width: number;
  height: number;
}

export const CHATHEAD_DEFAULTS: ChatheadConfig = {
  backgroundColor: CHATHEAD_DEFAULT_BG,
  iconSize: CHATHEAD_DEFAULT_ICON_SIZE,
  padding: CHATHEAD_DEFAULT_PADDING,
  width: CHATHEAD_DEFAULT_WIDTH,
  height: CHATHEAD_DEFAULT_HEIGHT,
};

/** The outer size a chathead derives from its icon and padding alone —
 * the pre-ticket-71 square and the fit requirement's floor. */
export function chatheadDerivedSize(config: Pick<ChatheadConfig, "iconSize" | "padding">): number {
  return config.iconSize + config.padding * 2;
}

/** Accepts #RGB and #RRGGBB, answers the canonical #RRGGBB form. */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
  if (!match?.[1]) {
    return null;
  }
  const hex = match[1];
  const expanded = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex;
  return `#${expanded.toLowerCase()}`;
}

export function isValidHexColor(input: unknown): input is string {
  return normalizeHexColor(input) !== null;
}

function isValidDimension(input: unknown): input is number {
  return (
    typeof input === "number" &&
    Number.isInteger(input) &&
    input >= CHATHEAD_MIN_DIMENSION &&
    input <= CHATHEAD_MAX_DIMENSION
  );
}

/** The write/read shape validator: dimensions are optional (legacy rows)
 * but when present must sit in the 44-96 px band (ticket 71). Fit — the
 * icon and padding fitting inside both dimensions — is a separate,
 * save-time rule (chatheadFitRequirement) so reads can resolve leniently. */
export function isValidChatheadConfig(input: unknown): input is ChatheadConfig {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const candidate = input as Partial<ChatheadConfig>;
  return (
    isValidHexColor(candidate.backgroundColor) &&
    typeof candidate.iconSize === "number" &&
    Number.isInteger(candidate.iconSize) &&
    candidate.iconSize >= CHATHEAD_MIN_ICON_SIZE &&
    candidate.iconSize <= CHATHEAD_MAX_ICON_SIZE &&
    typeof candidate.padding === "number" &&
    Number.isInteger(candidate.padding) &&
    candidate.padding >= CHATHEAD_MIN_PADDING &&
    candidate.padding <= CHATHEAD_MAX_PADDING &&
    (candidate.width === undefined || isValidDimension(candidate.width)) &&
    (candidate.height === undefined || isValidDimension(candidate.height))
  );
}

/** The save-time fit rule (ticket 71): the icon plus padding on both sides
 * must fit inside the configured width AND height. Returns the minimum
 * square dimension the current icon and padding require, or null when the
 * configuration fits. */
export function chatheadFitRequirement(config: ChatheadConfig): number | null {
  const required = chatheadDerivedSize(config);
  const width = config.width ?? required;
  const height = config.height ?? required;
  return width < required || height < required ? required : null;
}

/** The safe fallback for corrupt, out-of-range, or fit-broken rows. */
const CHATHEAD_SAFE_FALLBACK: ResolvedChatheadConfig = {
  backgroundColor: CHATHEAD_DEFAULT_BG,
  iconSize: CHATHEAD_DEFAULT_ICON_SIZE,
  padding: CHATHEAD_DEFAULT_PADDING,
  width: CHATHEAD_DEFAULT_WIDTH,
  height: CHATHEAD_DEFAULT_HEIGHT,
};

/** The read helper: corrupt, partial, or fit-broken rows resolve to safe
 * values — legacy rows (no dimensions) keep their derived outer size so
 * deployed chatheads do not resize, and the defaults fill the rest. */
export function resolveChatheadConfig(input: unknown): ResolvedChatheadConfig {
  if (!isValidChatheadConfig(input)) {
    return { ...CHATHEAD_SAFE_FALLBACK };
  }
  const valid = input as ChatheadConfig;
  if (chatheadFitRequirement(valid) !== null) {
    // A hand-edited row whose dimensions cannot hold the icon: the safe
    // fallback is the default configuration, not a clipped launcher.
    return { ...CHATHEAD_SAFE_FALLBACK };
  }
  const required = chatheadDerivedSize(valid);
  return {
    backgroundColor: normalizeHexColor(valid.backgroundColor) ?? CHATHEAD_DEFAULT_BG,
    iconSize: valid.iconSize,
    padding: valid.padding,
    width: valid.width ?? required,
    height: valid.height ?? required,
  };
}

/** WCAG 2.x relative luminance of one #RRGGBB color. */
function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The launcher's automatic foreground (ticket 70): whichever of white and
 * the dashboard ink color contrasts more with the chosen background. The
 * close mark, the focus ring, and any other launcher foreground inherit it,
 * so contrast never depends on the staff member picking "the right" color.
 */
export function chatheadForeground(backgroundColor: string): string {
  const luminance = relativeLuminance(backgroundColor);
  const versusLight = contrastRatio(luminance, relativeLuminance(BRANDING_LIGHT_FOREGROUND));
  const versusDark = contrastRatio(luminance, relativeLuminance(BRANDING_DARK_FOREGROUND));
  return versusLight >= versusDark ? BRANDING_LIGHT_FOREGROUND : BRANDING_DARK_FOREGROUND;
}

export type BrandedImageType = "image/png" | "image/jpeg" | "image/webp";

/**
 * Content-based type detection (ticket 70): the declared browser MIME type
 * is never trusted, so the decoded bytes are sniffed against the three
 * accepted formats' signatures. SVG (text) and everything else answer null
 * and are rejected upstream.
 */
export function sniffImageType(bytes: Uint8Array): BrandedImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * The upload validator: raw byte size and sniffed type only. A file past
 * the ceiling, an SVG, or a disguised non-image fails here before anything
 * is stored.
 */
export function isValidBrandedImage(
  bytes: Uint8Array,
  maxBytes: number = MAX_BRANDING_IMAGE_BYTES,
): boolean {
  return bytes.length > 0 && bytes.length <= maxBytes && sniffImageType(bytes) !== null;
}

export interface ParsedImageDataUrl {
  type: BrandedImageType;
  /** The canonical `data:<sniffed type>;base64,…` form stored in settings. */
  dataUrl: string;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Parses an uploaded data URL into validated image content. The declared
 * prefix only has to be a base64 data URL — the type that matters is sniffed
 * from the decoded bytes, so a browser-reported `image/svg+xml` prefix
 * carrying PNG bytes stores as image/png and a text/SVG payload fails.
 */
export function parseBrandingImageDataUrl(
  dataUrl: unknown,
  maxBytes: number = MAX_BRANDING_IMAGE_BYTES,
): ParsedImageDataUrl | null {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_BRANDING_DATA_URL_LENGTH) {
    return null;
  }
  if (!dataUrl.startsWith("data:")) {
    return null;
  }
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !dataUrl.slice(0, comma).endsWith(";base64")) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(dataUrl.slice(comma + 1));
  } catch {
    return null;
  }
  if (!isValidBrandedImage(bytes, maxBytes)) {
    return null;
  }
  const type = sniffImageType(bytes);
  if (!type) {
    return null;
  }
  // Store the canonical form with the sniffed type, so the serving route can
  // trust the stored prefix without re-sniffing (it still validates shape).
  return { type, dataUrl: `data:${type};base64,${dataUrl.slice(comma + 1)}` };
}

/** Shape check for stored values: a hand-edited row must read as unset. */
export function isStoredBrandingImageDataUrl(value: string | null): boolean {
  if (!value || value.length > MAX_BRANDING_DATA_URL_LENGTH) {
    return false;
  }
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(value)) {
    return false;
  }
  try {
    return isValidBrandedImage(base64ToBytes(value.slice(value.indexOf(",") + 1)));
  } catch {
    return false;
  }
}
