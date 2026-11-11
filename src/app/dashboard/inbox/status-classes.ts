import type { DeskStatus } from "@/domain/inbox";
import styles from "../dashboard.module.css";

/**
 * The tier's CSS classes (ticket 44): one mapping shared by every desk
 * surface, so "the same mapping" is structural rather than a promise —
 * rows' status dots, the selected header chip, and the count pills all
 * resolve their tier color through these records.
 */

export const STATUS_DOTS: Record<DeskStatus, string> = {
  needs_human: styles.dotNeedsHuman!,
  attention: styles.dotAttention!,
  // Contact Me shares the red family (ticket 69): a persistent staff task
  // wears the same danger treatment as a transient new message.
  contact: styles.dotAttention!,
  active: styles.dotActive!,
};

export const TIER_CHIPS: Record<DeskStatus, string> = {
  needs_human: styles.chipNeedsHuman!,
  attention: styles.chipAttention!,
  contact: styles.chipAttention!,
  active: styles.chipActive!,
};
