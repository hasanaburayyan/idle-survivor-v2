import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from './schema';
import { Rng, buildSeed, pickWeightedWithoutReplacement, rollAffixAmount } from './rng';
import { setStatSource, clearStatSourcesByPrefix } from './stats';
import { CAPABILITY_KEYS, getCapabilityTotal } from './class';
import {
  itemDefinition,
  itemDefinitionAffix,
  itemDefinitionRoll,
  itemInstance,
  itemInstanceAffix,
  equipmentSlotDefinition,
  craftingRecipe,
  craftingRecipeCost,
  armoryUpgradeCost,
  playerArmoryState,
  playerEquipment,
} from './armory_tables';

// Tuning constants
const MAX_ARMORY_LEVEL = 10;

// ---------- Resource helpers (locally inlined to avoid index.ts circular imports) ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getResource(ctx: any, username: string, resourceId: string): bigint {
  if (resourceId === 'scrap') {
    const ps = ctx.db.playerState.username.find(username);
    return ps?.scrap ?? 0n;
  }
  for (const row of ctx.db.playerResource.player_resource_username.filter(username)) {
    if (row.resourceId === resourceId) return row.amount;
  }
  return 0n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spendResource(ctx: any, username: string, resourceId: string, amount: bigint): void {
  if (amount <= 0n) return;
  if (resourceId === 'scrap') {
    const ps = ctx.db.playerState.username.find(username);
    if (ps === null) throw new SenderError('Player state missing');
    if (ps.scrap < amount) throw new SenderError('Insufficient scrap');
    ctx.db.playerState.username.update({
      ...ps,
      scrap: ps.scrap - amount,
      updatedAt: ctx.timestamp,
    });
    return;
  }
  for (const row of ctx.db.playerResource.player_resource_username.filter(username)) {
    if (row.resourceId !== resourceId) continue;
    if (row.amount < amount) throw new SenderError(`Insufficient ${resourceId}`);
    ctx.db.playerResource.id.update({ ...row, amount: row.amount - amount });
    return;
  }
  throw new SenderError(`Insufficient ${resourceId}`);
}

// ---------- Armory state helpers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findArmoryStructure(ctx: any, username: string) {
  for (const row of ctx.db.playerStructure.player_structure_username.filter(username)) {
    if (row.structureId === 'armory') return row;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOrCreateArmoryState(ctx: any, username: string) {
  const existing = ctx.db.playerArmoryState.username.find(username);
  if (existing !== null) return existing;
  if (findArmoryStructure(ctx, username) === null) {
    throw new SenderError('Armory not built yet');
  }
  ctx.db.playerArmoryState.insert({
    username,
    level: 1,
    builtAt: ctx.timestamp,
    craftCounter: 0n,
  });
  const inserted = ctx.db.playerArmoryState.username.find(username);
  if (inserted === null) throw new Error('Failed to create armory state');
  return inserted;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSlotVisible(ctx: any, username: string, slotDef: { unlockCondition: { tag: string; value?: any } }): boolean {
  const cond = slotDef.unlockCondition;
  if (cond.tag === 'always') return true;
  if (cond.tag === 'structureBuilt') {
    const structureId = cond.value.structureId;
    for (const row of ctx.db.playerStructure.player_structure_username.filter(username)) {
      if (row.structureId === structureId) return true;
    }
    return false;
  }
  if (cond.tag === 'skillPurchased') {
    const { skillId, minLevel } = cond.value;
    for (const row of ctx.db.playerSkill.player_skill_username.filter(username)) {
      if (row.skillId === skillId && row.level >= minLevel) return true;
    }
    return false;
  }
  return false;
}

// ---------- Views ----------

const RecipeRow = t.object('AvailableRecipeRow', {
  recipeId: t.string(),
  itemDefId: t.string(),
  unlockedAtArmoryLevel: t.u32(),
  sortOrder: t.u32(),
});

export const myAvailableRecipes = spacetimedb.view(
  { name: 'my_available_recipes', public: true },
  t.array(RecipeRow),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const state = ctx.db.playerArmoryState.username.find(s.username);
    if (state === null) return [];
    const result: { recipeId: string; itemDefId: string; unlockedAtArmoryLevel: number; sortOrder: number }[] = [];
    // Iterating crafting_recipe: it's a small static seed table (one row per recipe).
    for (const r of ctx.db.craftingRecipe.iter()) {
      if (r.unlockedAtArmoryLevel <= state.level) {
        result.push({
          recipeId: r.recipeId,
          itemDefId: r.itemDefId,
          unlockedAtArmoryLevel: r.unlockedAtArmoryLevel,
          sortOrder: r.sortOrder,
        });
      }
    }
    return result;
  }
);

export const myVisibleEquipmentSlots = spacetimedb.view(
  { name: 'my_visible_equipment_slots', public: true },
  t.array(equipmentSlotDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const result = [];
    for (const slot of ctx.db.equipmentSlotDefinition.iter()) {
      if (isSlotVisible(ctx, s.username, slot)) {
        result.push(slot);
      }
    }
    return result;
  }
);

export const myArmoryState = spacetimedb.view(
  { name: 'my_armory_state', public: true },
  t.array(playerArmoryState.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const row = ctx.db.playerArmoryState.username.find(s.username);
    return row ? [row] : [];
  }
);

export const myItemInstances = spacetimedb.view(
  { name: 'my_item_instances', public: true },
  t.array(itemInstance.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.itemInstance.item_instance_owner.filter(s.username)];
  }
);

export const myItemInstanceAffixes = spacetimedb.view(
  { name: 'my_item_instance_affixes', public: true },
  t.array(itemInstanceAffix.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const out = [];
    for (const inst of ctx.db.itemInstance.item_instance_owner.filter(s.username)) {
      for (const aff of ctx.db.itemInstanceAffix.item_instance_affix_instance.filter(inst.instanceId)) {
        out.push(aff);
      }
    }
    return out;
  }
);

export const myEquipment = spacetimedb.view(
  { name: 'my_equipment', public: true },
  t.array(playerEquipment.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.playerEquipment.player_equipment_username.filter(s.username)];
  }
);

// Discounted armory upgrade costs for the player's next level.
// Bakes ARMORY_COST_REDUCTION_BP into discountedAmount so the client
// never needs to re-apply the math locally.
const ArmoryUpgradeCostDiscountedRow = t.object('ArmoryUpgradeCostDiscountedRow', {
  resourceId: t.string(),
  originalAmount: t.u64(),
  discountedAmount: t.u64(),
  targetLevel: t.u32(),
});

export const myArmoryUpgradeCost = spacetimedb.view(
  { name: 'my_armory_upgrade_cost', public: true },
  t.array(ArmoryUpgradeCostDiscountedRow),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const state = ctx.db.playerArmoryState.username.find(s.username);
    const currentLevel = state?.level ?? 0;
    const targetLevel = currentLevel + 1;
    if (targetLevel > MAX_ARMORY_LEVEL) return [];
    const reductionBp = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.ARMORY_COST_REDUCTION_BP);
    const costMult = Math.max(0, 1 - reductionBp / 10000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];
    for (const c of ctx.db.armoryUpgradeCost.armory_upgrade_cost_level.filter(targetLevel)) {
      const discountedAmount = BigInt(Math.max(1, Math.floor(Number(c.amount) * costMult)));
      result.push({ resourceId: c.resourceId, originalAmount: c.amount, discountedAmount, targetLevel });
    }
    return result;
  }
);

// ---------- Reducers ----------

export const upgradeArmory = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const state = getOrCreateArmoryState(ctx, s.username);
  if (state.level >= MAX_ARMORY_LEVEL) {
    throw new SenderError('Armory already at max level');
  }
  const targetLevel = state.level + 1;
  const costs = [...ctx.db.armoryUpgradeCost.armory_upgrade_cost_level.filter(targetLevel)];
  if (costs.length === 0) {
    throw new SenderError('No upgrade cost defined for next level');
  }
  // ARMORY_COST_REDUCTION_BP: e.g. 2000 bp = 20% off.  Floor to 1 to prevent free upgrades.
  const reductionBp = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.ARMORY_COST_REDUCTION_BP);
  const costMult = Math.max(0, 1 - reductionBp / 10000);
  for (const c of costs) {
    const effectiveAmount = BigInt(Math.max(1, Math.floor(Number(c.amount) * costMult)));
    if (getResource(ctx, s.username, c.resourceId) < effectiveAmount) {
      throw new SenderError(`Insufficient ${c.resourceId}`);
    }
  }
  for (const c of costs) {
    const effectiveAmount = BigInt(Math.max(1, Math.floor(Number(c.amount) * costMult)));
    spendResource(ctx, s.username, c.resourceId, effectiveAmount);
  }
  ctx.db.playerArmoryState.username.update({
    ...state,
    level: targetLevel,
  });
});

export const craftItem = spacetimedb.reducer(
  { recipeId: t.string() },
  (ctx, { recipeId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const recipe = ctx.db.craftingRecipe.recipeId.find(recipeId);
    if (recipe === null) throw new SenderError('Unknown recipe');
    const state = getOrCreateArmoryState(ctx, s.username);
    if (recipe.unlockedAtArmoryLevel > state.level) {
      throw new SenderError('Recipe not yet unlocked');
    }
    const itemDef = ctx.db.itemDefinition.itemDefId.find(recipe.itemDefId);
    if (itemDef === null) throw new SenderError('Item template missing');
    const rollDef = ctx.db.itemDefinitionRoll.itemDefId.find(recipe.itemDefId);
    if (rollDef === null) throw new SenderError('Item roll definition missing');

    // Validate cost affordability before mutating anything.
    const costs = [...ctx.db.craftingRecipeCost.crafting_recipe_cost_recipe.filter(recipeId)];
    for (const c of costs) {
      if (getResource(ctx, s.username, c.resourceId) < c.amount) {
        throw new SenderError(`Insufficient ${c.resourceId}`);
      }
    }

    // Bump craft counter first so the seed is unique even on repeat crafts in the same tick.
    const nextCounter = state.craftCounter + 1n;
    ctx.db.playerArmoryState.username.update({ ...state, craftCounter: nextCounter });

    // Build deterministic seed.
    const senderHex = ctx.sender.toHexString();
    const seed = buildSeed([
      ctx.timestamp.microsSinceUnixEpoch,
      senderHex,
      recipeId,
      nextCounter,
    ]);
    const rng = new Rng(seed);

    // Pull the affix pool.
    const allAffixes = [...ctx.db.itemDefinitionAffix.item_definition_affix_def.filter(recipe.itemDefId)];
    const guaranteed = allAffixes.filter(a => a.isGuaranteed);
    const optionalPool = allAffixes
      .filter(a => !a.isGuaranteed)
      .map(a => ({ item: a, weight: a.rollWeight }));
    // CRAFT_EXTRA_OPTIONAL_COUNT: master crafter node adds extra optional affix rolls.
    const extraOptional = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.CRAFT_EXTRA_OPTIONAL_COUNT);
    const optionalCount = Math.min(rollDef.optionalRollCount + extraOptional, optionalPool.length);
    const chosenOptional = pickWeightedWithoutReplacement(rng, optionalPool, optionalCount);

    // CRAFT_AFFIX_BIAS_BP: skews the roll distribution toward higher amounts.
    const craftAffixBiasBp = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.CRAFT_AFFIX_BIAS_BP);
    const extraBias = craftAffixBiasBp / 10000;
    const rolled: { statId: string; amount: number }[] = [];
    for (const a of guaranteed) {
      rolled.push({
        statId: a.statId,
        amount: rollAffixAmount(rng, a.minAmount, a.maxAmount, state.level, MAX_ARMORY_LEVEL, extraBias),
      });
    }
    for (const a of chosenOptional) {
      rolled.push({
        statId: a.statId,
        amount: rollAffixAmount(rng, a.minAmount, a.maxAmount, state.level, MAX_ARMORY_LEVEL, extraBias),
      });
    }

    // Deduct costs after rolling succeeds.
    for (const c of costs) {
      spendResource(ctx, s.username, c.resourceId, c.amount);
    }

    // Insert the item instance and its affix rows.
    const inserted = ctx.db.itemInstance.insert({
      instanceId: 0n,
      itemDefId: recipe.itemDefId,
      ownerUsername: s.username,
      craftedAt: ctx.timestamp,
      armoryLevelAtCraft: state.level,
    });
    for (const r of rolled) {
      ctx.db.itemInstanceAffix.insert({
        id: 0n,
        instanceId: inserted.instanceId,
        statId: r.statId,
        amount: r.amount,
      });
    }
  }
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findEquippedInSlot(ctx: any, username: string, slotId: string) {
  for (const row of ctx.db.playerEquipment.player_equipment_username.filter(username)) {
    if (row.slotId === slotId) return row;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unequipInternal(ctx: any, username: string, slotId: string): void {
  const existing = findEquippedInSlot(ctx, username, slotId);
  if (existing === null) return;
  const prefix = `${username}:equipment:${existing.itemInstanceId.toString()}:`;
  clearStatSourcesByPrefix(ctx, username, prefix);
  ctx.db.playerEquipment.id.delete(existing.id);
}

export const equipItem = spacetimedb.reducer(
  { itemInstanceId: t.u64() },
  (ctx, { itemInstanceId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const inst = ctx.db.itemInstance.instanceId.find(itemInstanceId);
    if (inst === null) throw new SenderError('Item not found');
    if (inst.ownerUsername !== s.username) throw new SenderError('Not your item');
    const itemDef = ctx.db.itemDefinition.itemDefId.find(inst.itemDefId);
    if (itemDef === null) throw new SenderError('Item template missing');
    const slot = ctx.db.equipmentSlotDefinition.slotId.find(itemDef.slotId);
    if (slot === null) throw new SenderError('Equipment slot missing');
    if (!isSlotVisible(ctx, s.username, slot)) {
      throw new SenderError('Slot not yet unlocked');
    }

    // If something is already in this slot, unequip it first (clears its stat sources).
    unequipInternal(ctx, s.username, itemDef.slotId);

    ctx.db.playerEquipment.insert({
      id: 0n,
      username: s.username,
      slotId: itemDef.slotId,
      itemInstanceId: inst.instanceId,
    });

    for (const aff of ctx.db.itemInstanceAffix.item_instance_affix_instance.filter(inst.instanceId)) {
      const sourceKey = `${s.username}:equipment:${inst.instanceId.toString()}:${aff.statId}`;
      setStatSource(ctx, sourceKey, s.username, aff.statId, aff.amount);
    }
  }
);

export const unequipItem = spacetimedb.reducer(
  { slotId: t.string() },
  (ctx, { slotId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    unequipInternal(ctx, s.username, slotId);
  }
);

// Permanently destroys an item the caller owns. Auto-unequips first if the
// item is currently equipped (clears any stat sources via unequipInternal),
// then deletes all itemInstanceAffix rows for the instance, then the
// itemInstance itself. Idempotent on missing-or-not-owned (throws SenderError).
export const trashItem = spacetimedb.reducer(
  { itemInstanceId: t.u64() },
  (ctx, { itemInstanceId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const inst = ctx.db.itemInstance.instanceId.find(itemInstanceId);
    if (inst === null) throw new SenderError('Item not found');
    if (inst.ownerUsername !== s.username) throw new SenderError('Not your item');

    const itemDef = ctx.db.itemDefinition.itemDefId.find(inst.itemDefId);
    if (itemDef !== null) {
      const equipped = findEquippedInSlot(ctx, s.username, itemDef.slotId);
      if (equipped !== null && equipped.itemInstanceId === itemInstanceId) {
        unequipInternal(ctx, s.username, itemDef.slotId);
      }
    }

    for (const aff of ctx.db.itemInstanceAffix.item_instance_affix_instance.filter(itemInstanceId)) {
      ctx.db.itemInstanceAffix.id.delete(aff.id);
    }
    ctx.db.itemInstance.instanceId.delete(itemInstanceId);
  }
);

// ---------- Seed ----------

interface SlotSeed {
  slotId: string;
  displayName: string;
  iconKey: string;
  sortOrder: number;
  unlockCondition: { tag: 'always' } | { tag: 'structureBuilt'; value: { structureId: string } } | { tag: 'skillPurchased'; value: { skillId: string; minLevel: number } };
}

const SLOT_SEEDS: SlotSeed[] = [
  {
    slotId: 'tool',
    displayName: 'Tool',
    iconKey: 'slot_tool',
    sortOrder: 0,
    unlockCondition: { tag: 'structureBuilt', value: { structureId: 'armory' } },
  },
  {
    slotId: 'chest',
    displayName: 'Chest',
    iconKey: 'slot_chest',
    sortOrder: 1,
    unlockCondition: { tag: 'structureBuilt', value: { structureId: 'armory' } },
  },
];

interface ItemDefSeed {
  itemDefId: string;
  displayName: string;
  description: string;
  slotId: string;
  iconKey: string;
  sortOrder: number;
}

const ITEM_DEF_SEEDS: ItemDefSeed[] = [
  {
    itemDefId: 'rucksack',
    displayName: 'Rucksack',
    description: 'A scavenged backpack. Helps you carry more, find more.',
    slotId: 'tool',
    iconKey: 'item_rucksack',
    sortOrder: 0,
  },
  {
    itemDefId: 'handgun',
    displayName: 'Handgun',
    description: 'Old, oily, but it still fires. Trades survivability for stopping power.',
    slotId: 'tool',
    iconKey: 'item_handgun',
    sortOrder: 1,
  },
  {
    itemDefId: 'armor_vest',
    displayName: 'Armor Vest',
    description: 'Plates stitched into a vest. Heavy. Worth the weight.',
    slotId: 'chest',
    iconKey: 'item_armor_vest',
    sortOrder: 2,
  },
];

interface AffixSeed {
  itemDefId: string;
  statId: string;
  minAmount: number;
  maxAmount: number;
  rollWeight: number;
  isGuaranteed: boolean;
}

const AFFIX_SEEDS: AffixSeed[] = [
  // Rucksack — guaranteed Fortune; optional pool spans the other three stats so
  // Master Crafter (CRAFT_EXTRA_OPTIONAL_COUNT) has material to roll into.
  { itemDefId: 'rucksack', statId: 'fortune', minAmount: 1, maxAmount: 10, rollWeight: 5, isGuaranteed: true },
  { itemDefId: 'rucksack', statId: 'focus', minAmount: 1, maxAmount: 5, rollWeight: 3, isGuaranteed: false },
  { itemDefId: 'rucksack', statId: 'vigor', minAmount: 1, maxAmount: 4, rollWeight: 2, isGuaranteed: false },
  { itemDefId: 'rucksack', statId: 'power', minAmount: 1, maxAmount: 4, rollWeight: 2, isGuaranteed: false },
  // Handgun — guaranteed Power; optional pool covers the other three stats.
  { itemDefId: 'handgun', statId: 'power', minAmount: 1, maxAmount: 10, rollWeight: 5, isGuaranteed: true },
  { itemDefId: 'handgun', statId: 'vigor', minAmount: 1, maxAmount: 8, rollWeight: 3, isGuaranteed: false },
  { itemDefId: 'handgun', statId: 'focus', minAmount: 1, maxAmount: 4, rollWeight: 2, isGuaranteed: false },
  { itemDefId: 'handgun', statId: 'fortune', minAmount: 1, maxAmount: 4, rollWeight: 2, isGuaranteed: false },
  // Armor Vest — guaranteed Vigor; optional pool covers the other three stats.
  { itemDefId: 'armor_vest', statId: 'vigor', minAmount: 3, maxAmount: 15, rollWeight: 5, isGuaranteed: true },
  { itemDefId: 'armor_vest', statId: 'focus', minAmount: 1, maxAmount: 4, rollWeight: 2, isGuaranteed: false },
  { itemDefId: 'armor_vest', statId: 'fortune', minAmount: 1, maxAmount: 4, rollWeight: 2, isGuaranteed: false },
  { itemDefId: 'armor_vest', statId: 'power', minAmount: 1, maxAmount: 4, rollWeight: 2, isGuaranteed: false },
];

interface RollSeed {
  itemDefId: string;
  guaranteedCount: number;
  optionalRollCount: number;
}

const ROLL_SEEDS: RollSeed[] = [
  { itemDefId: 'rucksack', guaranteedCount: 1, optionalRollCount: 1 },
  { itemDefId: 'handgun', guaranteedCount: 1, optionalRollCount: 1 },
  { itemDefId: 'armor_vest', guaranteedCount: 1, optionalRollCount: 0 },
];

interface RecipeSeed {
  recipeId: string;
  itemDefId: string;
  unlockedAtArmoryLevel: number;
  sortOrder: number;
  costs: { resourceId: string; amount: bigint }[];
}

// Non-scrap costs cut ~2.5x from pre-structure-economy values to match the
// new income rates: Refinery yields ~120 parts/hr, Smelter ~60 metal/hr,
// Fabric craft is gated on those upstream resources.
const RECIPE_SEEDS: RecipeSeed[] = [
  {
    recipeId: 'craft_rucksack',
    itemDefId: 'rucksack',
    unlockedAtArmoryLevel: 1,
    sortOrder: 0,
    costs: [{ resourceId: 'scrap', amount: 200n }, { resourceId: 'fabric', amount: 2n }],
  },
  {
    recipeId: 'craft_handgun',
    itemDefId: 'handgun',
    unlockedAtArmoryLevel: 2,
    sortOrder: 1,
    costs: [{ resourceId: 'scrap', amount: 500n }, { resourceId: 'parts', amount: 4n }, { resourceId: 'metal', amount: 2n }],
  },
  {
    recipeId: 'craft_armor_vest',
    itemDefId: 'armor_vest',
    unlockedAtArmoryLevel: 3,
    sortOrder: 2,
    costs: [{ resourceId: 'scrap', amount: 1000n }, { resourceId: 'metal', amount: 6n }, { resourceId: 'fabric', amount: 4n }],
  },
];

interface UpgradeCostSeed {
  targetLevel: number;
  resourceId: string;
  amount: bigint;
}

// Costs scale geometrically; later levels add new resource gates. Non-scrap
// amounts cut ~2.5x (parts/metal/fabric) and ~5x (medicine) from the original
// click-economy values to match Refinery/Smelter/Workbench/minigame income.
const UPGRADE_COST_SEEDS: UpgradeCostSeed[] = [
  { targetLevel: 2, resourceId: 'scrap', amount: 500n },
  { targetLevel: 2, resourceId: 'parts', amount: 8n },
  { targetLevel: 3, resourceId: 'scrap', amount: 1500n },
  { targetLevel: 3, resourceId: 'parts', amount: 24n },
  { targetLevel: 3, resourceId: 'metal', amount: 4n },
  { targetLevel: 4, resourceId: 'scrap', amount: 4000n },
  { targetLevel: 4, resourceId: 'parts', amount: 60n },
  { targetLevel: 4, resourceId: 'metal', amount: 12n },
  { targetLevel: 5, resourceId: 'scrap', amount: 10000n },
  { targetLevel: 5, resourceId: 'parts', amount: 140n },
  { targetLevel: 5, resourceId: 'metal', amount: 30n },
  { targetLevel: 5, resourceId: 'fabric', amount: 8n },
  { targetLevel: 6, resourceId: 'scrap', amount: 25000n },
  { targetLevel: 6, resourceId: 'metal', amount: 80n },
  { targetLevel: 6, resourceId: 'fabric', amount: 24n },
  { targetLevel: 7, resourceId: 'scrap', amount: 60000n },
  { targetLevel: 7, resourceId: 'metal', amount: 200n },
  { targetLevel: 7, resourceId: 'fabric', amount: 60n },
  { targetLevel: 8, resourceId: 'scrap', amount: 150000n },
  { targetLevel: 8, resourceId: 'metal', amount: 480n },
  { targetLevel: 8, resourceId: 'fabric', amount: 160n },
  { targetLevel: 8, resourceId: 'medicine', amount: 4n },
  { targetLevel: 9, resourceId: 'scrap', amount: 400000n },
  { targetLevel: 9, resourceId: 'metal', amount: 1200n },
  { targetLevel: 9, resourceId: 'fabric', amount: 400n },
  { targetLevel: 9, resourceId: 'medicine', amount: 16n },
  { targetLevel: 10, resourceId: 'scrap', amount: 1000000n },
  { targetLevel: 10, resourceId: 'metal', amount: 3200n },
  { targetLevel: 10, resourceId: 'fabric', amount: 1000n },
  { targetLevel: 10, resourceId: 'medicine', amount: 50n },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seedArmory(ctx: any): void {
  for (const slot of SLOT_SEEDS) {
    if (ctx.db.equipmentSlotDefinition.slotId.find(slot.slotId) === null) {
      ctx.db.equipmentSlotDefinition.insert(slot);
    }
  }
  for (const def of ITEM_DEF_SEEDS) {
    if (ctx.db.itemDefinition.itemDefId.find(def.itemDefId) === null) {
      ctx.db.itemDefinition.insert(def);
    }
  }
  for (const aff of AFFIX_SEEDS) {
    let exists = false;
    for (const row of ctx.db.itemDefinitionAffix.item_definition_affix_def.filter(aff.itemDefId)) {
      if (row.statId === aff.statId && row.isGuaranteed === aff.isGuaranteed) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      ctx.db.itemDefinitionAffix.insert({ id: 0n, ...aff });
    }
  }
  for (const r of ROLL_SEEDS) {
    if (ctx.db.itemDefinitionRoll.itemDefId.find(r.itemDefId) === null) {
      ctx.db.itemDefinitionRoll.insert(r);
    }
  }
  for (const r of RECIPE_SEEDS) {
    if (ctx.db.craftingRecipe.recipeId.find(r.recipeId) === null) {
      ctx.db.craftingRecipe.insert({
        recipeId: r.recipeId,
        itemDefId: r.itemDefId,
        unlockedAtArmoryLevel: r.unlockedAtArmoryLevel,
        sortOrder: r.sortOrder,
      });
    }
    // Upsert each cost row: update amount on existing rows (so rebalances land
    // via runSeedMigration), insert if missing.
    for (const c of r.costs) {
      let existing = null;
      for (const row of ctx.db.craftingRecipeCost.crafting_recipe_cost_recipe.filter(r.recipeId)) {
        if (row.resourceId === c.resourceId) {
          existing = row;
          break;
        }
      }
      if (existing === null) {
        ctx.db.craftingRecipeCost.insert({
          id: 0n,
          recipeId: r.recipeId,
          resourceId: c.resourceId,
          amount: c.amount,
        });
      } else if (existing.amount !== c.amount) {
        ctx.db.craftingRecipeCost.id.update({ ...existing, amount: c.amount });
      }
    }
  }
  for (const c of UPGRADE_COST_SEEDS) {
    let existing = null;
    for (const row of ctx.db.armoryUpgradeCost.armory_upgrade_cost_level.filter(c.targetLevel)) {
      if (row.resourceId === c.resourceId) {
        existing = row;
        break;
      }
    }
    if (existing === null) {
      ctx.db.armoryUpgradeCost.insert({ id: 0n, ...c });
    } else if (existing.amount !== c.amount) {
      ctx.db.armoryUpgradeCost.id.update({ ...existing, amount: c.amount });
    }
  }
}
