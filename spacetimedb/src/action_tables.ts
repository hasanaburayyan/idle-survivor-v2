import { table, t } from 'spacetimedb/server';

// ---------- Tagged unions ----------

export const ActionTargeting = t.enum('ActionTargeting', {
  singleEnemy: t.unit(),
  allEnemies: t.unit(),
  singleAlly: t.unit(),
  allAllies: t.unit(),
  partyIncludingSelf: t.unit(),
});

export const ActionEffect = t.enum('ActionEffect', {
  damage: t.object('ActionEffectDamage', {
    baseMin: t.i32(),
    baseMax: t.i32(),
  }),
  healAmount: t.object('ActionEffectHealAmount', {
    baseMin: t.i32(),
    baseMax: t.i32(),
  }),
  healFull: t.unit(),
  ward: t.object('ActionEffectWard', {
    baseCount: t.u32(),
  }),
});

export const ActionScalingKind = t.enum('ActionScalingKind', {
  addToBoth: t.object('ActionScalingAddToBoth', { perPoint: t.i32() }),
  addToMax: t.object('ActionScalingAddToMax', { perPoint: t.i32() }),
  addToMin: t.object('ActionScalingAddToMin', { perPoint: t.i32() }),
  addToCount: t.object('ActionScalingAddToCount', { perPoint: t.i32() }),
});

// ---------- Action catalog (static seed) ----------

export const actionDefinition = table(
  { name: 'action_definition', public: true },
  {
    actionId: t.string().primaryKey(),
    displayName: t.string(),
    description: t.string(),
    iconKey: t.string(),
    targeting: ActionTargeting,
    effect: ActionEffect,
    sortOrder: t.u32(),
  }
);

export const actionStatScaling = table(
  {
    name: 'action_stat_scaling',
    public: true,
    indexes: [
      {
        accessor: 'action_stat_scaling_action',
        algorithm: 'btree',
        columns: ['actionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    actionId: t.string(),
    statId: t.string(),
    scalingKind: ActionScalingKind,
  }
);

// ---------- Per-player known actions (multi-grant) ----------
// Private — exposed via myKnownActions view (deduplicated by actionId).

export const playerKnownAction = table(
  {
    name: 'player_known_action',
    indexes: [
      {
        accessor: 'player_known_action_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    sourceKey: t.string().primaryKey(),
    username: t.string(),
    actionId: t.string(),
  }
);

// ---------- Per-player loadout ----------
// Private — exposed via myActionLoadout view.

export const playerActionLoadout = table(
  {
    name: 'player_action_loadout',
    indexes: [
      {
        accessor: 'player_action_loadout_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    slotIndex: t.u32(),
    actionId: t.string(),
  }
);
