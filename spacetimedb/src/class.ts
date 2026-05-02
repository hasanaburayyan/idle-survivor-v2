import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from './schema';
import { clearStatSourcesByPrefix } from './stats';
import { addPoolBalance } from './skill_tree';
import {
  playerEquippedClass,
  classNodeEffect,
  classCraftCost,
  playerClassCraftProgress,
  playerCapstoneChoice,
  playerCapability,
} from './class_tables';

// ---------- Capability key registry ----------
// All subsystems must import these constants rather than inline raw strings.
// A missing key becomes a compile-time error, not a silent misfire.

export const CAPABILITY_KEYS = {
  AUTOMATION_SLOT: 'automation_slot',
  AUTOMATION_COST_TOLERANT: 'automation_cost_tolerant',
  AUTOMATION_FREE_RUNS: 'automation_free_runs',
  AUTOMATION_YIELD_PCT_BP: 'automation_yield_pct_bp',
  OFFLINE_AUTOMATION_MULTIPLIER_BP: 'offline_automation_multiplier_bp',
  MANUAL_CLICK_YIELD_PCT_BP: 'manual_click_yield_pct_bp',
  MANUAL_CLICK_TICK_COUNT: 'manual_click_tick_count',
  MANUAL_CLICK_COMBO_ENABLED: 'manual_click_combo_enabled',
  MANUAL_CLICK_PROGRESSES_ALL_SLOTS: 'manual_click_progresses_all_slots',
  MANUAL_CLICK_CRIT_CHANCE_BP: 'manual_click_crit_chance_bp',
  MANUAL_CLICK_CRIT_MULTIPLIER_BP: 'manual_click_crit_multiplier_bp',
  WIDE_NET_PCT_BP: 'wide_net_pct_bp',
  WIDE_NET_OVERFLOW_BP: 'wide_net_overflow_bp',
  FORTUNE_PROC_CHANCE_BP: 'fortune_proc_chance_bp',
  FORTUNE_PROC_MULTIPLIER_BP: 'fortune_proc_multiplier_bp',
  FORTUNE_CASCADE_CHANCE_BP: 'fortune_cascade_chance_bp',
  FORTUNE_PROC_DROPS_ITEM_BP: 'fortune_proc_drops_item_bp',
  FORTUNE_PROC_ECHO_CHANCE_BP: 'fortune_proc_echo_chance_bp',
  CRAFT_AFFIX_BIAS_BP: 'craft_affix_bias_bp',
  CRAFT_EXTRA_OPTIONAL_COUNT: 'craft_extra_optional_count',
  ARMORY_COST_REDUCTION_BP: 'armory_cost_reduction_bp',
  COMBAT_HAND_SIZE_BONUS: 'combat_hand_size_bonus',
  COMBAT_DAMAGE_EXTRA_TARGET: 'combat_damage_extra_target',
  COMBAT_POWER_DAMAGE_MULTIPLIER_BP: 'combat_power_damage_multiplier_bp',
  COMBAT_CLICK_GRANTS_WARD: 'combat_click_grants_ward',
  COMBAT_LOOT_MULTIPLIER_FLAT_BP: 'combat_loot_multiplier_flat_bp',
  COMBO_FREE_CRAFT_THRESHOLD: 'combo_free_craft_threshold',
  VEIN_DROP_CHANCE_BP: 'vein_drop_chance_bp',
} as const;

export type CapabilityKey = typeof CAPABILITY_KEYS[keyof typeof CAPABILITY_KEYS];

// ---------- Sentinel for unbounded tier ----------

const INFINITE_TIER_POINTS = 4_294_967_295; // u32::MAX

// ---------- Class tree IDs ----------

export const CLASS_TREE_IDS = new Set([
  'brute',
  'generalist',
  'striker',
  'wanderer',
]);

// ---------- Capability helpers (mirror stats.ts helpers exactly) ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertCapSourceKeyOwnedBy(sourceKey: string, username: string): void {
  const colonIdx = sourceKey.indexOf(':');
  if (colonIdx === -1 || sourceKey.slice(0, colonIdx) !== username) {
    throw new Error(
      `Invalid sourceKey "${sourceKey}" — must start with "${username}:" per the {username}:{kind}:... convention`
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertCapCallerIs(ctx: any, username: string): void {
  const session = ctx.db.session.identity.find(ctx.sender);
  if (session === null || session.username !== username) {
    throw new Error(
      `Capability helper called with username="${username}" but caller's session resolves to "${session?.username ?? '<no session>'}" — refusing cross-player capability write`
    );
  }
}

/**
 * Upserts a capability contribution row.
 * sourceKey convention: {username}:class:{classId}:{skillId}:{effectKey}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  sourceKey: string,
  username: string,
  effectKey: string,
  amount: number
): void {
  assertCapCallerIs(ctx, username);
  assertCapSourceKeyOwnedBy(sourceKey, username);
  const existing = ctx.db.playerCapability.sourceKey.find(sourceKey);
  if (existing !== null) {
    if (existing.username !== username) {
      throw new Error(
        `setCapability: sourceKey "${sourceKey}" already exists for a different username`
      );
    }
    ctx.db.playerCapability.sourceKey.update({ ...existing, amount });
  } else {
    ctx.db.playerCapability.insert({ sourceKey, username, effectKey, amount });
  }
}

/**
 * Removes a single capability source row by sourceKey. No-op if absent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearCapability(ctx: any, sourceKey: string): void {
  const colonIdx = sourceKey.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`Invalid sourceKey "${sourceKey}" — must follow {username}:...`);
  }
  assertCapCallerIs(ctx, sourceKey.slice(0, colonIdx));
  const existing = ctx.db.playerCapability.sourceKey.find(sourceKey);
  if (existing !== null) {
    ctx.db.playerCapability.sourceKey.delete(sourceKey);
  }
}

/**
 * Removes all capability rows for a player whose sourceKey starts with prefix.
 * prefix MUST end with ':' and start with username.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearCapabilitiesByPrefix(ctx: any, username: string, prefix: string): void {
  assertCapCallerIs(ctx, username);
  if (!prefix.endsWith(':')) {
    throw new Error(
      `clearCapabilitiesByPrefix: prefix "${prefix}" must end with ':' to avoid substring collisions`
    );
  }
  assertCapSourceKeyOwnedBy(prefix, username);
  for (const row of ctx.db.playerCapability.player_capability_username.filter(username)) {
    if (row.sourceKey.startsWith(prefix)) {
      ctx.db.playerCapability.sourceKey.delete(row.sourceKey);
    }
  }
}

/**
 * Returns the summed capability amount for a given (username, effectKey).
 * Pure read — no authorization check needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCapabilityTotal(ctx: any, username: string, effectKey: string): number {
  let total = 0;
  for (const row of ctx.db.playerCapability.player_capability_username.filter(username)) {
    if (row.effectKey === effectKey) total += row.amount;
  }
  return total;
}

// ---------- Internal helpers ----------

/**
 * Returns true if the player has taken the unlock_<classId> skill at level >= 1.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hasUnlockedClass(ctx: any, username: string, classId: string): boolean {
  const unlockSkillId = `unlock_${classId}`;
  for (const row of ctx.db.playerSkill.player_skill_username.filter(username)) {
    if (row.skillId === unlockSkillId && row.level >= 1) return true;
  }
  return false;
}

/**
 * Returns true if the player is currently in a defensive battle or active minigame.
 * equip/unequip/refund operations are locked during these states.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isInMinigameOrBattle(ctx: any, username: string): boolean {
  const ps = ctx.db.playerState.username.find(username);
  if (ps !== null && ps.location.startsWith('defensive_battle:')) return true;
  // minigame_member has username as primary key — a row existing means active session
  return ctx.db.minigameMember.username.find(username) !== null;
}

/**
 * Writes stat and capability sources for all of a player's purchased nodes
 * in a given class tree. Called by equipClass to apply the full class snapshot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyClassEffects(ctx: any, username: string, classId: string): void {
  // v1: class trees are capabilities-only. Stat grants from class nodes are
  // Phase 2 — don't walk skill_stat_grant here.
  for (const psRow of ctx.db.playerSkill.player_skill_username.filter(username)) {
    if (psRow.level === 0) continue;
    const def = ctx.db.skillDefinition.skillId.find(psRow.skillId);
    if (def === null || def.treeId !== classId) continue;

    // Capability grants for this class node
    for (const effect of ctx.db.classNodeEffect.class_node_effect_skill_id.filter(psRow.skillId)) {
      const sourceKey = `${username}:class:${classId}:${psRow.skillId}:${effect.effectKey}`;
      setCapability(ctx, sourceKey, username, effect.effectKey, psRow.level * effect.amountPerLevel);
    }
  }
}

/**
 * Returns the first tier-0 classCraftCost row for a class (lowest id).
 * Used to determine the swap-cost resource.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPrimarySwapCostRow(ctx: any, classId: string) {
  let best = null;
  for (const row of ctx.db.classCraftCost.class_craft_cost_class_id.filter(classId)) {
    if (row.tierIndex !== 0) continue;
    if (best === null || row.id < best.id) best = row;
  }
  return best;
}

// ---------- Views ----------

export const myEquippedClass = spacetimedb.view(
  { name: 'my_equipped_class', public: true },
  t.array(playerEquippedClass.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const row = ctx.db.playerEquippedClass.username.find(s.username);
    return row ? [row] : [];
  }
);

export const myClassCraftProgress = spacetimedb.view(
  { name: 'my_class_craft_progress', public: true },
  t.array(playerClassCraftProgress.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.playerClassCraftProgress.player_class_craft_progress_username.filter(s.username),
    ];
  }
);

export const myCapstoneChoices = spacetimedb.view(
  { name: 'my_capstone_choices', public: true },
  t.array(playerCapstoneChoice.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.playerCapstoneChoice.player_capstone_choice_username.filter(s.username),
    ];
  }
);

// Per-user capability totals — pre-summed by effectKey for the calling player.
// Lets the client read effective capability values (slot count, wide-net bp,
// armory cost reduction bp, etc.) without re-implementing the sum at every
// consumer. One row per non-zero effectKey total.
const CapabilityTotalType = t.object('CapabilityTotal', {
  effectKey: t.string(),
  total: t.i32(),
});

export const myCapabilityTotals = spacetimedb.view(
  { name: 'my_capability_totals', public: true },
  t.array(CapabilityTotalType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const totals = new Map<string, number>();
    for (const row of ctx.db.playerCapability.player_capability_username.filter(s.username)) {
      totals.set(row.effectKey, (totals.get(row.effectKey) ?? 0) + row.amount);
    }
    const result: { effectKey: string; total: number }[] = [];
    for (const [effectKey, total] of totals) {
      if (total !== 0) result.push({ effectKey, total });
    }
    return result;
  }
);

// ---------- Reducers ----------

const SWAP_COST_UNITS = 100n; // base resource units to equip/swap a class

export const equipClass = spacetimedb.reducer(
  { classId: t.string() },
  (ctx, { classId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');

    // 1. Validate: class tree exists
    const treeDef = ctx.db.skillTreeDefinition.treeId.find(classId);
    if (treeDef === null || !CLASS_TREE_IDS.has(classId)) {
      throw new SenderError(`Unknown class: ${classId}`);
    }

    // 2. Validate: player has unlocked the class
    if (!hasUnlockedClass(ctx, s.username, classId)) {
      throw new SenderError(`Class "${classId}" is not unlocked yet`);
    }

    // 3. Validate: not in a minigame or battle
    if (isInMinigameOrBattle(ctx, s.username)) {
      throw new SenderError('Cannot change class during a minigame.');
    }

    // 4. Determine previous class (for prefix-clear later)
    const existingEquip = ctx.db.playerEquippedClass.username.find(s.username);
    const prevClassId = existingEquip?.classId ?? '';

    // No-op if already equipped
    if (prevClassId === classId) return;

    // 5. Validate swap cost BEFORE any mutations
    const swapRow = findPrimarySwapCostRow(ctx, classId);
    if (swapRow !== null) {
      const cost = SWAP_COST_UNITS;
      // Read current resource balance
      let balance = 0n;
      if (swapRow.resourceId === 'scrap') {
        const ps = ctx.db.playerState.username.find(s.username);
        balance = ps?.scrap ?? 0n;
      } else {
        for (const r of ctx.db.playerResource.player_resource_username.filter(s.username)) {
          if (r.resourceId === swapRow.resourceId) {
            balance = r.amount;
            break;
          }
        }
      }
      if (balance < cost) {
        throw new SenderError(
          `Equipping ${classId} requires ${cost.toString()} ${swapRow.resourceId}`
        );
      }
    }

    // ─── ALL PRECONDITIONS PASSED — begin mutations ───

    // 6. Deduct swap cost
    if (swapRow !== null) {
      const cost = SWAP_COST_UNITS;
      if (swapRow.resourceId === 'scrap') {
        const ps = ctx.db.playerState.username.find(s.username)!;
        ctx.db.playerState.username.update({
          ...ps,
          scrap: ps.scrap - cost,
          updatedAt: ctx.timestamp,
        });
      } else {
        for (const r of ctx.db.playerResource.player_resource_username.filter(s.username)) {
          if (r.resourceId === swapRow.resourceId) {
            ctx.db.playerResource.id.update({ ...r, amount: r.amount - cost });
            break;
          }
        }
      }
    }

    // 7. Clear previous class's stat + capability sources
    if (prevClassId !== '') {
      const prevPrefix = `${s.username}:class:${prevClassId}:`;
      clearStatSourcesByPrefix(ctx, s.username, prevPrefix);
      clearCapabilitiesByPrefix(ctx, s.username, prevPrefix);
    }

    // 8. Apply new class's effects for all purchased nodes
    applyClassEffects(ctx, s.username, classId);

    // 9. Upsert player_equipped_class
    if (existingEquip !== null) {
      ctx.db.playerEquippedClass.username.update({
        ...existingEquip,
        classId,
        equippedAt: ctx.timestamp,
      });
    } else {
      ctx.db.playerEquippedClass.insert({
        username: s.username,
        classId,
        equippedAt: ctx.timestamp,
      });
    }

    // 10. Grant the class_crafting structure on first equip (idempotent).
    // class_crafting has no build activity — equipping a class is the trigger.
    let hasClassCrafting = false;
    for (const row of ctx.db.playerStructure.player_structure_username.filter(s.username)) {
      if (row.structureId === 'class_crafting') {
        hasClassCrafting = true;
        break;
      }
    }
    if (!hasClassCrafting) {
      ctx.db.playerStructure.insert({
        id: 0n,
        username: s.username,
        structureId: 'class_crafting',
        slottedActivityId: '',
      });
    }
  }
);

export const unequipClass = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');

  // Check not in minigame/battle
  if (isInMinigameOrBattle(ctx, s.username)) {
    throw new SenderError('Cannot change class during a minigame.');
  }

  const existingEquip = ctx.db.playerEquippedClass.username.find(s.username);
  if (existingEquip === null || existingEquip.classId === '') return; // already unequipped

  const prevClassId = existingEquip.classId;

  // Clear the class's stat + capability sources
  const prevPrefix = `${s.username}:class:${prevClassId}:`;
  clearStatSourcesByPrefix(ctx, s.username, prevPrefix);
  clearCapabilitiesByPrefix(ctx, s.username, prevPrefix);

  // Set classId to '' (keep the row for future equip to find)
  ctx.db.playerEquippedClass.username.update({
    ...existingEquip,
    classId: '',
    equippedAt: ctx.timestamp,
  });
});

// ---------- Tier-info view ----------

// Per-class crafting tier summary exposed to the client.
// Tells the frontend exactly which tier the player is on, how far through the
// tier they are, and whether the tier is unbounded — so the UI can show
// "Tier 0 · 7 / 10 points (50 Metal + 50 Fabric each)" without any tier-walk
// logic on the client side.
const ClassCraftTierType = t.object('ClassCraftTier', {
  classId: t.string(),
  currentTierIndex: t.u32(),
  pointsCrafted: t.u64(),
  // Points crafted within the current tier (resets conceptually at each tier boundary).
  pointsCraftedInTier: t.u64(),
  // Total size of the current tier (= U32_MAX sentinel for the unbounded last tier).
  pointsInCurrentTier: t.u32(),
  // True when the current tier is the last (unbounded) one.
  isUnbounded: t.bool(),
});

export const myClassCraftTier = spacetimedb.view(
  { name: 'my_class_craft_tier', public: true },
  t.array(ClassCraftTierType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];

    const result: any[] = [];
    // Iterate over the known (bounded) set of class IDs — NOT a table .iter().
    for (const classId of CLASS_TREE_IDS) {
      // Progress row (index lookup)
      let pointsCrafted = 0n;
      for (const r of ctx.db.playerClassCraftProgress.player_class_craft_progress_username.filter(s.username)) {
        if (r.classId === classId) { pointsCrafted = r.pointsCrafted; break; }
      }

      // Build unique tier map: tierIndex → pointsInTier (index lookup)
      const tierMap = new Map<number, number>();
      for (const row of ctx.db.classCraftCost.class_craft_cost_class_id.filter(classId)) {
        if (!tierMap.has(row.tierIndex)) tierMap.set(row.tierIndex, row.pointsInTier);
      }
      if (tierMap.size === 0) continue;

      const sortedTiers = [...tierMap.entries()].sort(([a], [b]) => a - b);
      let currentTierIndex = sortedTiers[sortedTiers.length - 1][0];
      let pointsCraftedInTier = pointsCrafted; // fallback: all points in last tier
      let pointsInCurrentTier = sortedTiers[sortedTiers.length - 1][1];
      let cumulative = 0n;

      for (let i = 0; i < sortedTiers.length; i++) {
        const [ti, pit] = sortedTiers[i];
        const tierCap = BigInt(pit);
        if (cumulative + tierCap > pointsCrafted) {
          currentTierIndex = ti;
          pointsInCurrentTier = pit;
          pointsCraftedInTier = pointsCrafted - cumulative;
          break;
        }
        cumulative += tierCap;
      }

      const isUnbounded = pointsInCurrentTier === INFINITE_TIER_POINTS;
      result.push({ classId, currentTierIndex, pointsCrafted, pointsCraftedInTier, pointsInCurrentTier, isUnbounded });
    }

    return result;
  }
);

// ---------- craftClassPoint reducer ----------

// Spends class-specific resources to add one point to the player's class pool.
// Tier is computed server-side from pointsCrafted so costs auto-escalate with
// no client involvement.
export const craftClassPoint = spacetimedb.reducer(
  { classId: t.string() },
  (ctx, { classId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    if (!CLASS_TREE_IDS.has(classId)) throw new SenderError(`Unknown class: ${classId}`);
    if (!hasUnlockedClass(ctx, s.username, classId)) {
      throw new SenderError(`Class "${classId}" is not unlocked`);
    }

    // Fetch crafted-points total (index lookup)
    let progressRow = null;
    for (const r of ctx.db.playerClassCraftProgress.player_class_craft_progress_username.filter(s.username)) {
      if (r.classId === classId) { progressRow = r; break; }
    }
    const pointsCrafted: bigint = progressRow !== null ? progressRow.pointsCrafted : 0n;

    // Walk classCraftCost rows sorted explicitly by tierIndex to find current tier.
    const tierMap = new Map<number, number>();
    for (const row of ctx.db.classCraftCost.class_craft_cost_class_id.filter(classId)) {
      if (!tierMap.has(row.tierIndex)) tierMap.set(row.tierIndex, row.pointsInTier);
    }
    if (tierMap.size === 0) throw new SenderError(`No cost configuration for class "${classId}"`);

    const sortedTiers = [...tierMap.entries()].sort(([a], [b]) => a - b);
    let currentTierIndex = sortedTiers[sortedTiers.length - 1][0]; // default to last tier
    let cumulative = 0n;
    for (const [ti, pit] of sortedTiers) {
      if (cumulative + BigInt(pit) > pointsCrafted) {
        currentTierIndex = ti;
        break;
      }
      cumulative += BigInt(pit);
    }

    // Collect all cost rows for the current tier (one per required resource)
    const costRows: any[] = [];
    for (const row of ctx.db.classCraftCost.class_craft_cost_class_id.filter(classId)) {
      if (row.tierIndex === currentTierIndex) costRows.push(row);
    }
    if (costRows.length === 0) {
      throw new SenderError(`No cost rows for class "${classId}" tier ${currentTierIndex}`);
    }

    // Validate: player has all required resources before any mutation
    for (const costRow of costRows) {
      const required: bigint = costRow.amountPerPoint;
      let balance = 0n;
      if (costRow.resourceId === 'scrap') {
        balance = ctx.db.playerState.username.find(s.username)?.scrap ?? 0n;
      } else {
        for (const r of ctx.db.playerResource.player_resource_username.filter(s.username)) {
          if (r.resourceId === costRow.resourceId) { balance = r.amount; break; }
        }
      }
      if (balance < required) {
        throw new SenderError(
          `Not enough ${costRow.resourceId}: need ${required.toString()}, have ${balance.toString()}`
        );
      }
    }

    // ─── ALL PRECONDITIONS PASSED — begin mutations ───

    // Deduct resources
    for (const costRow of costRows) {
      const cost: bigint = costRow.amountPerPoint;
      if (costRow.resourceId === 'scrap') {
        const ps = ctx.db.playerState.username.find(s.username)!;
        ctx.db.playerState.username.update({ ...ps, scrap: ps.scrap - cost, updatedAt: ctx.timestamp });
      } else {
        for (const r of ctx.db.playerResource.player_resource_username.filter(s.username)) {
          if (r.resourceId === costRow.resourceId) {
            ctx.db.playerResource.id.update({ ...r, amount: r.amount - cost });
            break;
          }
        }
      }
    }

    // Increment pointsCrafted
    if (progressRow !== null) {
      ctx.db.playerClassCraftProgress.id.update({
        ...progressRow,
        pointsCrafted: progressRow.pointsCrafted + 1n,
        lastCraftedAt: ctx.timestamp,
      });
    } else {
      ctx.db.playerClassCraftProgress.insert({
        id: 0n,
        username: s.username,
        classId,
        pointsCrafted: 1n,
        lastCraftedAt: ctx.timestamp,
      });
    }

    // Award 1 skill point to the class pool
    const treeDef = ctx.db.skillTreeDefinition.treeId.find(classId);
    if (treeDef === null) throw new SenderError(`Tree definition missing for "${classId}"`);
    addPoolBalance(ctx, s.username, treeDef.pointPoolId, 1);
  }
);

// ---------- refundCapstoneChoice reducer ----------

// Refunds the player's capstone choice in a given branch, allowing them to
// re-pick. Costs 10× the class's tier-0 primary resource per the spec.
export const refundCapstoneChoice = spacetimedb.reducer(
  { classId: t.string(), capstoneBranchId: t.string() },
  (ctx, { classId, capstoneBranchId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');

    // 1. Find the player's capstone choice for this branch
    let choiceRow = null;
    for (const r of ctx.db.playerCapstoneChoice.player_capstone_choice_username.filter(s.username)) {
      if (r.capstoneBranchId === capstoneBranchId) { choiceRow = r; break; }
    }
    if (choiceRow === null) {
      throw new SenderError(`No capstone choice found for branch "${capstoneBranchId}"`);
    }

    // 2. Not in minigame or battle
    if (isInMinigameOrBattle(ctx, s.username)) {
      throw new SenderError('Cannot refund capstone choice during a minigame.');
    }

    // 3. Compute respec cost: 10× the tier-0 primary resource amount
    const primaryCostRow = findPrimarySwapCostRow(ctx, classId);
    if (primaryCostRow === null) {
      throw new SenderError(`No cost configuration for class "${classId}"`);
    }
    const respecCost: bigint = primaryCostRow.amountPerPoint * 10n;

    // 4. Validate the player can afford the respec cost
    let balance = 0n;
    if (primaryCostRow.resourceId === 'scrap') {
      balance = ctx.db.playerState.username.find(s.username)?.scrap ?? 0n;
    } else {
      for (const r of ctx.db.playerResource.player_resource_username.filter(s.username)) {
        if (r.resourceId === primaryCostRow.resourceId) { balance = r.amount; break; }
      }
    }
    if (balance < respecCost) {
      throw new SenderError(
        `Respec requires ${respecCost.toString()} ${primaryCostRow.resourceId}, you have ${balance.toString()}`
      );
    }

    // 5. Get the chosen skill definition (for costSkillPoints refund)
    const chosenSkillDef = ctx.db.skillDefinition.skillId.find(choiceRow.chosenSkillId);
    if (chosenSkillDef === null) {
      throw new SenderError(`Skill definition not found for "${choiceRow.chosenSkillId}"`);
    }

    // ─── ALL PRECONDITIONS PASSED — begin mutations ───

    // 6. Deduct respec cost
    if (primaryCostRow.resourceId === 'scrap') {
      const ps = ctx.db.playerState.username.find(s.username)!;
      ctx.db.playerState.username.update({ ...ps, scrap: ps.scrap - respecCost, updatedAt: ctx.timestamp });
    } else {
      for (const r of ctx.db.playerResource.player_resource_username.filter(s.username)) {
        if (r.resourceId === primaryCostRow.resourceId) {
          ctx.db.playerResource.id.update({ ...r, amount: r.amount - respecCost });
          break;
        }
      }
    }

    // 7. Refund costSkillPoints to the class pool balance
    const treeDef = ctx.db.skillTreeDefinition.treeId.find(classId);
    if (treeDef !== null) {
      addPoolBalance(ctx, s.username, treeDef.pointPoolId, chosenSkillDef.costSkillPoints);
    }

    // 8. Zero out the playerSkill row for the chosen capstone (level → 0)
    for (const r of ctx.db.playerSkill.player_skill_username.filter(s.username)) {
      if (r.skillId === choiceRow.chosenSkillId) {
        ctx.db.playerSkill.id.update({ ...r, level: 0 });
        break;
      }
    }

    // 9. Clear stat + capability sources for this capstone node.
    // Only matters if the class is currently equipped; if not, no source rows exist.
    const equipped = ctx.db.playerEquippedClass.username.find(s.username);
    if (equipped !== null && equipped.classId === classId) {
      const nodePrefix = `${s.username}:class:${classId}:${choiceRow.chosenSkillId}:`;
      clearStatSourcesByPrefix(ctx, s.username, nodePrefix);
      clearCapabilitiesByPrefix(ctx, s.username, nodePrefix);
    }

    // 10. Delete the capstone choice row — all three options are free again
    ctx.db.playerCapstoneChoice.id.delete(choiceRow.id);
  }
);

// ---------- Seed data ----------

// u32::MAX — sentinel for "tier has no upper bound on points"
const U32_MAX = 4_294_967_295;

interface ClassTreeSeed {
  treeId: string;
  displayName: string;
  description: string;
  sortOrder: number;
  unlockCondition: {
    tag: 'skillsAtLevel';
    value: { requirements: { skillId: string; level: number }[] };
  };
  pointPoolId: string;
}

const CLASS_TREE_SEEDS: ClassTreeSeed[] = [
  {
    treeId: 'brute',
    displayName: 'Brute',
    description: 'Raw endurance and force — parallel automation slots, stamina, heavy-frame advantages.',
    sortOrder: 10,
    unlockCondition: {
      tag: 'skillsAtLevel',
      value: { requirements: [{ skillId: 'vigor_minor', level: 4 }, { skillId: 'vigor_major', level: 4 }] },
    },
    pointPoolId: 'class_brute',
  },
  {
    treeId: 'generalist',
    displayName: 'Generalist',
    description: 'Wide-net efficiency, armory mastery, and tactical battlefield presence.',
    sortOrder: 11,
    unlockCondition: {
      tag: 'skillsAtLevel',
      value: { requirements: [{ skillId: 'focus_minor', level: 4 }, { skillId: 'focus_major', level: 4 }] },
    },
    pointPoolId: 'class_generalist',
  },
  {
    treeId: 'striker',
    displayName: 'Striker',
    description: 'Manual click power, combo chains, and lethal precision.',
    sortOrder: 12,
    unlockCondition: {
      tag: 'skillsAtLevel',
      value: { requirements: [{ skillId: 'power_minor', level: 4 }, { skillId: 'power_major', level: 4 }] },
    },
    pointPoolId: 'class_striker',
  },
  {
    treeId: 'wanderer',
    displayName: 'Wanderer',
    description: 'Fortune procs, lucky yields, and cascading bonuses.',
    sortOrder: 13,
    unlockCondition: {
      tag: 'skillsAtLevel',
      value: { requirements: [{ skillId: 'fortune_minor', level: 4 }, { skillId: 'fortune_major', level: 4 }] },
    },
    pointPoolId: 'class_wanderer',
  },
];

const CLASS_POOL_SEEDS = [
  { poolId: 'class_brute', displayName: 'Brute', sortOrder: 10 },
  { poolId: 'class_generalist', displayName: 'Generalist', sortOrder: 11 },
  { poolId: 'class_striker', displayName: 'Striker', sortOrder: 12 },
  { poolId: 'class_wanderer', displayName: 'Wanderer', sortOrder: 13 },
];

// Unlock nodes in the Intermediate tree.
// Gated by stat totals: maxing both minor (4×1) and major (4×3) = 16 total stat.
// prerequisiteStatId + prerequisiteStatValue express this gate in upgradeSkill.
interface UnlockNodeSeed {
  skillId: string;
  name: string;
  description: string;
  positionX: number;
  positionY: number;
  sortOrder: number;
  prerequisiteStatId: string;
  prerequisiteStatValue: number;
}

const UNLOCK_NODE_SEEDS: UnlockNodeSeed[] = [
  {
    skillId: 'unlock_brute',
    name: 'Unlock Brute',
    description: 'Reveals the Brute class tree. Spend Metal + Fabric to craft Brute points.',
    positionX: 0,
    positionY: 1600,
    sortOrder: 200,
    prerequisiteStatId: 'vigor',
    prerequisiteStatValue: 16,
  },
  {
    skillId: 'unlock_generalist',
    name: 'Unlock Generalist',
    description: 'Reveals the Generalist class tree. Spend a little of every resource to craft Generalist points.',
    positionX: 0,
    positionY: 1800,
    sortOrder: 201,
    prerequisiteStatId: 'focus',
    prerequisiteStatValue: 16,
  },
  {
    skillId: 'unlock_striker',
    name: 'Unlock Striker',
    description: 'Reveals the Striker class tree. Spend Parts + Food to craft Striker points.',
    positionX: 200,
    positionY: 1600,
    sortOrder: 202,
    prerequisiteStatId: 'power',
    prerequisiteStatValue: 16,
  },
  {
    skillId: 'unlock_wanderer',
    name: 'Unlock Wanderer',
    description: 'Reveals the Wanderer class tree. Spend Medicine + Scrap to craft Wanderer points.',
    positionX: -200,
    positionY: 1600,
    sortOrder: 203,
    prerequisiteStatId: 'fortune',
    prerequisiteStatValue: 16,
  },
];

// Craft cost seeds — 3 tiers per class, multiple rows per (classId, tierIndex).
// Tier 2 uses U32_MAX as sentinel (unbounded).
interface CraftCostSeed {
  classId: string;
  tierIndex: number;
  pointsInTier: number;
  resourceId: string;
  amountPerPoint: bigint;
}

function buildCraftCostSeeds(): CraftCostSeed[] {
  const seeds: CraftCostSeed[] = [];

  // Brute: Metal + Fabric, tier-0 base 50 each
  const bruteBase: [string, bigint][] = [['metal', 50n], ['fabric', 50n]];
  for (const [resourceId, base] of bruteBase) {
    seeds.push({ classId: 'brute', tierIndex: 0, pointsInTier: 10, resourceId, amountPerPoint: base });
    seeds.push({ classId: 'brute', tierIndex: 1, pointsInTier: 10, resourceId, amountPerPoint: base * 10n });
    seeds.push({ classId: 'brute', tierIndex: 2, pointsInTier: U32_MAX, resourceId, amountPerPoint: base * 100n });
  }

  // Generalist: 10 of each of all 6 resources
  const generalistResources: string[] = ['scrap', 'parts', 'metal', 'fabric', 'food', 'medicine'];
  for (const resourceId of generalistResources) {
    seeds.push({ classId: 'generalist', tierIndex: 0, pointsInTier: 10, resourceId, amountPerPoint: 10n });
    seeds.push({ classId: 'generalist', tierIndex: 1, pointsInTier: 10, resourceId, amountPerPoint: 100n });
    seeds.push({ classId: 'generalist', tierIndex: 2, pointsInTier: U32_MAX, resourceId, amountPerPoint: 1000n });
  }

  // Striker: Parts + Food, tier-0 base 50 each
  const strikerBase: [string, bigint][] = [['parts', 50n], ['food', 50n]];
  for (const [resourceId, base] of strikerBase) {
    seeds.push({ classId: 'striker', tierIndex: 0, pointsInTier: 10, resourceId, amountPerPoint: base });
    seeds.push({ classId: 'striker', tierIndex: 1, pointsInTier: 10, resourceId, amountPerPoint: base * 10n });
    seeds.push({ classId: 'striker', tierIndex: 2, pointsInTier: U32_MAX, resourceId, amountPerPoint: base * 100n });
  }

  // Wanderer: Medicine (50) + Scrap (250)
  const wandererBase: [string, bigint][] = [['medicine', 50n], ['scrap', 250n]];
  for (const [resourceId, base] of wandererBase) {
    seeds.push({ classId: 'wanderer', tierIndex: 0, pointsInTier: 10, resourceId, amountPerPoint: base });
    seeds.push({ classId: 'wanderer', tierIndex: 1, pointsInTier: 10, resourceId, amountPerPoint: base * 10n });
    seeds.push({ classId: 'wanderer', tierIndex: 2, pointsInTier: U32_MAX, resourceId, amountPerPoint: base * 100n });
  }

  return seeds;
}

const CRAFT_COST_SEEDS = buildCraftCostSeeds();

// ---------- Class tree node seeds ----------

interface ClassNodeSeed {
  skillId: string;
  name: string;
  description: string;
  maxLevel: number;
  prerequisiteSkillId: string;
  prerequisiteLevel: number;
  costSkillPoints: number;
  positionX: number;
  positionY: number;
  sortOrder: number;
  treeId: string;
  capstoneBranchId: string;
  infiniteScaling: boolean;
  prerequisiteStatId: string;
  prerequisiteStatValue: number;
}

interface ClassNodeEffectSeed {
  skillId: string;
  effectKey: string;
  amountPerLevel: number;
}

// Brute tree nodes (treeId: 'brute')
const BRUTE_NODE_SEEDS: ClassNodeSeed[] = [
  {
    skillId: 'parallel_frame_1',
    name: 'Parallel Frame I',
    description: 'Unlock a second automation slot for parallel resource gathering.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    treeId: 'brute',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'parallel_frame_2',
    name: 'Parallel Frame II',
    description: 'Unlock a third automation slot.',
    maxLevel: 1,
    prerequisiteSkillId: 'parallel_frame_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 0,
    positionY: 150,
    sortOrder: 1,
    treeId: 'brute',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'parallel_frame_3',
    name: 'Parallel Frame III',
    description: 'Unlock a fourth automation slot.',
    maxLevel: 1,
    prerequisiteSkillId: 'parallel_frame_2',
    prerequisiteLevel: 1,
    costSkillPoints: 3,
    positionX: 0,
    positionY: 300,
    sortOrder: 2,
    treeId: 'brute',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'steady_hands',
    name: 'Steady Hands',
    description: 'Automation slots no longer abort on cost failure — they simply skip the tick.',
    maxLevel: 1,
    prerequisiteSkillId: 'parallel_frame_1',
    prerequisiteLevel: 1,
    costSkillPoints: 1,
    positionX: 250,
    positionY: 100,
    sortOrder: 3,
    treeId: 'brute',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'heavy_frame',
    name: 'Heavy Frame',
    description: 'Manual clicks count as 2 progress ticks toward the slotted activity.',
    maxLevel: 1,
    prerequisiteSkillId: 'parallel_frame_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: -250,
    positionY: 100,
    sortOrder: 4,
    treeId: 'brute',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'endurance_infinite',
    name: 'Endurance',
    description: 'Each level grants +1% automation yield (stacks indefinitely).',
    maxLevel: 1,
    prerequisiteSkillId: 'parallel_frame_1',
    prerequisiteLevel: 1,
    costSkillPoints: 1,
    positionX: 250,
    positionY: 0,
    sortOrder: 5,
    treeId: 'brute',
    capstoneBranchId: '',
    infiniteScaling: true,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  // Capstone branch: brute_cap — gated at Vigor 30
  {
    skillId: 'forge_heart',
    name: 'Forge Heart',
    description: 'Automation slots tick at 1.5× yield while offline.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: -150,
    positionY: 450,
    sortOrder: 10,
    treeId: 'brute',
    capstoneBranchId: 'brute_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'vigor',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'iron_will',
    name: 'Iron Will',
    description: 'Manual clicks during a Defensive Battle grant ward charges.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 0,
    positionY: 480,
    sortOrder: 11,
    treeId: 'brute',
    capstoneBranchId: 'brute_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'vigor',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'bulwark',
    name: 'Bulwark',
    description: 'Automation ticks succeed even when costs aren\'t met.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 150,
    positionY: 450,
    sortOrder: 12,
    treeId: 'brute',
    capstoneBranchId: 'brute_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'vigor',
    prerequisiteStatValue: 30,
  },
];

const BRUTE_EFFECT_SEEDS: ClassNodeEffectSeed[] = [
  { skillId: 'parallel_frame_1', effectKey: CAPABILITY_KEYS.AUTOMATION_SLOT, amountPerLevel: 1 },
  { skillId: 'parallel_frame_2', effectKey: CAPABILITY_KEYS.AUTOMATION_SLOT, amountPerLevel: 1 },
  { skillId: 'parallel_frame_3', effectKey: CAPABILITY_KEYS.AUTOMATION_SLOT, amountPerLevel: 1 },
  { skillId: 'steady_hands', effectKey: CAPABILITY_KEYS.AUTOMATION_COST_TOLERANT, amountPerLevel: 1 },
  { skillId: 'heavy_frame', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_TICK_COUNT, amountPerLevel: 1 },
  { skillId: 'endurance_infinite', effectKey: CAPABILITY_KEYS.AUTOMATION_YIELD_PCT_BP, amountPerLevel: 100 },
  { skillId: 'forge_heart', effectKey: CAPABILITY_KEYS.OFFLINE_AUTOMATION_MULTIPLIER_BP, amountPerLevel: 5000 },
  { skillId: 'iron_will', effectKey: CAPABILITY_KEYS.COMBAT_CLICK_GRANTS_WARD, amountPerLevel: 1 },
  { skillId: 'bulwark', effectKey: CAPABILITY_KEYS.AUTOMATION_FREE_RUNS, amountPerLevel: 1 },
];

// Generalist tree nodes (treeId: 'generalist')
const GENERALIST_NODE_SEEDS: ClassNodeSeed[] = [
  {
    skillId: 'wide_net_1',
    name: 'Wide Net I',
    description: 'Each automation tick and manual click distributes 2% of yield to all other unlocked resources.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    treeId: 'generalist',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'wide_net_2',
    name: 'Wide Net II',
    description: 'Wide Net expanded — total distribution rises to 5%.',
    maxLevel: 1,
    prerequisiteSkillId: 'wide_net_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 0,
    positionY: 150,
    sortOrder: 1,
    treeId: 'generalist',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'surveyor',
    name: 'Surveyor',
    description: 'Reduce armory upgrade costs by 20%.',
    maxLevel: 1,
    prerequisiteSkillId: 'wide_net_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: -250,
    positionY: 100,
    sortOrder: 2,
    treeId: 'generalist',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'crafters_eye',
    name: "Crafter's Eye",
    description: 'Crafted items roll with a 10% bias toward the upper end of affix ranges.',
    maxLevel: 1,
    prerequisiteSkillId: 'wide_net_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 250,
    positionY: 100,
    sortOrder: 3,
    treeId: 'generalist',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'tactician',
    name: 'Tactician',
    description: 'Draw one extra card at the start of each Defensive Battle turn.',
    maxLevel: 1,
    prerequisiteSkillId: 'wide_net_2',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 0,
    positionY: 300,
    sortOrder: 4,
    treeId: 'generalist',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'polymath_infinite',
    name: 'Polymath',
    description: 'Each level grants +0.5% additional wide-net distribution (stacks indefinitely).',
    maxLevel: 1,
    prerequisiteSkillId: 'wide_net_2',
    prerequisiteLevel: 1,
    costSkillPoints: 1,
    positionX: 250,
    positionY: 250,
    sortOrder: 5,
    treeId: 'generalist',
    capstoneBranchId: '',
    infiniteScaling: true,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  // Capstone branch: generalist_cap — gated at Focus 30
  {
    skillId: 'hidden_caches',
    name: 'Hidden Caches',
    description: 'Wide-net yield occasionally produces a tier above your highest unlocked resource.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: -150,
    positionY: 450,
    sortOrder: 10,
    treeId: 'generalist',
    capstoneBranchId: 'generalist_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'focus',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'master_crafter',
    name: 'Master Crafter',
    description: 'Items you craft roll one extra optional affix.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 0,
    positionY: 480,
    sortOrder: 11,
    treeId: 'generalist',
    capstoneBranchId: 'generalist_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'focus',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'quartermaster',
    name: 'Quartermaster',
    description: 'Armory upgrade costs reduced by an additional 30% (stacks with Surveyor).',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 150,
    positionY: 450,
    sortOrder: 12,
    treeId: 'generalist',
    capstoneBranchId: 'generalist_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'focus',
    prerequisiteStatValue: 30,
  },
];

const GENERALIST_EFFECT_SEEDS: ClassNodeEffectSeed[] = [
  { skillId: 'wide_net_1', effectKey: CAPABILITY_KEYS.WIDE_NET_PCT_BP, amountPerLevel: 200 },
  { skillId: 'wide_net_2', effectKey: CAPABILITY_KEYS.WIDE_NET_PCT_BP, amountPerLevel: 300 },
  { skillId: 'surveyor', effectKey: CAPABILITY_KEYS.ARMORY_COST_REDUCTION_BP, amountPerLevel: 2000 },
  { skillId: 'crafters_eye', effectKey: CAPABILITY_KEYS.CRAFT_AFFIX_BIAS_BP, amountPerLevel: 1000 },
  { skillId: 'tactician', effectKey: CAPABILITY_KEYS.COMBAT_HAND_SIZE_BONUS, amountPerLevel: 1 },
  { skillId: 'polymath_infinite', effectKey: CAPABILITY_KEYS.WIDE_NET_PCT_BP, amountPerLevel: 50 },
  { skillId: 'hidden_caches', effectKey: CAPABILITY_KEYS.WIDE_NET_OVERFLOW_BP, amountPerLevel: 100 },
  { skillId: 'master_crafter', effectKey: CAPABILITY_KEYS.CRAFT_EXTRA_OPTIONAL_COUNT, amountPerLevel: 1 },
  { skillId: 'quartermaster', effectKey: CAPABILITY_KEYS.ARMORY_COST_REDUCTION_BP, amountPerLevel: 3000 },
];

// Striker tree nodes (treeId: 'striker')
const STRIKER_NODE_SEEDS: ClassNodeSeed[] = [
  {
    skillId: 'heavy_hand_1',
    name: 'Heavy Hand I',
    description: 'Manual clicks yield 25% more resources.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    treeId: 'striker',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'heavy_hand_2',
    name: 'Heavy Hand II',
    description: 'Manual click yield bonus grows to +50% total.',
    maxLevel: 1,
    prerequisiteSkillId: 'heavy_hand_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 0,
    positionY: 150,
    sortOrder: 1,
    treeId: 'striker',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'combo',
    name: 'Combo',
    description: 'Consecutive clicks within 3s stack +5% yield per hit, up to +50%. Decays on pause.',
    maxLevel: 1,
    prerequisiteSkillId: 'heavy_hand_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: -250,
    positionY: 100,
    sortOrder: 2,
    treeId: 'striker',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'quickstep',
    name: 'Quickstep',
    description: 'Manual clicks contribute progress to every slotted automation simultaneously.',
    maxLevel: 1,
    prerequisiteSkillId: 'combo',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: -250,
    positionY: 250,
    sortOrder: 3,
    treeId: 'striker',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'cleaver',
    name: 'Cleaver',
    description: 'Damage actions in Defensive Battle hit one additional target.',
    maxLevel: 1,
    prerequisiteSkillId: 'heavy_hand_2',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 250,
    positionY: 200,
    sortOrder: 4,
    treeId: 'striker',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'striker_infinite',
    name: 'Striker',
    description: 'Each level grants +1% additional manual click yield (stacks indefinitely).',
    maxLevel: 1,
    prerequisiteSkillId: 'heavy_hand_2',
    prerequisiteLevel: 1,
    costSkillPoints: 1,
    positionX: 250,
    positionY: 0,
    sortOrder: 5,
    treeId: 'striker',
    capstoneBranchId: '',
    infiniteScaling: true,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  // Capstone branch: striker_cap — gated at Power 30
  {
    skillId: 'crit_strike',
    name: 'Crit Strike',
    description: '5% chance on manual clicks to deal 10× yield.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: -150,
    positionY: 450,
    sortOrder: 10,
    treeId: 'striker',
    capstoneBranchId: 'striker_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'power',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'momentum',
    name: 'Momentum',
    description: 'Every 50 consecutive combo-window clicks grants a free class point.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 0,
    positionY: 480,
    sortOrder: 11,
    treeId: 'striker',
    capstoneBranchId: 'striker_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'power',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'ironfist',
    name: 'Ironfist',
    description: "Power scales 50% harder into Defensive Battle damage.",
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 150,
    positionY: 450,
    sortOrder: 12,
    treeId: 'striker',
    capstoneBranchId: 'striker_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'power',
    prerequisiteStatValue: 30,
  },
];

const STRIKER_EFFECT_SEEDS: ClassNodeEffectSeed[] = [
  { skillId: 'heavy_hand_1', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_YIELD_PCT_BP, amountPerLevel: 2500 },
  { skillId: 'heavy_hand_2', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_YIELD_PCT_BP, amountPerLevel: 2500 },
  { skillId: 'combo', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_COMBO_ENABLED, amountPerLevel: 1 },
  { skillId: 'quickstep', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_PROGRESSES_ALL_SLOTS, amountPerLevel: 1 },
  { skillId: 'cleaver', effectKey: CAPABILITY_KEYS.COMBAT_DAMAGE_EXTRA_TARGET, amountPerLevel: 1 },
  { skillId: 'striker_infinite', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_YIELD_PCT_BP, amountPerLevel: 100 },
  // crit_strike grants TWO capability rows
  { skillId: 'crit_strike', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_CRIT_CHANCE_BP, amountPerLevel: 500 },
  { skillId: 'crit_strike', effectKey: CAPABILITY_KEYS.MANUAL_CLICK_CRIT_MULTIPLIER_BP, amountPerLevel: 100000 },
  { skillId: 'momentum', effectKey: CAPABILITY_KEYS.COMBO_FREE_CRAFT_THRESHOLD, amountPerLevel: 50 },
  { skillId: 'ironfist', effectKey: CAPABILITY_KEYS.COMBAT_POWER_DAMAGE_MULTIPLIER_BP, amountPerLevel: 5000 },
];

// Wanderer tree nodes (treeId: 'wanderer')
const WANDERER_NODE_SEEDS: ClassNodeSeed[] = [
  {
    skillId: 'lucky_strike_1',
    name: 'Lucky Strike I',
    description: '+1% chance per click/tick to trigger a Fortune proc (10× yield burst).',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    treeId: 'wanderer',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'lucky_strike_2',
    name: 'Lucky Strike II',
    description: 'Fortune proc chance grows to 2.5% total.',
    maxLevel: 1,
    prerequisiteSkillId: 'lucky_strike_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 0,
    positionY: 150,
    sortOrder: 1,
    treeId: 'wanderer',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'cascade',
    name: 'Cascade',
    description: 'Fortune procs have a 25% chance to chain into another proc.',
    maxLevel: 1,
    prerequisiteSkillId: 'lucky_strike_1',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: -250,
    positionY: 100,
    sortOrder: 2,
    treeId: 'wanderer',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'quartermaster_drop',
    name: 'Quartermaster',
    description: 'Fortune procs have a 10% chance to also drop a freshly crafted item.',
    maxLevel: 1,
    prerequisiteSkillId: 'lucky_strike_2',
    prerequisiteLevel: 1,
    costSkillPoints: 3,
    positionX: 0,
    positionY: 300,
    sortOrder: 3,
    treeId: 'wanderer',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'loaded_dice',
    name: 'Loaded Dice',
    description: 'Defensive Battle loot multiplier gains a flat +0.5 bonus.',
    maxLevel: 1,
    prerequisiteSkillId: 'lucky_strike_2',
    prerequisiteLevel: 1,
    costSkillPoints: 2,
    positionX: 250,
    positionY: 200,
    sortOrder: 4,
    treeId: 'wanderer',
    capstoneBranchId: '',
    infiniteScaling: false,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  {
    skillId: 'wanderer_infinite',
    name: 'Wanderer',
    description: 'Each level grants +0.25% additional Fortune proc chance (stacks indefinitely).',
    maxLevel: 1,
    prerequisiteSkillId: 'lucky_strike_2',
    prerequisiteLevel: 1,
    costSkillPoints: 1,
    positionX: 250,
    positionY: 0,
    sortOrder: 5,
    treeId: 'wanderer',
    capstoneBranchId: '',
    infiniteScaling: true,
    prerequisiteStatId: '',
    prerequisiteStatValue: 0,
  },
  // Capstone branch: wanderer_cap — gated at Fortune 30
  {
    skillId: 'rich_veins',
    name: 'Rich Veins',
    description: '0.1% chance on clicks to trigger a vein — a burst of mixed resources scaled to player level.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: -150,
    positionY: 450,
    sortOrder: 10,
    treeId: 'wanderer',
    capstoneBranchId: 'wanderer_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'fortune',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'echo',
    name: 'Echo',
    description: 'Fortune procs have a 25% chance to fire simultaneously on a random group member.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 0,
    positionY: 480,
    sortOrder: 11,
    treeId: 'wanderer',
    capstoneBranchId: 'wanderer_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'fortune',
    prerequisiteStatValue: 30,
  },
  {
    skillId: 'fates_favor',
    name: "Fate's Favor",
    description: 'Fortune procs are 2× larger.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    costSkillPoints: 5,
    positionX: 150,
    positionY: 450,
    sortOrder: 12,
    treeId: 'wanderer',
    capstoneBranchId: 'wanderer_cap',
    infiniteScaling: false,
    prerequisiteStatId: 'fortune',
    prerequisiteStatValue: 30,
  },
];

const WANDERER_EFFECT_SEEDS: ClassNodeEffectSeed[] = [
  { skillId: 'lucky_strike_1', effectKey: CAPABILITY_KEYS.FORTUNE_PROC_CHANCE_BP, amountPerLevel: 100 },
  { skillId: 'lucky_strike_2', effectKey: CAPABILITY_KEYS.FORTUNE_PROC_CHANCE_BP, amountPerLevel: 150 },
  { skillId: 'cascade', effectKey: CAPABILITY_KEYS.FORTUNE_CASCADE_CHANCE_BP, amountPerLevel: 2500 },
  { skillId: 'quartermaster_drop', effectKey: CAPABILITY_KEYS.FORTUNE_PROC_DROPS_ITEM_BP, amountPerLevel: 1000 },
  { skillId: 'loaded_dice', effectKey: CAPABILITY_KEYS.COMBAT_LOOT_MULTIPLIER_FLAT_BP, amountPerLevel: 5000 },
  { skillId: 'wanderer_infinite', effectKey: CAPABILITY_KEYS.FORTUNE_PROC_CHANCE_BP, amountPerLevel: 25 },
  { skillId: 'rich_veins', effectKey: CAPABILITY_KEYS.VEIN_DROP_CHANCE_BP, amountPerLevel: 10 },
  { skillId: 'echo', effectKey: CAPABILITY_KEYS.FORTUNE_PROC_ECHO_CHANCE_BP, amountPerLevel: 2500 },
  { skillId: 'fates_favor', effectKey: CAPABILITY_KEYS.FORTUNE_PROC_MULTIPLIER_BP, amountPerLevel: 20000 },
];

// All class node seeds in order: used by seedClassSystem.
const ALL_CLASS_NODE_SEEDS: ClassNodeSeed[] = [
  ...BRUTE_NODE_SEEDS,
  ...GENERALIST_NODE_SEEDS,
  ...STRIKER_NODE_SEEDS,
  ...WANDERER_NODE_SEEDS,
];

const ALL_CLASS_EFFECT_SEEDS: ClassNodeEffectSeed[] = [
  ...BRUTE_EFFECT_SEEDS,
  ...GENERALIST_EFFECT_SEEDS,
  ...STRIKER_EFFECT_SEEDS,
  ...WANDERER_EFFECT_SEEDS,
];

/**
 * Seeds all class system definitions. Idempotent — safe to call on every init.
 * Must be called AFTER seedSkillTrees() so the intermediate treeId row exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seedClassSystem(ctx: any): void {
  // 1. Pool definitions
  for (const pool of CLASS_POOL_SEEDS) {
    if (ctx.db.skillPointPoolDefinition.poolId.find(pool.poolId) === null) {
      ctx.db.skillPointPoolDefinition.insert(pool);
    }
  }

  // 2. Tree definitions (use skillsAtLevel unlock condition)
  for (const tree of CLASS_TREE_SEEDS) {
    if (ctx.db.skillTreeDefinition.treeId.find(tree.treeId) === null) {
      ctx.db.skillTreeDefinition.insert({
        treeId: tree.treeId,
        displayName: tree.displayName,
        description: tree.description,
        sortOrder: tree.sortOrder,
        unlockCondition: tree.unlockCondition,
        completionRule: { tag: 'allNodesMaxed' },
        pointPoolId: tree.pointPoolId,
      });
    }
  }

  // 3. Unlock_<class> skill nodes in the Intermediate tree
  for (const seed of UNLOCK_NODE_SEEDS) {
    if (ctx.db.skillDefinition.skillId.find(seed.skillId) === null) {
      ctx.db.skillDefinition.insert({
        skillId: seed.skillId,
        name: seed.name,
        description: seed.description,
        maxLevel: 1,
        prerequisiteSkillId: '',
        prerequisiteLevel: 0,
        prerequisitePlayerLevel: 0,
        costSkillPoints: 1,
        positionX: seed.positionX,
        positionY: seed.positionY,
        sortOrder: seed.sortOrder,
        treeId: 'intermediate',
        capstoneBranchId: '',
        infiniteScaling: false,
        prerequisiteStatId: seed.prerequisiteStatId,
        prerequisiteStatValue: seed.prerequisiteStatValue,
      });
    }
  }

  // 4. Class tree node definitions (skill_definition rows for each class tree node)
  for (const seed of ALL_CLASS_NODE_SEEDS) {
    if (ctx.db.skillDefinition.skillId.find(seed.skillId) === null) {
      ctx.db.skillDefinition.insert({
        skillId: seed.skillId,
        name: seed.name,
        description: seed.description,
        maxLevel: seed.maxLevel,
        prerequisiteSkillId: seed.prerequisiteSkillId,
        prerequisiteLevel: seed.prerequisiteLevel,
        prerequisitePlayerLevel: 0,
        costSkillPoints: seed.costSkillPoints,
        positionX: seed.positionX,
        positionY: seed.positionY,
        sortOrder: seed.sortOrder,
        treeId: seed.treeId,
        capstoneBranchId: seed.capstoneBranchId,
        infiniteScaling: seed.infiniteScaling,
        prerequisiteStatId: seed.prerequisiteStatId,
        prerequisiteStatValue: seed.prerequisiteStatValue,
      });
    }
  }

  // 5. Class node effect rows (class_node_effect — capability grants per node)
  for (const seed of ALL_CLASS_EFFECT_SEEDS) {
    // Idempotent: check for existing row with same (skillId, effectKey)
    let effectExists = false;
    for (const row of ctx.db.classNodeEffect.class_node_effect_skill_id.filter(seed.skillId)) {
      if (row.effectKey === seed.effectKey) {
        effectExists = true;
        break;
      }
    }
    if (!effectExists) {
      ctx.db.classNodeEffect.insert({
        id: 0n,
        skillId: seed.skillId,
        effectKey: seed.effectKey,
        amountPerLevel: seed.amountPerLevel,
        appliesWhen: { tag: 'equipped', value: undefined },
      });
    }
  }

  // 6. Class craft cost rows
  for (const seed of CRAFT_COST_SEEDS) {
    // Idempotent check: look for an existing row with same (classId, tierIndex, resourceId)
    let exists = false;
    for (const row of ctx.db.classCraftCost.class_craft_cost_class_id.filter(seed.classId)) {
      if (row.tierIndex === seed.tierIndex && row.resourceId === seed.resourceId) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      ctx.db.classCraftCost.insert({
        id: 0n,
        classId: seed.classId,
        tierIndex: seed.tierIndex,
        pointsInTier: seed.pointsInTier,
        resourceId: seed.resourceId,
        amountPerPoint: seed.amountPerPoint,
      });
    }
  }
}
