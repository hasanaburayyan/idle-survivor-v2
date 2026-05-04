import { table, t } from 'spacetimedb/server';

// ---------- Core Stats Tables ----------
// These tables are imported by schema.ts.
// Do NOT import from schema.ts here — that would create a circular dependency.
// Views, helpers, and seed data live in stats.ts which imports from schema.ts.

export const statDefinition = table(
  { name: 'stat_definition', public: true },
  {
    statId: t.string().primaryKey(),
    displayName: t.string(),
    description: t.string(),
    iconKey: t.string(),
    sortOrder: t.u32(),
  }
);

export const playerStatSource = table(
  {
    name: 'player_stat_source',
    indexes: [
      {
        accessor: 'player_stat_source_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    // Deterministic string PK — e.g. "alice:skill:power_minor:vigor" or "bob:equipment:item_inst_42:power"
    // Convention: {username}:{kind}:{refId}[:{statId}]
    // The leading {username} segment is mandatory so two players granting from the same
    // skill/structure/etc. don't collide on the global PK. Enforced by callers, not the schema.
    sourceKey: t.string().primaryKey(),
    username: t.string(),
    statId: t.string(),
    amount: t.i32(),
  }
);
