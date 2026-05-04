# Combat Feedback Primitives

## Context

Across the four player-facing combat surfaces — Rhythm Tap, Coin Flip, Card Duel, and Defensive Battle — actions today are functionally correct but visually inert. A player taps an enemy and the HP number changes; a card resolves and the row in the table updates; the coin lands and a small inline card appears in the corner of the screen. Players have a hard time reading what just happened, especially in the multiplayer surfaces where another player's action has zero on-screen footprint outside of a state diff.

This spec ships the **shared primitives** that the per-game feedback specs will consume. It is a foundation, not a feature. After this lands, the Rhythm/Coin Flip spec and the Card Combat spec can both proceed in parallel and use these primitives instead of each re-deriving their own flash/wiggle/HP-bar logic.

The existing `DamagePop` in `DefensiveBattleScreen.tsx` (lines 637–695) is the prior art and should be folded into the new shared module, not parallel to it.

## Goals

- One shared module (`src/components/feedback/`) with four primitives: `<FlashOverlay>`, `<Wiggle>`, `<LaggingHpBar>`, `<ResultsPopup>`, plus the existing `<DamagePop>` relocated and generalized.
- A single source of truth for animation timings and feedback colors, so every minigame feels like the same game.
- A documented trigger contract — primitives know how to react to "an event happened" without each call site re-inventing the diff/key/animated-value pattern.
- Zero new backend tables. All primitives are pure client visualization driven by existing SpacetimeDB state changes.

Non-goals (explicit):

- Per-game wiring (covered by the two follow-up specs).
- Sound effects (separate spec).
- Particle effects, screen shake, or any animation more elaborate than tint / translate / scale / opacity.
- A new animation library — RN's built-in `Animated` is already in use across the codebase and is sufficient.

## Preliminary decisions (resolve before implementation)

These are the cross-cutting choices that should be agreed on before either application spec starts. None of them are settled in code today.

1. **Animation library**: stay on RN `Animated` (consistency with `DefensiveBattleScreen`'s existing `Animated` usage). Do not introduce `reanimated` or a third-party tweener for this work. Revisit only if web perf becomes a problem.
2. **Trigger pattern for one-shot animations**: the "bumped key" approach used by `DamagePop` — caller passes a numeric prop that increments per event; the primitive's `useEffect` keys on it and replays the animation. Avoids imperative refs and works cleanly with React's data flow.
3. **Event source per game**: animations are driven by table-state diffs and (where it already exists) the `defensive_battle_log` event table. **No new "events" tables are introduced for animation.** If a game lacks the right signal, the spec calls it out and either uses a state diff or extends an existing log.
4. **Concurrent animations**: when one event affects N targets (AoE damage, party heal), all N animations play in parallel — no staggering. The primitives are stateless and idempotent per element, so this falls out for free.
5. **Animation duration budget**: every primitive completes within 600ms. This is the cap. Defensive-Battle's lagging HP bar is the longest at ~600ms; flashes and wiggles are 200–400ms. Rationale: feedback should never block the next player input; in real-time games a 1s animation is unplayable.
6. **Reduced-motion**: out of scope for v1. The palette/timing module reserves a `motionEnabled: boolean` flag for a future settings toggle, but no UI ships in this spec.

## Module layout

```
src/components/feedback/
├── index.ts              // re-exports the public API
├── tokens.ts             // colors, durations, easing curves (single source of truth)
├── FlashOverlay.tsx      // tinted flash over a child container
├── Wiggle.tsx            // brief horizontal/rotational jitter on trigger
├── LaggingHpBar.tsx      // HP bar with a delayed-red "ghost" segment
├── ResultsPopup.tsx      // modal-style centered popup with backdrop
└── DamagePop.tsx         // moved from DefensiveBattleScreen, generalized
```

`tokens.ts` is the linchpin — every primitive imports from it, and every per-game spec imports from it for any inline tweak (e.g. a one-off color match). Adding a new color or duration is a single file edit.

## Tokens (`tokens.ts`)

```ts
// Durations (ms)
export const FLASH_FADE_IN_MS = 80;
export const FLASH_HOLD_MS = 100;
export const FLASH_FADE_OUT_MS = 200;       // total ~380ms
export const WIGGLE_MS = 320;
export const HP_LAG_DELAY_MS = 220;         // pause before red bar starts collapsing
export const HP_LAG_LERP_MS = 380;          // how long the collapse takes
export const POPUP_OPEN_MS = 280;
export const POPUP_AUTO_DISMISS_MS = 4000;  // 0 = stay open until tapped
export const SHRINK_OUT_MS = 240;           // card-removal animation in CardDuel

// Colors — keep in sync with the Tailwind palette already used in the app
export const COLOR_HIT = '#34d399';         // emerald-400 — generic positive signal
export const COLOR_HEAL_VIBRANT = '#6ee7b7';// emerald-300 — heal applied to ally
export const COLOR_MISS = '#fb7185';        // rose-400 — missed input
export const COLOR_DAMAGE = '#f43f5e';      // rose-500 — damage taken
export const COLOR_SHIELD = '#38bdf8';      // sky-400 — ward / shield / protect
export const COLOR_PLAY = '#34d399';        // emerald-400 — actor "I played a card"
export const COLOR_BG_TINT = 'rgba(15, 23, 42, 0.85)'; // slate-900/85 popup backdrop

// Easing — re-exported from RN to keep call sites short
export { Easing } from 'react-native';
```

> The two greens (`COLOR_HIT` vs `COLOR_HEAL_VIBRANT`) intentionally differ. The actor-played "I did something" green is mid-tone; the recipient-healed "you got something" green is lighter so a player flashing both colors in quick succession (heal-self) reads as two separate beats.

## Primitive APIs

### `<FlashOverlay>`

```tsx
interface FlashOverlayProps {
  trigger: number;               // bump on each event to replay
  color: string;                 // from tokens, e.g. COLOR_DAMAGE
  durationMs?: number;           // override; default = FLASH_HOLD_MS sum
  fillMode?: 'tint' | 'border';  // 'tint' = fill the container; 'border' = stroke
  intensity?: number;            // peak opacity 0..1; default 0.55. Use ~0.30 for "subtle"
}
```

Renders an `Animated.View` with `pointerEvents="none"`, absolutely positioned over the parent (`StyleSheet.absoluteFill`). Caller is responsible for ensuring the parent has `position: relative`. Opacity goes 0 → `intensity` → 0 over the standard envelope. The default 0.55 reads as a clear, deliberate beat (right for combat); lower values (0.25–0.35) read as "ambient feedback" and are appropriate for high-frequency events like a Rhythm Tap lane press, where a full-strength flash on every successful hit would feel like flicker.

`fillMode: 'border'` is a 2px outline-only flash; cheaper visually for tightly-packed elements like CardDuel's 5-card-wide board where a fill would be visually busy.

### `<Wiggle>`

```tsx
interface WiggleProps {
  trigger: number;
  axis?: 'x' | 'rotate';
  amplitude?: number;            // px (axis x) or deg (axis rotate); default 4
  children: React.ReactNode;
}
```

Wraps children in an `Animated.View`. On `trigger` change, runs a sequence: 0 → +amp → −amp → +amp/2 → 0 over `WIGGLE_MS`. Two oscillations is enough — three reads as "the UI is broken."

### `<LaggingHpBar>`

```tsx
interface LaggingHpBarProps {
  currentHp: number;
  maxHp: number;
  height?: number;               // default 8
  fillColor?: string;            // default 'emerald-500' below 33% switches to rose-500
  ghostColor?: string;           // default COLOR_DAMAGE
}
```

Renders three layered bars in a single track:

1. **Background** — slate-800, full width.
2. **Ghost (red lag bar)** — width animates from `prevHpPct` to `currentHpPct` over `HP_LAG_LERP_MS`, after a `HP_LAG_DELAY_MS` pause. This is the "blood streak" the user described — it shows what was lost.
3. **Foreground (current HP)** — width snaps to `currentHpPct` immediately; this is the live bar.

When `currentHp` increases (heal), the ghost simply jumps to match — no red lag for heals. When `currentHp` decreases multiple times in rapid succession, the ghost re-anchors to the *new* prev value and lerps from there; we do **not** queue lag animations. (Queueing produces a misleading "this happened a long time ago" feel.)

Replaces the inline HP-bar markup in `DefensiveBattleScreen.ParticipantCard` and `ZombieCard`, and the inline bars in `CardDuelView`'s player rows.

### `<ResultsPopup>`

```tsx
interface ResultsPopupProps {
  visible: boolean;
  onDismiss: () => void;
  autoDismissMs?: number;        // 0 = manual; default POPUP_AUTO_DISMISS_MS
  children: React.ReactNode;     // game-specific content
}
```

Renders an absolutely-positioned, full-screen overlay with a tinted backdrop (`COLOR_BG_TINT`). The inner card scales from 0.85 → 1.0 over `POPUP_OPEN_MS` with a spring, and the backdrop fades from 0 → 1. Tapping the backdrop or pressing a built-in "Done" button dismisses. If `autoDismissMs > 0`, schedules a dismiss timer that the caller can cancel by reusing the `onDismiss` flow.

`children` is the card body — game-specific content (CoinFlip result, future game endings) lives there. The popup itself only owns the backdrop, sizing, and animation.

### `<DamagePop>` (relocated)

Move the existing `DamagePop` from `DefensiveBattleScreen.tsx` into `feedback/DamagePop.tsx`. Generalize the `kind` prop to accept a color directly (`color: string`) instead of the hardcoded participant/zombie split. Defensive Battle and Card Duel both consume it; their per-game specs choose colors via `tokens.ts`.

## Verification

Primitives ship a small Storybook-style demo at `src/components/feedback/__demo.tsx` (NOT registered in routes — manually mounted during dev) that exercises each primitive with a button to fire its trigger. Visual verification only; no jest snapshot tests for animation timing.

Verify before merging:

1. Build & smoke: app boots on web and a mobile target with no `feedback/` import errors.
2. `<FlashOverlay>`: green and red flashes both replay on rapid trigger bumps without leaving residue.
3. `<Wiggle>`: child position lands back at 0 after each run; rapid triggers don't drift the resting position.
4. `<LaggingHpBar>`: dropping HP from 100 → 60 shows the red ghost lerping from 100 to 60 with a brief delay; restoring 60 → 100 shows the ghost snap to 100 with no red.
5. `<ResultsPopup>`: opens/closes cleanly; backdrop tap dismisses; auto-dismiss timer cancels if the user dismisses manually first.
6. `<DamagePop>`: still works in Defensive Battle (regression check — the relocation is a pure import move + color-prop API change).

## Files to create / modify

**Create (8 files):**

- `src/components/feedback/index.ts`
- `src/components/feedback/tokens.ts`
- `src/components/feedback/FlashOverlay.tsx`
- `src/components/feedback/Wiggle.tsx`
- `src/components/feedback/LaggingHpBar.tsx`
- `src/components/feedback/ResultsPopup.tsx`
- `src/components/feedback/DamagePop.tsx`
- `src/components/feedback/__demo.tsx` (dev-only, not routed)

**Modify:**

- `src/components/DefensiveBattleScreen.tsx` — remove the inline `DamagePop` definition; import from `feedback/`. Replace inline HP-bar markup in `ParticipantCard` and `ZombieCard` with `<LaggingHpBar>`. No behavioral change beyond the bar getting a lag effect.

The Defensive-Battle modification in this spec is a **mechanical relocation** — full feedback wiring lives in the Card Combat Feedback spec.

## Risks

1. **`Animated.Value` re-renders on web**: rapid trigger bumps in a list (e.g. 8 zombies all flashing) can cause perf degradation if every flash mounts its own animator. Profile with 8+ simultaneous flashes; if it stutters, switch the worst offender to `useNativeDriver: true` (already used in `DamagePop`) or batch-render.
2. **Color drift between games**: two developers picking "green" independently produces two different greens. Enforced single source via `tokens.ts`; reviewers should reject any inline color literal in the application specs that should have come from tokens.
3. **HP-bar ghost on small bars**: at the 1.5px Defensive-Battle zombie bar height, the ghost might be visually invisible. The primitive accepts a `height` override; the application spec specifies the per-callsite value.
4. **Popup z-index conflicts**: the existing `MinigameModal` already mounts at root. `<ResultsPopup>` mounted *inside* a minigame view will sit at the same z-layer. Confirm during integration that the popup renders above the minigame's hand strip and below any global toast layer.
