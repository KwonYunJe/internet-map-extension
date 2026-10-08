# Internet Map design

## Source of truth
- Status: Active; refreshed 2026-10-08.
- Surface: local Chrome extension visualization page.
- Evidence: user UI-redesign brief, visualization HTML/CSS/JS, existing background, icon and bubble textures. The referenced promotion banner was not attached; no pixel-match claim is made.

## Brand
An approachable miniature internet universe: airy soap bubbles, quiet silver reflections, soft blue light, deep navy sky. Avoid heavy glass donuts, neon lasers, science-fiction instrument clutter and opaque bubble centers. Preserve the existing e icon.

## Product goals
Make browsing patterns inviting and readable without changing collected data, grouping, time calculations or physical layout. Size remains relative importance; paths remain actual transitions. This is not a new tracking or layout engine.

## Personas and jobs
People reviewing their own daily browsing, comparing periods and inspecting connected sites. Primary context is a desktop extension tab; narrow-window access remains usable.

## Information architecture
Brand and period controls → daily replay → graph with detail/ranking companions. Settings, import/export, pause and summary remain accessible. Graph is the primary surface, not a framed dashboard card.

## Design principles
Transparency before decoration; data before atmosphere; reuse established behavior. Reflections occupy small areas, labels and favicons remain sharp. Latest brief supersedes the earlier selected-glue visual: directions are separate tapered light paths.

## Visual language
Navy #040819/#091532, blue/cyan accents, small lavender/pink highlights. System fonts, rounded capsule controls, 24–28px translucent panels. Background remains the existing starfield with restrained brightness. Bubble frame PNGs are true-alpha and almost circular, varying by 2–5%. Internal site colors are low-opacity radial light, never opaque fill.

## Components
Reuse period, settings, timeline, zoom and selection controls. Refresh header, glass panels, ranking bars, node frame/glow layers and directional path material. Tokens live in visualization.css; rendering in visualization.js. Existing data IDs and listener lifecycle are stable.

## Accessibility
Visible keyboard focus, existing semantic buttons and pressed state, meaningful icon alt text or decorative empty alt as appropriate. Readable text contrast. Respect reduced motion for decorative stars and wobble. Do not claim a full WCAG audit without one.

## Responsive behavior
Desktop ≥1100px: viewport-fit three columns with matching graph/panel heights. Tablet: graph first, two companion panels below. Mobile: graph, detail, ranking stacked with reasonable vertical scrolling and no horizontal overflow. The latest brief's mobile stack supersedes the older absolute no-page-scroll request.

## Interaction states
Preserve loading, no-records, fallback favicon, selected site, hover, replay-only focus, disabled tracking status and import errors. The UI remains useful offline when favicons are missing.

## Content voice
Friendly concise Korean. Brand subtitle: 나의 인터넷 우주. Describe actual metrics, never imply collected data is uploaded.

## Implementation constraints
Local MV3 assets/scripts only; no new libraries or remote execution. Do not modify service worker, storage schema, grouping, force/component/superellipse calculations, projection, hover anchoring or hit testing. Cache assets/color extraction, avoid new per-frame filters. Test synthetic records without touching personal extension storage; capture desktop/mobile and selection screenshots. Any real-extension test limitations must be reported.

## Open questions
- Promotion banner was not supplied; written art direction is authoritative for this pass.
- Full memory/performance profiling and broad accessibility auditing are separate from bounded regression tests.
