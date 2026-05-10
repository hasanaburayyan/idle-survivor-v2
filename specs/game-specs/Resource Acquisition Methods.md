# Resource Acquisition Methods

## Overview

Establishes the acquisition method for each of the five non-Scrap resources. **Supersedes the acquisition portion of "The Resource Pools.md"** — the skill-tree progression and tier-unlock pattern from that spec is preserved, but the "click a button per resource" model is replaced with five differentiated methods that each introduce a distinct gameplay paradigm.

The intent: the player rotates between active and passive engagement modes as they progress, rather than amassing six near-identical click-buttons. Crafting feels different from refining feels different from cooking feels different from playing minigames.

Depends on: **The Shelter Refresh** (provides the floor plan, structure bar, and structure-page contract that all new structures plug into).

## Acquisition matrix

| Resource | Method | Surface | Key quirk |
|---|---|---|---|
| **Scrap** | Click | Scavenge button (existing) | Unchanged |
| **Parts** | Refining (passive timed) | **Refinery** structure | Single input; queue and wait |
| **Metal** | Smelting (passive timed) | **Smelter** structure | Multi-input recipe; queue and wait |
| **Fabric** | Instant crafting | **Workbench** recipe panel | No timer; spend ingredients, get output |
| **Food** | Trickle drop + multiplier | Scavenge (trickle) + **Garden/Kitchen** structure | Ripe / Stale timing window on harvest |
| **Medicine** | Minigame rewards | Existing **minigames** | Participation gradient |

The skill-tree gating from "The Resource Pools.md" is preserved: each resource is invisible until discovered, and discovery happens via skill nodes in the order Scrap → Parts → Metal → Fabric → Food → Medicine. When a tier is discovered, the corresponding structure (or Workbench recipe, or Scavenge trickle output, or minigame reward output) becomes available.

## Per-resource design

### Scrap — unchanged

Existing Scavenge button. No spec changes.

---

### Parts — The Refinery

A new structure constructable in The Shelter. After construction, the Refinery has one or more **slots**. Each slot accepts a refining job:

- Input: N Scrap (initial: 10).
- Time: T seconds (initial: 30).
- Output: 1 Part.

The player queues a job by clicking "Refine" with sufficient scrap. The slot enters Running. When the timer completes, the slot enters Output Ready — the player must visit the Refinery and click Collect to receive the Part. (Auto-collection is a future upgrade unlock.)

#### Tables

```ts
export const Refinery = table(
  { name: 'refinery', public: true,
    indexes: [{ name: 'refinery_owner_id', algorithm: 'btree', columns: ['ownerId'] }] },
  {
    id: t.u64().primaryKey().autoInc(),
    ownerId: t.identity(),
    slotCount: t.u8(),
    efficiencyLevel: t.u32(),
  }
);

export const RefineryJob = table(
  { name: 'refinery_job', public: true,
    indexes: [
      { name: 'refinery_job_refinery_id', algorithm: 'btree', columns: ['refineryId'] },
      { name: 'refinery_job_owner_id',    algorithm: 'btree', columns: ['ownerId'] },
    ] },
  {
    id: t.u64().primaryKey().autoInc(),
    refineryId: t.u64(),
    ownerId: t.identity(),
    slotIndex: t.u8(),
    startedAt: t.timestamp(),
    completesAt: t.timestamp(),
    collected: t.bool(),
  }
);
```

#### Reducers

- `start_refinery_job` — finds an empty slot, validates scrap balance, deducts scrap, inserts a `RefineryJob`.
- `collect_refinery_job({ jobId })` — validates `completesAt <= ctx.timestamp` and `!collected`, marks collected, grants 1 Part.
- `upgrade_refinery_efficiency` — increments `efficiencyLevel`, deducts upgrade cost. Each level reduces job time and/or improves yield (curve TBD).

#### Skill-tree integration

- "Discover Parts" → Refinery becomes constructable in The Shelter.
- "Refinery Slot Count +1" upgrade nodes (cap TBD).
- "Refinery Efficiency +20%" — multiple ranks, ratchets time and/or yield.

#### Page UI

Structure page lists each slot. Empty slots show a Refine button. Running slots show a progress bar with countdown. Output Ready slots show a glowing Collect button. Below the slot list: an upgrade region (slot count, efficiency).

---

### Metal — The Smelter

A second structure. Slot-based like the Refinery, but each slot accepts a multi-input job:

- Input: 5 Scrap + 2 Parts (initial).
- Time: 60 seconds (initial).
- Output: 1 Metal.

Same Running / Output Ready states. Player collects manually.

Tables and reducers parallel the Refinery (`smelter`, `smelter_job`, `start_smelter_job`, `collect_smelter_job`, `upgrade_smelter_efficiency`). Schema mirrors Refinery — only the input cost and time differ.

The Smelter's distinguishing trait vs the Refinery is the multi-input recipe. The page UI surfaces input requirements with current-balance indicators per ingredient and a Smelt button gated on having enough of each. This visual difference is what prevents the Smelter page from feeling like the Refinery page reskinned.

---

### Fabric — Workbench Instant Craft

No new structure. The Workbench page (existing) gains a **Recipes** region alongside its automation-slot region. The first recipe is **Craft Fabric**:

- Input: 5 Scrap + 2 Parts + 1 Metal (initial).
- Time: instant.
- Output: 1 Fabric.

Clicking the recipe button validates ingredients, deducts them, and grants 1 Fabric immediately. Batch button "x10" available — performs the same validation × 10, deducts × 10, grants × 10.

#### Tables

No new persistent tables. Fabric is a resource amount on the player's resource row (existing). Recipes themselves are static config defined in code (not a table) — keeps the Workbench page rendering off a known list.

#### Reducer

```ts
export const craft_fabric = spacetimedb.reducer({ batchSize: t.u8() }, (ctx, { batchSize }) => {
  // validate batchSize in [1, 10]
  // validate player has scrap, parts, metal × batchSize
  // deduct, grant batchSize fabric
});
```

#### Workbench page layout

Two regions on one page (no tabs, no popovers):

1. **Automation Slot region** — current behavior (slot, slotted activity, slot-related upgrades).
2. **Recipes region** — list of unlocked recipes with ingredient costs, current-balance indicators, and Craft / Craft x10 buttons.

If more recipes ever land on the Workbench (out of scope for this spec), they extend the Recipes list — same component contract.

The Recipes region must look intentional with only one recipe (Fabric) at launch — single-recipe layout should not look like a placeholder.

---

### Food — Scavenge Trickle + Garden/Kitchen Multiplier

Two pieces.

#### A — Scavenge trickle

When Food is discovered (via skill tree), the Scavenge reducer begins yielding a small, low-rate Food drop in addition to scrap. Initial: ~1% chance per Scavenge tick to yield 1 Food. This is a one-line addition to the existing Scavenge reducer, gated on the player having discovered Food.

RNG must be deterministic per the SpacetimeDB rules. Use a seeded value derived from `ctx.timestamp.microsSinceUnixEpoch ^ <hash of ctx.sender>`.

#### B — Garden / Kitchen multiplier

A new structure. Distinct from Refinery/Smelter in that it does not *create* Food from other inputs — it *multiplies* existing Food.

- Input: N Food (initial: 5).
- Time: T seconds (initial: 60).
- Output (default, "Stale"): 2 × N Food.
- Output (if collected within Ripe window): 3 × N Food.

The Ripe window opens when the timer completes and stays open for W seconds (initial: 30). If the player collects during the Ripe window, they get the bonus tier. If they collect later, they still get the Stale tier — no penalty for being away, just no bonus. **No spoilage.** The food is never lost; the question is only whether it's the bonus or baseline tier.

This intentionally rewards attention without punishing absence.

#### Tables

```ts
export const Garden = table(
  { name: 'garden', public: true,
    indexes: [{ name: 'garden_owner_id', algorithm: 'btree', columns: ['ownerId'] }] },
  {
    id: t.u64().primaryKey().autoInc(),
    ownerId: t.identity(),
    slotCount: t.u8(),
    efficiencyLevel: t.u32(),
  }
);

export const GardenJob = table(
  { name: 'garden_job', public: true,
    indexes: [
      { name: 'garden_job_garden_id', algorithm: 'btree', columns: ['gardenId'] },
      { name: 'garden_job_owner_id',  algorithm: 'btree', columns: ['ownerId'] },
    ] },
  {
    id: t.u64().primaryKey().autoInc(),
    gardenId: t.u64(),
    ownerId: t.identity(),
    slotIndex: t.u8(),
    inputAmount: t.u64(),
    completesAt: t.timestamp(),
    ripeWindowEndsAt: t.timestamp(),
    collected: t.bool(),
  }
);
```

#### Reducers

- `start_garden_job({ inputAmount })` — validates Food balance, deducts, inserts a `GardenJob` with `completesAt = now + duration` and `ripeWindowEndsAt = completesAt + ripeWindow`.
- `collect_garden_job({ jobId })` — if `ctx.timestamp <= ripeWindowEndsAt`: Ripe payout (3×). Else: Stale payout (2×). Marks collected, grants Food.
- `upgrade_garden_efficiency` — improves slot count, multiplier, and/or Ripe-window duration.

#### Page UI

Each slot shows its current state:

- **Running** — timer counting down.
- **Ripe** — timer hit zero, Ripe window open. Glow / needs-attention treatment, with a countdown to Stale. This is the most visually loud state in the game.
- **Stale** — Ripe window closed; still collectable for default payout.

The status badge on the floor plan and structure bar uses the **Needs-Attention** badge (vs Output-Ready) when any Garden slot is in the Ripe window — this is the most time-sensitive output state in the game and deserves the louder badge.

When all ripe windows have passed, badge falls back to Output-Ready (still has uncollected output, but not urgent).

A "Collect All" button collects every collectable slot in one click. Mixed state (some Ripe, some Stale) collects each at its own tier.

---

### Medicine — Minigame Rewards

No new structure. No new acquisition surface. Modify the three existing minigame handlers' `onEnd` functions to include Medicine in the per-player reward list.

#### Per-game payout (initial values, balance pass to follow)

- **CoinFlip** — every player who plays receives a flat +1 Medicine on game end (regardless of bet outcome). Net new Medicine generated per game: `playerCount × 1`. Why a flat payout instead of a pot mechanic: a pot funded by losers' antes redistributes Medicine but creates none, which would prevent solo play from generating any Medicine. The flat floor keeps CoinFlip useful as a Medicine-farming option for solo players.

- **RhythmTap** — scaled by hits. `medicineEarned = floor(hits / 10)`. A perfect chart of ~50 notes → 5 Medicine. Coop, so all participants earn based on their own hits.

- **CardDuel** — winner earns 2 Medicine, loser earns 1 Medicine. Forfeits/disconnects: surviving player gets 2, leaver gets 0.

#### Implementation

Extend the `Reward` union in `spacetimedb/src/minigames/registry.ts`:

```ts
export type Reward =
  | { kind: 'scrap'; amount: bigint }
  | { kind: 'xp'; amount: bigint }
  | { kind: 'medicine'; amount: bigint }   // NEW
  | { kind: 'item'; itemDefId: bigint; quantity: bigint }
  | { kind: 'custom'; description: string; apply: (ctx, playerId) => void };
```

Extend the dispatch switch in `framework.endSession` to call the existing Medicine grant helper (or insert into the resource table) for `kind === 'medicine'`.

In each handler's `onEnd`, append `{ kind: 'medicine', amount: X }` entries to `MinigameEndResult.rewards`.

#### No alternate trickle source

Confirmed: Medicine is exclusively a minigame reward. Solo CoinFlip and solo RhythmTap are the floor for players who don't want PvP. **No daily cap.**

---

## Skill-tree integration (carried forward from "The Resource Pools.md")

Each resource tier is gated by skill nodes:

- "Discover Parts" — unlocks Refinery construction in The Shelter.
- "Discover Metal" — unlocks Smelter construction.
- "Discover Fabric" — unlocks the Fabric recipe in the Workbench page.
- "Discover Food" — enables Food trickle from Scavenge AND unlocks Garden/Kitchen construction.
- "Discover Medicine" — enables Medicine to drop from minigames.

Per-resource upgrade chains (slot count, efficiency, recipe efficiency, etc.) live in their respective sub-trees. The "Increase Maximum Upgrade Levels +5" capstone from "The Resource Pools.md" remains for each chain.

## Tables to add

- `refinery`, `refinery_job`
- `smelter`, `smelter_job`
- `garden`, `garden_job`

No new tables for Fabric (resource amount only) or Medicine (minigame reward dispatch only).

## Reducers to add or modify

**Add:**

- `start_refinery_job`, `collect_refinery_job`, `upgrade_refinery_efficiency`
- `start_smelter_job`, `collect_smelter_job`, `upgrade_smelter_efficiency`
- `start_garden_job`, `collect_garden_job`, `upgrade_garden_efficiency`
- `craft_fabric`

**Modify:**

- The Scavenge reducer — add Food trickle gated on Food discovery.
- `coinFlip.ts onEnd`, `rhythmTap.ts onEnd`, `cardDuel.ts onEnd` — add Medicine to rewards.
- `minigames/registry.ts` — extend `Reward` union with `medicine` variant.
- `minigames/framework.ts endSession` — dispatch `medicine` reward kind.

## Balance levers (initial values, all tunable)

| Knob | Initial | Notes |
|---|---|---|
| Refinery: scrap per Part | 10 | |
| Refinery: time per job | 30s | |
| Refinery: starting slots | 1 | upgrade chain TBD |
| Smelter: inputs per Metal | 5 scrap + 2 parts | |
| Smelter: time per job | 60s | |
| Smelter: starting slots | 1 | |
| Fabric recipe cost | 5 scrap + 2 parts + 1 metal | |
| Fabric output per craft | 1 | batch x10 supported |
| Scavenge → Food trickle chance | 1% per tick | gated on Food discovery |
| Garden: input per job | 5 Food | |
| Garden: time per job | 60s | |
| Garden: Stale multiplier | 2x | |
| Garden: Ripe multiplier | 3x | |
| Garden: Ripe window length | 30s | |
| Medicine: CoinFlip flat | +1 per player per game | |
| Medicine: RhythmTap | floor(hits / 10) | per player |
| Medicine: CardDuel | winner 2, loser 1 | |

## Files to create/modify

**Create:**

- `spacetimedb/src/structures/refinery.ts` (table + reducers)
- `spacetimedb/src/structures/smelter.ts` (table + reducers)
- `spacetimedb/src/structures/garden.ts` (table + reducers)
- `spacetimedb/src/recipes/fabric.ts` (or inline in workbench module — pick whichever pattern matches existing organisation)
- `src/components/shelter/RefineryPage.tsx`
- `src/components/shelter/SmelterPage.tsx`
- `src/components/shelter/GardenPage.tsx`

**Modify:**

- `spacetimedb/src/index.ts` — re-export new tables/reducers into the schema.
- The Scavenge module — add Food trickle.
- `spacetimedb/src/minigames/coinFlip.ts`, `rhythmTap.ts`, `cardDuel.ts` — Medicine in `onEnd`.
- `spacetimedb/src/minigames/registry.ts` — `Reward` union.
- `spacetimedb/src/minigames/framework.ts` — `endSession` reward dispatch.
- `src/components/shelter/WorkbenchPage.tsx` — add Recipes region with Fabric Craft / Craft x10 buttons.
- `src/components/shelter/structureLayout.ts` — add Refinery, Smelter, Garden tile positions and icons.

## Risks / open questions

1. **Multi-slot Garden during Ripe windows.** A player with multiple ripe slots simultaneously needs the "Collect All" affordance to avoid frustrating per-slot clicks. Confirmed in spec; flag for playtesting.
2. **Scavenge Food trickle determinism.** Reducers must be deterministic. The seeded RNG approach (`ctx.timestamp ^ hash(ctx.sender)`) needs to be implemented carefully — same tick, same sender, must always produce the same result.
3. **Recipe display at the Workbench with one recipe.** With only Fabric at launch, the Recipes region looks barren. Either fill it visually (one prominent recipe card centered) or design with future recipes in mind. Recommend the former; future recipes extend it naturally.
4. **Construction costs for new structures.** Each structure needs a Build Activity (cost in scrap, contribution-style like Build Workbench). Costs should ramp: Refinery cheap (1500-2500 scrap?), Smelter mid (gated behind Metal discovery anyway), Garden mid. Concrete numbers in implementation.
5. **Output-Ready persistence.** A completed Refinery/Smelter job sits forever if the player never collects. Consider auto-collection on next login or a max-pending-jobs rule. Probably out of scope for v1 — the Output-Ready badge should be loud enough to prevent this in practice.
6. **Multiplayer visibility.** Per-player tables (`refinery`, `garden`, etc.) are public for client subscription convenience but should be filtered server-side via views so players don't render each other's queues. Confirm visibility model with the existing pattern in the codebase before implementation.
7. **Skill-tree wiring.** Each "Discover X" node needs to actually unlock the corresponding structure / recipe / trickle. The skill tree's existing unlock-event mechanism handles this; just confirm the hooks exist before authoring the discovery nodes.
8. **CoinFlip Medicine inflation.** Flat +1 per player per game means Medicine generation scales linearly with games played. If players grind solo CoinFlip, Medicine becomes trivially abundant. Mitigation: keep the per-game payout small (1 is small) and make sinks expensive. Watch this in early playtesting; cap is on the table if it gets out of hand (counter to the no-cap decision, but reserved as an emergency lever).
