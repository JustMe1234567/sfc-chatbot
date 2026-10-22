# 01: Approved answer in the WordPress widget

**What to build:** A visitor can open the site-wide chatbot script on a WordPress test page, ask a common question anonymously, and receive a seeded approved answer. The conversation remains available after a page reload. This first slice establishes the runnable application and its public API test seam.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The versioned widget script loads once on intended WordPress pages without changing WordPress core; it works on desktop and mobile.
- [ ] A visitor can use the chat with keyboard controls and without signing in or providing an email address.
- [ ] A seeded, published answer rule returns only its approved response and optional college page link; no AI API is called.
- [ ] The visitor's question and bot answer persist and reappear after a page reload using only that visitor's session credential.
- [ ] Public input limits apply, and neither the page nor the widget exposes server-side service secrets.
- [ ] An automated API flow and a WordPress embed smoke check demonstrate the behavior.
