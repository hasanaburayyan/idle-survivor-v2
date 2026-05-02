import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from './schema';
import { clearStatSourcesByPrefix } from './stats';
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

  // 4. Class craft cost rows
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
