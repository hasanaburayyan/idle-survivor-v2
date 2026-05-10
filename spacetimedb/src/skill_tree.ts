import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from './schema';
import {
  skillTreeDefinition,
  skillPointPoolDefinition,
  playerSkillPointBalance,
  skillStatGrant,
} from './skill_tree_tables';

// ---------- Helpers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isTreeCompleted(ctx: any, username: string, treeId: string): boolean {
  let total = 0;
  let maxedCount = 0;
  // Capstone branches: only one of N nodes can ever be taken (others lock out).
  // Count each branch as a single slot, maxed when any node in it is maxed.
  const capstoneBranches = new Map<string, boolean>();
  for (const def of ctx.db.skillDefinition.skill_definition_tree.filter(treeId)) {
    if (def.infiniteScaling === true) continue;
    let level = 0;
    for (const ps of ctx.db.playerSkill.player_skill_username.filter(username)) {
      if (ps.skillId === def.skillId) {
        level = ps.level;
        break;
      }
    }
    if (def.capstoneBranchId && def.capstoneBranchId !== '') {
      const prev = capstoneBranches.get(def.capstoneBranchId) ?? false;
      capstoneBranches.set(def.capstoneBranchId, prev || level >= def.maxLevel);
    } else {
      total += 1;
      if (level >= def.maxLevel) maxedCount += 1;
    }
  }
  for (const anyMaxed of capstoneBranches.values()) {
    total += 1;
    if (anyMaxed) maxedCount += 1;
  }
  return total > 0 && maxedCount === total;
}

// Find-or-throw: locate the player's row in a given pool. Throws if missing
// (registration must always create one) or if multiple rows exist (defensive
// against bugs in the absence of a multi-column unique constraint).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPoolBalanceRow(ctx: any, username: string, poolId: string) {
  let found = null;
  let count = 0;
  for (const row of ctx.db.playerSkillPointBalance.player_skill_point_balance_username.filter(username)) {
    if (row.poolId === poolId) {
      found = row;
      count += 1;
    }
  }
  if (count === 0) {
    throw new SenderError(`No skill point balance row for ${username}/${poolId}`);
  }
  if (count > 1) {
    throw new Error(`Duplicate skill point balance rows for ${username}/${poolId}`);
  }
  return found!;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPoolBalance(ctx: any, username: string, poolId: string): number {
  for (const row of ctx.db.playerSkillPointBalance.player_skill_point_balance_username.filter(username)) {
    if (row.poolId === poolId) return row.amount;
  }
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addPoolBalance(ctx: any, username: string, poolId: string, delta: number): number {
  let found = null;
  for (const row of ctx.db.playerSkillPointBalance.player_skill_point_balance_username.filter(username)) {
    if (row.poolId === poolId) {
      found = row;
      break;
    }
  }
  if (found === null) {
    const initial = delta < 0 ? 0 : delta;
    ctx.db.playerSkillPointBalance.insert({
      id: 0n,
      username,
      poolId,
      amount: initial,
    });
    return initial;
  }
  const next = Math.max(0, found.amount + delta);
  ctx.db.playerSkillPointBalance.id.update({ ...found, amount: next });
  return next;
}

// ---------- Views ----------

// Exhaustive list of all seeded tree IDs in display order.
// MUST be updated when new trees are seeded via init.
// Using .find() per ID avoids .iter() so view invalidation is targeted to
// specific tree rows rather than firing on any skillTreeDefinition change.
const ORDERED_TREE_IDS = [
  'beginner',
  'intermediate',
  'brute',
  'generalist',
  'striker',
  'wanderer',
];

/**
 * isTreeCompleted variant that accepts a pre-built skill Map — avoids the
 * O(n*m) repeated filter() calls when called from inside a per-tree loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isTreeCompletedFromMap(ctx: any, treeId: string, skillLevels: Map<string, number>): boolean {
  let total = 0;
  let maxedCount = 0;
  const capstoneBranches = new Map<string, boolean>();
  for (const def of ctx.db.skillDefinition.skill_definition_tree.filter(treeId)) {
    if (def.infiniteScaling === true) continue;
    const level = skillLevels.get(def.skillId) ?? 0;
    if (def.capstoneBranchId && def.capstoneBranchId !== '') {
      const prev = capstoneBranches.get(def.capstoneBranchId) ?? false;
      capstoneBranches.set(def.capstoneBranchId, prev || level >= def.maxLevel);
    } else {
      total += 1;
      if (level >= def.maxLevel) maxedCount += 1;
    }
  }
  for (const anyMaxed of capstoneBranches.values()) {
    total += 1;
    if (anyMaxed) maxedCount += 1;
  }
  return total > 0 && maxedCount === total;
}

export const myVisibleSkillTrees = spacetimedb.view(
  { name: 'my_visible_skill_trees', public: true },
  t.array(skillTreeDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];

    // Build skill Map once — single indexed scan, O(1) lookups per tree/requirement.
    const skillLevels = new Map<string, number>();
    for (const ps of ctx.db.playerSkill.player_skill_username.filter(s.username)) {
      skillLevels.set(ps.skillId, ps.level);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];
    for (const treeId of ORDERED_TREE_IDS) {
      const tree = ctx.db.skillTreeDefinition.treeId.find(treeId);
      if (tree === null) continue; // not yet seeded
      const cond = tree.unlockCondition;
      if (cond.tag === 'always') {
        result.push(tree);
      } else if (cond.tag === 'treeCompleted') {
        if (isTreeCompletedFromMap(ctx, cond.value.treeId, skillLevels)) {
          result.push(tree);
        }
      } else if (cond.tag === 'skillsAtLevel') {
        // Class trees: all stat requirements met AND unlock_<treeId> purchased.
        const reqs: { skillId: string; level: number }[] = cond.value.requirements;
        const allStatsMet = reqs.every(req => (skillLevels.get(req.skillId) ?? 0) >= req.level);
        if (allStatsMet && (skillLevels.get(`unlock_${tree.treeId}`) ?? 0) >= 1) {
          result.push(tree);
        }
      }
      // 'manual': not yet granted by any system — skip.
    }
    // ORDERED_TREE_IDS already reflects display order; sort defensively in case
    // seed sortOrder values diverge from the constant.
    result.sort((a, b) => a.sortOrder - b.sortOrder);
    return result;
  }
);

export const myPointBalances = spacetimedb.view(
  { name: 'my_point_balances', public: true },
  t.array(playerSkillPointBalance.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.playerSkillPointBalance.player_skill_point_balance_username.filter(s.username)];
  }
);

// ---------- Seed ----------

interface SkillTreeSeed {
  treeId: string;
  displayName: string;
  description: string;
  sortOrder: number;
  unlockCondition: { tag: 'always' } | { tag: 'treeCompleted'; value: { treeId: string } } | { tag: 'manual' };
  completionRule: { tag: 'allNodesMaxed' } | { tag: 'none' };
  pointPoolId: string;
}

const SKILL_TREE_SEEDS: SkillTreeSeed[] = [
  {
    treeId: 'beginner',
    displayName: 'Beginner',
    description: 'Foundational skills — resource discovery and shelter.',
    sortOrder: 0,
    unlockCondition: { tag: 'always' },
    completionRule: { tag: 'allNodesMaxed' },
    pointPoolId: 'general',
  },
  {
    treeId: 'intermediate',
    displayName: 'Intermediate',
    description: 'Core stat investment — Vigor, Power, Focus, Fortune.',
    sortOrder: 1,
    unlockCondition: { tag: 'treeCompleted', value: { treeId: 'beginner' } },
    completionRule: { tag: 'allNodesMaxed' },
    pointPoolId: 'general',
  },
];

interface PoolSeed {
  poolId: string;
  displayName: string;
  sortOrder: number;
}

const POOL_SEEDS: PoolSeed[] = [
  { poolId: 'general', displayName: 'General', sortOrder: 0 },
];

interface IntermediateSkillSeed {
  skillId: string;
  name: string;
  description: string;
  maxLevel: number;
  prerequisiteSkillId: string;
  prerequisiteLevel: number;
  prerequisitePlayerLevel: number;
  costSkillPoints: number;
  positionX: number;
  positionY: number;
  sortOrder: number;
  treeId: string;
}

// Intermediate tree layout — diagonal-X for stat chains, two compact rows
// below for resource multipliers.
//
//   The four stat chains radiate diagonally from the centre. Each chain is
//   three nodes long (Minor → Major → class Unlock), with the Unlock pinned
//   at the chain's corner so the player physically arrives there by maxing
//   that stat:
//
//                  Wanderer ◇       ◇ Brute       ← unlocks (corners)
//                       ◯       ◯
//                          ◯ ◯               ← majors
//                          ◯ ◯               ← minors
//                       ◯       ◯
//                  Generalist ◇   ◇ Striker
//
//   Resource multipliers sit in two horizontal rows below the X.
const STEP = 130;            // diagonal pitch between chain nodes
const MULT_ROW_GAP = 130;    // vertical pitch between minor / major mult rows
const MULT_COL_GAP = 130;    // horizontal pitch between mult columns

// Multiplier nodes live in two rows below the stat-X. Six columns: scavenge
// + the five non-scrap chains.
interface MultiplierSpec {
  prefix: string; // matches activityDefinition.skillChainPrefix
  resourceLabel: string;
  columnIndex: number; // 0..5, gets translated into a centred X by helper
}

const MULTIPLIER_SPECS: MultiplierSpec[] = [
  { prefix: 'scavenge', resourceLabel: 'Scavenge', columnIndex: 0 },
  { prefix: 'parts', resourceLabel: 'Parts', columnIndex: 1 },
  { prefix: 'metal', resourceLabel: 'Metal', columnIndex: 2 },
  { prefix: 'fabric', resourceLabel: 'Fabric', columnIndex: 3 },
  { prefix: 'food', resourceLabel: 'Food', columnIndex: 4 },
  { prefix: 'medicine', resourceLabel: 'Meds', columnIndex: 5 },
];

// Centre the 6 columns horizontally around X=0.
function multColumnX(idx: number): number {
  return (idx - (MULTIPLIER_SPECS.length - 1) / 2) * MULT_COL_GAP;
}

// Multiplier rows sit one full diagonal step below the bottom unlock corners
// (which are at Y = 3 * STEP) so the 96px-radius unlock and multiplier nodes
// don't visually collide.
const MULT_MINOR_Y = STEP * 4;
const MULT_MAJOR_Y = MULT_MINOR_Y + MULT_ROW_GAP;

function buildMultiplierSeeds(): IntermediateSkillSeed[] {
  const out: IntermediateSkillSeed[] = [];
  let sortOffset = 100;
  for (const spec of MULTIPLIER_SPECS) {
    // Scrap is high-frequency click income — % both ways. Non-scrap resources
    // come from low-frequency structures/minigames where +25% on a base of 1
    // rounds to nothing, so Minor is a flat additive (+2 per level → 2/4/6/8)
    // and Major remains a percentage on top of (base + flat).
    const isScrap = spec.prefix === 'scavenge';
    const minorDesc = isScrap
      ? `+25% per level to ${spec.resourceLabel} yield. Stacks with Major.`
      : `+2 ${spec.resourceLabel} per yield event per level (2 / 4 / 6 / 8). Stacks with Major.`;
    const majorDesc = isScrap
      ? `+75% per level to ${spec.resourceLabel} yield on top of Minor.`
      : `+75% per level to ${spec.resourceLabel} yield, applied on top of Minor's flat bonus.`;
    out.push({
      skillId: `${spec.prefix}_minor_multiplier`,
      name: `${spec.resourceLabel} Yield Minor`,
      description: minorDesc,
      maxLevel: 4,
      prerequisiteSkillId: '',
      prerequisiteLevel: 0,
      prerequisitePlayerLevel: 0,
      costSkillPoints: 1,
      positionX: multColumnX(spec.columnIndex),
      positionY: MULT_MINOR_Y,
      sortOrder: sortOffset++,
      treeId: 'intermediate',
    });
    out.push({
      skillId: `${spec.prefix}_major_multiplier`,
      name: `${spec.resourceLabel} Yield Major`,
      description: majorDesc,
      maxLevel: 4,
      prerequisiteSkillId: `${spec.prefix}_minor_multiplier`,
      prerequisiteLevel: 4,
      prerequisitePlayerLevel: 0,
      costSkillPoints: 2,
      positionX: multColumnX(spec.columnIndex),
      positionY: MULT_MAJOR_Y,
      sortOrder: sortOffset++,
      treeId: 'intermediate',
    });
  }
  return out;
}

const INTERMEDIATE_SKILL_SEEDS: IntermediateSkillSeed[] = [
  // Stat chains — four diagonals from the centre. Vigor → NE, Power → SE,
  // Focus → SW, Fortune → NW. The chain ends at a class unlock node (defined
  // in class.ts) at the same diagonal step extended one further.
  {
    skillId: 'vigor_minor',
    name: 'Vigor Minor',
    description: 'Build resilience. Vigor scales survivability — HP in the Defensive Battle, charges and resilience in other minigames.',
    maxLevel: 4,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: STEP,
    positionY: -STEP,
    sortOrder: 0,
    treeId: 'intermediate',
  },
  {
    skillId: 'vigor_major',
    name: 'Vigor Major',
    description: 'Capstone Vigor investment — the difference between standing your ground and getting overrun.',
    maxLevel: 4,
    prerequisiteSkillId: 'vigor_minor',
    prerequisiteLevel: 4,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 2,
    positionX: STEP * 2,
    positionY: -STEP * 2,
    sortOrder: 1,
    treeId: 'intermediate',
  },
  {
    skillId: 'power_minor',
    name: 'Power Minor',
    description: 'Sharpen offensive output. Power scales damage, healing magnitude, and action effect strength.',
    maxLevel: 4,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: STEP,
    positionY: STEP,
    sortOrder: 2,
    treeId: 'intermediate',
  },
  {
    skillId: 'power_major',
    name: 'Power Major',
    description: 'Capstone Power investment — turn pressure into pace.',
    maxLevel: 4,
    prerequisiteSkillId: 'power_minor',
    prerequisiteLevel: 4,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 2,
    positionX: STEP * 2,
    positionY: STEP * 2,
    sortOrder: 3,
    treeId: 'intermediate',
  },
  {
    skillId: 'focus_minor',
    name: 'Focus Minor',
    description: 'Refine control and precision. Focus scales action quality, timing windows, and option-pool size.',
    maxLevel: 4,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: -STEP,
    positionY: STEP,
    sortOrder: 4,
    treeId: 'intermediate',
  },
  {
    skillId: 'focus_major',
    name: 'Focus Major',
    description: 'Capstone Focus investment — read every fight before it starts.',
    maxLevel: 4,
    prerequisiteSkillId: 'focus_minor',
    prerequisiteLevel: 4,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 2,
    positionX: -STEP * 2,
    positionY: STEP * 2,
    sortOrder: 5,
    treeId: 'intermediate',
  },
  {
    skillId: 'fortune_minor',
    name: 'Fortune Minor',
    description: 'Tip variance in your favor. Fortune scales loot rolls, crit chance, and bonus drops.',
    maxLevel: 4,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: -STEP,
    positionY: -STEP,
    sortOrder: 6,
    treeId: 'intermediate',
  },
  {
    skillId: 'fortune_major',
    name: 'Fortune Major',
    description: 'Capstone Fortune investment — the wastes start giving more than they take.',
    maxLevel: 4,
    prerequisiteSkillId: 'fortune_minor',
    prerequisiteLevel: 4,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 2,
    positionX: -STEP * 2,
    positionY: -STEP * 2,
    sortOrder: 7,
    treeId: 'intermediate',
  },
  ...buildMultiplierSeeds(),
];

interface StatGrantSeed {
  skillId: string;
  statId: string;
  amountPerLevel: number;
}

const STAT_GRANT_SEEDS: StatGrantSeed[] = [
  { skillId: 'vigor_minor', statId: 'vigor', amountPerLevel: 1 },
  { skillId: 'vigor_major', statId: 'vigor', amountPerLevel: 3 },
  { skillId: 'power_minor', statId: 'power', amountPerLevel: 1 },
  { skillId: 'power_major', statId: 'power', amountPerLevel: 3 },
  { skillId: 'focus_minor', statId: 'focus', amountPerLevel: 1 },
  { skillId: 'focus_major', statId: 'focus', amountPerLevel: 3 },
  { skillId: 'fortune_minor', statId: 'fortune', amountPerLevel: 1 },
  { skillId: 'fortune_major', statId: 'fortune', amountPerLevel: 3 },
  // Class-tree infinite-scaling stat nodes — each grants +1 of the class's
  // governing stat per level. No cap; cost-curve on class point crafting is
  // the natural soft cap. Always-on (`:skill:` source), so investment persists
  // across class swaps.
  { skillId: 'vigor_growth', statId: 'vigor', amountPerLevel: 1 },
  { skillId: 'focus_growth', statId: 'focus', amountPerLevel: 1 },
  { skillId: 'power_growth', statId: 'power', amountPerLevel: 1 },
  { skillId: 'fortune_growth', statId: 'fortune', amountPerLevel: 1 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seedSkillTrees(ctx: any): void {
  for (const pool of POOL_SEEDS) {
    if (ctx.db.skillPointPoolDefinition.poolId.find(pool.poolId) === null) {
      ctx.db.skillPointPoolDefinition.insert(pool);
    }
  }
  for (const tree of SKILL_TREE_SEEDS) {
    if (ctx.db.skillTreeDefinition.treeId.find(tree.treeId) === null) {
      ctx.db.skillTreeDefinition.insert(tree);
    }
  }
  // Upsert: copy edits (e.g. Minor flat-bonus rewording, balance tweaks to
  // costSkillPoints / maxLevel) propagate to live DBs via runSeedMigration.
  for (const seed of INTERMEDIATE_SKILL_SEEDS) {
    const existing = ctx.db.skillDefinition.skillId.find(seed.skillId);
    if (existing === null) {
      ctx.db.skillDefinition.insert(seed);
    } else {
      ctx.db.skillDefinition.skillId.update({ ...existing, ...seed });
    }
  }
  for (const grant of STAT_GRANT_SEEDS) {
    let exists = false;
    for (const row of ctx.db.skillStatGrant.skill_stat_grant_skill.filter(grant.skillId)) {
      if (row.statId === grant.statId) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      ctx.db.skillStatGrant.insert({ id: 0n, ...grant });
    }
  }
}

// Validation pass: every skillDefinition row must have a treeId that resolves
// to a real skill_tree_definition row. Logs orphans rather than throwing —
// throwing inside init breaks the entire module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateSkillTreeIntegrity(ctx: any): void {
  for (const skill of ctx.db.skillDefinition.iter()) {
    if (ctx.db.skillTreeDefinition.treeId.find(skill.treeId) === null) {
      console.warn(
        `Skill "${skill.skillId}" has treeId="${skill.treeId}" that does not resolve to a skill_tree_definition row.`
      );
    }
  }
}
