import { table, t } from 'spacetimedb/server';

// ---------- Tagged unions ----------

// appliesWhen on class_node_effect: 'equipped' fires only when the class is
// equipped; 'always' is reserved for a future "free the node from the class"
// mechanic. All v1 class effects ship as 'equipped'.
export const AppliesWhen = t.enum('AppliesWhen', {
  equipped: t.unit(),
  always: t.unit(),
});

// ---------- Tables ----------

// One row per player — which class is currently equipped.
// classId = '' means no class is equipped.
export const playerEquippedClass = table(
  { name: 'player_equipped_class' },
  {
    username: t.string().primaryKey(),
    classId: t.string(),
    equippedAt: t.timestamp(),
  }
);

// Non-stat effects granted by class skill nodes.
// Stat-granting class nodes continue to use skill_stat_grant.
// Indexed by skillId so equipClass can look up effects per node efficiently.
export const classNodeEffect = table(
  {
    name: 'class_node_effect',
    public: true,
    indexes: [
      {
        accessor: 'class_node_effect_skill_id',
        algorithm: 'btree',
        columns: ['skillId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    skillId: t.string(),
    effectKey: t.string(),
    amountPerLevel: t.i32(),
    appliesWhen: AppliesWhen,
  }
);

// Resource cost to craft one class point per tier.
// Multiple rows per (classId, tierIndex) — one row per required resource.
// Brute tier-0 has two rows: one for Metal and one for Fabric.
export const classCraftCost = table(
  {
    name: 'class_craft_cost',
    public: true,
    indexes: [
      {
        accessor: 'class_craft_cost_class_id',
        algorithm: 'btree',
        columns: ['classId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    classId: t.string(),
    tierIndex: t.u32(),
    // Number of points this tier spans. Use 4_294_967_295 (u32 max) for unbounded.
    pointsInTier: t.u32(),
    resourceId: t.string(),
    amountPerPoint: t.u64(),
  }
);

// Monotonically increasing count of class points crafted per player per class.
// Never decremented. The tier lookup in craftClassPoint reads this.
export const playerClassCraftProgress = table(
  {
    name: 'player_class_craft_progress',
    indexes: [
      {
        accessor: 'player_class_craft_progress_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    classId: t.string(),
    pointsCrafted: t.u64(),
    lastCraftedAt: t.timestamp(),
  }
);

// Records the capstone branch choice per (username, capstoneBranchId).
// At most one row per pair; reducer logic enforces uniqueness.
export const playerCapstoneChoice = table(
  {
    name: 'player_capstone_choice',
    indexes: [
      {
        accessor: 'player_capstone_choice_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    capstoneBranchId: t.string(),
    chosenSkillId: t.string(),
    chosenAt: t.timestamp(),
  }
);

// Non-stat class effects currently active for a player.
// PK = sourceKey following the {username}:class:{classId}:{skillId}:{effectKey}
// convention, mirroring player_stat_source exactly.
export const playerCapability = table(
  {
    name: 'player_capability',
    indexes: [
      {
        accessor: 'player_capability_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    sourceKey: t.string().primaryKey(),
    username: t.string(),
    effectKey: t.string(),
    amount: t.i32(),
  }
);
