# Cycling Deck

## Context

Today the Defensive Battle hand is a slot machine. The loadout sets the *probabilities* of what your hand contains; each `playAction` call replaces the played hand position via `drawActionForUsername`, which picks a random slot from your loadout. Across a battle the player has zero foresight — they react to whatever surfaces, can't plan two-card combos (Pierce → Strike on an Armored, Ward → Strike before a high-tick turn), and AoE wins by default because "do something to everything" is the safest play under uncertainty.

This spec replaces the random refill with a **cycling deck**:

- The loadout is snapshotted at battle start, in slot order, as the player's deck.
- The hand is the top-N of the deck (N from the existing `handSizeFromFocus`).
- Played cards rotate to the back of the deck.
- The full deck order is visible to the player at all times.

The mechanical change is small (one random draw call replaced by a sequential cycle); the experiential change is large (planning, sequencing, and scarcity all become legible).

Builds on: the recent zombie-kind work (Armored, Juggernaut) and Pierce-as-armor-pierce. Independent from but reinforces **Zombie Threat Values** — the two specs can ship in either order.

## Goals

- Player can see the full deck order at any time.
- Played cards predictably move to the back of the deck.
- Loadout slot order becomes a meaningful design decision, not a UI detail.
- Combo plays (Pierce → Strike, Ward → high-impact turn) become executable when planned, not lottery moments.

Non-goals:

- Mid-battle deck manipulation (mulligan, scry, peek-and-rearrange) — future polish lever.
- Multiple copies of the same action in a loadout influencing draw weight — already supported; this spec just makes the consequence visible.
- Per-wave shuffles or reshuffles. The deck cycles continuously through the entire battle.
- New cards, new stat scaling, new resources.

## Preliminary decisions (resolve before implementation)

1. **Initial deck order = literal loadout slot order. No shuffle.** Maximum agency: the player engineers the opener. Counter-argument: pure determinism could feel sterile run-to-run. We accept that trade because (a) wave composition and HP rolls already supply variance, and (b) deck-building IS the new player decision we want to surface. If playtest reveals openers feel rigid, an opt-in "Shuffle on start" loadout flag is a future polish lever.

2. **Hand = top `handSize` cards.** `handSizeFromFocus(focus)` (3..5) is unchanged. The hand is no longer "N random slots" — it's "the next N cards in the queue."

3. **Player can play any card in the hand, not just the top.** Preserves the current hand-tap freedom. Pick `handIndex` (0..handSize-1) of the visible hand; that card resolves; that card's deck order is bumped to `max+1` so it cycles to the very back.

4. **Empty loadout slots are skipped.** Deck size = number of populated loadout slots. A player who fills only slots 0, 2, 4 has a 3-card deck. Effective hand size = `min(handSize, deckSize)`.

5. **The deck is immutable for the duration of the battle.** Loadout edits made mid-battle (if the UI even allows it) do not affect the live deck. Snapshot at battle start; never mutate the card identities.

6. **Defeat preserves deck position.** A revived player resumes from where they left off. The deck is per-player; no shared queue in co-op.

7. **Full deck order is visible.** The hand strip shows all deck cards in order; the first `handSize` are bright/tappable, the rest dimmed and inert. This is the visibility upgrade that makes the new mechanic *feel* like a planning surface — without it, the change is invisible to the player.

## Schema

Replace `defensive_battle_hand_slot` with a more general `defensive_battle_deck_card`:

```typescript
export const defensiveBattleDeckCard = table(
  {
    name: 'defensive_battle_deck_card',
    indexes: [
      {
        accessor: 'defensive_battle_deck_card_session',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    deckOrder: t.u32(), // lower = closer to top of hand; played card gets max+1
    actionId: t.string(),
  }
);
```

`handIndex` is no longer a stored column — the hand is *derived* by sorting the player's deck cards by `deckOrder` ascending and taking the first `handSize`.

`deckOrder` is a monotonic counter per (sessionId, username). Initial values: loadout slot 0 → deckOrder 0, slot 1 → 1, ..., slot 5 → 5 (skipping empty slots). On play, the resolved card's new `deckOrder` = `max(deckOrder for this player) + 1`.

Migration: this is a breaking change — `defensive_battle_hand_slot` is removed and replaced. Hand-slot rows only exist during in-progress battles, so the impact is bounded. Same migration shape as the recent zombie-kind addition: drop the table, accept that any in-flight battle's hand state is lost. Players can vote-cancel any active battle pre-publish.

## Reducer changes

`startBattle` (in `battle.ts`):
- Replace the hand-slot insertion loop with a deck-card insertion loop.
- For each player, snapshot the loadout ordered by `slotIndex` ascending. Insert one `defensiveBattleDeckCard` row per populated slot, with `deckOrder` matching `slotIndex` (skipping empty slots; consecutive `deckOrder` values are not required, only the relative order matters).

`playAction` (in `battle.ts`):
- The `handIndex` parameter still comes from the client (0..handSize-1 of the visible hand).
- Server interpretation: fetch all deck cards for the player, sort by `deckOrder` ascending; the visible hand is the first `handSize` rows. The clicked card is at position `handIndex` in that sorted list.
- Resolve the card's effect (no change to effect resolution logic).
- After resolution: compute `newDeckOrder = max(deckOrder for this player) + 1` and update the played card's row. The card now sits at the back of the deck.

Remove the `drawActionForUsername` and `refillHand` helpers — no longer used.

## View changes

`myDefensiveBattleHand` returned hand_slot rows for the calling player. New behavior: returns deck_card rows for the calling player, ordered by `deckOrder` ascending. The view exposes **all** of the player's deck (not just the top `handSize`) so the client can render the full queue. Hand-vs-queue is a client-side concern — the server hands back the ordered deck; the client splits at `handSize`.

```typescript
export const myDefensiveBattleHand = spacetimedb.view(
  { name: 'my_defensive_battle_hand', public: true },
  t.array(defensiveBattleDeckCard.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const found = findActiveBattleForUser(ctx, s.username);
    if (!found) return [];
    return [...ctx.db.defensiveBattleDeckCard
      .defensive_battle_deck_card_session
      .filter(found.session.sessionId)]
      .filter(c => c.username === s.username)
      .sort((a, b) => a.deckOrder - b.deckOrder);
  }
);
```

## Client changes

`DefensiveBattleScreen.tsx` — hand strip rework:

Today the strip iterates `myDefensiveBattleHand` rows ordered by `handIndex` and renders each as a tappable card. New: same iteration, but the strip renders **all** deck rows. The first `handSize` are full-size and tappable; the remaining are smaller (or shown at lower opacity) and inert. A subtle vertical separator between hand and queue makes the boundary readable.

Pseudocode:

```tsx
const handSize = me.handSize;
const deck = sortedDeckCards;
return (
  <View className="flex-row gap-1 items-end">
    {deck.map((card, idx) => {
      const isInHand = idx < handSize;
      return (
        <HandCard
          key={card.id.toString()}
          actionId={card.actionId}
          dimmed={!isInHand}
          compact={!isInHand}
          onPress={isInHand ? () => onTap(idx) : undefined}
        />
      );
    })}
  </View>
);
```

Targeting flow: when the player taps a hand card (`idx < handSize`), the existing target-selection flow runs. On confirm, `playAction({ sessionId, handIndex: idx, targetKind, targetId })` is called. `handIndex` semantics from the client's perspective are unchanged.

## Animation

When a card is played, animate it sliding to the rightmost (back) position over ~280ms while the other cards shift one slot to the left. Reuses the existing `Animated.Value` infrastructure; each card's position is computed from its index in the sorted deck array.

A simpler v1 if the animation is fiddly: just re-render the new order. The data flow is correct without animation; this is polish on top.

## Emergent design

These fall out for free once the deck is visible:

1. **Combo execution becomes intentional.** "Pierce → Strike" on an Armored stops being a coincidence. Players who want it just front-load Pierce in their loadout. Today these combos are theoretical; tomorrow they're playable.

2. **Loadout slot order is a meaningful decision.** Front-load damage (strong opener), back-load support (Ward/Revive lurking for the late wave), or alternate types for predictable rotation. The 6-slot loadout becomes a 6-card deck-build without any new tables, costs, or mechanics.

3. **Card scarcity is legible.** With random refill, "I have one Revive in my loadout" meant "I have a 1/6 chance per refill." With cycling, "I have one Revive" means "Revive comes up exactly every 6 plays." Players plan around it instead of praying.

4. **Pierce gets its full payoff.** Pierce-vs-Armored is a setpiece play — but its value depends on Pierce being available when an Armored is alive. Random refill makes that a lottery; cycling makes it a sequencing decision. The recently-shipped armor-pierce mechanic suddenly feels strategic.

5. **AoE loses its default-pick crown.** When you can't predict the next card, AoE wins by being safest. When you can, single-target plays *targeted at the right zombie* deliver more output per cast. The dominance now shifts depending on wave composition rather than always favoring AoE.

6. **Defeated-player engagement is preserved.** A defeated player watching the team can still see their own deck order — they can plan their revive turn or coach teammates with concrete info ("I've got Pierce in 3"). The dead-time isn't dead anymore.

7. **Loadout UI gains tutorial pressure for depth.** New players will start asking "what should be at slot 0?" — that's a great question to invite. The loadout screen may want to surface "Your opener: Strike → Volley → Pierce" as a preview. Out of scope for this spec but a natural follow-up.

## Risks

1. **Bad opener locks the run.** If the player's first 3 cards are all heals against an enemy-only wave, they're stuck. Mitigation: the deck IS the loadout, and the player builds the loadout — this is a player-skill issue, not a design flaw. Tutorial should call out the opener concept.

2. **Removes the slot-machine fun.** Some players enjoy "what'll I get?" — the deck cycle is deterministic. Mitigation: wave composition (kinds, HP rolls, counts) still varies between battles, providing the variance. If playtest reveals players miss the chaotic feel, a future "Reshuffle on wave clear" toggle is one minimal lever.

3. **Visual real estate for the queue.** Showing 6 cards horizontally on a phone-width screen requires careful sizing. Mitigation: hand cards are full-size, queue cards are smaller (~60%) and dimmed. On very narrow screens, the strip scrolls horizontally.

4. **Migration nukes in-progress battles.** Schema change drops `defensive_battle_hand_slot`. Active battles will lose their hand state. Acceptable — the prior zombie migration set the precedent.

5. **Loadout edits during a battle.** If the existing UI lets a player change loadout mid-battle, the snapshot model means those changes won't apply until next battle. Verify the UI conveys this; if it doesn't, disable loadout edits during an active battle.

## Files to modify

**Backend:**
- `spacetimedb/src/battle_tables.ts` — drop `defensiveBattleHandSlot`, add `defensiveBattleDeckCard`.
- `spacetimedb/src/battle.ts` — rewrite hand initialization in `startBattle`; rewrite `playAction` to use deck order; remove `drawActionForUsername` and `refillHand`; update `myDefensiveBattleHand` view to return ordered deck rows.
- `spacetimedb/src/schema.ts` — register the new table; deregister the old one.

**Client:**
- `src/components/DefensiveBattleScreen.tsx` — hand strip renders all deck rows ordered by `deckOrder`, splits at `handSize` for hand vs queue. Optional: played-card slide-to-back animation.
- Bindings regenerate automatically via `spacetime generate`.

## Verification

1. **Battle start, slot 0 = Strike, 1 = Volley, 2 = Pierce, slots 3–5 empty.** Deck = [Strike, Volley, Pierce]. With focus 0 (handSize 3), the entire deck is the hand; no queue cards visible.

2. **Play Strike.** Strike's `deckOrder` bumps to max+1. Hand reorders to [Volley, Pierce, Strike]. Volley is now top; Strike is at the back.

3. **Loadout with 6 slots filled, focus 0 (handSize 3).** Hand shows top 3 cards bright; queue shows next 3 dimmed. Play any card; that card rotates to the back; hand and queue shift accordingly.

4. **Play card #2 from a hand of 3.** That card (not the top) cycles to the back. Remaining hand becomes [card1, card3]; the next queue card moves into hand position 2.

5. **Defeat and revive mid-battle.** A defeated player's deck position is unchanged when revived; their next play resumes from where they left off.

6. **Combo execution check.** Build loadout [Pierce, Strike, Volley, Volley, Volley, Ward]. Confirm that against a wave with one Armored, the player can naturally Pierce → Strike to dispatch it on the first two plays.

7. **AoE planning check.** Build [Volley, Volley, Strike, Strike, Pierce, Ward]. Verify the player can predict the rotation and plan around it.

8. **Multi-player co-op.** Two players in a session each have their own deck. Player A's plays advance only Player A's deck. Both players see only their own deck order via `myDefensiveBattleHand`.
