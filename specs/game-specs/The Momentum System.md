# The Momentum System

## Overview

Momentum is a per-battle, per-player tactical resource that gates a new tier of
high-impact "finisher" actions in Defensive Battle. Today every action in the
game is free to play (subject only to the self-damage tick). This makes
high-power effects either too cheap (so they crowd the loadout) or too weak (so
they're never picked). Momentum introduces a second cost axis — distinct from
the self-damage tax — so the most dramatic actions are gated by tactical
build-up rather than raw stat investment.

Momentum is generated through play (killing blows, post-cast luck, class hooks)
and spent on Momentum-cost actions ("finishers"). Each class gets a distinct
generation flavor that aligns with its identity, plus optional cap-raising
nodes that let dedicated builds stockpile larger pools.

This spec replaces nothing — it extends the **Defensive Battle**, **Defensive
Battle Action System**, and **Class Skill Trees** specs additively.

Depends on:
- **The Defensive Battle** (sessions, participants, hand slots, log)
- **Defensive Battle Action System** (`action_definition`, `resolveAction`)
- **Class Skill Trees** (Brute / Generalist / Striker / Wanderer trees, single-class lock)
- **Card Combat Feedback** (the visual primitives for flashing the Momentum pip on gain)

## User Story

A Striker is two waves into a defensive battle with their party. Their
loadout includes a new Momentum-cost finisher: **Execute** (cost 2 Momentum,
deals 12 damage, single target). The card sits greyed-out in their hand
because they've only got 1 Momentum so far — earned by clearing the last basic
zombie of wave 1.

Wave 3 spawns a Juggernaut. Their party Brute opens by tanking a couple of
hits, ticking up their cumulative-damage counter. The Brute uses their own new
finisher, **Defiant Roar** (cost 1 Momentum, party gains 2 ward each). Now the
party can lean in.

The Striker hits the Juggernaut for 36% of its max HP with a stat-buffed
Volley — the chunk threshold trips and they gain a Momentum pip (now 2).
Their **Execute** lights up. They drop it on the Juggernaut, finishing it,
and the killing blow itself yields another Momentum (now 1). They survive
the wave with a finisher in the chamber, ready for whatever wave 4 brings.

## Goals

- Add a discrete tactical resource (Momentum) per participant per battle, with
  a default cap of 3.
- Generate Momentum through four channels: killing blows, a post-play % chance,
  the (future) weak-spot system, and class-specific hooks.
- Spend Momentum on a new tier of higher-power "finisher" actions
  (`momentumCost` ≥ 1 on `action_definition`).
- Wire each class to a distinct generation flavor; add cap-raising nodes for
  Brute and Wanderer; add a starting-Momentum node for Generalist.
- Render Momentum as a public pip row above each player's hand and on each
  participant nameplate (party-visible).
- Backend-authoritative throughout — Momentum balance, generation, and spend
  all happen in the existing battle reducers.

## Non-goals

- The weak-spot system itself. This spec leaves a generation hook in place so
  weak-spot hits will yield Momentum once that system lands; it does not
  design or implement the weak-spot system.
- Re-tiering existing actions. All current actions stay free
  (`momentumCost: 0`); finishers are additive on top.
- Momentum persistence across battles, prestige, or as a meta-currency.
- Multi-class interactions. Classes are mutually exclusive (per the existing
  Class Skill Tree spec) so cross-class stacking concerns are out of scope.
- PvP CardDuel. CardDuel has its own mana and is unrelated; the word
  "Momentum" lives strictly inside Defensive Battle.

## Schema additions

### New column on `defensive_battle_participant`

```
momentumCurrent: u32   // 0..momentumCap; defaults 0 (or starting bonus on init)
momentumCap: u32       // computed at battle start from class/skills; default 3
damageTakenAccumulator: u32  // Brute-only counter; ticks toward next +1; resets on threshold cross
```

All three default to 0 (cap will be set explicitly during `startBattle`).
`damageTakenAccumulator` is only ever non-zero for Brutes; non-Brute participants
ignore it. We carry it on every participant row regardless to keep the schema
uniform — there's no benefit to a side table for a single u32.

### New column on `action_definition`

```
momentumCost: u32   // default 0; > 0 marks a finisher
```

All existing `action_definition` rows default to 0. New finisher rows ship
with `momentumCost ≥ 1`.

### New event kinds on `defensive_battle_log.eventKind`

Extend the existing tagged union with:
- `momentumGained` — payload: `{ source: 'killingBlow' | 'postPlayChance' | 'classHook' | 'weakSpot', delta: u32, total: u32 }`
- `momentumSpent` — payload: `{ actionId: string, cost: u32, total: u32 }`

These are visible on the existing `myDefensiveBattleLog` view. The client uses
them to drive a flash animation on the pip row (per Card Combat Feedback's
primitives).

### No new tables

Momentum is a per-participant scalar plus a per-action scalar. A dedicated
table would be overkill and would force extra subscriptions for what amounts
to two ints.

## Generation rules

All generation flows through a single internal helper:

```typescript
// In battle.ts
function gainMomentum(
  ctx, sessionId, username,
  delta: number,
  source: 'killingBlow' | 'postPlayChance' | 'classHook' | 'weakSpot'
): void {
  // 1. Look up participant.
  // 2. newTotal = min(participant.momentumCap, momentumCurrent + delta)
  // 3. If newTotal > momentumCurrent, update + log `momentumGained` with the
  //    actual applied delta (might be < requested if capping).
  // 4. If capped (delta requested > delta applied), do NOT log overflow.
}
```

### Default rules (apply to every class)

1. **Killing blow** — at the end of `resolveAction`, if any zombies died as a
   direct result of this card's damage application, call `gainMomentum(+1,
   'killingBlow')`. This is **+1 per card play that secured at least one
   kill**, NOT +1 per killed zombie. AOE that wipes 5 zombies still grants 1.
2. **Post-play chance** — after every successful card play (any card,
   including free ones, including Momentum-cost ones), roll `ctx.random` once
   against a per-class `postPlayMomentumChance` (default 0.25). If hit, call
   `gainMomentum(+1, 'postPlayChance')`. Roll happens *after* the killing-blow
   gain so a card that killed a zombie can still also luck into a +1.
3. **Weak-spot hit** — placeholder hook. When the weak-spot system lands, the
   damage-application path will gain a `weakSpotsHit: number` count and call
   `gainMomentum(weakSpotsHit, 'weakSpot')` per hit. This spec just guarantees
   the helper signature accommodates it.

### Class-specific rules

Each class has a small profile object stored in code (not a table — it's
static per class, like the existing class identity data):

```typescript
interface MomentumProfile {
  defaultCap: number;            // base cap before skill tree raises
  startingMomentum: number;      // value at battle start before skill nodes
  postPlayChance: number;        // override of the default 0.25
  brutDamageThreshold?: number;  // only set for Brute
  strikerThresholdPct?: number;  // only set for Striker, e.g. 0.33
}
```

Per-class values:

| Class      | Cap | Start | postPlay% | Damage threshold | Striker chunk % |
|------------|-----|-------|-----------|------------------|-----------------|
| Brute      | 3   | 0     | 25%       | 25 damage taken  | n/a             |
| Generalist | 3   | 0     | 25%       | n/a              | n/a             |
| Striker    | 3   | 0     | 25%       | n/a              | 33%             |
| Wanderer   | 3   | 0     | 50%       | n/a              | n/a             |

Generalist's "start with Momentum" and the Brute/Wanderer cap raises are
**skill-tree nodes** — the base profile is the unmodified starting point.

#### Brute — sustain damage

In the participant damage-application path (the self-damage tick AND any
future zombie-attack path), when a Brute's `currentHp` decreases by `delta`:

```
participant.damageTakenAccumulator += delta
while (participant.damageTakenAccumulator >= 25):
  participant.damageTakenAccumulator -= 25
  gainMomentum(+1, 'classHook')
```

The accumulator only counts **damage that actually landed** — wards absorbing
a hit do not contribute (you weren't tested by that damage). The accumulator
resets to 0 between battles (set explicitly in `startBattle`). The `while`
loop handles the rare case of a single huge hit ≥50 damage granting +2 in one
go.

#### Generalist — start with Momentum

Skill node: **Steady Hand** (one node, one rank, terminal-ish — does not
conflict with cap raises since Generalist doesn't have one). At battle start,
if the active class is Generalist and `Steady Hand` is purchased, set
`momentumCurrent = 1`.

#### Striker — high-HP-target chunk threshold

In `resolveAction`, when applying damage to a zombie:
```
if zombie.kind.tag matches 'juggernaut' (or any future kind in HIGH_HP_KINDS)
   AND damageDealtToThisZombie >= ceil(zombie.maxHp * 0.33):
  gainMomentum(+1, 'classHook')   // counted ONCE per card play, even if the
                                  // card hits two juggernauts and crosses
                                  // the threshold on both
```

Implementation detail: track a `strikerThresholdTriggeredThisCard: bool` flag
during the damage loop; flip it true after the first qualifying hit and skip
further checks for this resolution. This keeps the gain rate sane for a
hypothetical multi-juggernaut wave.

`HIGH_HP_KINDS` is a small in-code constant: `['juggernaut']` for v1, easily
extended when boss-class waves arrive.

#### Wanderer — higher post-play %

Wanderer's `postPlayMomentumChance` is **0.50**. Single point of difference;
no other behavior change. The class still gets killing-blow Momentum on the
default rule. No new accumulator, no threshold logic.

## Cap and starting-Momentum skill-tree nodes

These are added to the existing class trees. Position and tier follow the
existing tree topology — exact node coordinates left to implementation; this
spec defines the effects.

### Brute tree — `brute_iron_lung`

- Name: **Iron Lung**
- Description: "Your Momentum cap is increased by 1."
- Effect: At battle start, Brute's `momentumCap` becomes `4` instead of `3`.
- Tier: Intermediate. Single rank.
- Cost: standard for the tier (per existing tree economy).

### Wanderer tree — `wanderer_loose_change`

- Name: **Loose Change**
- Description: "Your Momentum cap is increased by 1."
- Effect: At battle start, Wanderer's `momentumCap` becomes `4` instead of `3`.
- Tier: Intermediate. Single rank.

### Generalist tree — `generalist_steady_hand`

- Name: **Steady Hand**
- Description: "Begin each defensive battle with 1 Momentum."
- Effect: At battle start, set Generalist's `momentumCurrent = 1`.
- Tier: Intermediate. Single rank.

### Striker — no new node in this spec

Striker's class hook (the chunk-threshold gain) is already a powerful
generation source; no cap raise or starting-Momentum node is added here.
The Striker tree may add finisher-affinity nodes in a follow-up spec.

## Spending: cost-gating in `resolveAction`

In `resolveAction`, after looking up the action definition and **before**
applying any effects:

```
const cost = actionDef.momentumCost;  // 0 for legacy free actions
if (cost > 0):
  if (participant.momentumCurrent < cost):
    throw new SenderError('Not enough Momentum');
  participant.momentumCurrent -= cost;
  log `momentumSpent` event with { actionId, cost, total: newTotal }
```

The deduction happens before effect resolution so a card that crashes mid-
resolution doesn't refund Momentum (this matches how mana works in CardDuel —
once committed, it's gone). The `Not enough Momentum` validation is also
echoed client-side for grey-out (see UI section), but the server check is the
authoritative gate.

### Drawing a Momentum-cost card you can't afford

The hand-draw logic does not filter by affordability. A finisher you can't
afford simply sits in a hand slot, greyed out, and the player makes a real
strategic tradeoff: they have one fewer playable slot until they earn enough
Momentum. This is identical to how mana works in CardDuel. No auto-discard,
no auto-redraw, no degraded-effect fallback.

## New finisher actions (v1 ship list)

This section seeds 7 new `action_definition` rows, mixing universal finishers
and class-themed ones. Names, numbers, and descriptions are starting points
for tuning; the schema and behavior are the contract.

### Universal finishers

#### `execute` — cost 2

- Display: **Execute**
- Description: "Single zombie takes 12 damage."
- Targeting: `singleEnemy`
- Effect: `damage { baseMin: 12, baseMax: 12 }`
- Stat scaling: `addToBoth(power, +1 per point)` — same scaling pattern as Strike.
- Use case: dependable Juggernaut-killer for Strikers and any party member
  who lucks into the Momentum.

#### `decimate` — cost 2

- Display: **Decimate**
- Description: "All zombies take 5 damage."
- Targeting: `allEnemies`
- Effect: `damage { baseMin: 5, baseMax: 5 }`
- Stat scaling: `addToBoth(power, +1 per 2 points)` — half-rate scaling
  reflects AOE ceiling.
- Use case: wave-clear pivot; a single Decimate on a fresh wave often
  triggers a +1 from killing blow + the post-play roll.

#### `iron_will` — cost 1

- Display: **Iron Will**
- Description: "Party gains 2 wards each."
- Targeting: `partyIncludingSelf`
- Effect: `ward { baseCount: 2 }`
- Stat scaling: `addToCount(vigor, +1 per 4 points)`.
- Use case: cheap defensive finisher; keeps cap-3 builds churning.

#### `last_stand` — cost 3

- Display: **Last Stand**
- Description: "Restore yourself to full HP and gain 3 wards."
- Targeting: `singleAlly` (self-castable)
- Effect: `healFull` PLUS `ward { baseCount: 3 }` (combined effect — see
  schema note below).
- Use case: at-cap panic button; explicitly the most expensive finisher.

> **Schema note:** `ActionEffect` is currently a tagged union with one variant
> per effect type, so `last_stand` can't combine `healFull + ward` without
> extending the enum. The spec calls this out explicitly: a new variant
> `healAndWard: { wardCount: u32 }` should be added to `ActionEffect`, and
> `resolveAction` updated to handle it. If extending the enum is too much
> scope for this spec, drop `last_stand` to v1.1 and ship the other 6 actions.

### Class-themed finishers (granted via class capstone or signature node)

#### `juggernaut_breaker` — cost 1 — Striker signature

- Display: **Juggernaut Breaker**
- Description: "Single zombie takes 8 damage. Bonus +6 damage if it's a
  Juggernaut."
- Targeting: `singleEnemy`
- Effect: `damage { baseMin: 8, baseMax: 8 }` + a Striker-only post-resolve
  hook in `resolveAction` that adds +6 if the target is a Juggernaut.

> **Schema note:** the bonus-vs-kind rule needs either (a) a new effect
> variant or (b) a hardcoded actionId branch in `resolveAction`. Option (b)
> is cheaper and acceptable for v1 since this is class-signature content.

#### `defiant_roar` — cost 1 — Brute signature

- Display: **Defiant Roar**
- Description: "Party gains 2 wards each AND draws a fresh hand."
- Targeting: `partyIncludingSelf`
- Effect: `ward { baseCount: 2 }` + a Brute-only post-resolve hook that
  re-rolls every party member's `defensive_battle_hand_slot` from their
  loadout (replacing each `actionId`).

> **Schema note:** "redraw the party hand" is a non-trivial side effect that
> doesn't map to any existing `ActionEffect` variant. Same options as
> `juggernaut_breaker`: hardcode an actionId branch in `resolveAction`. v1
> approach: hardcode.

#### `lucky_break` — cost 0 — Wanderer signature (special case)

- Display: **Lucky Break**
- Description: "Single zombie takes 4 damage. 50% chance to gain +1 Momentum
  on play (in addition to your normal post-play roll)."
- Targeting: `singleEnemy`
- Effect: `damage { baseMin: 4, baseMax: 4 }` + an actionId-specific hook in
  `resolveAction` that rolls a *second* 50% Momentum chance after the
  standard post-play roll.

> Note: cost 0 is intentional — it's a Wanderer signature that *generates*
> Momentum rather than spending it. Granting this card via a Wanderer
> capstone gives the class an identity-coherent Momentum-pumping tool.

### Granting finishers

Finishers enter a player's `playerKnownAction` pool the same way other
actions do — via skill tree node grants. Universal finishers (`execute`,
`decimate`, `iron_will`, `last_stand`) are **earned via a new shared
"Finisher Mastery" node line** at the cross-tree intermediate tier (one node
per finisher; pick which to invest in). Class-signature finishers are
granted by the corresponding class capstone or signature node:
- `juggernaut_breaker` → Striker capstone
- `defiant_roar` → Brute capstone
- `lucky_break` → Wanderer capstone

The exact tree topology for the four universal finisher nodes is left to the
implementation pass; this spec scopes their effect content, not their place
in the graph.

## `startBattle` integration

In the existing `startBattle` helper (per The Defensive Battle spec):

After the per-participant maxHp / handSize / loadout logic, add a Momentum
init step:

```
const profile = momentumProfileFor(participant.activeClass);
let cap = profile.defaultCap;
let starting = profile.startingMomentum;

if (hasNode(participant, 'brute_iron_lung'))     cap += 1;
if (hasNode(participant, 'wanderer_loose_change')) cap += 1;
if (hasNode(participant, 'generalist_steady_hand')) starting += 1;

ctx.db.defensiveBattleParticipant.id.update({
  ...participant,
  momentumCap: cap,
  momentumCurrent: Math.min(starting, cap),
  damageTakenAccumulator: 0,
});
```

`momentumProfileFor(activeClass)` returns the static profile by class. The
`hasNode` helper already exists in the class/skill_tree code path — reuse it.

## UI

### Pip row above player's own hand

In `DefensiveBattleScreen.tsx`, above the hand strip, render a row of
`participant.momentumCap` pips. Each pip is:
- Lit (gold/amber) if its index `< momentumCurrent`.
- Unlit (grey ring) otherwise.

Pip count adjusts at battle start based on cap; never changes mid-battle. The
row sits just above the hand cards so it's read together with the hand for
play-decision context.

### Pip indicator on participant nameplate

On every participant card (yours and teammates'), render a tiny pip row
under the HP bar. Same lit/unlit visual, scaled smaller. This keeps the
party-coordination signal visible without forcing players to expand a
separate panel.

### Greyed-out finisher cards

A hand slot whose `actionDef.momentumCost > momentumCurrent`:
- Renders at 60% opacity.
- Is non-draggable / non-pressable.
- Tooltip / press-feedback: "Need N Momentum" (computed `cost - current`).

The drag handlers already gate on validity for `singleEnemy` / `singleAlly`
target requirements; this is one more gate in that same path.

### Animations on Momentum change

Per **Card Combat Feedback**: when a `momentumGained` log entry lands for a
participant, flash the pip row gold (per-pip stagger if `delta > 1`). When a
`momentumSpent` entry lands, the spent pips dim with a subtle shrink-out.
Both use the existing `<FlashOverlay>` and pip-component refs; no new
primitives.

## View / subscription notes

- `momentumCurrent` and `momentumCap` are columns on
  `defensive_battle_participant`, which is already streamed to all party
  members via the participant subscription. No new view needed for the
  party-visible pip data.
- `damageTakenAccumulator` is on the same row, which is fine — it's not
  hidden info, just uninteresting to non-Brutes.
- The new log event kinds (`momentumGained`, `momentumSpent`) flow through
  the existing `myDefensiveBattleLog` view; no new subscription needed for
  the animation triggers.
- `momentumCost` on `action_definition` is part of the public action catalog
  the client already subscribes to.

## Files to modify

### Backend

- `spacetimedb/src/battle_tables.ts` — extend
  `defensive_battle_participant` with `momentumCurrent`, `momentumCap`,
  `damageTakenAccumulator`. Extend `BattleLogEventKind` with `momentumGained`
  and `momentumSpent`.
- `spacetimedb/src/action_tables.ts` — extend `action_definition` with
  `momentumCost: u32`.
- `spacetimedb/src/battle.ts` — add `gainMomentum` helper, integrate into
  killing-blow path / post-play roll / Brute damage tick / Striker chunk
  threshold; gate `resolveAction` on `momentumCost`; init Momentum in
  `startBattle`; emit log events; hardcode signature-finisher branches.
- `spacetimedb/src/actions.ts` (or wherever `action_definition` is seeded) —
  insert the 7 new finisher rows with `momentumCost` set appropriately.
- `spacetimedb/src/class.ts` — add `brute_iron_lung`,
  `wanderer_loose_change`, `generalist_steady_hand` skill nodes; tie capstone
  grants for the three signature finishers; tie the universal finisher node
  line.
- `spacetimedb/src/index.ts` — only if new exported reducers are needed (none
  expected — Momentum gain/spend rides existing reducers).

### Frontend

- `src/components/DefensiveBattleScreen.tsx` — add the player's hand-row pip
  bar; render Momentum log events into the existing battle-log feed; pass
  Momentum state to `ParticipantCard` for nameplate pips.
- `src/components/battle/ParticipantCard.tsx` (if it exists; otherwise the
  participant card subcomponent inside DefensiveBattleScreen) — render the
  small nameplate pip row.
- A new `src/components/battle/MomentumPipRow.tsx` — shared pip component
  used by both hand-row and nameplate; takes `current`, `cap`, and a `size`
  prop (`'large' | 'small'`).
- The hand-card render path — apply the greyed-out / disabled-drag treatment
  when `momentumCost > momentumCurrent`.

### Bindings

- Regenerate via `spacetime generate` after the backend changes.

## Verification

1. **Generation — killing blow**: Strike clears the last 1-HP basic on wave
   1. Pip row goes from 0/3 to 1/3 with a gold flash. Log entry
   `momentumGained` with `source: killingBlow`.
2. **Generation — post-play chance, base case**: cast Strike with no kill,
   25% roll lands. 1/3 with gold flash. Same log kind, `source:
   postPlayChance`.
3. **Generation — post-play chance, Wanderer**: same as (2) but Wanderer
   class active. Empirically the trigger rate over 100 plays should be
   ~50%, not ~25%.
4. **Brute damage accumulator**: Brute takes 25 self-damage cumulatively
   over 5 turns (5 damage per turn). On the turn that crosses 25, Momentum
   ticks +1, accumulator resets to 0. Wards in between absorbing a hit
   should NOT contribute (verify by warding before a 5-damage hit, then
   confirming the accumulator did not advance).
5. **Brute big-hit overflow**: simulate a 60-damage hit on a Brute (likely
   only triggerable once zombies attack the actor directly — the spec
   today's self-damage hits topping out lower; this verification may need
   to wait for incoming-damage features). With accumulator at 0, the hit
   pushes it to 60 → loop fires +2 Momentum, accumulator settles at 10.
6. **Striker chunk threshold**: Strike a 30-HP Juggernaut for 12 damage
   (40%). Pip flashes, log entry `source: classHook`. Strike a 30-HP
   Juggernaut for 8 damage (26%) — no Momentum.
7. **Striker double-trigger guard**: a single AOE that hits two
   Juggernauts both for ≥33% of their max HP yields +1 (not +2). The
   `strikerThresholdTriggeredThisCard` flag should gate it.
8. **Striker non-target guard**: same AOE that crosses 33% on a *basic*
   zombie's HP yields no Momentum (basic isn't in `HIGH_HP_KINDS`).
9. **Generalist start**: enter battle as Generalist with `Steady Hand`
   purchased. Pip row reads 1/3 immediately. Without the node, 0/3.
10. **Cap raises**: enter battle as Brute with `Iron Lung` purchased. Pip
    row reads 0/4. Confirm the row visually has 4 pips.
11. **Spend gate — affordable**: cast Execute (cost 2) at 2/3 Momentum →
    succeeds, Momentum drops to 0/3, `momentumSpent` log. Effect resolves
    correctly (12 damage to single zombie).
12. **Spend gate — unaffordable**: try to drag Execute at 1/3 Momentum →
    card is greyed out, drag is rejected, no reducer call fires. Tooltip
    reads "Need 1 more Momentum."
13. **Spend gate — server authoritative**: bypass the client greyout (e.g.,
    via direct reducer call) at 0/3 Momentum → reducer throws `Not enough
    Momentum`, no state change.
14. **Cap behavior**: at 3/3 Momentum, score a killing blow → no log entry
    (no overflow logging), Momentum stays at 3/3. Same for 4/4 with cap
    raised.
15. **Carry across waves**: end wave 2 at 2/3 Momentum, wave 3 starts → pip
    row still reads 2/3.
16. **Reset across battles**: complete battle, return to The Wastes, start
    a new battle without `Steady Hand` → pip row 0/3. No leakage from the
    previous session.
17. **Party visibility**: teammate's pip row on their nameplate updates in
    real-time as they earn Momentum. Confirm no extra subscription is
    required (data rides on existing participant subscription).
18. **Animation on cap**: at 2/3, killing-blow grants +1 → flash on the
    third pip. At 3/3, killing-blow grants +0 → no flash, no log.
19. **Mid-battle reconnect**: disconnect and rejoin mid-battle. Pip row
    rehydrates to current Momentum without burst-firing every prior gain
    flash. (Same `lastSeenLogId` priming approach as Card Combat Feedback.)
20. **Decimate (cost 2 AOE) wave clear**: at 2/3 Momentum, Decimate kills
    the last 3 zombies of wave 2. Momentum: 2 → 0 (spend) → 1 (killing
    blow, single grant for the multi-kill) → possibly 2 if the post-play
    roll hits.

## Risks

1. **Momentum economy too generous**: with default 25% post-play + killing
   blows + class hooks, players may sit at cap permanently and finishers
   become free. Mitigation: the v1 numbers (cap 3, 25% post-play, +1 per
   card-with-kill) are intentionally on the conservative side; the chunk
   threshold and Brute accumulator are the only steady taps. Tune the
   `postPlayMomentumChance` constant first if economy is too loose.
2. **Momentum economy too stingy**: conversely, finishers might never go
   off in shorter battles (3-wave wipes). Mitigation: Generalist's "start
   with 1 Momentum" node + the relatively-low cap of 3 means even a
   conservative play cycle reaches a finisher within a wave. If too
   stingy, the lever to pull is the post-play chance (raise to 0.33).
3. **Brute accumulator interacts oddly with wards**: ward absorbs a hit →
   no damage applied → no accumulator gain. This is the correct behavior
   per spec but may feel like Brute's defensive nodes (wards) work against
   their offensive nodes (sustain-damage Momentum). Document in the node
   tooltip if confusion lands in playtest.
4. **Striker chunk threshold edge case**: a card that overkills a
   Juggernaut (deals 100 damage to a 30-HP target) trivially crosses 33%
   AND scores a killing blow. Both Momentum sources fire, granting +2 from
   one card. Intended — Striker's identity is "rewarded for big hits" — but
   confirm it doesn't accidentally let Striker spike from 0 to 3 from a
   single cast at high stats.
5. **`ActionEffect` enum extension for combo finishers**: `last_stand` and
   the redraw mechanic in `defiant_roar` push past the current effect
   variants. The spec offers two paths (extend enum vs. hardcode actionId
   branches). Hardcode is fine for v1 but creates a small pile of magic
   strings in `resolveAction` — clean up in a follow-up if more
   combo-effect finishers ship.
6. **Animation pile-up at cap**: killing-blow + post-play double-trigger at
   the same play resolution can flash two pips in close succession. The
   pip-row component should stagger the per-pip flash by ~80ms when
   `delta > 1`, same pattern Card Combat Feedback uses for staggered
   damage flashes.
7. **Skill node grant ordering at battle start**: cap raises and starting
   Momentum are read from skill tree state. If a player buys a node mid-
   battle (shouldn't be possible per location lock, but worth confirming),
   no recomputation happens — the snapshot at battle start is final, like
   stat snapshots. Document in implementation; do not re-read mid-battle.
8. **Single-class lock assumption**: the spec relies on the existing class
   exclusivity rule. If multi-class ever ships, every "if class is X" check
   in this spec needs to be revisited (probably as "if has node Y" instead).
   Marked here so the constraint is visible to future class-system work.
