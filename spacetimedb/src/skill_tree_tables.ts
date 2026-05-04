import { table, t } from 'spacetimedb/server';

// ---------- Tagged unions ----------

export const UnlockCondition = t.enum('UnlockCondition', {
  always: t.unit(),
  treeCompleted: t.object('TreeCompletedUnlockPayload', {
    treeId: t.string(),
  }),
  manual: t.unit(),
  // APPENDED LAST — BSATN ordinals are positional (always=0, treeCompleted=1,
  // manual=2, skillsAtLevel=3). Never insert before existing variants.
  skillsAtLevel: t.object('SkillsAtLevelPayload', {
    requirements: t.array(
      t.object('SkillAtLevelReq', { skillId: t.string(), level: t.u32() })
    ),
  }),
});

export const CompletionRule = t.enum('CompletionRule', {
  allNodesMaxed: t.unit(),
  none: t.unit(),
});

// ---------- Skill tree definitions ----------

export const skillTreeDefinition = table(
  { name: 'skill_tree_definition', public: true },
  {
    treeId: t.string().primaryKey(),
    displayName: t.string(),
    description: t.string(),
    sortOrder: t.u32(),
    unlockCondition: UnlockCondition,
    completionRule: CompletionRule,
    pointPoolId: t.string(),
  }
);

export const skillPointPoolDefinition = table(
  { name: 'skill_point_pool_definition', public: true },
  {
    poolId: t.string().primaryKey(),
    displayName: t.string(),
    sortOrder: t.u32(),
  }
);

// ---------- Per-player point balances ----------
// Private — exposed via myPointBalances view.

export const playerSkillPointBalance = table(
  {
    name: 'player_skill_point_balance',
    indexes: [
      {
        accessor: 'player_skill_point_balance_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    poolId: t.string(),
    amount: t.u32(),
  }
);

// ---------- Stat grants ----------

export const skillStatGrant = table(
  {
    name: 'skill_stat_grant',
    public: true,
    indexes: [
      {
        accessor: 'skill_stat_grant_skill',
        algorithm: 'btree',
        columns: ['skillId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    skillId: t.string(),
    statId: t.string(),
    amountPerLevel: t.i32(),
  }
);
