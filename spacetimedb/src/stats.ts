import { t } from 'spacetimedb/server';
import spacetimedb from './schema';

// Re-export tables so callers only need to import from stats.ts
export { statDefinition, playerStatSource } from './stats_tables';

// ---------- Custom view row types ----------

const StatTotalRow = t.object('StatTotalRow', {
  statId: t.string(),
  total: t.i32(),
});

const StatBreakdownRow = t.object('StatBreakdownRow', {
  sourceKey: t.string(),
  statId: t.string(),
  amount: t.i32(),
});

// ---------- Views ----------

/**
 * Returns one row per stat for the calling player with the summed total.
 * Always returns a row for all defined stats (from stat_definition), defaulting absent stats to 0.
 * This means the Character panel always shows Vigor/Power/Focus/Fortune even with zero investment.
 *
 * Implementation: index lookup on player_stat_source by username — no full table scan.
 * The stat_definition scan is over 4 rows (static) and is acceptable.
 */
export const myStatTotals = spacetimedb.view(
  { name: 'my_stat_totals', public: true },
  t.array(StatTotalRow),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];

    // Aggregate amounts by statId using the username index
    const totals = new Map<string, number>();
    for (const row of ctx.db.playerStatSource.player_stat_source_username.filter(s.username)) {
      totals.set(row.statId, (totals.get(row.statId) ?? 0) + row.amount);
    }

    // Return a row for every defined stat so the UI always shows all four stats.
    // stat_definition is a small public table (4 rows) — iterating it is safe.
    const result: { statId: string; total: number }[] = [];
    for (const def of ctx.db.statDefinition.iter()) {
      result.push({ statId: def.statId, total: totals.get(def.statId) ?? 0 });
    }
    return result;
  }
);

/**
 * Returns every individual stat source row for the calling player.
 * Used by the Character panel's breakdown tooltip ("where did my Vigor come from?").
 *
 * Implementation: index lookup on player_stat_source by username — no full table scan.
 */
export const myStatBreakdown = spacetimedb.view(
  { name: 'my_stat_breakdown', public: true },
  t.array(StatBreakdownRow),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];

    const result: { sourceKey: string; statId: string; amount: number }[] = [];
    for (const row of ctx.db.playerStatSource.player_stat_source_username.filter(s.username)) {
      result.push({ sourceKey: row.sourceKey, statId: row.statId, amount: row.amount });
    }
    return result;
  }
);

// ---------- Server-Side Helpers ----------
// These are called from other reducers, not exposed as reducers themselves.
// They run inside the calling reducer's transaction — no atomicity concerns.

/**
 * Upserts a stat contribution row.
 * If a row with sourceKey already exists, updates the amount in-place.
 * If not, inserts a new row.
 *
 * The sourceKey is the idempotency key — calling setStatSource with the same
 * sourceKey twice is safe; the second call overwrites the first.
 *
 * IMPORTANT: sourceKey MUST start with the player's username followed by a colon, e.g.
 * `${username}:skill:power_minor:vigor`. Without the username segment, two players
 * investing in the same skill/equipment would generate identical sourceKeys and overwrite
 * each other (the PK is global). This helper validates that the supplied username matches
 * the leading segment of sourceKey.
 *
 * @param ctx       Reducer context from the calling reducer
 * @param sourceKey Deterministic string PK — e.g. "alice:skill:power_minor:vigor"
 * @param username  The player who owns this stat contribution; must match the leading segment of sourceKey
 * @param statId    Which stat this row contributes to — e.g. "vigor"
 * @param amount    Signed integer — positive for bonuses, negative for debuffs
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setStatSource(ctx: any, sourceKey: string, username: string, statId: string, amount: number): void {
  assertCallerIs(ctx, username);
  assertSourceKeyOwnedBy(sourceKey, username);
  const existing = ctx.db.playerStatSource.sourceKey.find(sourceKey);
  if (existing !== null) {
    if (existing.username !== username) {
      throw new Error(
        `setStatSource: sourceKey "${sourceKey}" already exists for a different username (existing="${existing.username}", supplied="${username}")`
      );
    }
    ctx.db.playerStatSource.sourceKey.update({ ...existing, amount });
  } else {
    ctx.db.playerStatSource.insert({ sourceKey, username, statId, amount });
  }
}

function assertSourceKeyOwnedBy(sourceKey: string, username: string): void {
  const colonIdx = sourceKey.indexOf(':');
  if (colonIdx === -1 || sourceKey.slice(0, colonIdx) !== username) {
    throw new Error(
      `Invalid sourceKey "${sourceKey}" — must start with "${username}:" per the {username}:{kind}:{refId}[:{statId}] convention`
    );
  }
}

// Defense in depth: helpers must only ever mutate the caller's own stat rows.
// Future callers may derive `username` from a user-supplied entity id (e.g. item
// instance lookup); a missed ownership check there must NOT translate into a
// cross-player stat write here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertCallerIs(ctx: any, username: string): void {
  const session = ctx.db.session.identity.find(ctx.sender);
  if (session === null || session.username !== username) {
    throw new Error(
      `Stat helper called with username="${username}" but caller's session resolves to "${session?.username ?? '<no session>'}" — refusing cross-player stat write`
    );
  }
}

/**
 * Removes a single stat source row by sourceKey.
 * No-op if the row does not exist.
 *
 * @param ctx       Reducer context
 * @param sourceKey The exact sourceKey to delete
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearStatSource(ctx: any, sourceKey: string): void {
  const colonIdx = sourceKey.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(
      `Invalid sourceKey "${sourceKey}" — must follow {username}:{kind}:{refId}[:{statId}]`
    );
  }
  assertCallerIs(ctx, sourceKey.slice(0, colonIdx));
  const existing = ctx.db.playerStatSource.sourceKey.find(sourceKey);
  if (existing !== null) {
    ctx.db.playerStatSource.sourceKey.delete(sourceKey);
  }
}

/**
 * Removes all stat source rows for a player whose sourceKey starts with the given prefix.
 *
 * DEVIATION FROM SPEC: The spec defined this as clearStatSourcesByPrefix(ctx, prefix).
 * We require `username` so we can use the btree index rather than a full table scan.
 * All callers know the affected player (item destroy, skill reset), so this is not a burden.
 *
 * Examples:
 *   clearStatSourcesByPrefix(ctx, username, 'equipment:item_inst_42:')
 *     → deletes all stat rows from that item instance
 *   clearStatSourcesByPrefix(ctx, username, 'skill:power_minor:')
 *     → deletes all stat rows granted by that skill node
 *
 * @param ctx      Reducer context
 * @param username The player whose sources to scan (enables btree index lookup)
 * @param prefix   The sourceKey prefix — all matching rows are deleted
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearStatSourcesByPrefix(ctx: any, username: string, prefix: string): void {
  assertCallerIs(ctx, username);
  // Prefix must end with ':' so we never match a longer numeric ID by accident
  // (e.g. "alice:equipment:item_inst_4" also matching item_inst_40).
  if (!prefix.endsWith(':')) {
    throw new Error(
      `clearStatSourcesByPrefix: prefix "${prefix}" must end with ':' to avoid substring collisions`
    );
  }
  // Prefix must include the username segment so it can only ever delete the caller's own rows.
  assertSourceKeyOwnedBy(prefix, username);
  for (const row of ctx.db.playerStatSource.player_stat_source_username.filter(username)) {
    if (row.sourceKey.startsWith(prefix)) {
      ctx.db.playerStatSource.sourceKey.delete(row.sourceKey);
    }
  }
}

/**
 * Returns a map of statId → total amount for a given player.
 * Called by minigame session-start reducers to snapshot current stat values
 * before computing minigame-specific derived values.
 *
 * Returns only stats that have at least one source row — callers should default
 * any stat they care about to 0 if it is absent from the returned map.
 *
 * @param ctx      Reducer context
 * @param username The player to compute totals for
 * @returns        Record<statId, total> — summed i32 totals per stat
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStatTotals(ctx: any, username: string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of ctx.db.playerStatSource.player_stat_source_username.filter(username)) {
    totals[row.statId] = (totals[row.statId] ?? 0) + row.amount;
  }
  return totals;
}

// ---------- Seed Data ----------

interface StatDefinitionSeed {
  statId: string;
  displayName: string;
  description: string;
  iconKey: string;
  sortOrder: number;
}

const STAT_DEFINITION_SEEDS: StatDefinitionSeed[] = [
  {
    statId: 'vigor',
    displayName: 'Vigor',
    description: 'Survivability — translates to HP, max charges, and damage resistance.',
    iconKey: 'stat_vigor',
    sortOrder: 1,
  },
  {
    statId: 'power',
    displayName: 'Power',
    description: 'Offensive output — scales damage, healing magnitude, and action effect strength.',
    iconKey: 'stat_power',
    sortOrder: 2,
  },
  {
    statId: 'focus',
    displayName: 'Focus',
    description: 'Control and precision — scales action quality, timing windows, and option-pool size.',
    iconKey: 'stat_focus',
    sortOrder: 3,
  },
  {
    statId: 'fortune',
    displayName: 'Fortune',
    description: 'Variance and rewards — scales loot rolls, crit chance, and bonus drops.',
    iconKey: 'stat_fortune',
    sortOrder: 4,
  },
];

/**
 * Seeds the stat_definition table with the four core stats.
 * Idempotent — checks existence before inserting to handle re-deployments.
 * Called from the spacetimedb.init() hook in index.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seedStatDefinitions(ctx: any): void {
  for (const seed of STAT_DEFINITION_SEEDS) {
    if (ctx.db.statDefinition.statId.find(seed.statId) === null) {
      ctx.db.statDefinition.insert(seed);
    }
  }
}

