import { table, t } from 'spacetimedb/server';

// ---------- Slot unlock conditions ----------

export const SlotUnlockCondition = t.enum('SlotUnlockCondition', {
  always: t.unit(),
  structureBuilt: t.object('SlotStructureBuiltPayload', {
    structureId: t.string(),
  }),
  skillPurchased: t.object('SlotSkillPurchasedPayload', {
    skillId: t.string(),
    minLevel: t.u32(),
  }),
});

// ---------- Item templates (static seed) ----------

export const itemDefinition = table(
  { name: 'item_definition', public: true },
  {
    itemDefId: t.string().primaryKey(),
    displayName: t.string(),
    description: t.string(),
    slotId: t.string(),
    iconKey: t.string(),
    sortOrder: t.u32(),
  }
);

export const itemDefinitionAffix = table(
  {
    name: 'item_definition_affix',
    public: true,
    indexes: [
      {
        accessor: 'item_definition_affix_def',
        algorithm: 'btree',
        columns: ['itemDefId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    itemDefId: t.string(),
    statId: t.string(),
    minAmount: t.i32(),
    maxAmount: t.i32(),
    rollWeight: t.u32(),
    isGuaranteed: t.bool(),
  }
);

export const itemDefinitionRoll = table(
  { name: 'item_definition_roll', public: true },
  {
    itemDefId: t.string().primaryKey(),
    guaranteedCount: t.u32(),
    optionalRollCount: t.u32(),
  }
);

// ---------- Equipment slots (static seed, view-filtered per player) ----------

export const equipmentSlotDefinition = table(
  { name: 'equipment_slot_definition', public: true },
  {
    slotId: t.string().primaryKey(),
    displayName: t.string(),
    iconKey: t.string(),
    sortOrder: t.u32(),
    unlockCondition: SlotUnlockCondition,
  }
);

// ---------- Crafting recipes (static seed) ----------

export const craftingRecipe = table(
  { name: 'crafting_recipe', public: true },
  {
    recipeId: t.string().primaryKey(),
    itemDefId: t.string(),
    unlockedAtArmoryLevel: t.u32(),
    sortOrder: t.u32(),
  }
);

export const craftingRecipeCost = table(
  {
    name: 'crafting_recipe_cost',
    public: true,
    indexes: [
      {
        accessor: 'crafting_recipe_cost_recipe',
        algorithm: 'btree',
        columns: ['recipeId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    recipeId: t.string(),
    resourceId: t.string(),
    amount: t.u64(),
  }
);

// ---------- Armory upgrade costs (static seed) ----------

export const armoryUpgradeCost = table(
  {
    name: 'armory_upgrade_cost',
    public: true,
    indexes: [
      {
        accessor: 'armory_upgrade_cost_level',
        algorithm: 'btree',
        columns: ['targetLevel'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    targetLevel: t.u32(),
    resourceId: t.string(),
    amount: t.u64(),
  }
);

// ---------- Per-player armory state ----------
// Private — exposed via myArmoryState view.

export const playerArmoryState = table(
  { name: 'player_armory_state' },
  {
    username: t.string().primaryKey(),
    level: t.u32(),
    builtAt: t.timestamp(),
    craftCounter: t.u64(),
  }
);

// ---------- Per-player item instances ----------
// Private — exposed via myItemInstances + myItemInstanceAffixes views.

export const itemInstance = table(
  {
    name: 'item_instance',
    indexes: [
      {
        accessor: 'item_instance_owner',
        algorithm: 'btree',
        columns: ['ownerUsername'],
      },
    ],
  },
  {
    instanceId: t.u64().primaryKey().autoInc(),
    itemDefId: t.string(),
    ownerUsername: t.string(),
    craftedAt: t.timestamp(),
    armoryLevelAtCraft: t.u32(),
  }
);

export const itemInstanceAffix = table(
  {
    name: 'item_instance_affix',
    indexes: [
      {
        accessor: 'item_instance_affix_instance',
        algorithm: 'btree',
        columns: ['instanceId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    instanceId: t.u64(),
    statId: t.string(),
    amount: t.i32(),
  }
);

// ---------- Per-player equipment slots ----------
// Private — exposed via myEquipment view.

export const playerEquipment = table(
  {
    name: 'player_equipment',
    indexes: [
      {
        accessor: 'player_equipment_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    slotId: t.string(),
    itemInstanceId: t.u64(),
  }
);
