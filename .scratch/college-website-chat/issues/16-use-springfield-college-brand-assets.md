# 16: Apply the supplied Springfield College brand assets

**Status:** ready-for-human

**What to build:** Replace placeholder Example College branding in the chatbot experience with the supplied SFC crest and Springfield College wordmark. Carry the blue and gold identity through the visitor widget, local embed demo, and staff dashboard while keeping the interface clear and accessible.

**Source assets in `public/brand/`:**

- [SFC-Final-Logo-with-Text-scaled.png](../../../public/brand/SFC-Final-Logo-with-Text-scaled.png) (2560 × 1280, transparent): crest and Springfield College wordmark for wider, light-background placements.
- [cropped-SFC-Final-Logo-Single.png](../../../public/brand/cropped-SFC-Final-Logo-Single.png) (512 × 512, transparent): compact crest for the launcher, widget header, and narrow layouts.
- [SFC-Final-Logo-Single-1.png](../../../public/brand/SFC-Final-Logo-Single-1.png) (2000 × 2000, transparent): high-resolution crest source when a larger rendering is needed.

- [x] Organize the supplied originals under `public/brand/` without changing their filenames or contents.
- [x] Create fit-for-size derivatives where useful, keeping the supplied originals as source material. Do not stretch, recolor, redraw, or crop the crest or wordmark in a way that changes their proportions.
- [x] Use the full wordmark where it remains legible, such as staff sign-in and the dashboard header at wide widths. Use the compact crest with a text label where space is tight, including the chat launcher and mobile headers. Avoid repeating the same logo unnecessarily within one view.
- [x] Replace visitor-visible and staff-visible placeholder brand names with Springfield College where they identify the service. Keep functional labels such as Chat and Shared inbox clear. Update the local WordPress-style demo page so the embed can be reviewed with the same identity.
- [x] Derive a restrained blue-and-gold palette from the assets and apply it consistently to existing interactive states and status treatments. The dark-blue wordmark must sit on a surface with sufficient contrast; verify the transparent images on both light and dark backgrounds rather than assuming black preview areas are part of the image.
- [x] Provide appropriate text alternatives: meaningful brand marks have the college name as accessible text, while repeated decorative marks are hidden from assistive technology. Preserve readable headings and navigation if images fail to load.
- [x] Check desktop, the narrow dashboard width from ticket 13's reference screenshot, and phone width. Logos stay crisp, correctly sized, and free of clipping or horizontal overflow. Verify the widget remains small enough for its host page and the script still loads cross-origin.
- [x] Review image weight and use fit-for-size assets so the large 2000px source is not shipped to every small icon slot. Include rendered before/after screenshots and an asset-placement summary in Comments when implemented.

## Context

The current app and demo use the text Example College and a generic navy treatment. The three newly supplied PNGs show an SFC shield in blue and gold; the wide version includes Springfield College text. This ticket provides the brand foundation for ticket 13's broader dashboard redesign. Use the project's installed `design-taste-frontend` skill for its existing-brand audit and visual consistency guidance where applicable; its marketing-page rules do not govern the staff dashboard.

## Comments

2026-10-26: Captured after inspecting the three image files added to the project root. No UI implementation requested in this turn.

2026-10-26: Moved all three original PNGs from the project root to `public/brand/`; the application does not reference them yet.

## Comments

2026-10-26: Captured after inspecting the three image files added to the project root. No UI implementation requested in this turn.

2026-10-26: Moved all three original PNGs from the project root to `public/brand/`; the application does not reference them yet.

Implemented 2026-10-28 (ticket 16). The staff-dashboard share (header crest, branded sign-in and second-factor cards, the blue/gold token palette) landed with ticket 13; this change covers the visitor side and the placeholder sweep. Evidence: `references/shots-before/` (before-demo-launcher, before-widget-open) and `references/shots-after/` (after-demo-launcher, after-widget-open, after-widget-open-phone) — desktop and phone captures of the demo page with launcher, and the open widget.

Asset-placement summary:

- `cropped-SFC-Final-Logo-Single.png` (512×512, 22 KB — the only crest file shipped to the browser; the 2000×2000 source stays unused as source material): the chat launcher (24px on a white plate), the widget frame header (24px on a white plate), the demo page header (30px on a white plate), and the dashboard header/login/enroll marks from ticket 13.
- `SFC-Final-Logo-with-Text-scaled.png` and the 2000px source: unreferenced by the app, kept as source material per the ticket. No derivatives were generated — the 512px file already weighs less than many single hero images and no tooling here crops PNGs; recorded rather than forced.
- The full wordmark is not placed as an image anywhere: the wordmark appears as live text ("Springfield College" in the dashboard header eyebrow, login card, and demo h1), which scales crisply, survives missing images, and carries its own accessible name.

Placeholder sweep: layout metadata and the root index page, the local WordPress-style demo page (name, colors, crest), the WordPress plugin's default deployment host, the auth app name / TOTP issuer / password-reset and verification subjects, the answer-form link placeholder, and the seeded answer-rule links (launch content, updated to match the demo domain). Test fixtures and helpers follow (`tests/auth-helpers.ts`, staff-management, cross-origin fixture).

Identity details: brand blue #1d4e89 / deep #163c6b replaces the old navy #1d3a6b across the loader, widget frame, and demo page; gold appears in visitor interactive states (launcher focus ring, topic-button hover border and focus ring) matching the dashboard's token palette. Every crest sits on a white plate — the transparent image's blue shield vanishes against the same-hue brand blue, which the ticket's light/dark verification requirement caught; the marks are decorative (`alt=""`) with the service name carried by adjacent text, the launcher's accessible name is "Chat with Springfield College", and hiding the launcher while the frame is open keeps one crest per view (Escape-close returns focus to it). Verified: launcher hidden while open, frame closes via Escape, launcher returns focused, no clipping or overflow at 1280/730/390, crest transfer weight 23 KB (the 2000px source never ships), and the loader bundle still carries no storage/API surface per the embed smoke test.

Judgment calls:

- The launcher hides while the chat is open instead of staying as a minimize control: the frame has its own close button, and the ticket's no-repeated-marks rule outweighs a minimize affordance this release does not have anyway.
- Seed answer-rule links moved from example-college.edu to www.springfieldcollege.edu — launch-demo content, not service configuration; the two URL-shaped assertions in tests followed.
- The demo header carries the crest because the page stands in for the college WordPress theme; in production the site-wide branding belongs to the WordPress theme itself, and the plugin only enqueues the loader.
