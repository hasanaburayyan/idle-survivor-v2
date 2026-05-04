Overview:
This spec replaces the existing `Equippable Items.md` and `The Armory.md` specs in their entirety. Items no longer carry direct per-game effects ("+10 HP in Defensive Battle"); instead, every item rolls one or more **stat affixes** (Vigor / Power / Focus / Fortune) drawn from a per-item-template pool. Equipping an item writes its affixes to `player_stat_source` (per the Core Stats System spec); unequipping clears them. The Armory is a Shelter structure that unlocks equipment, hosts crafting recipes, and has an upgrade level — armory level shifts the *average* roll quality of new items (higher level → rolls bias toward the top of each affix's range). Item *destruction* and *re-rolling* are out of scope for v1.

User Story:
A player has just built the Armory. The Equipment menu appears at the bottom of their screen with a single empty slot — Tool. They navigate into the Armory and see one recipe — Rucksack — with a resource cost. They tap Craft. A Rucksack appears in their inventory with two stat affixes — Fortune +3, Focus +1 — visible on the item card. They open Equipment, drag the Rucksack onto the Tool slot, and their Character panel's Fortune line ticks up by 3, Focus by 1. Later, after spending some metal upgrading the Armory to level 4, they craft a second Rucksack — this one rolls Fortune +7, Focus +4. They swap their old Rucksack out for the new one; the old one drops back to inventory and its stat contributions are removed automatically. A new recipe — Armor Vest — has unlocked at the higher armory level, with bigger Vigor rolls than anything they've had access to before.

Requirements:
+ Server authoritative. All item templates, instances, affixes, slots, and crafting state live on SpacetimeDB. Stat contributions flow through the Core Stats System's `player_stat_source` table — never duplicated into other tables.
+ This spec depends on the Core Stats System spec and uses its helpers (`setStatSource`, `clearStatSource`, `clearStatSourcesByPrefix`) for every mutation that adds or removes equipment.

Item templates:
+ A new `item_definition` table: `itemDefId` (string primary key), `displayName` (string), `description` (string — flavor text + general role), `slotId` (string foreign key to `equipment_slot_definition`), `iconKey` (string), `sortOrder` (u32). Templates are static seeds; players never create or modify rows here.
+ A new `item_definition_affix` table describes the affix *pool* a template rolls from: `id` (u64 primary key autoinc), `itemDefId` (string foreign key), `statId` (string foreign key to `stat_definition`), `minAmount` (i32), `maxAmount` (i32), `rollWeight` (u32 — relative probability when picking which affixes to roll), `isGuaranteed` (bool — guaranteed affixes always roll). Indexed by `itemDefId` (`accessor: 'item_definition_affix_def'`).
+ A new `item_definition_roll` table describes how many affixes a template produces per craft: `itemDefId` (string primary key), `guaranteedCount` (u32 — count of `isGuaranteed: true` rows expected to always roll), `optionalRollCount` (u32 — how many additional affixes are pulled from the non-guaranteed pool by weighted selection without replacement). One row per template. Splitting roll-count from the affix pool keeps templates flexible — a template can have a large possible pool but only roll `guaranteedCount + optionalRollCount` affixes per instance.

Item instances:
+ A new `item_instance` table: `instanceId` (u64 primary key autoinc), `itemDefId` (string foreign key), `ownerUsername` (string), `craftedAt` (timestamp), `armoryLevelAtCraft` (u32 — snapshotted for display and audit). Indexed by `ownerUsername` (`accessor: 'item_instance_owner'`).
+ A new `item_instance_affix` table holds the rolled affixes for a specific instance: `id` (u64 primary key autoinc), `instanceId` (u64 foreign key), `statId` (string foreign key), `amount` (i32 — the actual rolled value, within the template affix's [min, max] range). Indexed by `instanceId` (`accessor: 'item_instance_affix_instance'`).

Equipment slots:
+ A new `equipment_slot_definition` table: `slotId` (string primary key), `displayName` (string), `iconKey` (string), `sortOrder` (u32), `unlockCondition` (tagged union — variants `always`, `structureBuilt: { structureId: string }`, `skillPurchased: { skillId: string, minLevel: u32 }`, extensible). Seeded in v1 with one slot: `tool`, `unlockCondition: structureBuilt('armory')`. Future slots (`back`, `chest`, `head`, etc.) added by inserting rows.
+ A private view `myVisibleEquipmentSlots` returns only the slots whose `unlockCondition` the calling player has met. Identical pattern to `myVisibleSkillTrees` from the Skill Tree Tiers spec. The client renders one slot per row.
+ A new `player_equipment` table: `id` (u64 primary key autoinc), `username` (string), `slotId` (string), `itemInstanceId` (u64). Indexed by `username` (`accessor: 'player_equipment_username'`). Unique constraint enforced in reducer logic on `(username, slotId)` — only one item per slot. (SpacetimeDB doesn't support multi-column unique constraints natively; the reducer must check.)

Equip / unequip reducers:
+ `equipItem({ itemInstanceId: u64 })` — validates: instance exists and `ownerUsername === ctx.sender`'s username; the item's `itemDefId.slotId` is in the player's visible slots. If a different item is already in that slot, internally calls `unequipItem` first (which clears the prior item's stat sources). Inserts a `player_equipment` row. For each `item_instance_affix` on the equipped item, calls `setStatSource(ctx, '{username}:equipment:{itemInstanceId}:{statId}', username, statId, amount)`.
+ `unequipItem({ slotId: string })` — finds the player's `player_equipment` row for that slot. Calls `clearStatSourcesByPrefix(ctx, username, '{username}:equipment:{itemInstanceId}:')` to remove every stat row for this instance in one call. Deletes the `player_equipment` row.
+ Item instances are never deleted by equip/unequip — they move between "in inventory" (no `player_equipment` row referencing them) and "equipped." Inventory is implicit: any `item_instance` owned by the player and *not* referenced by a `player_equipment` row is in inventory.

Armory state and upgrade:
+ A new `player_armory_state` table: `username` (string primary key), `level` (u32 — 1 when first built, increments via upgrade), `builtAt` (timestamp). One row per player; row exists only after the player builds the Armory.
+ A new `armory_upgrade_cost` table describes the resource cost to advance to a given level: `id` (u64 primary key autoinc), `targetLevel` (u32), `resourceId` (string), `amount` (u64). Multiple rows per `targetLevel`, one per resource required. Indexed by `targetLevel` (`accessor: 'armory_upgrade_cost_level'`). Costs scale with level (e.g., level 2 costs 50 scrap + 20 parts; level 3 costs 150 scrap + 60 parts + 10 metal; etc.). Concrete cost curve is a tuning concern, seeded with sensible v1 numbers.
+ `upgradeArmory()` reducer — validates: `player_armory_state` exists; player has the resources for `level + 1`. Deducts resources, increments `level`. Throws `SenderError` if any precondition fails.

Crafting:
+ A new `crafting_recipe` table: `recipeId` (string primary key), `itemDefId` (string foreign key — the template this recipe produces), `unlockedAtArmoryLevel` (u32 — recipe is hidden / uncraftable below this level), `sortOrder` (u32). One row per recipe.
+ A new `crafting_recipe_cost` table: `id` (u64 primary key autoinc), `recipeId` (string foreign key), `resourceId` (string), `amount` (u64). Multiple rows per recipe. Indexed by `recipeId` (`accessor: 'crafting_recipe_cost_recipe'`).
+ A private view `myAvailableRecipes` returns the recipes the player can currently craft, given their armory level. If the player has no `player_armory_state` row, the view returns nothing.
+ `craftItem({ recipeId: string })` reducer:
  1. Validate: `player_armory_state` exists; recipe exists; recipe's `unlockedAtArmoryLevel <= player armory level`; player has the costs.
  2. Deduct resource costs.
  3. Roll affixes (see "Affix rolling" below) — produces a list of `(statId, amount)` pairs.
  4. Insert `item_instance` row, capturing `armoryLevelAtCraft = current level`.
  5. Insert one `item_instance_affix` row per rolled affix.
  6. The new instance is in inventory automatically (no `player_equipment` row exists for it yet).

Affix rolling:
+ Reducers must be deterministic — no true randomness. Affix rolls use a deterministic PRNG seeded from a hash of `(ctx.timestamp.microsSinceUnixEpoch, ctx.sender, recipeId, a per-craft counter)`. Implementation detail, but the seed must vary per craft; the per-player `player_armory_state` row is a convenient place to hold a `craftCounter: u64` field that the craft reducer increments on every call to guarantee distinct seeds across crafts in the same microsecond.
+ Roll procedure:
  1. Pull all `item_definition_affix` rows for the recipe's `itemDefId`.
  2. Apply every `isGuaranteed: true` affix — produces one rolled `(statId, amount)` per row.
  3. From the remaining (`isGuaranteed: false`) pool, draw `optionalRollCount` affixes by weighted selection without replacement using `rollWeight`. (If the pool has fewer non-guaranteed rows than `optionalRollCount`, draw all of them.)
  4. For each selected affix, compute `amount = roll(minAmount, maxAmount, armoryLevel)`.
+ Roll formula (`roll(min, max, armoryLevel)`):
  - Define a per-level bias `bias = clamp((armoryLevel - 1) / (maxArmoryLevel - 1), 0, 1)` — at level 1, bias is 0; at the cap, bias is 1.
  - Draw a uniform `u ∈ [0, 1)` from the seeded PRNG.
  - Skew it: `skewed = u^(1 - bias * 0.7)` — at low armory level, distribution is uniform; at high level, distribution increasingly favors values near 1.
  - `amount = round(min + skewed * (max - min))`.
  - The exponent constant (`0.7`) is a tuning knob — picked so that level 1 averages ~midpoint and the cap averages ~85% of max. Adjust as playtesting demands. The `maxArmoryLevel` cap is a tuning constant in the seed (proposed v1: 10).

Frontend:
+ **Equipment menu** (existing bottom-bar entry per the original `Equippable Items.md` spec). Renders one card per slot from `myVisibleEquipmentSlots`. Each slot shows either the equipped item (icon, name, affix list with `+N stat` per affix) or an empty placeholder with a "Tap to equip" CTA. Tapping an empty slot opens the inventory filtered to items matching that slot. Tapping an equipped item opens an action sheet with "Unequip" and "Replace."
+ **Inventory list** — accessible from the Equipment menu and from the Armory screen. Renders every `item_instance` owned by the player, grouped by slot. Each card shows item name, affixes (`+3 Fortune`, `+1 Focus`), armory level at craft, and an Equip / Unequip button depending on current state.
+ **Armory screen** — a section inside the Shelter once the Armory is built. Shows current armory level, an Upgrade button with the resource cost for the next level (disabled if costs not met), and a recipe list from `myAvailableRecipes`. Each recipe card shows the item it produces, its resource cost, and a Craft button (disabled if costs not met). Successful crafts surface a brief toast with the rolled affixes ("Rucksack crafted: +3 Fortune, +1 Focus").
+ **Character panel source resolution** — per the Core Stats System spec, the breakdown view shows source labels. The client splits `sourceKey` on `:`, skips the leading `username` segment (always the calling player on `myStatBreakdown`), and resolves `equipment:{itemInstanceId}:{statId}` → look up `item_instance` by id → look up `item_definition.displayName` → render as e.g. "Rucksack: +3 Fortune". Subscribe to `item_instance` and `item_definition` so resolution is local.

V1 seed content:
+ **Slots seeded:** `tool` (unlocked by Armory build), `chest` (unlocked by Armory build). Both surface the moment the Armory exists; a slot being unlocked just means it appears in `myVisibleEquipmentSlots` — recipes that fill it are independently gated by armory level.
+ **Item templates seeded:**
  - `rucksack` — slot `tool`. Affix pool: Fortune (1–10, weight 5, guaranteed), Focus (1–5, weight 3, optional). Roll: 1 guaranteed + 1 optional.
  - `handgun` — slot `tool`. Affix pool: Power (1–10, weight 5, guaranteed), Vigor (1–8, weight 3, optional). Roll: 1 guaranteed + 1 optional. Unlocked at armory level 2.
  - `armor_vest` — slot `chest`. Affix pool: Vigor (3–15, weight 5, guaranteed). Roll: 1 guaranteed + 0 optional. Unlocked at armory level 3.
+ **Recipes seeded:** one per template, with costs scaling roughly with the template's power. Concrete costs are a tuning concern, deferred to seed-time decisions.
+ **Armory upgrade costs** seeded for levels 2–10, scaling across all six resources (later levels require Medicine).
+ Note: the Rucksack's prior described effect ("+50% Click Resource Yield") is superseded by Fortune affixes. The Activities system reads Fortune via the Core Stats System and applies its own derivation (e.g. `clickYieldMultiplier = 1 + Fortune * 0.05`). That derivation belongs to the Activities system spec, not here.

Extensibility:
+ Adding a new item template: insert one `item_definition` row, N `item_definition_affix` rows, one `item_definition_roll` row, one `crafting_recipe` row, M `crafting_recipe_cost` rows. No client changes if the slot already exists.
+ Adding a new slot: insert one `equipment_slot_definition` row with the appropriate `unlockCondition`. No client changes — the equipment menu reads from `myVisibleEquipmentSlots` and renders dynamically.
+ Adding a new stat: handled by the Core Stats System spec. Items can begin rolling the new stat as soon as `item_definition_affix` rows reference it.
+ Item upgrading, re-rolling affixes, sockets, set bonuses — all out of scope for v1. Each is a future spec; the schema as designed doesn't preclude any of them.

Migration:
+ This is a greenfield system — no existing item / armory data to migrate. No-op migration.
+ Players who exist when this ships start with no `player_armory_state` row, no items, no equipped gear. They build the Armory through the existing structure-build flow (which gains an entry for `armory` if it doesn't already have one; that's a `structure_definition` seed addition).
+ The original `Equippable Items.md` and `The Armory.md` spec files should be marked as superseded once this spec is implemented — either deleted or with a top-line "Superseded by `Equipment & Armory Stat Rework.md`" note. The latter is gentler if other docs reference them by name.

Placeholders:
+ Concrete affix ranges, recipe costs, and armory upgrade costs in the v1 seed are illustrative starting points. Expect tuning during playtesting. Costs are data, not code, so updates are seed edits.
+ The deterministic PRNG implementation (LCG, xorshift, hash-based, etc.) is implementation choice — the spec only requires that it be deterministic, distinct per craft, and uniformly distributed. A small wrapper module (`server/src/rng.ts`) is the natural home.
+ Item destruction / sell-for-resources is a likely near-future feature but is out of scope for v1. When added: a `destroyItem({ itemInstanceId })` reducer will need to refund some fraction of crafting cost, delete the affix rows, delete the instance, and (if equipped) call `unequipItem` first to clear the stat sources.
+ Item icons follow the same pattern as stat icons — `iconKey` exists in the schema, but the client may render text-only fallbacks until art is produced.
