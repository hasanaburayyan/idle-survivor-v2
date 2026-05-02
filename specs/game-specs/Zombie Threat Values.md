# Zombie Threat Values

## Context

Today the actor's self-damage tick is `live_zombie_count × 1`. Killing zombie #3 has the same numeric impact as killing zombie #7 — every dead zombie is worth a flat -1 to the next tick. There's no kill-priority signal. Zombie kinds (Basic, Armored, Juggernaut) differ in HP and armor but not in *how much they hurt the actor per tick*. From the player's seat, zombies look interchangeable; targeting is busywork.

This spec gives every zombie an `attack` value and reframes the self-damage tick as `sum of (live_zombie.attack)`. Players can read kill-priority off the screen. The three existing kinds get distinct attack values so the threat hierarchy is immediately legible. Future zombie kinds become trivially expressible along an HP × armor × **attack** axis without any new system.

Builds on: the recent zombie-kind work (Armored, Juggernaut). Independent from but reinforces **Cycling Deck** — the two specs can ship in either order, but their effect is multiplied when both are in.

## Goals

- Each zombie shows a numeric attack value on its tile.
- Self-damage tick = sum of live zombie attacks (no longer count × 1).
- Juggernauts feel meaningfully more threatening than basics, in a number the player can read.
- Adding a new zombie kind requires only picking HP, armor, and attack — no new threat-system work.

Non-goals:

- Variable / random attack values per roll. Deterministic per kind only.
- Wave-based attack scaling. Numbers are flat per kind in v1; revisit if late waves feel under-threatening.
- Per-target attack (zombies that only hit one specific player). Self-damage stays as a single tick on the actor, computed from the *sum* of all live attacks.
- New zombie kinds. The system enables them; this spec ships only the redistribution of values across the existing three kinds.

## Preliminary decisions (resolve before implementation)

1. **Numbers (per kind, flat):**
   - Basic: **attack 1** (preserves the per-zombie threat for swarms of basics).
   - Armored: **attack 1** (armored is already a defensive nuisance via its armor stacks; doubling threat with attack would make them oppressive).
   - Juggernaut: **attack 3** (the priority target — surviving juggernauts hurt visibly more per tick).

   Worked example: at wave 5 with `numJuggs=1, numArmored=1, numBasic=7`, total attack = `7 + 1 + 3 = 11` vs. the previous count-based 9. Slight tick increase; juggs feel notably scarier without changing the broader pace. At wave 10 with `numJuggs=2, numArmored=3, numBasic=9`, total = `9 + 3 + 6 = 18` vs. previous 14. Juggernaut presence drives the tick up; killing one drops the tick by 3 — a real strategic prize.

2. **No variance.** Each kind has a fixed attack value. HP rolls already supply per-zombie variance; making attack random would muddy kill-priority reads. Players should be able to math the wave.

3. **No wave scaling in v1.** Attack values do not scale with wave number. Late-wave threat already grows from zombie *count*; threat-per-zombie is intentionally flat for legibility. Scaling is a future polish lever — possibly tied to a "berserker" debuff or a wave milestone.

4. **Display: prominent and persistent.** A small sword-icon + number badge in the top-right of the zombie tile, visible at all sizes. The number is the killing-context — players should read it from a glance. The badge appears on every zombie, including basics (so the value is informational, not exceptional).

5. **Self-damage log payload changes silently.** The `damageDealt source: 'self'` log entry's `amount` is now the sum of attack values, not the live count. The frontend already displays this number; no client changes for the log itself. The change is invisible to existing log consumers.

## Schema

Add `attack: u32` to `defensiveBattleZombie`, appended after `armor`:

```typescript
{
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64(),
  waveNumber: t.u32(),
  currentHp: t.i32(),
  maxHp: t.u32(),
  isDead: t.bool(),
  kind: ZombieKind.default({ tag: 'basic' }),
  armor: t.u32().default(1),  // existing falsy-default workaround
  attack: t.u32().default(1), // basic = 1, armored = 1, juggernaut = 3
}
```

The default is `1` — same SDK falsy-default workaround as `armor` (`default(0)` is silently dropped by `if (meta.defaultValue)` at `node_modules/spacetimedb/src/lib/table.ts:407`). `1` happens to be the correct value for basics and armored, so any historical row migrated by this default lands in the "basic threat" bucket. Historical rows are dead anyway; no gameplay impact.

## Spawn changes

In `spawnWave` (battle.ts), set the attack value per kind at insertion time:

```typescript
const ATTACK_BY_KIND: Record<'basic' | 'armored' | 'juggernaut', number> = {
  basic: 1,
  armored: 1,
  juggernaut: 3,
};

// inside spawn loops:
ctx.db.defensiveBattleZombie.insert({
  // ...existing fields...
  attack: ATTACK_BY_KIND.basic,        // or .armored / .juggernaut
});
```

Numbers live as constants at the top of `battle.ts` for easy tuning.

## Damage application (self-damage)

In `playAction` (battle.ts), the self-damage block currently computes:

```typescript
const liveCount = liveZombiesOf(ctx, sessionId, updatedSession.currentWave).length;
let damage = liveCount;
```

Change to:

```typescript
const liveZombies = liveZombiesOf(ctx, sessionId, updatedSession.currentWave);
let damage = liveZombies.reduce((sum, z) => sum + z.attack, 0);
```

The rest of the self-damage flow (ward consumption, defeat check, log entry) is unchanged. The log's `amount` field now carries the summed value.

## Client changes

`DefensiveBattleScreen.tsx` `ZombieCard`:

Add an attack badge in the tile, top-right corner. Suggested layout near the kind label:

```tsx
<View className="absolute top-1 right-1 flex-row items-center gap-0.5">
  <Text className="text-[10px] text-rose-400">⚔</Text>
  <Text className={`${isJugg ? 'text-sm' : 'text-[11px]'} font-semibold text-rose-300`}>
    {attack}
  </Text>
</View>
```

The Juggernaut tile is already larger and amber-accented; sizing the attack number one step up there underscores "this one matters most." For visual consistency the attack icon uses a rose accent (signaling threat), distinct from the sky-blue armor pips and the rose-tinged HP bar.

`ZombieCard` props gain an `attack: number` field, sourced from `z.attack` in the regenerated bindings.

## Emergent design

These fall out for free:

1. **Kill priority becomes a number you can read off the screen.** The juggernaut's ⚔3 makes "kill the jugg first" obvious without text or tooltips. The basic-1 swarm is still a threat in volume but each individual is a low-priority kill.

2. **Ward gains a calculable value.** Ward absorbs one instance of self-damage. Today the ward absorbs an unknown future tick. Tomorrow it absorbs a known one — "the next tick is 8" makes Ward's value concrete, and Ward becomes a *spike absorber* rather than a *tap absorber*.

3. **Healing math becomes a real decision.** Rally's +5 today is "+5 HP, future damage TBD." Tomorrow it's "+5 HP, the next tick is 8 — this turn nets -3 HP after the heal lands and the tick fires." Players can deliberately heal-trade with full information.

4. **AoE economy is cleaner.** Killing 4 basics (attack 1 each) drops the tick by 4 for a fixed damage budget. Killing one juggernaut (attack 3) drops the tick by 3 for the same damage budget. AoE keeps its swarm-clear identity. Single-target on the juggernaut delivers *more tick reduction per damage point* than against basics — a cleaner economy than today's flat -1 per kill.

5. **Future zombie kinds become trivial to add.** A "Stinger" with low HP and ⚔5 is a one-line addition — high kill-priority, dies fast, demands an early single-target play. A "Tank" with ⚔0 is also expressible (just a wall, soaks damage, threatens nothing per tick). The threat-design space opens up without any new mechanic.

6. **Difficulty tuning gains a third axis.** Today wave difficulty scales by zombie count and HP. Tomorrow, attack values are a third axis. Wave 20 could lean into 30% juggernauts to make the tick brutal, or stay all basics to make it "merely numerous." Designer leverage triples without code changes.

7. **Pierce vs Armored is now legibly two-fold.** Pierce-popping an Armored is an armor-strip play; the Armored's per-tick contribution (⚔1) is small, so the *real* reason to Pierce an Armored is to unlock its HP for a follow-up kill. The numbers make this readable instead of abstract — players can SEE that Pierce on an Armored is positional, not threat-mitigating.

8. **Telegraphed AoE math.** "I can see my self-damage will be 11 next tick. Volley does 3 to each of the 9 zombies. That kills 7 of the basics. Juggernaut and armored survive. New tick = 3+1 = 4." The player can do real math because both sides of the equation are visible. With the current count-based tick that math was opaque.

## Risks

1. **Number readability adds visual noise.** A digit on every zombie tile increases on-screen text. Mitigation: the badge is small (10–14px), top-right corner, single icon + single character (numbers stay single-digit for the tuning we shipped; if they grow to two digits, font size adapts naturally).

2. **Tick inflation breaks balance.** Wave 5 tick goes from ~9 to ~11; wave 10 from ~14 to ~18. Real but moderate. Mitigation: monitor playtest. If tick inflation outpaces participant maxHp scaling (`50 + 10×vigor`), nudge juggernaut attack down to 2.

3. **Variance feels lower without random per-zombie attack.** Counter-intuitively, deterministic attack *increases* puzzle quality — players can math the wave. The randomness budget should live in HP rolls and zombie composition, not in attack stats.

4. **Default-value migration artifact.** Existing zombie rows (historical, all dead) migrate to attack=1. No gameplay impact since they're dead. Same workaround as the armor migration; nothing new to solve.

5. **Flavor mismatch.** The actor's "self-damage = my actions caused this" frame doesn't literally come from each zombie's swing — the existing flavor is "you take a tick for being out there." Per-zombie attack is the *attribution* of the tick, not a reskin. Verify in-game tooltip language matches; if a tooltip says "you take 1 damage per zombie per action," update it to "you take damage equal to total zombie threat per action" or similar.

## Files to modify

**Backend:**
- `spacetimedb/src/battle_tables.ts` — append `attack: t.u32().default(1)` to `defensiveBattleZombie`.
- `spacetimedb/src/battle.ts` — `ATTACK_BY_KIND` constants; set `attack` on insertion in `spawnWave` for each of the three kind branches; rewrite the self-damage block to sum attack instead of count.

**Client:**
- `src/components/DefensiveBattleScreen.tsx` — add `attack` prop to `ZombieCard`; render the attack badge top-right.
- Bindings regenerate automatically via `spacetime generate`.

## Verification

1. **Solo battle, wave 1, 5 basics.** Each zombie tile shows ⚔1. Self-damage tick on next action = 5. Kill one → next tick = 4.

2. **Wave 5 with 1 juggernaut, 1 armored, 7 basics.** Juggernaut shows ⚔3, armored ⚔1, basics ⚔1. Self-damage = `3+1+7 = 11`. Pierce the armored down (HP only) → tick stays at 11 (armored's attack still contributes until dead). Kill the armored → tick = 10. Kill the juggernaut → tick = 8.

3. **Pierce → Strike combo on Armored.** Pierce strips armor, deals damage; Strike finishes. Armored is dead two plays in. Tick drops by ⚔1; HP loss is the cumulative tick across both plays.

4. **Ward play before a high-tick turn.** Stack ward on yourself; play any action with 11 attack incoming; the tick is fully absorbed (ward consumes one instance regardless of magnitude). Visible: ward count -1, HP unchanged, log shows "blocked by ward."

5. **Spectator view.** Defeated player watching the rest of the team — zombie tiles still show attack values. Useful for backseat-driving and for the player's own re-entry planning.

6. **Co-op tick independence.** Two players in a session, same wave, both play actions. Both see the same attack values on the zombies; their individual self-damage ticks are independent and computed from the live zombie set at the moment each action resolves.

7. **End-of-wave check.** Wave clears (all zombies dead). Self-damage on the last killing blow is calculated *before* the killing blow lands — ordering preserved from current behavior.
