# 03: One reliable escalation email

**What to build:** Staff receive an email alert when a conversation first escalates. The alert links to the protected inbox, and a failed delivery remains visible so staff can retry it.

**Blocked by:** 02: Unknown question reaches the shared inbox.

**Status:** ready-for-agent

- [ ] An owner can configure the staff alert destination and an approved email sender is used from the server.
- [ ] One escalation produces one staff alert even when requests are retried or repeated; later chat messages do not send another escalation alert.
- [ ] The email links to the protected conversation and contains no full transcript or visitor session secret.
- [ ] Delivery status and failure reason are visible to authorized staff, with a retry action that does not create duplicate successful alerts.
- [ ] Automated tests cover first delivery, duplicate events, failed delivery, and retry.
