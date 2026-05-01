Overview:
The Skill Tree menu becomes a tabbed view where each tab is a separate **skill tree tier**. The current onboarding tree is rebranded as the **Beginner Skill Tree** — its purpose is to introduce the player to resource discovery, balancing earn-versus-spend, and pacing them into the rest of the game's systems. When the player completes the Beginner tree (every node maxed), a second tab — the **Intermediate Skill Tree** — appears next to it, and any further skill points the player earns can be spent there. Skill points earned via player leveling are shared between Beginner and Intermediate; the player's 31st earned point naturally flows into Intermediate after Beginner is full. Future tiers (class trees, prestige trees, etc.) live behind their own unlock conditions and may use entirely different point-earning systems (achievement-based, drop-based, etc.). The data model is structured up front to support that without churn. Per repo convention, tabs for tiers the player cannot yet interact with are hidden entirely — never greyed-out placeholders.

User Story:
A new player opens the Skill Tree menu and sees only the Beginner tab. As they level up they spend skill points unlocking and upgrading nodes — Parts, Metal, Fabric, Food, Meds — discovering the game's resources one at a time. Eventually they max every node in Beginner; the next time they open the menu, an Intermediate tab is sitting next to Beginner. Their next level-up grants a skill point that can be spent in either tree, but Beginner is already done, so the point is effectively earmarked for Intermediate.

Requirements:
+ Server authoritative. A new `skill_tree_definition` table on SpacetimeDB describes each tier: `treeId` (string primary key), `displayName`, `description`, `sortOrder`, `unlockCondition` (tagged union — see below), `completionRule` (tagged union — see below), and `pointPoolId` (string foreign key to a `skill_point_pool_definition` row).
+ `unlockCondition` is a tagged union: `always` (Beginner), `treeCompleted` carrying a `treeId` (Intermediate is unlocked when `beginner` is completed), and a placeholder `manual` variant for future tiers gated by other systems (e.g., choosing a class). The variant list is extensible.
+ `completionRule` is a tagged union: `allNodesMaxed` (Beginner — every `skill_definition` in this tree has a corresponding `player_skill` row at `level === maxLevel`) and a placeholder `none` variant for trees that don't gate anything else on completion. Extensible.
+ A new `skill_point_pool_definition` table describes pools: `poolId` (string primary key), `displayName`, `sortOrder`. Seeded with one pool for v1: `general`. Future class trees will introduce their own pools (e.g. `class_warrior`).
+ The existing `skill_definition` table gains a `treeId` column joining to `skill_tree_definition`. All current Beginner skills are seeded with `treeId: "beginner"`.
+ A new `player_skill_point_balance` table holds per-pool balances: `(username, poolId, amount)` indexed by `username`. The existing `playerState.skillPoints` field is migrated into this table as the player's `general` pool balance. The server-side level-up flow that currently does `skillPoints += 1` is updated to write to the `general` pool row instead. The frontend stops reading `playerState.skillPoints` and reads the pool balance instead.
+ Skill spend reducers (`upgradeSkill`, etc.) deduct from the pool that the skill's tree references — not from a hardcoded field — so that a future class tree's spend correctly subtracts from `class_warrior` rather than `general`.
+ Tab visibility is enforced server-side: a private view `myVisibleSkillTrees` returns only the rows from `skill_tree_definition` whose `unlockCondition` the player has met. Trees the player can't yet interact with are never returned. The client renders one tab per row.

Tree completion check:
+ A server-side helper `isTreeCompleted(ctx, username, treeId)` walks the tree's `skill_definition` rows and confirms each has a `player_skill` row at max level. It is called by the `myVisibleSkillTrees` view (to expose Intermediate once Beginner is done) and by any other system that wants to gate on completion.
+ When the player earns the skill point that completes the Beginner tree (the spend that takes the final node to max level), fire a one-shot system notification through the existing notifications tray ("Beginner Skill Tree complete — Intermediate tab unlocked.") so the unlock isn't silent. Single line of code in the spend reducer.

Tidy-up to the existing Beginner tree:
+ Stamp every existing `SKILL_SEED` and `SKILL_PREREQ_SEED` with `treeId: "beginner"`.
+ Drop the planned `Unlock Classes` no-op capstone (specced in `Skill tree rework.md` but never implemented). The `allNodesMaxed` completion rule symbolizes graduation directly; a free no-op node would clutter the tree without adding meaning. If a ceremonial graduation node is desired later it can be added to Intermediate as its starting node, where it'd actually do something.
+ Verify the existing Build Shelter prereq on `unlock_shelter` still functions correctly after the seed changes.

Frontend:
+ The Skill Tree screen renders a horizontal tab strip across the top, one tab per row in `myVisibleSkillTrees`, sorted by `sortOrder`. Selecting a tab swaps the pannable web below to that tree's nodes. Default-selected tab on screen open: the lowest-sortOrder tree that has unspent points in its pool, falling back to the lowest-sortOrder tree overall.
+ Each tab can show a small "X/Y" progress indicator (nodes-maxed / total-nodes) to give players a sense of how much of a tree is left.
+ A per-pool point counter renders next to or above the active tab, showing the remaining spendable balance in the pool that tree draws from. Players whose only unlocked tier is Beginner just see one counter.

Extensibility:
+ Adding a new tier: insert a `skill_tree_definition` row, optionally a new `skill_point_pool_definition` row, and seed the new tree's skills with the matching `treeId`. No client changes are needed for the tab to appear when the player unlocks it.
+ Alternate point-earning methods for future tiers (achievement-based, drop-based, etc.): grants come from whatever reducer makes sense for that earning system (e.g., a minigame's `onEnd` granting `class_warrior` points by writing to `player_skill_point_balance`). The skill tree system itself is agnostic about where points came from — it only cares which pool to spend from when a player upgrades a node.

Placeholders:
+ The Intermediate tree's *content* is out of scope for this spec. v1 ships an empty Intermediate tree (no `skill_definition` rows seeded with `treeId: "intermediate"`). Its tab still appears upon Beginner completion, with the web showing a single placeholder "Coming soon" node so players see the surface and aren't left wondering. Points earned post-Beginner-completion bank in the `general` pool against future Intermediate content — they aren't lost.
+ Tutorial popups guiding new players through the Beginner tree are explicitly **out of scope** for this spec. They live in a separate Tutorial Flow spec which builds an obtrusive, click-through popup primitive that runs alongside the Beginner tree until completion, then turns itself off.
