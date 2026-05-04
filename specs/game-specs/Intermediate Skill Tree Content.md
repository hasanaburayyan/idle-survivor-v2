Overview:
The Intermediate Skill Tree — defined structurally by `The Skill Tree Tiers.md` but shipped empty in v1 of that spec — gets its v1 content here. Intermediate is the player's primary outlet for stat progression: every node grants Vigor, Power, Focus, or Fortune via the Core Stats System. v1 ships eight nodes — a Minor and a Major (capstone) chain for each of the four stats — using the tiered "max-the-minor-to-unlock-the-major" pattern. The Intermediate tree shares the `general` skill point pool with Beginner, so points earned by leveling up after Beginner completion naturally flow here. This spec adds one new schema table (`skill_stat_grant`), modifies the existing `upgradeSkill` reducer to honor it, and seeds the eight nodes plus their stat grants.

User Story:
A player has just maxed every node in the Beginner tree. The Skill Tree screen now shows two tabs: Beginner and Intermediate. They tap Intermediate and see a star-shaped web with eight nodes — four Minor stat nodes around an empty center (Vigor north, Power east, Focus south, Fortune west) and four Major capstones radiating further out, each greyed and locked behind its corresponding Minor. They have one unspent skill point. They tap Vigor Minor and spend the point — the node ticks to level 1, and on their Character panel the Vigor line jumps from 0 to 1. The breakdown tooltip now shows "Vigor Minor: +1". They keep playing, level up several more times, and gradually max Vigor Minor at level 4 (+4 Vigor total). The Vigor Major capstone unlocks; their next point goes there. Vigor Major level 1 grants +3 Vigor on top of the +4 they already have, taking their Vigor to 7. Maxing Vigor Major eventually brings them to +16 Vigor from the Intermediate tree alone.

Requirements:
+ Server authoritative. All node definitions and stat grants live on SpacetimeDB. Stat contributions flow through the Core Stats System's `player_stat_source` table; this spec does not introduce a parallel write path.
+ This spec depends on the Core Stats System spec (for stat aggregation) and the Skill Tree Tiers spec (for the Intermediate tree's existence and the `general` point pool). It assumes both are implemented.

Schema additions:
+ A new `skill_stat_grant` table describes which stats a skill grants per level: `id` (u64 primary key autoinc), `skillId` (string foreign key to `skill_definition`), `statId` (string foreign key to `stat_definition`), `amountPerLevel` (i32 — signed so future debuff-style nodes are representable). Indexed by `skillId` (`accessor: 'skill_stat_grant_skill'`). Multiple rows per skill are allowed — a future node could grant both +1 Vigor *and* +1 Power per level by inserting two rows. v1 nodes each grant a single stat, so they each have one row.
+ No changes to `skill_definition`, `skill_prerequisite`, or `player_skill` schemas — the existing tables already cover node identity, prerequisites, and per-player level. Stat grants are an *attached* fact, not a column on the node.

Reducer changes:
+ The existing `upgradeSkill({ skillId })` reducer (defined by the Skill Tree Tiers spec, which migrated it from the original Beginner-only flow) gains one step at the end:
  - After incrementing `player_skill.level` (call the new value `newLevel`), iterate over every `skill_stat_grant` row whose `skillId` matches the upgraded skill. For each, compute `total = newLevel * amountPerLevel` and call `setStatSource(ctx, '{username}:skill:{skillId}:{statId}', username, statId, total)` — an upsert that replaces the prior level's contribution with the new one.
  - Because the sourceKey is deterministic per `(username, skill, stat)`, re-spending into the same node correctly *replaces* the contribution rather than stacking duplicate rows.
+ No reducer changes needed for nodes that have *no* `skill_stat_grant` rows — the iteration is a no-op, so Beginner nodes (which grant no stats) are unaffected.
+ If a future skill-refund reducer is added, it will need a corresponding step that calls `setStatSource` with the post-refund level (or `clearStatSource` if refunded to zero). Out of scope for v1.

Tree completion interaction:
+ The Intermediate tree's `completionRule` (defined in the tier definition seed from the Skill Tree Tiers spec) should be `allNodesMaxed`, identical to Beginner. With v1's eight nodes, "complete Intermediate" means every node at level 4. This produces a clear graduation moment that future tiers (class trees, etc.) can gate on.
+ The Intermediate tier definition must be updated as part of this spec's seed step: replace its placeholder `none` completionRule (per the Skill Tree Tiers placeholder section) with `allNodesMaxed`. The placeholder "Coming soon" node from that spec's v1 is removed in the same seed.

V1 node seed:
The eight nodes are seeded into `skill_definition` with `treeId: "intermediate"` and into `skill_stat_grant` for their stat contributions. Layout coordinates form a star pattern around the origin; tune in implementation as the visual web demands.

| skillId | name | maxLevel | costSkillPoints | prerequisiteSkillId | prerequisiteLevel | positionX | positionY | Stat grant |
|---|---|---|---|---|---|---|---|---|
| `vigor_minor` | Vigor Minor | 4 | 1 | (none) | 0 | 0 | -1 | +1 Vigor / level |
| `vigor_major` | Vigor Major | 4 | 2 | `vigor_minor` | 4 | 0 | -2 | +3 Vigor / level |
| `power_minor` | Power Minor | 4 | 1 | (none) | 0 | 1 | 0 | +1 Power / level |
| `power_major` | Power Major | 4 | 2 | `power_minor` | 4 | 2 | 0 | +3 Power / level |
| `focus_minor` | Focus Minor | 4 | 1 | (none) | 0 | 0 | 1 | +1 Focus / level |
| `focus_major` | Focus Major | 4 | 2 | `focus_minor` | 4 | 0 | 2 | +3 Focus / level |
| `fortune_minor` | Fortune Minor | 4 | 1 | (none) | 0 | -1 | 0 | +1 Fortune / level |
| `fortune_major` | Fortune Major | 4 | 2 | `fortune_minor` | 4 | -2 | 0 | +3 Fortune / level |

+ Maximum Intermediate contribution per stat: `4 × 1 + 4 × 3 = 16`. Across all four stats, a fully-maxed Intermediate tree grants 64 stat points total.
+ Total skill points required to max Intermediate: `(4 × 1 + 4 × 2) × 4 stats = 48`. Players reach this over many levels post-Beginner; the exact pacing depends on the level-up cadence and is a tuning concern outside this spec.
+ Node `description` strings (e.g. "Increase your Vigor by 1 per level. Vigor scales survivability — HP in the Defensive Battle, charges and resilience in other minigames.") are seeded with copy that explains both the numeric effect and the stat's general role. The exact wording is editorial and can be tuned without code changes.
+ All eight nodes have `prerequisitePlayerLevel: 0` — Intermediate visibility is already gated by Beginner completion at the tier level (per the Skill Tree Tiers spec's `myVisibleSkillTrees` view), so no extra per-node player-level prereq is needed.

Frontend:
+ No new screens. The existing Skill Tree screen (per Skill Tree Tiers) renders Intermediate the moment it appears in `myVisibleSkillTrees`. Each node's display is driven by `skill_definition` data and any associated `skill_stat_grant` rows — the node card should surface the stat grant prominently (e.g. "+1 Vigor per level"), pulling from `skill_stat_grant` joined to `stat_definition.displayName`. Subscribe to both tables.
+ When a node's level changes, `myStatTotals` and `myStatBreakdown` (from the Core Stats System) update automatically and the Character panel reflects the new totals — no extra wiring needed in this spec.
+ The "Coming soon" placeholder node introduced in the Skill Tree Tiers spec's v1 is removed from the seed in the same migration that adds the eight Intermediate nodes.

Extensibility:
+ Adding a new Intermediate node: insert one `skill_definition` row (with `treeId: "intermediate"`) and one or more `skill_stat_grant` rows. No code changes. The visual web auto-renders from definition rows.
+ Non-stat Intermediate nodes (e.g. unlock a new action, unlock a structure) are valid future additions — they simply don't have `skill_stat_grant` rows. The `upgradeSkill` reducer becomes the integration point for *any* per-skill side-effect type; future side-effects (action unlocks, structure unlocks) follow the same "iterate over a side-table after level increment" pattern.
+ Multi-stat nodes (a single node granting two stats) are supported by the schema — insert multiple `skill_stat_grant` rows per `skillId`. v1 doesn't ship any but the design accommodates them.
+ Tree caps: the +1 → +3 progression in v1 is intentionally simple. Future Intermediate content (deeper chains, hybrid nodes, conditional grants) layers on top without schema change.

Migration:
+ A one-shot seed migration:
  1. Update the `intermediate` row in `skill_tree_definition`: change `completionRule` from `none` to `allNodesMaxed`.
  2. Delete the "Coming soon" placeholder node row from `skill_definition` (and any orphan `skill_stat_grant`, `skill_prerequisite`, or `player_skill` rows referencing it — though `player_skill` rows shouldn't exist since the placeholder wasn't upgradeable).
  3. Insert the eight `skill_definition` rows above with `treeId: "intermediate"`.
  4. Insert the four `skill_prerequisite` rows linking each Major to its Minor at level 4 (or rely on `skill_definition.prerequisiteSkillId` / `prerequisiteLevel` columns — match whichever convention the existing seed code uses).
  5. Insert the eight `skill_stat_grant` rows.
+ Existing players are unaffected by the table additions until they spend a point in Intermediate. No backfill needed; `player_skill` rows for the new nodes simply don't exist until a player buys in.
+ Players who somehow had a `player_skill` row for the deleted "Coming soon" placeholder node get that row deleted too (defensive cleanup; expected to be empty).

Placeholders:
+ Per-level cost (`costSkillPoints` of 1 for Minor, 2 for Major) is the v1 starting point. Easy to retune in seeds during playtesting.
+ The +1 / +3 magnitudes are illustrative — they're chosen to make Major capstones meaningfully more impactful per spend. The spec accommodates any integers; pick what playtests well.
+ Visual layout coordinates are rough cardinal positions. Designers should adjust to match the chosen art / web style without changing semantics.
+ A future "Intermediate completion" celebratory popup or unlock event (analogous to "Beginner Skill Tree complete" from the Tutorial Flow spec) is recommended but not required in v1. When added, it gates on `treeCompleted("intermediate")` via the same notification helper Beginner uses.
