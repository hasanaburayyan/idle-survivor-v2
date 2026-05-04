Overview:
The Defensive Battle's options-on-screen mechanic is backed by a generalized **action system**: every "option" the player can grab and drag onto a target is an `action_definition` row with a typed effect, a targeting rule, and per-stat scaling. Players have a pool of *known* actions (some default, some unlocked via skills / items / structures) and a *loadout* of equipped actions they bring into battle. The loadout is persistent and shared between two UI surfaces — the Armory (out-of-battle planning) and the Defensive Battle's pre-game lobby (last-minute swaps). This spec defines the catalog, the unlock and loadout contracts, the effect-and-scaling formula contract, and the loadout UI. **Battle-side mechanics — how the loadout becomes a hand-of-three, how options resolve in real time, wave generation, voting, loot — live in `The Defensive Battle.md`, not here.** This spec ends at "the Defensive Battle reads a player's loadout and applies effects using the formulas defined here."

User Story:
A player has just built the Armory and unlocked the Defensive Battle. They tap the Armory's new "Loadout" sub-tab and see six numbered slots — five filled with default actions (Strike, Volley, Revive, Rally, Ward) and one empty. To the side, a panel lists their known actions, with the same five plus a new one — "Overwatch" — granted by the Handgun they just equipped. They drag Overwatch into slot 6. Each slot card shows a live preview: "Strike — deal 3-10 damage to one enemy (base 1-8, +2 from Power 2)." Later, the party calls a vote to start a Defensive Battle. The lobby surfaces the same loadout view, but with a "ready" button below it; they swap Volley out for Overwatch's twin and ready up. The battle begins; their loadout is what feeds the in-battle option deck.

Requirements:
+ Server authoritative. All action definitions, scaling, known-actions, and loadouts live on SpacetimeDB. Effect resolution math is computed server-side in the battle reducer (defined by `The Defensive Battle.md`) using the formulas this spec defines.
+ This spec depends on the Core Stats System spec (for stat totals fed into scaling). It does not depend on `The Defensive Battle.md` at the schema level — the action system is a standalone subsystem, even though its v1 sole consumer is the Defensive Battle.

Action catalog:
+ A new `action_definition` table: `actionId` (string primary key), `displayName` (string), `description` (string — player-facing one-liner about effect and target), `iconKey` (string), `targeting` (tagged union — see below), `effect` (tagged union — see below), `sortOrder` (u32). Templates are static seeds; players never insert here.
+ `targeting` variants describe what the player can drag the option onto:
  - `singleEnemy` — one zombie
  - `allEnemies` — all zombies on the screen at resolution time
  - `singleAlly` — one party member (including self)
  - `allAllies` — every party member
  - `partyIncludingSelf` — same set as `allAllies` in v1; named distinctly so future "exclude self" variants can be added without renaming
  - Extensible. The Defensive Battle's UI maps each variant to its drop-target rules.
+ `effect` variants describe what happens on resolution:
  - `damage: { baseMin: i32, baseMax: i32 }` — random integer in [min, max] dealt to the target(s)
  - `healAmount: { baseMin: i32, baseMax: i32 }` — random integer in [min, max] healed on the target(s), capped at target max HP
  - `healFull: {}` — heal target(s) to current max HP. Carries no numeric parameters; stat scaling is not applicable.
  - `ward: { baseCount: u32 }` — prevent the next N instances of damage that would land on each target. Stacks additively if applied multiple times.
  - Extensible. New variants (cleanse, buff, summon, etc.) can be added later — both the resolution code and any UI handling are keyed off the variant tag.
+ A new `action_stat_scaling` table: `id` (u64 primary key autoinc), `actionId` (string foreign key), `statId` (string foreign key to `stat_definition`), `scalingKind` (tagged union — see below). Indexed by `actionId` (`accessor: 'action_stat_scaling_action'`). Multiple rows per action allowed (one stat scales magnitude, another scales count, etc.).
+ `scalingKind` variants describe *how* a stat's total modifies the effect:
  - `addToBoth: { perPoint: i32 }` — adds `perPoint × statTotal` to both `baseMin` and `baseMax` of `damage` / `healAmount` effects. The most common case.
  - `addToMax: { perPoint: i32 }` — adds only to `baseMax` (variance scaling — the floor is unchanged, the ceiling rises).
  - `addToMin: { perPoint: i32 }` — adds only to `baseMin` (consistency scaling — bad rolls become less bad).
  - `addToCount: { perPoint: i32 }` — adds `perPoint × statTotal` to `ward.baseCount`.
  - Extensible. New scaling kinds (multiplicative, threshold-based, etc.) added as variants.
+ Scalings that target a parameter the action's `effect` variant doesn't have (e.g. `addToCount` on a `damage` action) are no-ops. The seed should never produce these but the resolver must tolerate them.

Player known actions:
+ A new `player_known_action` table: `sourceKey` (string primary key), `username` (string), `actionId` (string foreign key). Indexed by `username` (`accessor: 'player_known_action_username'`). The same deterministic-sourceKey pattern from the Core Stats System: a player "knows" an action by virtue of one or more rows in this table. Multiple rows for the same `(username, actionId)` are allowed (an action granted by both a skill and an item just sits as two rows; deleting one doesn't remove the action so long as another grant remains).
+ Source-key naming convention: `{username}:{kind}:{refId}:{actionId}`. Kinds in v1: `default` (granted at account creation), `equipment` (granted by an equipped item). Future kinds: `skill`, `structure`. Same enforcement rule as stat sources — convention enforced by callers, schema treats key as opaque.
+ Source-management helpers (server-side, in a new `actions.ts` module on the server, parallel to `stats.ts`):
  - `grantKnownAction(ctx, sourceKey, username, actionId)` — inserts the row if not present (no-op if already there). Used when a default action is initialized, an item granting an action is equipped, etc.
  - `revokeKnownAction(ctx, sourceKey)` — deletes the row if it exists. Used when an item granting an action is unequipped. **Side effect:** if removing this row leaves the player with zero remaining grants for that `actionId`, also call `removeFromLoadoutIfPresent(ctx, username, actionId)` — clears any loadout slot referencing the now-unknown action so the player can't equip something they no longer know.
  - `revokeKnownActionsByPrefix(ctx, username, prefix)` — deletes all rows for `username` whose `sourceKey` starts with `prefix`. Used when an item is destroyed (one call clears every action that item granted). Same loadout-cleanup post-step applies per affected `actionId`.
  - `removeFromLoadoutIfPresent(ctx, username, actionId)` — internal: if any `player_action_loadout` row references `actionId` for `username`, delete it. Idempotent.

Default-action initialization:
+ Every new player receives the v1 default actions on account creation. The `clientConnected` lifecycle hook (or whatever existing reducer first creates a `playerState` row for a new account) calls `grantKnownAction` once per default action with sourceKey `{username}:default:{actionId}`. Existing players need a one-shot migration that does the same — see Migration.
+ Default actions never have their grants revoked. The `default:` sourceKey is sticky.

Loadout:
+ A new `player_action_loadout` table: `id` (u64 primary key autoinc), `username` (string), `slotIndex` (u32 — 0-indexed), `actionId` (string foreign key). Indexed by `username` (`accessor: 'player_action_loadout_username'`). A row's existence means "slot N holds action X for this player." Absent rows mean the slot is empty.
+ Slot count: v1 ships with **6 loadout slots** (`slotIndex` valid range 0–5). The cap is a constant in the seed code; making it configurable per-minigame is a future extension.
+ Uniqueness: the `setLoadoutSlot` reducer enforces (via lookup, since SpacetimeDB has no multi-column unique constraint) that the same `actionId` appears at most once across a player's loadout — no duplicate actions in the same loadout. The same lookup also enforces one row per `(username, slotIndex)`.
+ On account creation, after default actions are granted, the loadout auto-fills: slot 0 gets `strike`, slot 1 gets `volley`, slot 2 gets `revive`, slot 3 gets `rally`, slot 4 gets `ward`. Slot 5 is empty for the player to fill with a future unlock.

Loadout reducers:
+ `setLoadoutSlot({ slotIndex: u32, actionId: string })` — validates: `slotIndex` in [0, 5]; `actionId` exists; the player has at least one `player_known_action` row for `(username, actionId)`; `actionId` is not already present in any other slot for this player. If a row exists at `(username, slotIndex)`, update its `actionId`; otherwise insert. Throws `SenderError` on validation failure.
+ `clearLoadoutSlot({ slotIndex: u32 })` — deletes the row at `(username, slotIndex)` if present. No-op if the slot is already empty. No throw.
+ `swapLoadoutSlots({ slotA: u32, slotB: u32 })` — swaps the actions in two slots in one atomic reducer call. Validates both indices in range. Either slot may be empty; if one is empty and the other isn't, the action moves and the originally-occupied slot becomes empty.

Effect resolution contract (consumed by The Defensive Battle):
+ The Defensive Battle's reducers compute effect outputs by joining `action_definition`, `action_stat_scaling`, and the player's `myStatTotals`. The resolution function lives in `actions.ts` on the server:
  - `resolveAction(ctx, username, actionId) → ResolvedAction` — returns the effect with stat scaling applied and any random rolls realized. Used at the moment a player drops an option onto a target.
  - For `damage` and `healAmount` effects:
    - `resolvedMin = baseMin + Σ(scaling.perPoint × statTotal[scaling.statId])` for all `addToBoth` and `addToMin` rows
    - `resolvedMax = baseMax + Σ(scaling.perPoint × statTotal[scaling.statId])` for all `addToBoth` and `addToMax` rows
    - `rolledValue = randInt(resolvedMin, resolvedMax)` — using the same deterministic PRNG approach as the Equipment & Armory crafting reducer (per-session counter on the battle session row to guarantee distinct seeds across resolutions in the same microsecond).
  - For `ward` effects:
    - `resolvedCount = baseCount + Σ(scaling.perPoint × statTotal[scaling.statId])` for all `addToCount` rows.
  - For `healFull` effects: no scaling, no roll. The resolver returns a marker that the battle code interprets as "set target HP to its current max."
+ Stat snapshot rule (per the Core Stats System spec): the Defensive Battle MUST snapshot stat totals at battle-start into its session table, and `resolveAction` MUST consume the snapshot, not live `myStatTotals`. A player who equips an item mid-battle does not see scaling change until the next battle. This snapshot mechanism is owned by `The Defensive Battle.md`; this spec only defines the formula contract.
+ The resolver returns whether the action was a "ward apply" or a "magnitude apply" so the battle code can route accordingly (apply the rolled number to target HP, or push a "next damage prevented" counter, etc.). The exact ResolvedAction shape is an implementation detail; both modules import the type from `actions.ts`.

V1 seed content:
+ **Default actions seeded:**
  - `strike` — `targeting: singleEnemy`, `effect: damage { baseMin: 1, baseMax: 8 }`. Scaling: Power `addToBoth { perPoint: 1 }`.
  - `volley` — `targeting: allEnemies`, `effect: damage { baseMin: 1, baseMax: 4 }`. Scaling: Power `addToBoth { perPoint: 1 }`.
  - `revive` — `targeting: singleAlly`, `effect: healFull {}`. No scaling.
  - `rally` — `targeting: allAllies`, `effect: healAmount { baseMin: 1, baseMax: 8 }`. Scaling: Power `addToBoth { perPoint: 1 }`, Focus `addToMax { perPoint: 1 }`.
  - `ward` — `targeting: partyIncludingSelf`, `effect: ward { baseCount: 1 }`. No scaling in v1.
+ Five default actions, six loadout slots — slot 5 starts empty by design, so a player who unlocks even one new action immediately has a place to put it without having to drop a default.
+ Future actions seeded by future specs (skill nodes, item unlocks, structures) follow the same pattern: insert one `action_definition` row, N `action_stat_scaling` rows, plus whatever side-table the unlock-source spec uses to wire the grant to its trigger.

Frontend:
+ **LoadoutPanel** — a single React component used in two places. Renders the six slots as a horizontal or grid arrangement, each showing the equipped action (icon, name, scaled effect preview) or an empty placeholder. Below or beside the slots, the player's known-actions list (deduplicated by `actionId`, since multiple grants of the same action just present one entry). Drag-and-drop or tap-to-select is the interaction model; the wire to the server is `setLoadoutSlot` / `clearLoadoutSlot` / `swapLoadoutSlots`.
+ **Effect preview** — for each slot and each known-action card, show the effect with current stat scaling applied. Computed client-side: subscribe to `action_definition`, `action_stat_scaling`, and `myStatTotals`; for each action, compute `resolvedMin` / `resolvedMax` / `resolvedCount` using the same formulas the server uses. Render as e.g. "Strike — deal 3-10 damage (base 1-8, +2 from Power)." Out-of-date stat snapshot during an active battle is a UI concern of the battle screen, not this preview — out of battle, stats are live.
+ **Armory entry point** — the Armory screen (per Equipment & Armory Stat Rework) gains a "Loadout" sub-tab alongside its existing recipe list. Mounts `LoadoutPanel` directly. No additional features in this surface — read and write only.
+ **Defensive Battle lobby entry point** — the Defensive Battle's lobby UI (defined in `The Defensive Battle.md`) mounts the same `LoadoutPanel` component. The battle spec is responsible for the lobby's other elements (vote state, ready button, party member display); it just imports and embeds `LoadoutPanel` for the loadout-management portion.
+ The `LoadoutPanel` does not gate on the Armory being built — players see and edit their loadout from any surface that mounts it. v1's only entry points are Armory and lobby, so in practice the player needs the Armory before they can plan, but if a future surface (e.g. a Character panel sub-tab) mounts the same component, no extra plumbing is required.

Extensibility:
+ Adding a new action: insert one `action_definition` row, N `action_stat_scaling` rows, and have whichever system grants it (skill upgrade reducer, item equip reducer, structure unlock reducer) call `grantKnownAction` with an appropriately-namespaced sourceKey.
+ Adding a new effect variant (cleanse, buff, summon): add to the `effect` tagged union, extend the resolver in `actions.ts`, extend the battle code that consumes ResolvedAction. Frontend preview also gains a render branch for the new variant. No schema migration if the variant is purely additive.
+ Adding a new scaling kind (multiplicative, divisor-based, threshold): add to `scalingKind` tagged union, extend the resolver. Existing rows are unaffected.
+ Per-minigame loadout sizes: v1's hardcoded "6 slots" is a constant in the loadout reducers and seed. Promoting to a per-minigame configurable value is a small refactor — replace the constant with a column on a new `loadout_profile` table keyed by something like `minigameId`. Defer until a second consumer exists.
+ Cooldowns, charges, energy costs — all out of scope for v1. The current model is "any equipped action is always available to be drawn into the battle hand." Adding cooldowns later would mean a per-action `cooldown` field on `action_definition` and per-session cooldown tracking owned by the battle.

Migration:
+ One-shot migration when this spec ships:
  1. Insert all `action_definition` rows for the v1 defaults.
  2. Insert all `action_stat_scaling` rows for those defaults.
  3. For every existing player (rows in `playerState`), call `grantKnownAction` once per default action with sourceKey `{username}:default:{actionId}`.
  4. For every existing player, populate `player_action_loadout` with the default slot assignments (slots 0–4 filled, slot 5 empty).
+ New players created post-migration have these inserts performed by the existing player-creation flow, which gains a step calling `initializeDefaultActionsAndLoadout(ctx, username)` (one helper call, defined in `actions.ts`).
+ No data is destroyed by this migration — the action system is greenfield.

Placeholders:
+ The exact set of v1 default actions, their base ranges, and their scaling perPoints are tuning starting points. All five are pulled from the original Defensive Battle spec; numbers are first-pass and expected to change in playtesting. All values are seed data, not code.
+ Action icons follow the same iconKey-with-text-fallback pattern used by stats and items.
+ Whether the Defensive Battle's in-battle "hand of three" is drawn from the loadout uniformly at random, with replacement, without replacement, weighted, etc., is a battle-mechanic decision owned by `The Defensive Battle.md`. This spec only guarantees that the loadout is a stable, ordered list of up to six actions the player has knowingly equipped.
+ Targeting variants `allAllies` and `partyIncludingSelf` are functionally identical in v1; the distinction exists for forward compatibility (a future "exclude self" target). Either name is fine for v1 seeds.
