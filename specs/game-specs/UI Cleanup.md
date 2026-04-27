# UI Cleanup

## Context

Two recurring frustrations in the current UI:

1. **Skill tree pan is unreliable.** On web, a mouse drag on the skill tree often highlights node text instead of panning. On mobile, dragging sometimes scrolls the parent screen instead of the tree. There's no zoom — players can't see the bigger picture or zoom in on a region.
2. **Clicks select button text.** Tapping/clicking buttons across the app sometimes selects the underlying text label (especially on long-press / drag-tap), leaving the page in a "text selected" state that's visually awkward and breaks the feel of an action game.

Root cause for both: the app uses React Native's `PanResponder` and `Pressable`, which on web map to plain DOM elements with default text-selection enabled and no explicit gesture ownership. The fix is to (a) disable text selection on interactive elements globally and (b) replace the `PanResponder`-based skill tree pan with a `react-native-gesture-handler` setup that handles mouse, touch, and pinch uniformly, plus a wheel handler for web zoom.

This spec is scoped to **both web and mobile**.

## Goals

- Skill tree: smooth, reliable pan + zoom on both web (mouse) and mobile (touch). No text highlighting on drag. No accidental parent-screen scroll.
- Click/tap-anywhere: tapping any interactive control (`Pressable`, button, card, hand card, etc.) does not select text on web.

Non-goals (deferred):

- Skill tree mini-map, "go to node" affordance, or path animations.
- Right-click / keyboard shortcuts on activity buttons (separate spec).
- Hover tooltips / cursor-aware affordances.

## Approach

### Add `react-native-gesture-handler`

Add the dependency (Expo-supported, official RN gesture library). It handles mouse + touch + pen uniformly on web, supports pinch / pan / tap composition out of the box, and consumes pointer events so the browser doesn't fall through to text selection.

Wire its `GestureHandlerRootView` at the app root in `App.tsx` (above `SafeAreaProvider`), as the library requires.

### Skill tree: pan + zoom (`SkillTreeTab.tsx`)

Replace the existing `PanResponder` block (lines ~121–145) with a composed gesture:

- **Pan gesture** — drag with one finger (touch) or mouse button down + drag (web). Updates a shared `Animated.ValueXY` for translation.
- **Pinch gesture** — two-finger pinch (touch). Updates a shared `Animated.Value` for scale.
- **Web wheel zoom** — on `Platform.OS === 'web'`, attach an `onWheel` handler to the gesture container that adjusts scale on scroll. Plain scroll = pan vertically; `ctrl + scroll` = zoom (matching Figma / Miro / browser-zoom convention).
- **Compose** with `Gesture.Simultaneous(pan, pinch)` so two-finger pinch doesn't lock pan, and pan continues to feel single-finger natural.

The transform applied to the inner skill-tree container becomes:

```ts
transform: [
  { translateX: pan.x },
  { translateY: pan.y },
  { scale: scale },
]
```

#### Zoom defaults

- `MIN_SCALE = 0.5`
- `MAX_SCALE = 2.0`
- `DEFAULT_SCALE = 1.0`
- Wheel zoom step: `0.1` per notch (clamped).
- **Reset gesture**: double-tap on empty area resets pan to (0,0) and scale to 1.

#### Pan bounds

Compute the bounding box of all skill nodes once (the existing layout already places nodes by `positionX/positionY` in `skillDefinition`):

```
contentBoundsMin = { x: min(positionX) - PADDING, y: min(positionY) - PADDING }
contentBoundsMax = { x: max(positionX) + PADDING, y: max(positionY) + PADDING }
```

with `PADDING = 200` (a comfortable extra-width on every side, so users don't hit a hard wall right at the last node).

When pan finishes, clamp `pan.x` and `pan.y` so that the visible viewport (accounting for current `scale`) stays inside the padded content bounds. If the user's gesture goes beyond, animate-spring back to the clamped value.

### Global text-select suppression

On web only, `Pressable` (and any other interactive element) renders as a `<div>` with default `user-select: text`. Browsers will start a selection on mouse-down-and-drag — this is what produces the "highlights button text" feel.

Fix at one place: a small wrapper around `Pressable` (e.g., `src/components/SafePressable.tsx`) that on `Platform.OS === 'web'` sets the inline style:

```ts
{
  userSelect: 'none',
  WebkitUserSelect: 'none',
  cursor: 'pointer',
  touchAction: 'manipulation',  // disables 300ms tap delay & double-tap zoom
}
```

Either:

- **(a)** Replace direct `Pressable` imports across components with `SafePressable` (mechanical sweep, ~12 files), or
- **(b)** Apply via a global stylesheet hack injected once at app boot (web only) targeting `[role="button"]` and similar.

**Pick (a)** for explicitness — it's grep-friendly and makes future devs aware. The sweep is small (the codebase has ~20 `Pressable` call sites).

For the skill tree's pan area specifically, also apply `user-select: none` to the gesture container so dragging across nodes doesn't begin a selection.

### Apply `select-none` to text inside buttons

Any `<Text>` inside a button-like container should also be select-none on web (otherwise the inner text node can still pick up selection on web when the wrapper's `user-select: none` is overridden by descendant style). The `SafePressable` wrapper passes `user-select: none` down via context or a style prop.

## Files to create / modify

**Create:**

- `src/components/SafePressable.tsx` — drop-in replacement for `Pressable` that applies `userSelect: 'none'`, `cursor: 'pointer'`, `touchAction: 'manipulation'` on web.

**Modify:**

- `package.json` — add `react-native-gesture-handler` (compatible with Expo SDK 52).
- `App.tsx` — wrap the app root in `<GestureHandlerRootView style={{ flex: 1 }}>`.
- `src/components/SkillTreeTab.tsx` — replace `PanResponder` block with `Gesture.Pan() + Gesture.Pinch() + GestureDetector`. Add `Animated.Value` for `scale`. Compute and clamp pan bounds. Add `onWheel` handler when `Platform.OS === 'web'`. Add double-tap-to-reset.
- All `Pressable` import sites (ActivityGrid, ActivitiesTab, AuthScreen, ChatTab, GroupLobby, GroupPanel, HomeScreen, ScrapFlow, ShelterTab, SkillTreeTab, SocialTab, StructureCard, TabBar, TravelTab, ResourceStrip, MinigamesTab, MinigameModal, MinigameLobby, MinigameResults, CoinFlipView, RhythmTapView, CardDuelView) — swap `Pressable` for `SafePressable`. The TextInput in MinigameLobby and CoinFlipView are unaffected (they should remain selectable).

## Verification

1. **Build & smoke**: `npm install`, `npx expo start`. App boots on web and a mobile target with no gesture-handler errors.
2. **Skill tree on web (mouse)**:
   - Click-and-drag on empty space inside the tree → pans smoothly. No text gets highlighted.
   - Click on a skill node → selects it (single tap, not drag).
   - Scroll wheel over the tree → pans vertically.
   - Ctrl + scroll wheel → zooms in/out around the cursor (or center; either is fine for v1). Clamps to 0.5×–2×.
   - Double-tap empty area → resets pan to origin and zoom to 1×.
   - Drag past the node bounds → pan springs back to the padded bound.
3. **Skill tree on mobile (touch)**:
   - Single-finger drag → pans without scrolling the parent tab. Verify the parent screen does NOT also scroll.
   - Two-finger pinch → zooms. Clamps to 0.5×–2×.
   - Tap a node → selects it.
4. **Text-select suppression**:
   - On web, click-and-hold the "Scavenge" button text and try to drag — no text selection appears. Same for any tab in `TabBar`, the lobby's "Start" button, the CoinFlip "Heads" button, and the CardDuel "End turn" button.
   - On mobile, long-press a button — no native context menu / text selection callout appears.
5. **Regression**:
   - Existing flows (Scavenge, Group invite, CoinFlip wager, CardDuel play) all still work — `SafePressable` is a transparent wrapper.
   - `TextInput` fields (signup form, lobby username, CoinFlip wager) remain selectable.

## Risks

1. **`react-native-gesture-handler` install on web** sometimes needs a metro/webpack tweak. Expo SDK 52 typically Just Works, but if web build fails, check `metro.config.js` for the gesture-handler resolver alias.
2. **Pan bounds clamping math** has edge cases when `scale < 1` (content smaller than viewport — no clamp needed) vs. `scale > 1` (content larger — clamp tight). Test both.
3. **`SafePressable` sweep** must not change behavior of buttons that intentionally allow text selection inside them (none currently exist, but confirm during the sweep).
4. **`touchAction: 'manipulation'`** disables double-tap zoom on web. If we later want browser-native zoom on the page, we'd revisit.
