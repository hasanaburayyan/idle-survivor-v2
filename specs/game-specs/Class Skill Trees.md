Overview:
The Intermediate Skill Tree's core stats (Vigor, Power, Focus, Fortune) currently affect only Defensive Battle. This spec attaches them to the idle layer by gating four new **class skill trees** behind stat mastery: maxing both the Minor and Major node for a given stat reveals the corresponding class's unlock node in Intermediate, which when taken makes that class's tree visible to the player. Each class's tree contains discrete mechanical nodes (parallel automation slots, generalist passive yields, manual click bursts, RNG procs), one or more infinitely-upgradable scaling nodes, and a capstone branch that forces a meaningful 1-of-3 choice with the other two locked out. Players can unlock all four classes, but **only one is equipped at a time** — equipped class effects are active, others are dormant. Class points are *crafted* by spending class-specific resources on a tiered cost curve — cheap early, expensive mid, prohibitive late ("bragging rights"). Stats themselves continue scaling forever (Defensive Battle HP, damage, etc.), and higher tiers within class trees gate on raw stat values, giving the infinite climb a continuous purpose. This spec depends on the Core Stats System, the Skill Tree Tiers spec, the Intermediate Skill Tree Content spec, and the Equipment & Armory Stat Rework spec.

User Story:
A player has just maxed Vigor Minor (4/4) and Vigor Major (4/4) in Intermediate. A new node lights up on the Intermediate canvas: "Unlock Brute Class Tree." They spend 1 SP from the general pool to take it. The Skill Tree screen now shows a new tab — Brute — but their Brute pool is at 0 points. They navigate to the new Class Crafting panel inside their Shelter, where they can spend Metal + Fabric to craft Brute points. The first 10 cost 50 Metal + 50 Fabric each; the next 10 cost 500 of each; beyond that, costs balloon. They craft 8 points, return to the Brute tree, and spend them — picking up Parallel Frame I (+1 automation slot), Heavy Frame, and Steady Hands. They equip Brute via the Class panel (paying a small Metal cost to swap); their automation slot count climbs from 1 to 2 immediately, and they assign `scavenge_for_metal` to the new slot. Later they explore Striker too — they can browse the Striker tree at any time, spend Striker points there, and even take Striker nodes, but the Striker mechanics only fire when they equip Striker. Down the road they reach Brute's capstone branch (3 nodes, pick 1) — they pick "Forge Heart," locking out the other two. If they regret it, the `refundCapstoneChoice` reducer can refund the choice for a steep resource cost.

Requirements:
+ Server authoritative. Class tree definitions, unlock conditions, point pools, effects, equipped-class state, and capstone choices all live on SpacetimeDB. The client only renders.
+ This spec depends on Core Stats System, Skill Tree Tiers, Intermediate Skill Tree Content, and Equipment & Armory Stat Rework. Schema and reducer changes here build on existing tables.

Schema additions:
+ Extend the `unlockCondition` tagged union on `skill_tree_definition` with a new variant:
  - `skillsAtLevel` carrying `requirements: array of { skillId: string, level: u32 }` — fires when every (skillId, level) pair is satisfied for the calling player. Used to gate class trees behind stat mastery (e.g. Brute requires `vigor_minor` at 4 AND `vigor_major` at 4). The variant list remains extensible.
+ A new `player_equipped_class` table tracks the currently equipped class per player.
  - `username` (string primary key), `classId` (string — the equipped tree's `treeId`, or empty string when no class is equipped), `equippedAt` (timestamp).
  - One row per player. Default state (post-Beginner-completion, pre-class-unlock) is no row, treated as "none equipped."
+ A new `class_node_effect` table — analog of `skill_stat_grant` for class-tree capabilities (non-stat effects). Describes the effect each class node grants when *active* (i.e. the class is equipped and the node has been spent into).
  - `id` (u64 primary key autoinc), `skillId` (string foreign key to `skill_definition`), `effectKey` (string — see "Capabilities" below), `amountPerLevel` (i32), `appliesWhen` (tagged union with variants `equipped` and `always`; defaults to `equipped` in v1, `always` reserved for the future "free the node from the class" mechanic).
  - Indexed by `skillId` (`accessor: 'class_node_effect_skill'`).
  - Stat-granting class nodes continue to use `skill_stat_grant` from the Intermediate spec; `class_node_effect` is purely for non-stat capabilities.
+ A new `class_craft_cost` table describes the resource cost to craft one class point at each tier of the cost curve.
  - `id` (u64 primary key autoinc), `classId` (string), `tierIndex` (u32 — 0-based; tier 0 = first N points crafted, tier 1 = next N, etc.), `pointsInTier` (u32 — how many points this tier spans before advancing to the next tier; the highest seeded tier may use a sentinel like `u32::MAX` for "no upper bound"), `resourceId` (string), `amountPerPoint` (u64).
  - Multiple rows per (classId, tierIndex) — one per required resource. Brute tier 0 has two rows: 50 Metal + 50 Fabric per point.
  - Indexed by `classId` (`accessor: 'class_craft_cost_class'`).
+ A new `player_class_craft_progress` table tracks how many class points the player has *crafted* for each class, used to compute their current tier on the cost curve.
  - `id` (u64 primary key autoinc), `username` (string), `classId` (string), `pointsCrafted` (u64 — increments per `craftClassPoint` call), `lastCraftedAt` (timestamp).
  - Indexed by `username` (`accessor: 'player_class_craft_progress_username'`).
  - The class point *balance* (spendable) lives in the existing `player_skill_point_balance` table under the class's `pointPoolId` (e.g. `class_brute`). This table records *crafted total* — never decreases — and is the source of truth for cost-curve tier lookup.
+ Extend `skill_definition` with two new optional columns:
  - `capstoneBranchId` (string, empty when not part of a capstone branch) — groups mutually-exclusive capstone choices.
  - `infiniteScaling` (bool, default false) — marks a node as having no `maxLevel` cap. Beyond `maxLevel`, the node continues to accept levels at the same per-level cost; the cost-curve tier on `class_craft_cost` provides the natural soft cap.
  - Both columns default such that existing Beginner / Intermediate seeds work unchanged.
+ A new `player_capstone_choice` table records the capstone choice per branch.
  - `id` (u64 primary key autoinc), `username` (string), `capstoneBranchId` (string), `chosenSkillId` (string), `chosenAt` (timestamp).
  - Indexed by `username` (`accessor: 'player_capstone_choice_username'`). At most one row per (username, capstoneBranchId); reducer logic enforces uniqueness.
  - Locked-out skills are derived: any `skill_definition` row sharing the same `capstoneBranchId` whose `skillId` is not the player's `chosenSkillId` is locked.
+ A new `player_capability` table holds non-stat effects granted by class nodes (and future systems): `sourceKey` (string primary key), `username` (string), `effectKey` (string), `amount` (i32). Indexed by `username` (`accessor: 'player_capability_username'`) and by `(effectKey)` is unnecessary — sums-by-effect are computed from per-user index scans, same pattern as `player_stat_source`.
+ Source-management helpers (server-side, in a new `class.ts` module on the server):
  - `setCapability(ctx, sourceKey, username, effectKey, amount)` — upserts.
  - `clearCapability(ctx, sourceKey)` — deletes.
  - `clearCapabilitiesByPrefix(ctx, username, prefix)` — required `username` so the helper uses the index.
  - `getCapabilityTotal(ctx, username, effectKey)` — sums `amount` across the player's rows matching `effectKey`. Used by every subsystem that reads class effects.
  - These mirror the Core Stats System's helpers exactly; the contract is the same.

Capabilities (v1 effect keys):
+ `automation_slot` — Brute's Parallel Frame nodes; consumed by the automation system to determine how many parallel slots the player has access to. Base is 1 (the workbench slot); this capability adds.
+ `manual_click_yield_pct` — Striker's Heavy Hand nodes; multiplies manual click yields. Additive % stacking with existing multiplier skills.
+ `wide_net_pct` — Generalist's Wide Net nodes; per-tick percentage of automation/click yield distributed across all six unlocked resources.
+ `fortune_proc_chance_bp` — Wanderer's Lucky Strike nodes; basis points of proc chance per click/tick (10000 bp = 100%).
+ `fortune_proc_multiplier_bp` — Wanderer's capstone-tier multipliers on proc magnitude.
+ `craft_affix_bias_bp` — Generalist's Crafter's Eye; basis points of additional bias toward upper end of affix ranges at craft time.
+ `armory_cost_reduction_bp` — Generalist's Surveyor / Quartermaster; basis points of armory upgrade cost reduction.
+ `combat_hand_size_bonus` — Generalist's Tactician; flat addition to Defensive Battle hand size beyond the Focus-derived value.
+ Future systems extend this list. The schema is agnostic to the key set.

Class tree definitions (v1 seeds):
Four class trees are seeded in `skill_tree_definition`. Each has its own `skill_point_pool_definition` row (`class_brute`, `class_generalist`, `class_striker`, `class_wanderer`). All four use `completionRule: allNodesMaxed` (the maxed check ignores `infiniteScaling: true` nodes — they have no cap to satisfy).

| treeId | displayName | unlockCondition (skillsAtLevel) | pointPoolId | sortOrder |
|---|---|---|---|---|
| `brute` | Brute | `vigor_minor:4, vigor_major:4` | `class_brute` | 10 |
| `generalist` | Generalist | `focus_minor:4, focus_major:4` | `class_generalist` | 11 |
| `striker` | Striker | `power_minor:4, power_major:4` | `class_striker` | 12 |
| `wanderer` | Wanderer | `fortune_minor:4, fortune_major:4` | `class_wanderer` | 13 |

The unlock node itself lives in **Intermediate** (`treeId: intermediate`), one per class:

| skillId | name | maxLevel | costSkillPoints | description |
|---|---|---|---|---|
| `unlock_brute` | Unlock Brute | 1 | 1 | Reveals the Brute class tree. Spend Metal + Fabric to craft Brute points. |
| `unlock_generalist` | Unlock Generalist | 1 | 1 | Reveals the Generalist class tree. Spend a little of every resource to craft Generalist points. |
| `unlock_striker` | Unlock Striker | 1 | 1 | Reveals the Striker class tree. Spend Parts + Food to craft Striker points. |
| `unlock_wanderer` | Unlock Wanderer | 1 | 1 | Reveals the Wanderer class tree. Spend Medicine + Scrap to craft Wanderer points. |

These nodes draw from the `general` pool. Their visibility within Intermediate is gated by the same `skillsAtLevel` check as the corresponding class tree — players see "Unlock Brute" only after mastering Vigor. The `myVisibleSkillTrees` view returns class trees only when both (a) the tree's `unlockCondition` is satisfied AND (b) the player has taken the corresponding `unlock_<class>` node at level 1.

Class equip / unequip:
+ `equipClass({ classId })` reducer — validates: caller has unlocked the class (their `unlock_<class>` node is at level 1). Validates: caller is not currently in a Defensive Battle or other minigame session (location does not start with `defensive_battle:` and no active `minigame_member` row). Deducts the swap cost from the caller's resources (see "Swap cost" below). Updates the `player_equipped_class` row (insert if absent; previous row's classId is replaced). The reducer then walks every `class_node_effect` row and every `skill_stat_grant` row for the caller's purchased nodes in this class and applies each:
  - For stat effects: `setStatSource(ctx, '{username}:class:{classId}:{skillId}:{statId}', username, statId, totalAmount)`.
  - For capability effects: `setCapability(ctx, '{username}:class:{classId}:{skillId}:{effectKey}', username, effectKey, totalAmount)`.
  - Before applying the new class's effects, the reducer calls `clearStatSourcesByPrefix(ctx, username, '{username}:class:{prevClassId}:')` and `clearCapabilitiesByPrefix(ctx, username, '{username}:class:{prevClassId}:')` to clear the previous class's writes (no-op if no previous class).
+ `unequipClass()` reducer — same prefix-clear pattern. Sets `player_equipped_class.classId` to empty string (or deletes the row). No swap cost — unequipping to "no class" is free.
+ Swap cost (v1 seed, tunable): 100 of the *target* class's primary resource (the first resource listed in its tier-0 `class_craft_cost` row). Deliberate friction without trapping. First-time equip of a class is also costed; players who insist on a free swap can `unequipClass()` first (which is free) and then `equipClass(other)` later — but they'll still owe the equip cost.
+ Combat lock: `equipClass` and `unequipClass` throw `SenderError('Cannot change class during a minigame.')` if the player is in a `defensive_battle:` location or has an active `minigame_member` row. Class selection is locked for the duration of any minigame session, matching the stat snapshot rule from Core Stats.

Class point crafting:
+ `craftClassPoint({ classId })` reducer — validates: caller has unlocked the class. Looks up `player_class_craft_progress.pointsCrafted` for this class (treats absence as 0). Computes the current tier by walking `class_craft_cost` rows for this class in `tierIndex` order, accumulating `pointsInTier` until the cumulative total exceeds `pointsCrafted`; the matching tier is the player's current tier. Validates: caller has the resources for one craft at the current tier (sums all `class_craft_cost` rows for `(classId, tierIndex)`). Deducts resources; increments `pointsCrafted` by 1; adds 1 to the player's `player_skill_point_balance` row for the class's `pointPoolId` (creates the row at amount 1 if absent). Throws `SenderError` if any precondition fails.
+ Cost curve (v1 seed, tunable): each class has 3 tiers. The seed multiplies the tier-0 amount by the tier multiplier — implementation can either store the multiplied amounts directly or store a `tier_multiplier` somewhere; the schema as defined stores them directly.

| Tier | pointsInTier | Multiplier on resource cost |
|---|---|---|
| 0 | 10 | 1× (base) |
| 1 | 10 | 10× |
| 2 | unbounded (sentinel) | 100× |

Resources per class (v1 thematic seed, tunable):

| classId | tier-0 cost per craft |
|---|---|
| `brute` | 50 Metal + 50 Fabric |
| `generalist` | 10 of each of all six resources |
| `striker` | 50 Parts + 50 Food |
| `wanderer` | 50 Medicine + 250 Scrap |

Tier 1 multiplies all amounts by 10×; tier 2 by 100×. Players self-cap naturally where the cost outpaces patience. Resources 2–6 each gain a meaningful long-term economic role: Metal feeds Brute, Parts feeds Striker, Medicine feeds Wanderer, Generalist consumes everything, and Fabric / Food are paired with Metal / Parts respectively. Scrap (the universal early resource) only matters as a Wanderer cost.

Capstone branches:
+ A capstone branch is a set of `skill_definition` rows sharing the same `capstoneBranchId`. v1 seeds one capstone branch per class tree, with three nodes each (six rows total per class).
+ The existing `upgradeSkill` reducer is extended with a capstone-branch check before incrementing a node's level:
  - If the node has a non-empty `capstoneBranchId`, query `player_capstone_choice` for the same `(username, capstoneBranchId)`.
  - If a row exists with a different `chosenSkillId`, throw `SenderError('Capstone choice locked.')`.
  - If no row exists, insert one stamping `chosenSkillId = thisSkillId`. Subsequent `upgradeSkill` calls for the same node are allowed (a capstone might still have multiple levels — though v1 capstones are all `maxLevel: 1`).
+ The frontend reads `player_capstone_choice` joined with `skill_definition.capstoneBranchId` to render locked-out nodes as visually disabled with a "Locked — refund Forge Heart to free this branch" hint.
+ `refundCapstoneChoice({ classId, capstoneBranchId })` reducer — validates: caller has a `player_capstone_choice` row for this branch. Validates: the caller is not in a minigame session. Deducts the **respec cost**: 10 of the class's primary resource at the player's current tier-0-cost rate (e.g. Brute respec costs 500 Metal). Refunds the chosen capstone node's `costSkillPoints` to the class's `pointPoolId` balance. Sets the player's `player_skill` row for the chosen capstone to level 0 (or deletes it — `upgradeSkill` should handle either form). Calls `clearStatSourcesByPrefix` / `clearCapabilitiesByPrefix` for the chosen capstone's source-key prefix `'{username}:class:{classId}:{chosenSkillId}:'` (only matters if the class is currently equipped — otherwise the prefix wouldn't exist). Deletes the `player_capstone_choice` row, freeing all three options to be picked again.
+ General respec across the rest of the tree is **out of scope for v1**. Capstone-only respec ships with this spec because the lockout is the highest-stakes single decision in any class tree; without a recovery path, a regretted capstone is a quit-risk moment.

Infinite-scaling nodes:
+ Marked in `skill_definition` with `infiniteScaling: true`. The `maxLevel` field becomes a soft threshold rather than a hard cap.
+ The `upgradeSkill` reducer treats the level field as monotonically increasing for these nodes; no cap check fires when `infiniteScaling: true`.
+ Class tree completion (`allNodesMaxed`) ignores infinite-scaling nodes for the "maxed" check — the rule walks `skill_definition` rows for the tree and skips any with `infiniteScaling: true`.
+ Effect amount per level is whatever the corresponding `class_node_effect.amountPerLevel` (or `skill_stat_grant.amountPerLevel`) row says, scaled by the player's level — unbounded.
+ The cost-curve on `class_craft_cost` creates a natural soft cap. Players self-stop where it stops being worth it. The infinite climb exists primarily as a long-term progression sink for committed players.

Stat-gated node access (v1):
+ Capstone nodes (and other "deep" tree nodes) gate on raw stat values via the existing `prerequisitePlayerLevel` mechanism — but applied to a stat instead. A new optional column `prerequisiteStatId` (string, empty for "no stat gate") and reuse of `prerequisitePlayerLevel` (renamed conceptually to "prerequisite numeric") expresses this. The reducer's prereq check, when `prerequisiteStatId` is non-empty, calls `getStatTotals(ctx, username)[prerequisiteStatId]` and compares against `prerequisitePlayerLevel`. When `prerequisiteStatId` is empty, the existing player-level check applies as before.
+ This keeps stats relevant past the 16-point cap of Intermediate — Brute capstones gate on Vigor 30, Generalist on Focus 30, etc. Players continue spending Intermediate / class points to increase stats, climbing toward higher-tier nodes.

V1 class tree node seeds:
Sketches; precise positionX/Y, copy, and fine tuning deferred to implementation. Each class ships with **6–8 nodes plus a 3-node capstone branch**.

Brute (treeId `brute`, pool `class_brute`):

| skillId | name | maxLevel | cost | prereq | effect |
|---|---|---|---|---|---|
| `parallel_frame_1` | Parallel Frame I | 1 | 1 | (none) | +1 `automation_slot` |
| `parallel_frame_2` | Parallel Frame II | 1 | 2 | `parallel_frame_1` at 1 | +1 `automation_slot` |
| `parallel_frame_3` | Parallel Frame III | 1 | 3 | `parallel_frame_2` at 1 | +1 `automation_slot` |
| `steady_hands` | Steady Hands | 1 | 1 | `parallel_frame_1` at 1 | (capability key `automation_cost_tolerant`, consumed by automation tick reducer to skip cost-failure aborts) |
| `heavy_frame` | Heavy Frame | 1 | 2 | `parallel_frame_1` at 1 | +1 to `manual_click_tick_count` (manual clicks count as 2 ticks toward the slotted activity) |
| `endurance_infinite` | Endurance | infiniteScaling | 1 per level | `parallel_frame_1` at 1 | +100 bp `automation_yield_pct_bp` per level (1% per level, additive) |

Capstone branch `brute_cap` (gates: Vigor 30, all maxLevel 1, all cost 5):
+ `forge_heart` — automation slots tick at 1.5× yield while the player is logged out (capability key `offline_automation_multiplier_bp` = 5000).
+ `iron_will` — manual clicks while in a Defensive Battle grant ward charges to the caller (capability key `combat_click_grants_ward`, consumed by the battle reducer).
+ `bulwark` — automation cost-failure tolerance promoted from "skip aborts" to "ticks succeed even when costs aren't met" (capability key `automation_free_runs`).

Generalist (treeId `generalist`, pool `class_generalist`):

| skillId | name | maxLevel | cost | prereq | effect |
|---|---|---|---|---|---|
| `wide_net_1` | Wide Net I | 1 | 1 | (none) | +200 bp `wide_net_pct_bp` (2% per tick to all unlocked resources) |
| `wide_net_2` | Wide Net II | 1 | 2 | `wide_net_1` at 1 | +300 bp `wide_net_pct_bp` (total 5%) |
| `surveyor` | Surveyor | 1 | 2 | `wide_net_1` at 1 | +2000 bp `armory_cost_reduction_bp` (20%) |
| `crafters_eye` | Crafter's Eye | 1 | 2 | `wide_net_1` at 1 | +1000 bp `craft_affix_bias_bp` (10% bias toward upper end of affix ranges) |
| `tactician` | Tactician | 1 | 2 | `wide_net_2` at 1 | +1 `combat_hand_size_bonus` |
| `polymath_infinite` | Polymath | infiniteScaling | 1 per level | `wide_net_2` at 1 | +50 bp `wide_net_pct_bp` per level |

Capstone branch `generalist_cap` (gates: Focus 30, all maxLevel 1, all cost 5):
+ `hidden_caches` — wide-net yield occasionally produces a tier above the player's highest unlocked resource (capability key `wide_net_overflow_bp` = 100, consumed by the wide-net distribution code).
+ `master_crafter` — crafts roll one extra optional affix (capability key `craft_extra_optional_count` = 1).
+ `quartermaster` — armory upgrade costs reduced by an additional 30% on top of Surveyor (additive +3000 bp `armory_cost_reduction_bp`).

Striker (treeId `striker`, pool `class_striker`):

| skillId | name | maxLevel | cost | prereq | effect |
|---|---|---|---|---|---|
| `heavy_hand_1` | Heavy Hand I | 1 | 1 | (none) | +2500 bp `manual_click_yield_pct_bp` (+25%) |
| `heavy_hand_2` | Heavy Hand II | 1 | 2 | `heavy_hand_1` at 1 | +2500 bp `manual_click_yield_pct_bp` (total +50%) |
| `combo` | Combo | 1 | 2 | `heavy_hand_1` at 1 | (capability key `manual_click_combo_enabled`; the activity reducer maintains a per-player `last_click_at` and stacks +500 bp per consecutive click within 3s, decays after 3s of inactivity, caps at +5000 bp) |
| `quickstep` | Quickstep | 1 | 2 | `combo` at 1 | (capability key `manual_click_progresses_all_slots`; manual clicks contribute progress to every slotted automation, not just the activity being tapped) |
| `cleaver` | Cleaver | 1 | 2 | `heavy_hand_2` at 1 | +1 `combat_damage_extra_target` |
| `striker_infinite` | Striker | infiniteScaling | 1 per level | `heavy_hand_2` at 1 | +100 bp `manual_click_yield_pct_bp` per level |

Capstone branch `striker_cap` (gates: Power 30, all maxLevel 1, all cost 5):
+ `crit_strike` — manual clicks have a 5% chance to deal 10× yield (capability key `manual_click_crit_chance_bp` = 500, with a separate `manual_click_crit_multiplier_bp` = 100000 read by the activity reducer).
+ `momentum` — every 50 consecutive clicks within combo window grants a free craft point in any unlocked class (capability key `combo_free_craft_threshold` = 50, consumed by the combo subsystem to fire a `craftClassPoint` server-side without resource cost).
+ `ironfist` — Power scales harder into combat damage (capability key `combat_power_damage_multiplier_bp` = 5000, consumed by the action stat scaling reducer to multiply Power's contribution to damage by 1.5).

Wanderer (treeId `wanderer`, pool `class_wanderer`):

| skillId | name | maxLevel | cost | prereq | effect |
|---|---|---|---|---|---|
| `lucky_strike_1` | Lucky Strike I | 1 | 1 | (none) | +100 bp `fortune_proc_chance_bp` (1% chance per click/tick); proc base multiplier ×10 |
| `lucky_strike_2` | Lucky Strike II | 1 | 2 | `lucky_strike_1` at 1 | +150 bp `fortune_proc_chance_bp` (total 2.5%) |
| `cascade` | Cascade | 1 | 2 | `lucky_strike_1` at 1 | (capability key `fortune_cascade_chance_bp` = 2500; on Fortune proc, 25% chance to chain into another proc) |
| `quartermaster_drop` | Quartermaster | 1 | 3 | `lucky_strike_2` at 1 | (capability key `fortune_proc_drops_item_bp` = 1000; on Fortune proc, 10% chance to also drop a freshly crafted item rolled at current armory level) |
| `loaded_dice` | Loaded Dice | 1 | 2 | `lucky_strike_2` at 1 | +5000 bp `combat_loot_multiplier_flat_bp` (Defensive Battle loot multiplier formula gains +0.5 flat) |
| `wanderer_infinite` | Wanderer | infiniteScaling | 1 per level | `lucky_strike_2` at 1 | +25 bp `fortune_proc_chance_bp` per level |

Capstone branch `wanderer_cap` (gates: Fortune 30, all maxLevel 1, all cost 5):
+ `rich_veins` — clicks have a 0.1% chance to drop a "vein" — burst of mixed resources scaled to player level (capability key `vein_drop_chance_bp` = 10, consumed by the activity reducer).
+ `echo` — Fortune procs have a chance to fire on a random group member's session simultaneously (capability key `fortune_proc_echo_chance_bp` = 2500; the activity reducer, on proc, rolls echo and writes a parallel grant to a random group member, plus a notification).
+ `fates_favor` — Fortune procs are 2× larger (capability key `fortune_proc_multiplier_bp` = 20000, multiplicatively applied on the proc magnitude).

Subsystem integration:
+ **Automation system** — the slot count is `1 + getCapabilityTotal(ctx, username, 'automation_slot')`. Tick scheduling and slot UI gate on this total. Slot assignments persist across class swaps: when a Brute player un-Brutes, their slot 2 / 3 assignments stay in the database but their effective slot count drops back to 1, leaving the higher-index assignments dormant. Re-equip Brute, the assignments resume. Implementation: don't delete `automation_tick` rows on unequip; the tick reducer reads the live slot count and silently no-ops on rows whose slot index exceeds the total.
+ **Activity yield (manual clicks)** — `performScavengeActivity` reads `getCapabilityTotal(ctx, username, 'manual_click_yield_pct_bp')` and applies as an additive % bonus on the final yield, stacking additively with multiplier-skill bonuses. Also reads `manual_click_combo_enabled`, `manual_click_progresses_all_slots`, `manual_click_tick_count`, and the crit / vein capability keys from above.
+ **Wide-net yield** — `performScavengeActivity` and the automation tick reducer both read `getCapabilityTotal(ctx, username, 'wide_net_pct_bp')`. After the primary yield is awarded, for each *other* unlocked resource (per `resourceDefinition.unlockSkillId` check), award `floor(primaryYield × wide_net_pct_bp / 10000)`. With `hidden_caches` capstone, an additional roll on `wide_net_overflow_bp` may award a tier-above resource.
+ **Fortune procs** — every click and every automation tick rolls a deterministic PRNG seeded from `(timestamp, username, action_count)`. If the roll falls below `getCapabilityTotal(ctx, username, 'fortune_proc_chance_bp') / 10000`, the yield is multiplied by `10 × (1 + fortune_proc_multiplier_bp / 10000)`. On proc, insert a `notification` of kind `system` with a flavor-text summary ("Fortune strikes! +N <resource>."). `cascade` re-rolls if the first proc hits, with diminishing chance. `quartermaster_drop` rolls separately for an item drop. `echo` rolls separately for the group-member echo.
+ **Affix bias** — the `roll(min, max, armoryLevel)` formula in `armory.ts` reads `getCapabilityTotal(ctx, username, 'craft_affix_bias_bp')` and adds to the existing armory-level-driven bias.
+ **Armory upgrade costs** — `upgradeArmory` reduces costs by `getCapabilityTotal(ctx, username, 'armory_cost_reduction_bp') / 10000` before the affordability check.
+ **Combat hand size** — `handSizeFromFocus` formula in `battle.ts` adds `getCapabilityTotal(ctx, username, 'combat_hand_size_bonus')` after clamping. The maximum hand size is intentionally not bounded by the existing 5-cap when capabilities push it higher.
+ **Combat damage extra target** — the `resolveAction` reducer's damage application loop iterates one extra target if `combat_damage_extra_target` is non-zero.
+ **Combat power scaling** — the action stat scaling reducer multiplies Power's contribution by `1 + combat_power_damage_multiplier_bp / 10000`.
+ All effects fire only when the class is equipped. Their stat sources / capabilities are written at equip time and cleared at unequip time, so the read-through pattern doesn't need conditional gating per call — the data simply isn't present when the source class is unequipped.

Frontend:
+ **Skill Tree screen** — gains class tabs in `myVisibleSkillTrees` order. Tabs surface only after the player has both met the unlock condition AND taken the corresponding `unlock_<class>` node. Each class tab shows its tree, the spendable balance from `player_skill_point_balance` for that pool, and the player's current cost-curve tier (e.g. "Tier 1: 500 Metal + 500 Fabric per Brute point").
+ **Class Crafting panel** — a new section, location is the Shelter (alongside the Armory, since it parallels the workbench-style "spend resources to make progress" pattern). Shows: list of unlocked classes, current craft cost per class (resource icons + amounts at the player's current tier), a Craft button per class. Cost preview reflects the player's current tier on the cost curve. Successful crafts surface a brief toast ("Brute point crafted. Spend in the Brute tree.").
+ **Class Equip panel** — a small UI element (likely a banner above the Skill Tree tabs, plus a Character-tab section). Shows the currently-equipped class with an icon and name. Tapping opens a list of unlocked classes; selecting one fires `equipClass` after a confirmation that names the swap cost. Disabled with a tooltip during minigame sessions.
+ **Capstone branch rendering** — the three nodes in a branch are visually grouped (a triptych or arc layout). Locked-out nodes (after a choice has been made) render dimmed with a "Locked out — refund to change" label. Tapping a locked-out node opens a confirmation showing the refund cost.
+ **Fortune proc notifications** — flow through the existing notifications tray, kind `system`. High-impact, low-frequency, satisfying. Avoid spam: a v1 dedup window of e.g. 5 seconds collapses multiple procs into a single "Fortune strikes! +N total" notification. Tunable.

Migration:
+ Greenfield system. Players who exist when this ships have no class trees unlocked, no equipped class, no class point balances. They access classes through the normal flow: master a stat → take the unlock node in Intermediate → equip → craft → spend.
+ Schema additions are non-breaking: new tables, new optional columns on `skill_definition` with safe defaults, a new `unlockCondition` variant. Existing seeds work unchanged. The two new optional columns on `skill_definition` (`capstoneBranchId`, `infiniteScaling`) are added with empty / false defaults, so all existing skills (Beginner unlocks, Intermediate stat / multiplier nodes) interpret correctly.
+ The `prerequisiteStatId` column addition (or equivalent expression of stat-gating) is also additive; existing nodes with empty `prerequisiteStatId` retain their `prerequisitePlayerLevel` semantics.

Extensibility:
+ Adding a new class: insert one `skill_tree_definition` row, one `skill_point_pool_definition` row, one `unlock_<class>` skill in Intermediate, the class's `class_craft_cost` rows, and the class's `skill_definition` + `class_node_effect` + `skill_stat_grant` + `player_capstone_choice`-eligible capstone seeds. No client changes for the tab to appear once the player meets the gates.
+ Adding a new effect type: add an `effectKey` constant, write the subsystem read in the relevant module, seed `class_node_effect` rows. Capabilities scale uniformly via the same source-table pattern.
+ "Free the node from the class" (future spec): the `appliesWhen: always` variant on `class_node_effect` is already in the schema. A future reducer (`promoteNodeToAlways({ skillId })`) could pay a meaningful resource cost to flip a single node's effects from `equipped` to `always`, letting players keep specific benefits across class swaps. v1 ships with all class effects as `equipped`.
+ General respec (future spec): refunds spent class points across the whole tree, returning them to the class's pool. A more aggressive cost curve than capstone respec applies. Capstone respec ships in v1 because the lockout is the most regret-prone moment; full respec follows on a separate cost curve.
+ Earned-via-action class points (future spec): the `craftClassPoint` reducer is the only source path in v1, but nothing in the schema prevents future systems from granting class points (e.g. battles awarding `class_brute` points on victory). The `player_skill_point_balance` table is the source of truth and stays the integration point.
+ Multi-class equip (future spec): a future "Hybrid" structure or skill tree could allow a second class slot. The `player_equipped_class` table can be extended to support this with a `slot` column or replaced with a `player_equipped_classes` rows-per-slot table. v1 ships with strict one-class-equipped.

Placeholders:
+ All resource costs (craft tier 0 amounts, swap cost, capstone respec cost), all node `costSkillPoints` values, all capstone gate stat values, all infinite-node per-level magnitudes, and all Fortune proc multipliers are first-pass seeds. Expect heavy iteration during playtesting.
+ Class node copy ("Forge Heart," "Hidden Caches," etc.) is illustrative — wording and theming can shift before ship without code changes.
+ Visual layout for the four class trees (positionX / positionY) is implementation-defined. The existing pannable web works; new icons / class theming can land iteratively.
+ The Class Crafting and Class Equip UIs are sketches. Whichever locations feel most discoverable win; the data layer is unchanged regardless.
+ Notification dedup window for Fortune procs (v1: 5 seconds) is tunable — start permissive and tighten if procs become spammy at high investment levels.
+ The capstone respec cost formula (10× tier-0 primary resource per refund) is a starting point. If playtesters report it feels too cheap or too expensive, adjust the multiplier — the reducer reads cost from a tunable constant.
