# The Cookie Layout

## Overview

The home screen is restructured around a Cookie-Clicker-style three-panel shell. The Scavenge button gets a permanent home on the left so it's always one click away regardless of which sub-screen the player is looking at. The right side becomes a thin tab sidebar. The center is the active sub-screen.

This spec replaces the eight-tab bottom bar with a six-item sidebar (Acts and Travel are removed).

## Goals

- Scavenge is one click away from any view. No tab-switching to gather.
- Build activities sit next to Scavenge, where the player's already pressing things, instead of being a navigation step away.
- Reduce navigation surface: 8 tabs → 6.
- Travel is implicit — picking the Shelter tab "is" being inside the shelter, conceptually. The location-switching UI goes away. (Player stays at the engine-level `the_wastes` location forever; the `location` field, `travelTo` reducer, and `location_definition` table all stay in place so Travel can come back without a schema change.)

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│   Resource strip · Level / XP bar · Username · Dev · Logout  │   header (full width, existing)
├──────────────┬───────────────────────────────────┬───────────┤
│              │                                   │  🛖 Shelt │
│              │                                   │  🌳 Skill │
│   ⛏          │                                   │  👤 Char  │
│  SCAVENGE    │       Active sidebar tab          │  👥 Soc   │
│              │       content renders here        │  🎲 Games │
│   Lv N       │                                   │  💬 Chat  │
│              │                                   │           │
│  build cards │                                   │           │
└──────────────┴───────────────────────────────────┴───────────┘
   ScavengePanel        active tab pane              Sidebar
```

### Header strip (unchanged)
Spans the full width above the three columns. Renders ResourceStrip + level/XP bar + username + dev tools + logout. No layout changes from today.

### Left panel — `ScavengePanel`
- **Width**: ~280px on wide viewports; full width on narrow.
- **Always rendered** regardless of selected sidebar tab.
- **Contents**:
  1. **Scavenge button** — the cookie. Big, always-affordable click target with the existing combo / fortune-proc affordances (per `ActivityGrid`'s scavenge cell).
  2. **Scavenge level pill** — existing "Lv N · ⬆ cost ⚙" upgrade affordance, unchanged.
  3. **Build cards** — compact tiles for any build activity the player can currently start (see Build Gating below). Hidden when none qualify, so a clean state is "just the cookie".

### Center panel — active tab pane
- **Width**: flex.
- Renders whichever sidebar tab is active. Each tab component (`ShelterTab`, `SkillTreeTab`, `CharacterTab`, `SocialTab`, `MinigamesTab`, `ChatTab`) is reused as-is — no changes to their internals beyond what removal of `Acts` / `Travel` requires.

### Right sidebar — `Sidebar`
- **Width**: ~96px on wide viewports.
- **Items**: Shelter, Skills, Char, Social, Games, Chat (6 total, in this order).
- Each item is an icon + short label tile. Active item is highlighted (amber-on-slate, matching the existing tab styling). One click swaps the center panel.
- Sticky — does not scroll with the active panel content.

## Removed surfaces

- **Acts tab** — deleted. Its only content (Scavenge + build activities) lives in the ScavengePanel now.
- **Travel tab** — deleted from the UI. The `travelTo` reducer, `location_definition` table, `myTravelableLocations` view, and the player's `location` field all remain server-side. The button in the existing `TutorialPopup` that points at `tab:travel` (in `shelter_built`) needs its spotlight target changed to `tab:shelter`.

## Build activity gating

The build cards in the ScavengePanel show only what the player can currently act on. Filtering rules:

1. **Skill prereq satisfied** — if `activityDefinition.prerequisiteSkillId` is non-empty, the player must have `playerSkill.level >= prerequisiteSkillLevel` for that skill.
2. **Not yet completed** — `playerActivity.timesUsed < activityDefinition.maxUses` (every build activity has `maxUses: 1`).
3. **Shelter prereq for shelter-located builds** — an activity with `locationKey === 'the_shelter'` is additionally hidden until `build_shelter` has been completed (`timesUsed >= 1` on `build_shelter`). Without this, the player would see a Build Workbench card before they have a shelter to put it in.

Resulting visibility per build:

| Build | Visible when |
|---|---|
| Build Shelter | `unlock_shelter` purchased AND `build_shelter` not yet completed |
| Build Workbench | Shelter built |
| Build Armory | Shelter built |
| Build Refinery | Shelter built AND `unlock_parts` purchased AND not yet completed |
| Build Smelter | Shelter built AND `unlock_metal` purchased AND not yet completed |
| Build Garden | Shelter built AND `unlock_food` purchased AND not yet completed |

Once a build is done, its card disappears from the panel.

## Server-side changes

A new view `myAvailableActivities` powers the ScavengePanel:

```ts
spacetimedb.view(
  { name: 'my_available_activities', public: true },
  t.array(activityDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const username = s.username;
    const shelterBuilt = (findPlayerActivity(ctx, username, 'build_shelter')?.timesUsed ?? 0) >= 1;
    return [...ctx.db.activityDefinition.iter()].filter(def => {
      // Skill prereq
      if (def.prerequisiteSkillId !== '') {
        if (skillLevel(ctx, username, def.prerequisiteSkillId) < def.prerequisiteSkillLevel) return false;
      }
      // Max uses
      if (def.maxUses !== -1) {
        const pa = findPlayerActivity(ctx, username, def.activityId);
        if ((pa?.timesUsed ?? 0) >= def.maxUses) return false;
      }
      // Shelter gating for shelter-located activities
      if (def.locationKey === 'the_shelter' && !shelterBuilt) return false;
      return true;
    });
  }
);
```

The existing `myVisibleActivities` view stays for now — it's location-aware and useful if Travel comes back. Nothing in the new UI subscribes to it, and its compute cost is small.

The location check inside `scavengeActivity` and `advanceBuild` reducers stays untouched. Players default to `the_wastes` on signup; with Travel removed, they stay there. The shelter-build bypass already in `advanceBuild` (effectiveLocation = 'the_shelter' when `def.locationKey === 'the_shelter'`) handles the in-shelter builds correctly without travel.

### One-shot migration

Players whose `location` is anything other than `the_wastes` (e.g. `the_shelter` from a prior session) would be unable to scavenge after the UI change. Add a tiny migration step in `runSeedMigration` that resets every `playerState.location` to `the_wastes`. Idempotent. Safe to re-run.

## Responsive behavior

The 3-column layout doesn't fit on a phone. Breakpoint at 768px viewport width.

### Wide (≥ 768px)
- Three columns: left (~280px) | center (flex) | right (~96px).
- All three are always visible. Center scrolls; left and right are sticky.

### Narrow (< 768px)
- Stacked vertically:
  1. Header (top, fixed)
  2. ScavengePanel (auto-height, sticky to top below header)
  3. Active tab pane (flex)
  4. Sidebar (bottom, horizontal row of icon-only tiles, similar footprint to the old `TabBar`)
- This preserves the "Scavenge always visible" goal while keeping nav reachable with the thumb.

Width detection: `useWindowDimensions().width >= 768`. No media-query libraries needed.

## Tutorial cleanup

- `shelter_built` step's `spotlightTargetKey` changes from `tab:travel` to `tab:shelter` (Travel no longer exists as a target).
- `first_level_up` step keeps `tab:skill_tree` (still valid in the sidebar).
- `beginner_complete` keeps `tab:character`.
- No tutorial copy needs rewording — the existing text doesn't reference Acts or Travel by name.

## Files to create / modify

**Create:**
- `src/components/ScavengePanel.tsx` — left panel; reuses `ActivityGrid` for the scavenge cell + build cards.
- `src/components/Sidebar.tsx` — right sidebar; replaces `TabBar`.
- `src/components/HomeShell.tsx` (or refactor `HomeScreen` directly) — three-column / stacked-narrow layout.

**Modify:**
- `src/components/HomeScreen.tsx` — replace the `<View className="flex-1">{tab === ...}</View>` + `<TabBar />` block with the new shell. Drop `activities` and `travel` from the `TabKey` union.
- `src/components/TabBar.tsx` — delete, or repurpose as the narrow-viewport horizontal sidebar.
- `src/components/ActivitiesTab.tsx` — delete (its content moves into `ScavengePanel`).
- `src/components/TravelTab.tsx` — delete from the UI. `travelTo` reducer reference stays in `module_bindings` (auto-generated) and on the server.
- `spacetimedb/src/index.ts` — add the `myAvailableActivities` view; add the `playerState.location → 'the_wastes'` reset to `runSeedMigration`.
- Tutorial: change `shelter_built.spotlightTargetKey` to `'tab:shelter'`.

**Untouched:**
- All sub-tab components: `ShelterTab`, `SkillTreeTab`, `CharacterTab`, `SocialTab`, `MinigamesTab`, `ChatTab` continue to work as-is.
- All structure pages, the floor plan, the structure bar — unchanged.
- The Scavenge reducer math, build progress reducer, skill tree, classes — unchanged.

## Open questions / risks

1. **Build card density on narrow screens.** When all six build activities are visible at once (briefly possible — e.g. just after unlocking Garden but before building any of the four shelter structures), the ScavengePanel might dominate the narrow-viewport layout. If this becomes a problem, collapse the build cards into a single "Build" expandable section.

2. **Scavenge button as a tile vs. as a hero.** Today the scavenge cell is one tile in a grid. In the new ScavengePanel it's the headline element — it should look bigger / more prominent than a build card. Either give it a larger variant in `ActivityGrid` or render it inline in `ScavengePanel` with the existing `ActivityCell` component scaled up.

3. **What if Travel returns?** When (if) Travel comes back, the natural fit is a small switcher in the ScavengePanel header — "you are in: Wastes ▼" — that toggles between locations. The infrastructure is preserved for exactly this. No spec for that here; flagged for the future.

4. **Sidebar scroll on small heights.** Six items fit on most screens, but with bigger tiles they might overflow on a short viewport. If overflow happens, the sidebar should scroll independently of the center panel (already true since the sidebar is its own column).

5. **The Battle / Minigame modals stay full-screen.** Defensive Battle and minigame modals overlay the entire shell, including the scavenge panel — same z-index behavior as today. Confirm no regressions during a battle.
