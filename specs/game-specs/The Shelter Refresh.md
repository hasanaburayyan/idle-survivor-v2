# The Shelter Refresh

## Overview

The Shelter is currently a flat list of activities. With the companion spec **Resource Acquisition Methods** introducing three new structures (Refinery, Smelter, Garden/Kitchen), and the existing Workbench gaining a Fabric recipe panel, the Shelter needs a layout that scales beyond a list and *feels like a place* rather than a control panel.

This spec defines the navigation paradigm, the structure-page contract, and the status-visibility primitives that all structure pages depend on. It is a prerequisite for Resource Acquisition Methods — every structure page introduced there builds on the patterns here.

## Goals

- Walking into the Shelter shows a *visual* representation of what's inside (floor plan).
- Every structure has its own full-page UI; nothing is nested behind tabs or popovers.
- One-click navigation between any two structure pages, from anywhere in the Shelter.
- Status (running / idle / output-ready / needs-attention) is visible without entering a page.
- Adding a new structure is additive — drop in a layout entry + a page registration. No framework edits.

## Non-goals

- Player-customizable shelter layouts (drag-and-drop placement). Layout is static config in v1.
- Visiting other players' shelters. The floor plan should be designed so this is *possible* later, but the feature itself is out of scope.
- Animated walking-around-the-shelter avatars. The floor plan is a clickable diagram, not a navigable space.

## Two-tier navigation

The Shelter has two persistent navigation surfaces.

### Tier 1 — The Floor Plan (the Shelter "home")

When the player travels to The Shelter, the main content area shows a floor-plan view of the location. Each constructed structure is a clickable tile. Pre-built construction sites (e.g. "Build Workbench" before the workbench exists) are also tiles, showing their build progress bar inline. Empty space exists where future structures will go.

- Top-down or isometric is an implementation detail; pick what fits the existing visual style.
- Each tile shows the structure's icon + name + a status badge (see **Status Badges** below).
- Clicking a tile enters that structure's page.
- The floor plan is the default Shelter screen — no separate "home" tab.

### Tier 2 — The Structure Bar (inside any structure page)

When inside a structure page, a persistent strip of structure icons is visible at one edge of the screen (top or side — implementation choice). The bar shows every constructed structure plus a "Floor Plan" button. The active structure is highlighted.

- One click on any icon swaps the page content to that structure. No round-trip through the floor plan required.
- Same status badges as the floor-plan tiles.
- Bar is sticky — scrolling page content does not move it.
- The "Floor Plan" button returns to Tier 1.

This combination — floor plan as thematic anchor, structure bar as snappy task-execution nav — was chosen explicitly so players are never more than one click from any structure, while preserving the "this is my base" feel.

## Status badges

Every structure tile (in floor plan) and structure icon (in bar) shows a status badge:

- **Idle** — no jobs queued, no automation running.
- **Running** — at least one job/automation in progress. Optionally show a thin progress ring around the tile/icon.
- **Output Ready** — completed jobs awaiting harvest/collection. Loud — pulse / glow / colored badge. This is the "log back in to a satisfying number" affordance and must be unmissable.
- **Needs Attention** — for time-sensitive structures (currently only Garden/Kitchen during its Ripe window). Visually distinct from Output Ready, more urgent. Suggested treatment: the badge animates faster, uses a warmer color, and is co-located with a countdown.

Badges are glanceable. A player viewing the floor plan should know which structures need them without reading text.

Status is computed from existing subscribed tables (workbench automation row, structure-specific job tables introduced in Resource Acquisition Methods). No new tables are required for status.

## Structure page contract

Every structure page must:

1. Render in the main content area, full page. No half-panels overlaid on the floor plan.
2. Include the persistent structure bar (Tier 2 nav).
3. Show the structure's current status prominently at the top.
4. Surface the primary action (start job, harvest, queue, craft) above the fold.
5. Surface upgrades and recipes in dedicated regions — visible without scrolling on common screen sizes.
6. **Never nest menus.** Tabs within a page are forbidden. If there is too much content for one page, that is a sign the structure should be split into two.

The Workbench page is the only exception with multiple regions on one page: it must host both an automation slot and a Fabric recipe panel (per Resource Acquisition Methods). These are two visually distinct *regions* on one page (e.g. left half + right half, or top region + bottom region) — not two tabs, and no clicks between them.

## Activities vs Structures on the floor plan

The Shelter can host both Activities (one-shot tasks like the original "Build Workbench") and Structures (persistent interactables like the Workbench post-build). Both appear on the floor plan:

- **Construction-site Activities** show as a placeholder tile with a progress bar overlay. Clicking enters the existing Activity page (style pass to match the floor-plan aesthetic).
- **Built Structures** show as a normal tile; clicking enters the structure page.
- When a construction Activity completes (e.g. workbench is built), the construction-site tile transforms into the structure tile in place. This in-place transition is a juice opportunity — animate it.

## Tables

No new tables for the Shelter Refresh itself. Floor-plan tile positions are derived from a static client-side layout config (one entry per structure kind) since the Shelter has a fixed shape in v1.

When/if player-customizable shelters ship, *that* is when a `shelter_layout` table with `(playerId, structureKind, x, y)` becomes necessary — explicitly out of scope here.

## Files to create/modify

**Create:**

- `src/components/shelter/ShelterFloorPlan.tsx` — the floor-plan home view
- `src/components/shelter/StructureBar.tsx` — the persistent in-page nav strip
- `src/components/shelter/StructureStatusBadge.tsx` — shared badge component (idle / running / output-ready / needs-attention)
- `src/components/shelter/structureLayout.ts` — config mapping structure kind → floor-plan position + icon

**Modify:**

- `src/components/ShelterTab.tsx` (or wherever The Shelter currently renders) — replace the flat activity list with the floor plan as the default view.
- The component that renders structure pages today (currently the Workbench) — wrap it in the new structure-page contract (full page + structure bar at edge).
- Travel routing — landing on The Shelter location should land the player on the floor plan.

## Risks / open questions

1. **Status-badge polling.** Badges must update in near-realtime as jobs progress. If they're computed from row counts/timestamps in subscribed tables, this comes for free. Watch for badge flicker on fast-completing jobs — debounce briefly if visual noise becomes an issue.
2. **Floor-plan responsive design.** On narrow screens, the floor plan needs either a scrollable canvas or a fallback to a tile-grid view that preserves the metaphor. Decide before implementation: floor plan only with horizontal scroll, or graceful grid fallback at narrow viewports.
3. **Structure-bar real estate.** With ~5 structures + Floor Plan button, the bar fits comfortably horizontally on desktop. Vertical may be required on narrow viewports. Decide which edge (top is more common; side preserves vertical content space).
4. **Sticky-bar z-index.** Confirm no z-index conflicts with the minigame modal, Notifications Tray, and confirmation dialogs.
5. **First-time player onboarding.** A brand-new player enters The Shelter with only the Build-Workbench construction site available. The floor plan with mostly-empty tiles must not look broken. Two options: grayed-out "future structure" placeholders that hint at progression, or a single-tile centered layout that visually grows as structures are built. Recommend the latter — empty placeholders create cognitive overhead at the moment of first impression.
6. **Construction-site tile transition.** When the player completes a Build activity, the construction-site → structure tile transition should be visible and rewarding (scale pulse, particle burst, confetti — match existing juice vocabulary). This is the most satisfying single moment in the Shelter loop and it's worth the polish budget.
7. **Activity pages styled for the new layout.** Existing Activity pages (Build Workbench, etc.) need a styling pass to feel consistent with the new structure-page contract. They don't need the structure bar (Activities aren't structures), but they do need the same visual frame.
