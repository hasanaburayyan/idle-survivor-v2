# Played Card Popout

## Context

In co-op Defensive Battle, another player's actions today land as silent state diffs. A zombie's HP drops, but you don't know what card produced it — was that a Strike, a Volley, or a Pierce? Was it a 24-damage crit or a 4-damage minimum roll? You can't read a teammate's playstyle from gameplay alone (single-target damage build vs healer vs ward-focused), and you can't celebrate or learn from their hits.

This spec adds a **Played Card Popout**: when any participant resolves a card, a visual representation of that card emerges from their nameplate, displays the resolved outcome for ~1 second, then slides upward and fades. Same animation across all players, including self. Reuses the existing log signal; extends the `actionResolved` payload with totals so multi-target outcomes are legible.

Builds on the Card Combat Feedback wiring (nameplate wiggle + green flash on `actionResolved`). The popout *complements* those — it's a richer information overlay sitting above the same trigger. Independent from but enhanced by **Cycling Deck** (you can predict a teammate's next play, then watch the popout confirm the outcome) and **Zombie Threat Values** (heal/ward popouts read as concrete math against the visible tick).

## Goals

- A teammate's playstyle is readable by watching their cards fly out: single-target damage, AoE, healer, ward, or mixed.
- Resolved values are visible (rolled damage, healed HP, ward count granted), not just the card name.
- The popout fires for self too, providing a satisfying "here's what your play did" moment.
- Concurrent plays across multiple players don't pile up or block each other.

Non-goals:

- Replay history / "show me what happened on the last 3 turns." Handled by the existing battle log drawer.
- Cards sliding toward their targets. Considered and rejected — AoE has no single direction.
- Per-card-type animation variants. All cards share one popout animation.
- Sound effects.

## Preliminary decisions (resolve before implementation)

1. **Show rolled values, summarized for multi-target.**
   - Damage single-target: `"24 dmg"`
   - Damage AoE: `"28 dmg ×4 targets"` (total + target count)
   - Heal single-target: `"+8 HP"`
   - Heal multi-target: `"+24 HP ×3 allies"`
   - HealFull (Revive): `"Full HP"` (no number)
   - Ward: `"+1 ward ×4 party"` (count granted + recipient count)

   Resolved values come from a small extension of the `actionResolved` log payload (see Schema). Range previews like the hover panel are NOT shown in the popout — this is the *outcome*, not the planning surface.

2. **Anchoring: per-participant on-screen position via a layout registry.** Each `ParticipantCard` registers its measured position (top-left + dimensions) on `onLayout`, keyed by `participantId`. The popout container reads the registered position at trigger time. If the participant's position is unknown (first-mount race), fall back to the top of the party panel. The codebase already has a similar pattern in `src/components/SpotlightTargetRegistry.tsx` — follow that shape rather than inventing a new one.

3. **Slide direction: upward only.** Emerge at the nameplate position, drift up by ~40px while fading. No "toward target." Multi-target actions have no single direction, and a one-rule policy keeps the visual language consistent. Target-directional movement is a future polish lever, not v1.

4. **Concurrency: most-recent-wins per participant.** Each participant has at most one popout on screen at a time; a new trigger for the same participant cancels and replaces the in-flight popout. Popouts from different participants run fully in parallel. Rationale: with Cycling Deck shipping, fast plays chain quickly. Queueing produces a "this happened a long time ago" feel; stacking is visually noisy. Replacement keeps the screen current, and the log drawer is the source-of-truth for history.

5. **Fires for everyone including self.** Consistency across the table beats avoiding redundancy. The self-popout is a reward moment ("I just hit for 28"), and it complements the existing nameplate flash + wiggle without conflicting — those are pre-attentive cues, the popout is the readable artifact.

6. **Fork from `CardPreviewPanel`, don't reuse.** Different anchoring, different lifecycle, different content. The new `<PlayedCardPopout>` lives in `src/components/feedback/` alongside the other primitives. If a later refactor wants a shared `<CardFace>` subcomponent for the visual body, both call sites can pull it in then; for now, copy the visual style and own the lifecycle.

## Schema

Extend the `actionResolved` log payload with totals and target count. The payload is JSON-stringified, so adding fields is non-breaking for existing consumers:

```typescript
// In battle.ts, where logEvent('actionResolved', { ... }) fires:
logEvent(ctx, sessionId, s.username, 'actionResolved', {
  actionId: mySlot.actionId,
  kind: resolved.kind,
  totalAmount,    // sum of rolled values across all targets (0 for healFull)
  targetCount,    // number of targets affected (1 for single-target, N for AoE)
});
```

`totalAmount` and `targetCount` are accumulated in `playAction` while iterating `zombieTargets` / `participantTargets`. For ward, `totalAmount` carries the ward count granted (`resolved.resolvedCount`); for healFull, `totalAmount` stays 0 and the client renders "Full HP" from `kind` alone.

No new tables.

## Component: `<PlayedCardPopout>`

`src/components/feedback/PlayedCardPopout.tsx`:

```tsx
interface PlayedCardPopoutProps {
  trigger: number;                  // bumped per event to replay (existing primitive pattern)
  actionId: string;                 // resolved against the actionDefinition table the client already subscribes to
  kind: string;                     // 'damage' | 'healAmount' | 'healFull' | 'ward'
  totalAmount: number;
  targetCount: number;
  anchor: { x: number; y: number; width: number; height: number };
}
```

Renders an absolutely-positioned card body containing the card name + icon, targeting label (single / all enemies / etc.), and one outcome line formatted per Decision 1. `pointerEvents="none"` always — the popout never blocks input.

Animation pipeline (uses tokens from `feedback/tokens.ts`):

- **Emerge** (spring, 280ms): scale 0.85 → 1.0, opacity 0 → 1, position from anchor center.
- **Hold** (1000ms): static.
- **Slide + fade** (400ms): `translateY` → -40, opacity → 0.

Total budget ~1.7s — well above the 600ms cap for tap-feedback primitives because this is a *narrative* feedback element, not an in-loop responsiveness signal. The Combat Feedback Primitives spec's 600ms ceiling does not apply here.

New tokens:

```typescript
export const POPOUT_HOLD_MS = 1000;
export const POPOUT_SLIDE_MS = 400;
// POPUP_OPEN_MS (280) is reused for the emerge spring.
```

## Layout registry

A new `ParticipantLayoutRegistry`, modeled on `SpotlightTargetRegistry.tsx`:

```typescript
interface ParticipantLayout { x: number; y: number; width: number; height: number; }
// Provides register(id, layout), unregister(id), get(id) via Context.
```

`ParticipantCard` calls `register(p.id, layout)` from its `onLayout` handler and `unregister(p.id)` on unmount. The popout container reads via `get(participantId)` at trigger time and snapshots the value into the popout's `anchor` prop. The popout layer is mounted absolutely at the party panel root so its coordinates are panel-relative, not screen-relative — this means scrolling the party panel naturally moves the popout with it.

If the existing `SpotlightTargetRegistry` shape fits, fold the participant variant into it as a second registry rather than duplicating the implementation.

## Trigger wiring

In `DefensiveBattleScreen.tsx`, the existing log-watch effect (added by Card Combat Feedback) processes new `actionResolved` rows and bumps the actor's wiggle + green-flash triggers. Extend that effect to also bump a per-participant `popoutTrigger` and stash the latest payload (`{actionId, kind, totalAmount, targetCount}`) in component state, keyed by `participantId`.

The popout layer iterates participants; for each, it mounts a `<PlayedCardPopout>` instance whose `trigger` and payload props come from the per-participant state. The bumped-key pattern from existing primitives handles the most-recent-wins replacement automatically (a new trigger cancels the in-flight animation; React effect re-runs with the fresh payload).

## Emergent design

1. **Playstyle reading.** Watching teammates' popouts over a few plays, you can read "Sarah is on Pierce/Strike single-target duty, Joel is the AoE clear." That's the core ask.

2. **Spectator engagement.** A defeated player watching the team can read everyone's cards and outcomes — dead time becomes interesting again. Combined with their own visible deck queue (Cycling Deck), spectating is genuinely informative.

3. **Self-validation moment.** Your own card popout is a satisfying beat after each play, especially on high rolls. "Strike for 28!" reads as a celebration without any new audio or particle work.

4. **Cycling-Deck synergy.** With visible queues, you can predict "Sarah's Pierce comes up next" and then watch the popout confirm the outcome. Closes the loop between planning and resolution at the table.

5. **Threat-Values synergy.** When the popout shows "+15 HP ×3 allies" and you can see the next self-damage tick is 11, the heal's value lands as math you can do in real time. Resolved-value popouts make threat-value math vivid.

6. **Pierce-Armored payoff is now visible from across the table.** A teammate Piercing an Armored shows "X dmg" against a zombie that — without Pierce — would have eaten the cast. Other players see the pierce mechanic working, not just a number diff.

## Risks

1. **Multi-popout simultaneity in 4-player co-op.** Up to four popouts on screen at once is plausible. Mitigation: each is anchored to its own nameplate so they spatially separate naturally. Visual density is bounded by participant count.

2. **Anchor measurement race on first mount.** A popout firing in the first ~100ms after mount may find no registered anchor. Fallback to top-of-party-panel; subsequent popouts hit the correct position. Acceptable for v1.

3. **Party panel scroll mid-animation.** Because the popout layer is panel-relative, scrolling the panel during an active popout will move the popout with the panel — visually consistent but means rapid scrolling produces a tracking popout. Acceptable; the panel rarely scrolls.

4. **Replacement loses information.** A rapid-fire player's first popout may be cut off by their second. Mitigation: log drawer remains the source-of-truth for history. The popout is *current* feedback, not archival.

5. **Fork-not-reuse increases code duplication.** Card body styling will live in `CardPreviewPanel` and `PlayedCardPopout`. Mitigation: extract a `<CardFace>` shared subcomponent later if drift becomes painful. Premature extraction is the worse failure mode given the components' diverging lifecycles.

6. **Backend payload accumulation.** Adding `totalAmount`/`targetCount` to `actionResolved` means `playAction` must thread the values through every effect branch. If a future effect kind is added without updating the accumulator, the popout reads `0` and renders blankly. Mitigation: a default of `totalAmount: resolved.resolvedCount * targetCount` for unhandled kinds keeps the popout honest, even if imperfect.

## Files to create / modify

**Backend:**
- `spacetimedb/src/battle.ts` — extend `actionResolved` payload in `playAction` with `totalAmount` and `targetCount`, accumulated inside the existing target-iteration loops.

**Client (create):**
- `src/components/feedback/PlayedCardPopout.tsx` — new component.
- `src/components/feedback/ParticipantLayoutRegistry.tsx` — new context registry (or fold into `SpotlightTargetRegistry` if shapes merge).

**Client (modify):**
- `src/components/feedback/index.ts` — export the new component.
- `src/components/feedback/tokens.ts` — add `POPOUT_HOLD_MS` and `POPOUT_SLIDE_MS`.
- `src/components/DefensiveBattleScreen.tsx` — extend the log-watch effect to bump per-participant popout triggers; mount the popout layer inside the party panel; have `ParticipantCard` register/unregister its layout.

**Specs:** this file.

## Verification

1. **Solo, play Strike on a zombie.** A card popout emerges from your nameplate showing "Strike — 1 enemy — X dmg" (X = rolled value). Holds ~1s, slides up + fades. Existing nameplate green-flash + wiggle still fire.

2. **Solo, play Volley.** Popout reads "Volley — all enemies — {sum} dmg ×{count}".

3. **Solo, play Rally on full party.** Popout reads "Rally — all allies — +{sum} HP ×{count}".

4. **Solo, play Ward.** Popout reads "Ward — party — +1 ward ×{count}".

5. **Solo, play Revive on a defeated ally.** Popout reads "Revive — 1 ally — Full HP".

6. **Co-op, two teammates play simultaneously.** Both popouts render in parallel, each anchored to its own nameplate. No flicker, no overlap.

7. **Same player plays two cards in quick succession (Cycling Deck).** Second popout cancels and replaces the first. No queue, no stacking on a single nameplate.

8. **Defeated player spectator.** Sees popouts from active teammates with resolved values. Their own nameplate never fires a popout (no plays).

9. **Pierce on Armored.** Popout shows the rolled damage value (full hit), not zero — confirming the pierce-through-armor reads correctly to teammates.

10. **Battle ended.** Popouts in flight at battle-end animate out cleanly; no popouts fire after the `battleEnded` log entry.
