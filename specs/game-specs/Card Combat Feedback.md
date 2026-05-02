# Card Combat Feedback — Card Duel & Defensive Battle

## Context

The two card-driven combat surfaces share the same multiplayer-feel problem: when another player acts, it lands as a silent state diff. A card on the opponent's board appears with no signal that *they* played it. A teammate's heal lands on you with no indication of who cast it or that it was a heal at all. Today the only feedback the player gets is the post-resolution state — which is correct but emotionally inert.

This spec applies the **Combat Feedback Primitives** to both Card Duel and Defensive Battle, making each player's moves legible to themselves and to everyone else in the session. The two games are bundled because they share enough mechanics (turn-resolved card play, HP-bearing combatants, heal/damage/shield effects, card-removal moments) that a single coordinated pass is faster than two separate sweeps.

Depends on: **Combat Feedback Primitives** (must land first).

## Goals

- **Card Duel**: card-on-card combat reads as a sequence of distinct beats — attacker plays, both flash on damage, defeated cards shrink off the board.
- **Defensive Battle**: every card play produces a visible "X played a card" beat on the actor's nameplate, plus colored feedback on every affected target (red on damaged, vibrant green on healed, blue on warded). HP changes use the lagging-bar primitive so big damage is felt.
- Spectators see what other players did, not just the after-state.
- Backend changes are minimal: zero for Card Duel, a small log-extension for Defensive Battle so target-resolved heal/ward events are visible to the client.

Non-goals:

- New card types, new actions, or any combat-math change.
- Replays / time-rewind / "show me what happened on the last turn" features.
- Per-card animation variations (every damage flash is the same red; the spec doesn't introduce action-specific animation variants).

## Card Duel — `CardDuelView.tsx`

### Trigger model: state diffs

Card Duel has no event-log table and shouldn't grow one for animation alone. The board state (`cardDuelCardOnBoard`, `cardDuelPlayer`) plus the public `cardDuelBoard.turnNumber` are sufficient signals.

The view tracks, in refs:

- `prevCardHp: Map<bigint, number>` — last-seen HP per board card by id.
- `prevCardIds: Set<bigint>` — last-seen set of board card ids per seat.
- `prevPlayerHp: Map<seat, number>` — last-seen player HP.
- `prevTurnNumber: number` — for distinguishing "card appeared from a play" vs. "card appeared from initial deal."

On each render, a `useEffect` keyed off `boardCards`, `players`, and `board` diffs against the refs and bumps per-id flash triggers in component state. The same approach `DamagePop` already uses, scaled out per row.

### Animations

1. **Card damage flash (red)**: when a `cardDuelCardOnBoard` row's `health` drops, flash that card's slot red via `<FlashOverlay fillMode="border" color={COLOR_DAMAGE}>`. Mount it inside each board slot, keyed by the card id.
2. **Card removal (shrink-out)**: when a previously-tracked card id disappears from `boardCards`, render a "ghost slot" for `SHRINK_OUT_MS` showing the last-known card content with an `Animated.View` that scales 1.0 → 0.0 and fades 1 → 0. After the animation, the slot returns to its empty state. Implemented via a `removingCards` map in component state that's pruned on animation end.
3. **Player damage flash (red)**: when a `cardDuelPlayer.health` drops, flash that player's HP/status row red via `<FlashOverlay fillMode="tint">`. (The "direct attack" case — attacker hits opponent face — was previously invisible; this surfaces it.)
4. **Card-played wiggle on opponent's nameplate**: when `enemyCards.length` increases (between renders, with `prevTurnNumber` gating to suppress the initial deal), bump the opponent name row's `<Wiggle>` trigger and flash it green. This is the "opponent just played a card" signal.
5. **HP bars become `<LaggingHpBar>`**: replace both players' inline `❤ HP` text with `<LaggingHpBar>` so big damage hits land visually. Keep the numeric HP next to the bar.

### Layout adjustments

- Each board slot needs `position: 'relative'` so the per-slot `<FlashOverlay>` can absolute-position. The current `flex-1 rounded-md` containers already work as positioned ancestors with one className addition.
- The opponent and me header rows currently render as flat flex rows; wrap the opponent's row in `<Wiggle>` and `<FlashOverlay>` containers. The "me" row is wrapped too, in case a future feature wants to feed back self-play; for v1 it's mounted but never triggered.
- Hand cards: when a hand index is consumed by `cdPlayCard`, the hand row already updates from the private state subscription. No animation; the visual change is enough since the player is the actor and saw their own input.

### Verification (Card Duel)

1. 1v1 duel, A plays a 2/2 onto a slot: B's view wiggles A's nameplate and flashes it green; A's view flashes their own slot's drop-in (visual via the existing tap, no extra animation needed).
2. A attacks B's 1/1 with a 2/2: both involved slots flash red, B's 1/1 shrinks and disappears, A's 2/2 stays (1 HP remaining). The numeric `attack/health` matches.
3. A directly attacks B's face: B's HP row flashes red, the lagging HP bar shows the lost segment lerping down.
4. Rapid trades: a sequence of 3 attacks in a single turn produces 3 distinct red flashes per affected card; no flash gets dropped or overlapped.
5. Card destroyed by trade: shrink animation completes (no popping out instantly), then the slot is empty. New plays into that slot work immediately afterward.

## Defensive Battle — `DefensiveBattleScreen.tsx`

### Trigger model: hybrid (event log + state diff)

Defensive Battle already maintains `defensive_battle_log` (see `battle_tables.ts:166`) and the client subscribes via the `myDefensiveBattleLog` view. The log carries `actionResolved` and `damageDealt` events keyed on `actorUsername` + payload — enough to drive nameplate wiggle and per-target damage flashes today.

For heal and ward effects the log currently fires only `actionResolved` with `kind: healAmount | healFull | ward` — *no per-target detail*. Two options:

- **(a)** Extend the log: emit one event per target, the same pattern damage already uses.
- **(b)** Keep the log as-is and detect heal/ward client-side via state diffs on `defensiveBattleParticipant.currentHp` and `wardCount`.

**Recommendation: (b) — state diffs.** It avoids backend churn, the client diffing is straightforward (HP up = heal target; wardCount up = shield target), and all targets in a single AoE heal land in the same client tick anyway. The trade-off: if a player is hit for 5 and healed for 5 in the same transaction the diff is 0 and no flash fires. That's a real edge case but acceptable for v1; revisit if reported.

So the trigger model is:

- **Log-driven**: actor nameplate wiggle + green flash (driven by new `actionResolved` rows).
- **State-diff-driven**: per-target damage flash, per-target heal flash, per-target shield flash, lagging HP bar updates.
- **State-diff-driven**: zombie damage flashes (HP drop) and shrink-on-death animation.

Implement two refs / effect pairs:

```
useNewLogEntries(sessionId, (entry) => { /* nameplate-level animations */ });
usePrevValueDiffs(participants, zombies, (delta) => { /* per-target flashes */ });
```

`useNewLogEntries` keeps a ref of the highest-seen `defensiveBattleLog.id` per session and processes only entries with `id > lastSeenId`. On mount, prime the ref to the current max so initial subscription doesn't replay every prior event as a "new" animation.

### Animations

1. **Actor played a card**: on every new `actionResolved` log entry, find the participant card matching `actorUsername` and:
   - Bump its `<Wiggle>` trigger.
   - Bump its `<FlashOverlay color={COLOR_PLAY}>` trigger.
2. **Damage to a participant** (red flash): when a `defensiveBattleParticipant.currentHp` drops, flash that participant's card red. The actor's "self-damage tick" (HP loss equal to live zombie count) is also a damage event from the player's own perspective and should flash red on themselves — this means the actor's card sees a green-then-red sequence (played → took self-damage). That's accurate to the game mechanic and reads well.
3. **Heal to a participant** (vibrant green flash): when `currentHp` rises (or `isDefeated` flips false from true on revive), flash with `COLOR_HEAL_VIBRANT`. Use the *brighter* heal green vs. the actor-played green so an actor healing themselves sees both shades.
4. **Ward / shield** (blue flash): when `wardCount` rises, flash the participant's card blue with `COLOR_SHIELD`.
5. **Zombie damage flash**: when a `defensiveBattleZombie.currentHp` drops, flash the zombie tile with `COLOR_DAMAGE` using `fillMode: 'border'` (zombie tiles are small and dense; a tint flash is too noisy).
6. **Zombie death shrink**: when `isDead` flips true, hold the zombie tile and animate it 1.0 → 0.0 scale + fade over `SHRINK_OUT_MS`, then let the row's existing dimmed-state styling take over once animation ends.
7. **HP bars become `<LaggingHpBar>`**: in both `ParticipantCard` and `ZombieCard`, replace the inline `<View className="h-2 bg-emerald-500" />` markup with `<LaggingHpBar>`. This is technically already covered by the Primitives spec's mechanical relocation — this spec is the surface that uses the lag effect for real.
8. **Existing `DamagePop` keeps firing**: the floating damage number is still shown on every HP change via the relocated primitive. It complements the flash, doesn't replace it.

### Layout adjustments

- `ParticipantCard` already exists as its own component — wrap its outer `SafePressable` (or the rounded card body inside) with `<Wiggle>` and a `<FlashOverlay>`. Keep `position: 'relative'` on the inner card.
- `ZombieCard` likewise.
- The flash overlays are mounted unconditionally (one per element) — they're invisible unless their trigger is bumped, so this isn't a perf concern.

### Existing animations to preserve

Defensive Battle ships several animations today that are NOT touched by this work and must keep functioning after the refactor:

- `BattleEndedOverlay` — the post-battle fade overlay. Untouched.
- `CardPreviewPanel` — the spring-open card preview above the hand strip. Untouched.
- The relocated `<DamagePop>` — keeps firing on every HP change, complementing the new flashes. The application code only changes the import path; behavior is identical.
- `BattleLogDrawer` and `BattleChatDrawer` — the textual log and chat drawers are unrelated to visual feedback and are not changed by this spec.

Card Duel ships no animations today, so there's nothing to preserve there.

### Backend (no changes required for v1)

The existing `defensive_battle_log` rows + state subscriptions cover all v1 needs. If a future polish pass wants log-driven heal/ward feedback (with explicit amounts), extend `logEvent` calls in `battle.ts` around the `healAmount`, `healFull`, and `ward` branches to emit per-target rows. **That work is explicitly deferred.**

### Verification (Defensive Battle)

1. **Solo battle**: play a damage card on a zombie. Your nameplate wiggles + green-flashes; the targeted zombie border-flashes red and HP lags down; on the same beat, your card red-flashes from self-damage and your HP lags down.
2. **Co-op battle, party heal**: a teammate plays a heal-all card. Their nameplate wiggles + green-flashes on your screen. Every party card (including yours) flashes vibrant-green and HP lerps up. Their own card sees green (played) then vibrant-green (healed) — both flashes are visible.
3. **Ward play**: a teammate wards the party. Their nameplate flashes green; every party card flashes blue. Your `wardCount` ticker increments.
4. **Card kill**: the last zombie in a wave dies. The zombie tile shrinks out and disappears. The next wave spawns in (the fade-in is already covered by RN's mount, no extra animation needed).
5. **Player defeated**: a player drops to 0 HP. Their card red-flashes, HP lags to 0, and the existing "Defeated" badge appears. No further animations fire on that card after defeat (their HP doesn't change again).
6. **Idle baseline**: with no actions firing, no flashes or wiggles trigger. The screen is fully still.
7. **Spectator**: a defeated player watches the rest of the team play. They still see all teammates' nameplate wiggles and target flashes. No actions are theirs, so no flashes ever land on their own card.

## Files to modify

- `src/components/minigames/CardDuelView.tsx` — diff-tracked refs for prev card HP / prev card ids / prev player HP; per-slot `<FlashOverlay>`; `removingCards` state with shrink-out animation; `<Wiggle>` on opponent header row; `<LaggingHpBar>` for both players.
- `src/components/DefensiveBattleScreen.tsx` — log subscription + new-entries diff hook; participant + zombie state-diff hook; `<Wiggle>` + `<FlashOverlay>` wrapping `ParticipantCard` and `ZombieCard`; zombie shrink-out animation; `<LaggingHpBar>` already pulled in from the Primitives spec — the application here is the trigger wiring.

No backend changes for v1.

## Risks

1. **State-diff misses for "damage + heal in same tick"**: explicitly accepted as a v1 trade-off (see "Trigger model" above). Watch reports; promote to log-driven if it shows up.
2. **Log replay on initial subscription**: `myDefensiveBattleLog` may deliver historical rows when the client resubscribes after a reconnect. The "prime `lastSeenId` on mount" approach prevents replay, but if the client mounts mid-battle (player joined late or reloaded), the prior rows shouldn't animate. Confirm during testing that a page-reload mid-battle doesn't burst-fire dozens of nameplate wiggles.
3. **Card Duel slot flash anchor**: each slot is a `SafePressable` with `flex-1`. Confirm that an absolutely-positioned `<FlashOverlay>` inside it doesn't break the press-target hit area — `pointerEvents="none"` on the overlay is mandatory.
4. **Animation pile-up on AoE heal-all in a 4-person party**: 4 simultaneous flashes + 4 simultaneous HP lerps + 4 `DamagePop`s. Profile on web and a low-end mobile target. If it stutters, the cheapest mitigation is to drop the `DamagePop` for healFull (the popup is more honest there anyway) and keep the flashes.
5. **Zombie shrink-out + new-wave spawn collision**: the last zombie's shrink animation runs while the next wave is being inserted. Both groups will be on screen for ~240ms. Fine in practice — the dying zombie's tile is dimmed and shrinking, the new wave is full-color and full-size, and no slot conflict is possible because they have different ids.
6. **Self-damage tick reads as a "second event"**: when an actor plays a damage card, they get a green-flash (played) immediately followed by a red-flash (self-damage). This is accurate but might feel like the game punished them. Verify the order is right (green first, then red ~80–150ms later) so the causality is clear; if it feels off, hold the green flash until the red has finished. Decide on visual playtest.
