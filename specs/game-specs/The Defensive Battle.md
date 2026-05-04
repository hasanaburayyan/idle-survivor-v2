Overview:
A cooperative, real-time, group-only minigame where the party fights successive waves of zombies until everyone dies, then they're returned to where they were before the battle with a loot package whose contents scale with their performance and Fortune. Battles are initiated by any group member calling a vote; if every member votes Yay (within a timeout), the party transitions into a shared battle screen. Each player has a hand of three actions drawn from their loadout; dragging an action onto a valid target resolves it immediately and costs the acting player damage equal to the current zombie count. Waves grow harder (more zombies, higher HP). The battle ends when all participants are at 0 HP. This spec replaces the original `The Defensive Battle.md` in its entirety and depends on the Core Stats System, Equipment & Armory Stat Rework, and Defensive Battle Action System specs.

User Story:
Three friends are scavenging together in The Wastes. One of them taps "Call Defensive Battle" in their group panel. The other two get a notification — even though one is on the Skill Tree screen and the other is mid-craft in the Armory. Both notifications carry inline Yay / Nay buttons. They both tap Yay. The Defensive Battle lobby modal opens for all three players simultaneously, showing their party member cards on the left and a `LoadoutPanel` for last-minute action swaps. Everyone hits Ready. The lobby fades into the battle screen: the party cards stay on the left (each showing their current HP), zombie cards animate onto the right, and a hand of three actions appears under each player's own card. Player A drags Strike onto a zombie — the zombie takes 5 damage (rolled), and Player A's HP ticks down by 4 (the current zombie count). The Strike card is replaced by a freshly-drawn Volley. Player B, low on HP, drags Revive onto Player A — A returns to full HP. They survive wave 1. Wave 2 spawns six tougher zombies. Eventually all three players hit 0 HP. The screen fades, they reappear in The Wastes, scavenging activities still where they left them, with toast notifications listing their loot — "+850 scrap, +12 parts, +1 Rucksack."

Requirements:
+ Server authoritative. The session, participant state, zombie roster, hands, votes, and loot all live on SpacetimeDB. The client is a render layer plus reducer-call shim. Effect math, damage application, wave generation, and loot rolling are all server-side reducers.
+ Depends on:
  - **Core Stats System** — for stat snapshotting and the `getStatTotals` helper.
  - **Equipment & Armory Stat Rework** — for items contributing to those stats.
  - **Defensive Battle Action System** — for `action_definition`, `action_stat_scaling`, `player_action_loadout`, the `resolveAction` server function, and the `LoadoutPanel` component.
  - **Multiplayer / group system** — for the group membership rows that determine the participant set.
  - **Notifications system** — for vote-invite delivery.
  - **Existing minigame framework** — used as the host runtime (member registration, reward dispatch). Voting is a Defensive-Battle-specific extension on top of the framework's existing lobby phase.
+ A Defensive Battle session is a minigame in the framework's sense: the framework's `minigame_member` rows track who's in (preventing concurrent minigames per player), and the framework's reward dispatch is reused for handing out loot at the end. All Defensive-Battle-specific state lives in the new tables defined below.

Schema additions:
+ `defensive_battle_session` — `sessionId` (u64 primary key autoinc), `groupId` (u64 — the group that initiated), `state` (tagged union: `voting`, `inProgress`, `completed`, `cancelled`), `currentWave` (u32 — 0 during voting, 1+ once inProgress), `prngCounter` (u64 — incremented on every randomness draw to keep deterministic seeds distinct), `createdAt` (timestamp), `voteDeadline` (timestamp — when the vote auto-cancels if not resolved), `endedAt` (timestamp, optional). Indexed by `groupId` (`accessor: 'defensive_battle_session_group'`).
+ `defensive_battle_participant` — `id` (u64 primary key autoinc), `sessionId` (u64), `username` (string), `vote` (tagged union: `pending`, `yay`, `nay`), `startLocation` (string — the player's `playerState.location` at vote-cast time, snapshotted so it can be restored), `maxHp` (u32 — derived from snapshotted Vigor), `currentHp` (i32 — signed so overheal/overkill math is safe; clamped at zero before "is defeated" check), `wardCount` (u32 — number of pending damage-prevention charges), `isDefeated` (bool — set true when currentHp first reaches 0). Indexed by `sessionId` (`accessor: 'defensive_battle_participant_session'`) and by `username` (`accessor: 'defensive_battle_participant_username'`).
+ `defensive_battle_stat_snapshot` — `id` (u64 primary key autoinc), `sessionId` (u64), `username` (string), `statId` (string), `total` (i32). Indexed by `(sessionId)` (`accessor: 'defensive_battle_stat_snapshot_session'`). Per the Core Stats System's snapshot rule: at battle start, every participant's `myStatTotals` is read once and frozen here. `resolveAction` uses these rows for the duration of the session — never live totals.
+ `defensive_battle_zombie` — `id` (u64 primary key autoinc), `sessionId` (u64), `waveNumber` (u32 — the wave this zombie belongs to), `currentHp` (i32), `maxHp` (u32), `isDead` (bool). Indexed by `sessionId` (`accessor: 'defensive_battle_zombie_session'`).
+ `defensive_battle_hand_slot` — `id` (u64 primary key autoinc), `sessionId` (u64), `username` (string), `handIndex` (u32 — 0..handSize-1), `actionId` (string). Indexed by `sessionId` (`accessor: 'defensive_battle_hand_slot_session'`). Holds the current per-player hand. When an action resolves, the row's `actionId` is replaced with a fresh draw.
+ `defensive_battle_log` — `id` (u64 primary key autoinc), `sessionId` (u64), `eventAt` (timestamp), `actorUsername` (string — empty string for system events like wave spawn), `eventKind` (tagged union: `voteCast`, `battleStarted`, `actionResolved`, `damageDealt`, `playerDefeated`, `waveCompleted`, `waveStarted`, `battleEnded`), `payload` (string — JSON blob with event-specific details for the client log feed). Indexed by `sessionId` (`accessor: 'defensive_battle_log_session'`). Used to drive the in-battle event log on the client. Bounded by session lifespan.

Voting and lobby:
+ `proposeDefensiveBattle()` reducer — initiator must be in a group of 2+ members (battle is group-only; solo is disallowed). Validates: no existing `voting` or `inProgress` `defensive_battle_session` for this group; no participant already has an active minigame per the framework's `minigame_member` lock. Creates a `defensive_battle_session` with `state: voting`, `voteDeadline: ctx.timestamp + 60 seconds`, `currentWave: 0`. Inserts one `defensive_battle_participant` row per current group member with `vote: pending`. The initiator's row is auto-stamped `vote: yay` (proposing implies voting yes). Schedules an auto-cancel reducer fire at `voteDeadline` via the existing scheduler (per the SpacetimeDB scheduling pattern). Inserts one `notification` per non-initiator group member with `kind: defensiveBattleVote`, carrying `sessionId` as the actionable ref.
+ `voteDefensiveBattle({ sessionId: u64, vote: YayOrNay })` reducer — validates: session exists in `voting` state; caller is a participant; their current `vote` is `pending`. Updates their `vote` row.
  - If the new vote is `nay`: transitions session to `cancelled`, deletes the auto-cancel scheduled job, dispatches `notification` cleanup for the vote-invite refs, no loot, no location change. Battle simply doesn't happen.
  - If the new vote is `yay` and every participant's vote is now `yay`: calls the internal `startBattle(ctx, sessionId)` helper (see below).
+ `cancelDefensiveBattleVote({ sessionId: u64 })` scheduled reducer — fires at `voteDeadline`. If the session is still in `voting`, transitions to `cancelled`, cleans up vote-invite notifications. No-op if the session has already advanced or been cancelled.
+ The lobby modal stays open on every voted-yay player's client until the session transitions to `inProgress` (then it fades into the battle screen) or `cancelled` (then it dismisses with a "Battle cancelled" toast). Yay-voted players see the `LoadoutPanel` (defined by the Action System spec) and can swap loadout slots up until `startBattle` snapshot fires.

Battle setup (`startBattle` helper):
+ Internal helper, called from `voteDefensiveBattle` once all votes are `yay`. Not exposed as a player-callable reducer.
+ Steps:
  1. For every participant: read `getStatTotals(ctx, username)`. Insert one `defensive_battle_stat_snapshot` row per `(participant, statId)`.
  2. For every participant: compute `maxHp = hpFromVigor(vigorSnapshot)` (formula below). Set `currentHp = maxHp`, `wardCount = 0`, `isDefeated = false`.
  3. For every participant: compute `handSize = handSizeFromFocus(focusSnapshot)`. Draw `handSize` actions from their `player_action_loadout` (uniformly at random, with replacement) and insert one `defensive_battle_hand_slot` row per draw. If a participant has zero loadout entries, the battle still starts; their hand is empty and they're a passive participant (and will trivially die first as zombies attack on their inactivity? no — damage only triggers on action resolution; an empty-handed participant just stares at empty slots and contributes nothing, taking no damage and dying last when the rest of the party is wiped. This is a degenerate but valid edge case. The lobby UI strongly nudges players to fill their loadout before readying, but the spec doesn't *require* it).
  4. Spawn wave 1 (see "Wave generation" below).
  5. Transition session `state` from `voting` to `inProgress`. Set `currentWave: 1`, `endedAt: null`.
  6. Per-participant: write `playerState.location = 'defensive_battle:{sessionId}'` so the player's location is unambiguously the battle (their original `startLocation` is preserved on the participant row for later restore). The `defensive_battle:{sessionId}` location is a sentinel — no Activities tab content, no actions available; the client recognizes this prefix and routes to the battle screen unconditionally.
  7. Dispatch `notification` cleanup for the vote-invite refs.
  8. Append `battleStarted` event to `defensive_battle_log`.

Derivation formulas (per the Core Stats derivation contract):
+ `hpFromVigor(vigor: i32) → u32`: `max(20, 50 + vigor * 10)`. A player with 0 Vigor starts at 50 HP; the floor of 20 prevents weird edge cases if Vigor ever goes negative via debuffs. Maxed Intermediate Vigor (16) → 210 HP; combined with mid-tier gear (~15 Vigor) → 360 HP.
+ `handSizeFromFocus(focus: i32) → u32`: `clamp(3 + floor(focus / 8), 3, 5)`. Default 3 hand slots; +1 every 8 Focus, capped at 5. A maxed-Intermediate Focus (16) gives a hand of 5.
+ `lootMultiplierFromFortune(fortune: i32) → f32`: `1.0 + fortune * 0.05`. Linear; 16 Fortune = 1.8× loot quantities. Applied multiplicatively at loot-roll time (`floor(baseAmount * multiplier)`).
+ Power's role is entirely on action effect scaling, defined in the Action System spec's `action_stat_scaling` rows. This battle spec does not introduce additional Power-derived values.
+ Stat snapshots are READ-ONLY for the session duration. Stat changes mid-battle (which shouldn't happen anyway since the player is locked in `defensive_battle:` location) do not affect the session.

Wave generation:
+ A wave is spawned by inserting `defensive_battle_zombie` rows for the current `sessionId` and `waveNumber`. Wave 1 happens at battle start; subsequent waves happen after every zombie of the prior wave is dead.
+ Per-wave zombie count: `zombieCount = baseCount + waveScalar * waveNumber + perPlayerBonus * livingParticipantCount`. v1 seed values:
  - `baseCount = 2`
  - `waveScalar = 1`
  - `perPlayerBonus = 1`
  - Examples: wave 1 with 3 living players → 6 zombies; wave 5 with 2 living → 9 zombies.
+ Per-zombie HP: rolled in `[1, waveNumber]` using the session's deterministic PRNG (seeded by `sessionId + prngCounter`, `prngCounter` incremented per draw). Wave 1 zombies all have 1 HP; wave 5 zombies have HP 1–5.
+ Wave-completion check: after every action resolution (since damage only happens on resolution), check whether every `defensive_battle_zombie` row for `(sessionId, currentWave)` has `isDead: true`. If yes:
  1. Append `waveCompleted` log event.
  2. Increment `currentWave`.
  3. Spawn the next wave via the same generator.
  4. Append `waveStarted` log event.
  - If at the same time *all participants* are defeated, the battle ends (game-over check below) and no new wave spawns.

Hand and option resolution:
+ `resolveAction({ sessionId: u64, handIndex: u32, targetKind: TargetKind, targetId: u64 })` reducer — validates: session is `inProgress`; caller is a participant and not defeated; `handIndex` is in valid range and the slot has an action; the target is valid for the action's targeting variant (e.g. `singleEnemy` requires a live zombie in this session; `singleAlly` requires a participant in this session; `allEnemies` / `allAllies` / `partyIncludingSelf` ignore `targetId`).
+ `TargetKind` is a tagged union: `zombie: { zombieId: u64 }`, `participant: { participantId: u64 }`, `noTarget: {}` (used for AoE/party-wide actions where the target is implied).
+ Resolution steps:
  1. Look up the `actionId` from the hand slot.
  2. Call the Action System's `resolveAction(ctx, callerUsername, actionId)` — this returns the resolved effect with stat scaling applied (using the snapshot table this session, not live totals — the Action System helper takes an optional `statTotalsOverride` param; the battle reducer passes the snapshot).
  3. Apply the resolved effect to the targets:
     - `damage`: apply rolled value to each targeted zombie. Mark zombies whose `currentHp <= 0` as `isDead`. Append `actionResolved` and `damageDealt` log events.
     - `healAmount` / `healFull`: clamp at participant `maxHp`. If a previously-`isDefeated` participant is healed back above 0, clear `isDefeated` (revives are valid). Append `actionResolved`.
     - `ward`: increment `wardCount` on each targeted participant by the resolved count. Append `actionResolved`.
  4. Apply self-damage to the caller: `selfDamage = liveZombieCount(sessionId, currentWave)`. If the caller has `wardCount > 0`, decrement it and apply 0 damage instead. Otherwise subtract `selfDamage` from `currentHp`; if `currentHp <= 0`, set `isDefeated: true` and append `playerDefeated`. Append `damageDealt` log event for the self-damage in any case.
  5. Replace the hand slot: draw a new action from the caller's `player_action_loadout` uniformly at random with replacement (using session PRNG); update the hand slot's `actionId`. If the caller's loadout is empty, leave the slot's actionId unchanged or set to a sentinel — but in practice the lobby UI prevents this.
  6. Wave-completion check (above) and game-over check (below).
+ Hand draws are with replacement — the same action can appear in multiple hand slots simultaneously and can refill into the same slot.
+ Reducer is called by the player's drag-and-drop interaction client-side. There is no server-side turn order; reducers serialize naturally on the SpacetimeDB transaction boundary.

Game over:
+ Game-over check runs after every `resolveAction`. Condition: every `defensive_battle_participant` row for the session has `isDefeated: true`.
+ When triggered:
  1. Compute loot per participant (see "Loot" below). Use the framework's `applyReward` for each.
  2. For each participant, restore `playerState.location = participant.startLocation`. The sentinel `defensive_battle:{sessionId}` location is overwritten; the client unmounts the battle screen on the next subscription tick.
  3. Set session `state: completed`, `endedAt: ctx.timestamp`.
  4. Release the framework's `minigame_member` locks for every participant (per the framework's existing flow).
  5. Append `battleEnded` log event.
  6. Insert a per-participant `notification` of `kind: system` summarizing their loot, so it persists in the tray after they leave the battle screen.
+ Disconnections during battle: if a participant's session-presence is lost (per the framework's disconnect handling), set their `isDefeated: true` and append `playerDefeated`. Their participant row remains; loot is computed normally on game-over (they get whatever waves they survived contributed to). Reconnect during a still-running battle re-mounts the battle screen for them; they remain defeated but can spectate. Mid-battle reconnect to a session they've been defeated in is a v1 placeholder — fine to just show a static "you were defeated" overlay until game-over.

Loot:
+ Loot is computed at game-over for each participant individually — no shared loot pool. Each participant gets their own bag based on their personal contribution and Fortune.
+ Per-participant loot formula (v1 seed values; tuning concern):
  - Scrap: `floor((50 + 30 * wavesSurvived) * lootMultiplierFromFortune(fortuneSnap))`. `wavesSurvived` = `waveAtDefeat - 1` if defeated mid-wave, else `currentWave - 1` at battle end. Living-til-end participants count `currentWave` directly.
  - Parts: `floor(5 * max(0, wavesSurvived - 2) * lootMultiplier)`. No parts before wave 3.
  - Metal: `floor(2 * max(0, wavesSurvived - 5) * lootMultiplier)`. No metal before wave 6.
  - XP: `floor(20 * wavesSurvived * lootMultiplier)`. Awarded via the framework's `grantXp`.
  - Item drop: `lootMultiplier * 0.05` chance per wave survived of dropping a random craftable item (rolled via the Equipment & Armory crafting machinery without consuming a recipe — the item arrives in inventory at the player's current Armory level for affix biasing). If the player has no Armory, item drops are skipped.
+ All loot grants go through the framework's reward dispatch (`applyReward`) so they get the same toast/notification UX existing minigames use.

Frontend:
+ **Group panel** gains a "Call Defensive Battle" CTA, visible only when the player is in a group of 2+ members and no Defensive Battle session is currently `voting` or `inProgress` for the group. Tapping it calls `proposeDefensiveBattle`.
+ **Vote notification** — the existing notifications tray is the delivery surface. The `defensiveBattleVote` notification kind renders inline Yay / Nay buttons that call `voteDefensiveBattle`. Tapping the notification body opens the lobby modal (so non-yet-voted players can see context — party members, who's voted yay so far — before deciding).
+ **Lobby modal** — opens automatically on the client when the player has a `defensive_battle_participant` row in a `voting` session. Shows: party member cards (each with a vote indicator: pending / yay / nay), `LoadoutPanel` (from the Action System spec), countdown timer to `voteDeadline`, Yay / Nay buttons (or "Ready" if the player has already voted yay and is waiting for others), and a Cancel-vote option that re-fires `voteDefensiveBattle` with `nay`. The modal closes when the session transitions to `inProgress` (replaced by battle screen) or `cancelled` (dismissed with toast).
+ **Battle screen** — a full-screen view that replaces the normal Activities/tabs UI when the player's `playerState.location` starts with `defensive_battle:`. Layout:
  - Left column: party member cards. Each shows username, current HP / max HP bar, ward count badge, defeated overlay if `isDefeated`. Reactions to incoming heal / damage events animate here.
  - Right column: zombie cards for the current wave. Each shows current HP / max HP. Dead zombies fade out.
  - Bottom strip: the player's own hand — `handSize` cards, each draggable. Disabled while the player is `isDefeated`.
  - Top bar: current wave number, live zombie count, party HP summary.
  - Right-side panel (collapsible): the event log fed by `defensive_battle_log` events for this session, scrolling newest-at-top.
  - Drag interaction: dragging a card highlights valid drop targets per the action's targeting variant. Releasing on a valid target fires `resolveAction` with the appropriate `TargetKind`. Releasing on invalid space cancels.
+ **Game-over overlay** — when the session transitions to `completed`, the battle screen fades to a results overlay showing each participant's loot. Tapping "Continue" dismisses the overlay; the client's location-driven router naturally returns to whatever screen matches the restored `startLocation`.
+ **Reconnect handling** — if the client subscription returns the player into an `inProgress` session they're a participant of, the battle screen mounts immediately. If they're already defeated, it shows the spectator/defeated overlay variant.

Extensibility:
+ New action effect variants (cleanse, buff, etc.) added by the Action System spec just work here as long as `resolveAction` is extended in `actions.ts`. The battle reducer's effect-application switch needs a new branch per new variant.
+ Tuning the difficulty curve: `baseCount`, `waveScalar`, `perPlayerBonus`, zombie HP roll range, and all loot formulas are seed values. A future "difficulty tier" feature could parameterize these per-session.
+ Boss waves, special zombie types (heavy, ranged), environmental hazards — all out of scope for v1. The schema accommodates them by adding columns or a `zombieKind` tagged union to `defensive_battle_zombie` later.
+ Spectators (group members not participating, or random watchers): not supported in v1. The participant set is fixed at vote time. A spectator pattern would need a separate `defensive_battle_spectator` table and a public-vs-private subscription split.
+ PvP variants, raid-scale battles (more than current group size), persistent campaign modes — all greenfield future specs. Nothing here precludes them.

Migration:
+ Greenfield system at the schema level. No existing Defensive Battle data exists. Players who exist when this ships gain the ability to be invited to / propose battles automatically once their group has 2+ members.
+ The original `The Defensive Battle.md` spec is being replaced by this file — no separate spec file to mark superseded; this *is* the rewrite.
+ The seed for `defensiveBattleVote` notification kind requires extending the existing `notification.kind` tagged union with one new variant. Per the Notifications spec, this is a non-breaking additive change.

Placeholders:
+ All numeric tuning values (HP formula coefficients, hand size scaling, loot quantities, wave generation parameters, vote deadline duration) are first-pass seeds. Expect heavy iteration during playtesting.
+ The defensive_battle_log event-log JSON payload schema is loosely specified — concrete payload shapes per `eventKind` should be locked down in implementation alongside the client renderer that consumes them.
+ Visual battle effects (zombie animations, drag-drop polish, damage popups) are art / UX concerns deferred to implementation. The server emits enough event-log granularity that the client can drive any animation style on top.
+ Fast-forward / replay of past battles is not supported. The `defensive_battle_log` rows for a completed session can be cleaned up by a periodic janitor reducer to bound storage. Keep `defensive_battle_session` rows indefinitely for stat-tracking purposes; their participant / snapshot / hand-slot / zombie / log children can be deleted on a TTL (e.g. 7 days post-`endedAt`).
+ Solo (1-player) battles are explicitly disallowed in v1 — the design hinges on group cooperation. A future "Survival Mode" solo variant could lift this with a separate proposal reducer that doesn't require a group.
