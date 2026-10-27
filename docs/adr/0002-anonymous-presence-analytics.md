# Anonymous presence analytics, with no IP addresses kept

Visitor and chat analytics (ticket 17) count browsers through an anonymous
identifier generated in the widget, and never record an IP address, email,
chat credential, message text, or staff identity anywhere in the analytics
path. Day boundaries for reports follow a configurable reporting time zone
(default Asia/Singapore), and analytics rows expire on their own retention
period, separate from transcript retention. This keeps the college's
reporting useful without turning the chat into a tracking system, and it
bounds what exists about any visitor: a random number that rotates, plus
daily counts.

## Privacy and consent implications before production use

- **What is stored about a visitor:** a SHA-256 hash of a random UUID the
  widget generates and holds in the chat widget's own storage on the chatbot
  origin. It is shared across that browser's tabs, rotates at least as often
  as the configured analytics retention period (default 90 days), and can
  never be linked to an email, a chat credential, or message text by the
  application. The raw identifier leaves the browser only to be hashed.
- **What is never stored:** IP addresses (the presence endpoint rate limits
  by client address in memory only, as every public endpoint already does),
  location or ISP derivations, exact visit histories (only per-day presence
  and daily chat/escalation counts), and anything typed into a chat.
- **Consent posture:** the signal is cookieless and anonymous, but it is
  still a page-presence measurement. Whether the college's privacy notice
  must mention it — and whether a consent choice is required — depends on
  the college's own jurisdiction and policy; the WordPress embed ships it
  enabled alongside the widget. Operators who prefer to run without it can
  block the widget's `/api/v1/presence` request at their edge without
  affecting any chat functionality.
- **Cross-visit recognition is bounded by design:** the identifier can only
  ever shorten its own lifetime (a shorter retention shortens it; a longer
  one never extends it), so an active browser cannot quietly become a
  long-lived tracker. When the identifier rotates, a returning browser is
  counted as new — that is the intended cost.
- **Retention:** `analytics_retention_days` (owner-set, default 90) governs
  both the presence rows and the daily rollups, and expiry runs on ordinary
  staff traffic regardless of transcript retention. Reported totals are
  rollups, so purging a transcript (ticket 10) never moves them.
- **Dashboard exposure:** only aggregates cross the API — no visitor
  identifiers, no transcripts. The page states that browser counts are
  estimates, and explains why a median first-reply time is not reported.
