import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from './schema';
import { insertNotification } from './notifications';
import { getStatTotals } from './stats';
import {
  actionDefinition,
  actionStatScaling,
  playerKnownAction,
  playerActionLoadout,
} from './action_tables';

// ---------- Constants ----------

export const LOADOUT_SLOT_COUNT = 6;
const VALID_SLOT_RANGE = LOADOUT_SLOT_COUNT - 1;

// ---------- Resolved-effect shape ----------
//
// The shared, pure-function output for any action resolution. Used by:
//   - myActionPreviews view (live myStatTotals as input)
//   - resolveAction reducer in The Defensive Battle (frozen snapshot stats)
//
// One implementation, two callers — eliminates the dual-implementation drift
// the devils advocate flagged as the most expensive failure mode.

interface ResolvedEffect {
  // Resolved range for damage / healAmount effects.
  resolvedMin: number;
  resolvedMax: number;
  // Resolved count for ward effects.
  resolvedCount: number;
  // The effect variant tag, echoed for the consumer's branching convenience.
  kind: 'damage' | 'healAmount' | 'healFull' | 'ward' | 'unknown';
}

const ResolvedEffectRow = t.object('ResolvedEffectRow', {
  actionId: t.string(),
  resolvedMin: t.i32(),
  resolvedMax: t.i32(),
  resolvedCount: t.i32(),
  kind: t.string(),
});

// Pure, deterministic. No DB access. Same inputs → same outputs.
// scalingRows: array of { statId, scalingKind: { tag, value? } }
// statTotals: Record<statId, integer>
// effect: { tag, value? }  (the action's effect variant)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeResolvedEffect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  effect: { tag: string; value?: any },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scalingRows: { statId: string; scalingKind: { tag: string; value?: any } }[],
  statTotals: Record<string, number>
): ResolvedEffect {
  let baseMin = 0;
  let baseMax = 0;
  let baseCount = 0;
  let kind: ResolvedEffect['kind'] = 'unknown';

  if (effect.tag === 'damage' || effect.tag === 'healAmount') {
    baseMin = effect.value?.baseMin ?? 0;
    baseMax = effect.value?.baseMax ?? 0;
    kind = effect.tag;
  } else if (effect.tag === 'ward') {
    baseCount = effect.value?.baseCount ?? 0;
    kind = 'ward';
  } else if (effect.tag === 'healFull') {
    kind = 'healFull';
  }

  let resolvedMin = baseMin;
  let resolvedMax = baseMax;
  let resolvedCount = baseCount;

  for (const row of scalingRows) {
    const stat = statTotals[row.statId] ?? 0;
    const sk = row.scalingKind;
    const perPoint = sk.value?.perPoint ?? 0;
    const delta = perPoint * stat;
    if (sk.tag === 'addToBoth') {
      // No-op for healFull / ward — variant doesn't carry magnitude.
      if (kind === 'damage' || kind === 'healAmount') {
        resolvedMin += delta;
        resolvedMax += delta;
      }
    } else if (sk.tag === 'addToMax') {
      if (kind === 'damage' || kind === 'healAmount') resolvedMax += delta;
    } else if (sk.tag === 'addToMin') {
      if (kind === 'damage' || kind === 'healAmount') resolvedMin += delta;
    } else if (sk.tag === 'addToCount') {
      if (kind === 'ward') resolvedCount += delta;
    }
  }

  // Floor invariants — a damage roll with a negative ceiling makes no sense.
  if (resolvedMin < 0) resolvedMin = 0;
  if (resolvedMax < resolvedMin) resolvedMax = resolvedMin;
  if (resolvedCount < 0) resolvedCount = 0;

  return { resolvedMin, resolvedMax, resolvedCount, kind };
}

// ---------- Source-management helpers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countGrantsFor(ctx: any, username: string, actionId: string): number {
  let count = 0;
  for (const row of ctx.db.playerKnownAction.player_known_action_username.filter(username)) {
    if (row.actionId === actionId) count += 1;
  }
  return count;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function grantKnownAction(ctx: any, sourceKey: string, username: string, actionId: string): void {
  if (ctx.db.playerKnownAction.sourceKey.find(sourceKey) !== null) return;
  ctx.db.playerKnownAction.insert({ sourceKey, username, actionId });
}

// Removes any loadout slot referencing the given action for the given user.
// Idempotent. Inserts a system notification when a slot is actually cleared so
// the silent-loadout-clear failure mode never bites a player.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function removeFromLoadoutIfPresent(ctx: any, username: string, actionId: string, reason?: string): void {
  let cleared = false;
  for (const row of ctx.db.playerActionLoadout.player_action_loadout_username.filter(username)) {
    if (row.actionId === actionId) {
      ctx.db.playerActionLoadout.id.delete(row.id);
      cleared = true;
    }
  }
  if (!cleared) return;
  const def = ctx.db.actionDefinition.actionId.find(actionId);
  const name = def?.displayName ?? actionId;
  const summary = reason
    ? `${name} was removed from your loadout (${reason}).`
    : `${name} was removed from your loadout — you no longer know this action.`;
  insertNotification(ctx, username, 'system', summary, undefined, `loadout_clear:${actionId}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function revokeKnownAction(ctx: any, sourceKey: string, reason?: string): void {
  const existing = ctx.db.playerKnownAction.sourceKey.find(sourceKey);
  if (existing === null) return;
  const { username, actionId } = existing;
  ctx.db.playerKnownAction.sourceKey.delete(sourceKey);
  if (countGrantsFor(ctx, username, actionId) === 0) {
    removeFromLoadoutIfPresent(ctx, username, actionId, reason);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function revokeKnownActionsByPrefix(ctx: any, username: string, prefix: string, reason?: string): void {
  if (!prefix.endsWith(':')) {
    throw new SenderError(`revokeKnownActionsByPrefix: prefix "${prefix}" must end with ':'`);
  }
  const colonIdx = prefix.indexOf(':');
  if (colonIdx === -1 || prefix.slice(0, colonIdx) !== username) {
    throw new SenderError(`revokeKnownActionsByPrefix: prefix "${prefix}" must start with "${username}:"`);
  }
  const affectedActions = new Set<string>();
  for (const row of ctx.db.playerKnownAction.player_known_action_username.filter(username)) {
    if (row.sourceKey.startsWith(prefix)) {
      affectedActions.add(row.actionId);
      ctx.db.playerKnownAction.sourceKey.delete(row.sourceKey);
    }
  }
  for (const actionId of affectedActions) {
    if (countGrantsFor(ctx, username, actionId) === 0) {
      removeFromLoadoutIfPresent(ctx, username, actionId, reason);
    }
  }
}

// ---------- Default-action initialization ----------

// All actions every player knows by default. Migration grants every entry
// here to existing players via initializeDefaultActionsAndLoadout. The set
// can grow over time without any other code changes.
const DEFAULT_ACTION_IDS = [
  'strike',
  'volley',
  'revive',
  'rally',
  'ward',
  'pierce',
  'barrage',
  'gamble',
] as const;

// The subset that auto-fills loadout slots 0..N on first creation. FROZEN.
// Adding new entries here would overwrite player customization on existing
// loadouts — the array index is the slot index. New defaults appear in the
// known-actions pool (above) but never auto-equip.
const AUTOFILL_ACTION_IDS = ['strike', 'volley', 'revive', 'rally', 'ward'] as const;

// Idempotent: safe to call on signup AND on the migration sweep for existing
// players. Uses sourceKey to dedupe grants; uses (username, slotIndex) lookup
// to dedupe loadout rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function initializeDefaultActionsAndLoadout(ctx: any, username: string): void {
  for (const actionId of DEFAULT_ACTION_IDS) {
    grantKnownAction(ctx, `${username}:default:${actionId}`, username, actionId);
  }
  // Auto-fill original 5 default slots only — new defaults are never
  // auto-equipped (would clobber player customization in slot 5+).
  AUTOFILL_ACTION_IDS.forEach((actionId, slotIndex) => {
    let alreadyOccupied = false;
    for (const row of ctx.db.playerActionLoadout.player_action_loadout_username.filter(username)) {
      if (row.slotIndex === slotIndex) {
        alreadyOccupied = true;
        break;
      }
    }
    if (alreadyOccupied) return;
    ctx.db.playerActionLoadout.insert({
      id: 0n,
      username,
      slotIndex,
      actionId,
    });
  });
}

// ---------- Server-side resolveAction (consumed by The Defensive Battle) ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveActionForBattle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  actionId: string,
  statTotals: Record<string, number>
): ResolvedEffect {
  const def = ctx.db.actionDefinition.actionId.find(actionId);
  if (def === null) throw new SenderError(`Unknown actionId: ${actionId}`);
  const scalingRows: { statId: string; scalingKind: { tag: string; value?: unknown } }[] = [];
  for (const row of ctx.db.actionStatScaling.action_stat_scaling_action.filter(actionId)) {
    scalingRows.push({ statId: row.statId, scalingKind: row.scalingKind });
  }
  return computeResolvedEffect(def.effect, scalingRows, statTotals);
}

// ---------- Views ----------

const KnownActionRow = t.object('KnownActionRow', {
  actionId: t.string(),
});

// Deduplicated by actionId — one row per unique known action regardless of
// how many sourceKeys grant it.
export const myKnownActions = spacetimedb.view(
  { name: 'my_known_actions', public: true },
  t.array(KnownActionRow),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const seen = new Set<string>();
    const out: { actionId: string }[] = [];
    for (const row of ctx.db.playerKnownAction.player_known_action_username.filter(s.username)) {
      if (seen.has(row.actionId)) continue;
      seen.add(row.actionId);
      out.push({ actionId: row.actionId });
    }
    return out;
  }
);

export const myActionLoadout = spacetimedb.view(
  { name: 'my_action_loadout', public: true },
  t.array(playerActionLoadout.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.playerActionLoadout.player_action_loadout_username.filter(s.username)];
  }
);

// Resolved effect previews for every action the calling player knows. Uses
// LIVE myStatTotals — out-of-battle planning. The Defensive Battle separately
// snapshots stats at battle-start; the in-battle preview is the snapshot.
export const myActionPreviews = spacetimedb.view(
  { name: 'my_action_previews', public: true },
  t.array(ResolvedEffectRow),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const totals = getStatTotals(ctx, s.username);
    const out: { actionId: string; resolvedMin: number; resolvedMax: number; resolvedCount: number; kind: string }[] = [];
    const seen = new Set<string>();
    for (const row of ctx.db.playerKnownAction.player_known_action_username.filter(s.username)) {
      if (seen.has(row.actionId)) continue;
      seen.add(row.actionId);
      const def = ctx.db.actionDefinition.actionId.find(row.actionId);
      if (def === null) continue;
      const scalingRows: { statId: string; scalingKind: { tag: string; value?: unknown } }[] = [];
      for (const sc of ctx.db.actionStatScaling.action_stat_scaling_action.filter(row.actionId)) {
        scalingRows.push({ statId: sc.statId, scalingKind: sc.scalingKind });
      }
      const resolved = computeResolvedEffect(def.effect, scalingRows, totals);
      out.push({
        actionId: row.actionId,
        resolvedMin: resolved.resolvedMin,
        resolvedMax: resolved.resolvedMax,
        resolvedCount: resolved.resolvedCount,
        kind: resolved.kind,
      });
    }
    return out;
  }
);

// ---------- Reducers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLoadoutSlot(ctx: any, username: string, slotIndex: number) {
  for (const row of ctx.db.playerActionLoadout.player_action_loadout_username.filter(username)) {
    if (row.slotIndex === slotIndex) return row;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLoadoutByAction(ctx: any, username: string, actionId: string) {
  for (const row of ctx.db.playerActionLoadout.player_action_loadout_username.filter(username)) {
    if (row.actionId === actionId) return row;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function knowsAction(ctx: any, username: string, actionId: string): boolean {
  return countGrantsFor(ctx, username, actionId) > 0;
}

export const setLoadoutSlot = spacetimedb.reducer(
  { slotIndex: t.u32(), actionId: t.string() },
  (ctx, { slotIndex, actionId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    if (slotIndex > VALID_SLOT_RANGE) {
      throw new SenderError(`Slot index out of range (0-${VALID_SLOT_RANGE})`);
    }
    if (ctx.db.actionDefinition.actionId.find(actionId) === null) {
      throw new SenderError('Unknown action');
    }
    if (!knowsAction(ctx, s.username, actionId)) {
      throw new SenderError('You do not know this action');
    }
    // Reject duplicates — the action can't be in another slot already.
    const dup = findLoadoutByAction(ctx, s.username, actionId);
    if (dup !== null && dup.slotIndex !== slotIndex) {
      throw new SenderError('Action is already equipped in another slot');
    }
    const existing = findLoadoutSlot(ctx, s.username, slotIndex);
    if (existing !== null) {
      ctx.db.playerActionLoadout.id.update({ ...existing, actionId });
    } else {
      ctx.db.playerActionLoadout.insert({
        id: 0n,
        username: s.username,
        slotIndex,
        actionId,
      });
    }
  }
);

export const clearLoadoutSlot = spacetimedb.reducer(
  { slotIndex: t.u32() },
  (ctx, { slotIndex }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const existing = findLoadoutSlot(ctx, s.username, slotIndex);
    if (existing !== null) {
      ctx.db.playerActionLoadout.id.delete(existing.id);
    }
  }
);

export const swapLoadoutSlots = spacetimedb.reducer(
  { slotA: t.u32(), slotB: t.u32() },
  (ctx, { slotA, slotB }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    if (slotA > VALID_SLOT_RANGE || slotB > VALID_SLOT_RANGE) {
      throw new SenderError(`Slot index out of range (0-${VALID_SLOT_RANGE})`);
    }
    if (slotA === slotB) return;
    const rowA = findLoadoutSlot(ctx, s.username, slotA);
    const rowB = findLoadoutSlot(ctx, s.username, slotB);
    // Both empty → no-op
    if (rowA === null && rowB === null) return;
    // Both filled → swap their actionIds (keep row identities stable)
    if (rowA !== null && rowB !== null) {
      const aId = rowA.actionId;
      const bId = rowB.actionId;
      ctx.db.playerActionLoadout.id.update({ ...rowA, actionId: bId });
      ctx.db.playerActionLoadout.id.update({ ...rowB, actionId: aId });
      return;
    }
    // One filled, one empty → move the filled row's actionId into the empty slot
    if (rowA !== null) {
      ctx.db.playerActionLoadout.insert({
        id: 0n,
        username: s.username,
        slotIndex: slotB,
        actionId: rowA.actionId,
      });
      ctx.db.playerActionLoadout.id.delete(rowA.id);
    } else if (rowB !== null) {
      ctx.db.playerActionLoadout.insert({
        id: 0n,
        username: s.username,
        slotIndex: slotA,
        actionId: rowB.actionId,
      });
      ctx.db.playerActionLoadout.id.delete(rowB.id);
    }
  }
);

// ---------- Seed ----------

interface ActionDefSeed {
  actionId: string;
  displayName: string;
  description: string;
  iconKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targeting: { tag: string; value?: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  effect: { tag: string; value?: any };
  sortOrder: number;
}

const ACTION_DEF_SEEDS: ActionDefSeed[] = [
  {
    actionId: 'strike',
    displayName: 'Strike',
    description: 'Deal damage to one enemy. Reliable, scales with Power.',
    iconKey: 'action_strike',
    targeting: { tag: 'singleEnemy' },
    effect: { tag: 'damage', value: { baseMin: 1, baseMax: 8 } },
    sortOrder: 0,
  },
  {
    actionId: 'volley',
    displayName: 'Volley',
    description: 'Deal damage to every enemy. Spreads thin, scales with Power.',
    iconKey: 'action_volley',
    targeting: { tag: 'allEnemies' },
    effect: { tag: 'damage', value: { baseMin: 1, baseMax: 4 } },
    sortOrder: 1,
  },
  {
    actionId: 'revive',
    displayName: 'Revive',
    description: 'Restore one ally to full HP. No scaling.',
    iconKey: 'action_revive',
    targeting: { tag: 'singleAlly' },
    effect: { tag: 'healFull' },
    sortOrder: 2,
  },
  {
    actionId: 'rally',
    displayName: 'Rally',
    description: 'Heal every ally. Scales with Power; ceiling rises with Focus.',
    iconKey: 'action_rally',
    targeting: { tag: 'allAllies' },
    effect: { tag: 'healAmount', value: { baseMin: 1, baseMax: 8 } },
    sortOrder: 3,
  },
  {
    actionId: 'ward',
    displayName: 'Ward',
    description: 'Grant the party a barrier that prevents the next instance of damage.',
    iconKey: 'action_ward',
    targeting: { tag: 'partyIncludingSelf' },
    effect: { tag: 'ward', value: { baseCount: 1 } },
    sortOrder: 4,
  },
  {
    actionId: 'pierce',
    displayName: 'Pierce',
    description: 'Deal damage to one enemy. Ignores armor — never blocked. Floor rises with Focus.',
    iconKey: 'action_pierce',
    targeting: { tag: 'singleEnemy' },
    effect: { tag: 'damage', value: { baseMin: 4, baseMax: 6 } },
    sortOrder: 5,
  },
  {
    actionId: 'barrage',
    displayName: 'Barrage',
    description: 'Deal damage to all enemies. Weak base, scales hard with Power — peaks high.',
    iconKey: 'action_barrage',
    targeting: { tag: 'allEnemies' },
    effect: { tag: 'damage', value: { baseMin: 1, baseMax: 2 } },
    sortOrder: 6,
  },
  {
    actionId: 'gamble',
    displayName: 'Gamble',
    description: 'Strike one enemy. Pure variance — Fortune scales the ceiling, the floor stays at one.',
    iconKey: 'action_gamble',
    targeting: { tag: 'singleEnemy' },
    effect: { tag: 'damage', value: { baseMin: 1, baseMax: 1 } },
    sortOrder: 7,
  },
];

interface ActionScalingSeed {
  actionId: string;
  statId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scalingKind: { tag: string; value?: any };
}

const ACTION_SCALING_SEEDS: ActionScalingSeed[] = [
  { actionId: 'strike', statId: 'power', scalingKind: { tag: 'addToBoth', value: { perPoint: 1 } } },
  { actionId: 'volley', statId: 'power', scalingKind: { tag: 'addToBoth', value: { perPoint: 1 } } },
  { actionId: 'rally', statId: 'power', scalingKind: { tag: 'addToBoth', value: { perPoint: 1 } } },
  { actionId: 'rally', statId: 'focus', scalingKind: { tag: 'addToMax', value: { perPoint: 1 } } },
  { actionId: 'pierce', statId: 'focus', scalingKind: { tag: 'addToMin', value: { perPoint: 1 } } },
  { actionId: 'barrage', statId: 'power', scalingKind: { tag: 'addToMax', value: { perPoint: 2 } } },
  { actionId: 'gamble', statId: 'fortune', scalingKind: { tag: 'addToMax', value: { perPoint: 3 } } },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seedActions(ctx: any): void {
  for (const def of ACTION_DEF_SEEDS) {
    const existing = ctx.db.actionDefinition.actionId.find(def.actionId);
    if (existing === null) {
      ctx.db.actionDefinition.insert(def);
    } else {
      // Keep existing rows in sync with the seed so description / number tweaks
      // applied via republish reach players without a clear-database wipe.
      ctx.db.actionDefinition.actionId.update({ ...existing, ...def });
    }
  }
  for (const scaling of ACTION_SCALING_SEEDS) {
    let exists = false;
    for (const row of ctx.db.actionStatScaling.action_stat_scaling_action.filter(scaling.actionId)) {
      if (row.statId === scaling.statId && row.scalingKind.tag === scaling.scalingKind.tag) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      ctx.db.actionStatScaling.insert({ id: 0n, ...scaling });
    }
  }
}

// Walks every existing playerState row and ensures defaults are set up.
// Called from init AFTER seedActions() so the action_definition rows exist.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateExistingPlayersToDefaults(ctx: any): void {
  for (const ps of ctx.db.playerState.iter()) {
    initializeDefaultActionsAndLoadout(ctx, ps.username);
  }
}
