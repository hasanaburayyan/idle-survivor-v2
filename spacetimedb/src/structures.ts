import { t, SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb from './schema';
import { refineryState, smelterJob, gardenJob } from './structures_tables';

// ---------- Resource helpers ----------
// Mirror the pattern in index.ts addResource/getResource. Inlined here to avoid
// importing from index.ts (which would create a circular import via schema.ts).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getResourceAmount(ctx: any, username: string, resourceId: string): bigint {
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
function addResourceAmount(ctx: any, username: string, resourceId: string, delta: bigint): void {
  if (delta === 0n) return;
  if (resourceId === 'scrap') {
    const ps = ctx.db.playerState.username.find(username);
    if (ps === null) return;
    let next = ps.scrap + delta;
    if (next < 0n) next = 0n;
    ctx.db.playerState.username.update({ ...ps, scrap: next, updatedAt: ctx.timestamp });
    return;
  }
  for (const row of ctx.db.playerResource.player_resource_username.filter(username)) {
    if (row.resourceId === resourceId) {
      let next = row.amount + delta;
      if (next < 0n) next = 0n;
      ctx.db.playerResource.id.update({ ...row, amount: next });
      return;
    }
  }
  if (delta > 0n) {
    ctx.db.playerResource.insert({ id: 0n, username, resourceId, amount: delta });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSenderUsername(ctx: any): string {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  return s.username;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPlayerStructure(ctx: any, username: string, structureId: string) {
  for (const row of ctx.db.playerStructure.player_structure_username.filter(username)) {
    if (row.structureId === structureId) return row;
  }
  return null;
}

// Slot count = 1 + sum of slot_count upgrade levels.
// Efficiency yield bonus = sum of (level * yieldPerLevelPer100) across all
// efficiency upgrades for the structure.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStructureSlots(ctx: any, username: string, structureId: string): number {
  let slots = 1;
  for (const up of ctx.db.structureUpgradeDefinition.structure_upgrade_definition_structure.filter(structureId)) {
    if (up.kind !== 'slot_count') continue;
    slots += upgradeLevel(ctx, username, up.upgradeId);
  }
  return slots;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEfficiencyBonusPercent(ctx: any, username: string, structureId: string): number {
  let bonus = 0;
  for (const up of ctx.db.structureUpgradeDefinition.structure_upgrade_definition_structure.filter(structureId)) {
    if (up.kind !== 'efficiency') continue;
    const lvl = upgradeLevel(ctx, username, up.upgradeId);
    bonus += lvl * up.yieldPerLevelPer100;
  }
  return bonus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeLevel(ctx: any, username: string, upgradeId: string): number {
  for (const row of ctx.db.playerStructureUpgrade.player_structure_upgrade_username.filter(username)) {
    if (row.upgradeId === upgradeId) return row.level;
  }
  return 0;
}

// Local copy of skillLevel — duplicated from index.ts to avoid a circular
// import (index.ts re-exports from this module).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function skillLevelLocal(ctx: any, username: string, skillId: string): number {
  for (const row of ctx.db.playerSkill.player_skill_username.filter(username)) {
    if (row.skillId === skillId) return row.level;
  }
  return 0;
}

// Apply non-scrap resource yield bonus from the Intermediate skill tree:
//   Minor (max 4) — flat +2 per level → 2/4/6/8
//   Major (max 4) — +75% per level on top of (base + flat)
// Use ONLY for non-scrap chains (parts/metal/fabric/food/medicine). Scrap is
// applied via computeScavengeGain in index.ts and uses a different (% both)
// formula.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyResourceYieldBonus(
  ctx: any,
  username: string,
  prefix: string,
  baseAmount: bigint
): bigint {
  if (baseAmount <= 0n) return baseAmount;
  const minor = skillLevelLocal(ctx, username, `${prefix}_minor_multiplier`);
  const major = skillLevelLocal(ctx, username, `${prefix}_major_multiplier`);
  const flat = BigInt(minor * 2);
  const pct = major * 75;
  const withFlat = baseAmount + flat;
  return withFlat + (withFlat * BigInt(pct)) / 100n;
}

// Find the lowest empty slot index (0..slotCount-1). Returns -1 if all full.
function findEmptySlot(occupied: number[], slotCount: number): number {
  const taken = new Set(occupied);
  for (let i = 0; i < slotCount; i++) {
    if (!taken.has(i)) return i;
  }
  return -1;
}

// ---------- Refinery: scrap -> parts (continuous buffer) ----------

const REFINERY_SCRAP_PER_PART = 10n;
const REFINERY_PART_DURATION_MICROS = 30_000_000n; // 30s per part
const REFINERY_BASE_CAPACITY = 20n;

// Capacity = base + sum(level * yieldPerLevelPer100) across 'capacity' upgrades.
// For 'capacity' kind upgrades, yieldPerLevelPer100 stores raw scrap units per
// level (NOT a percentage — distinct from 'efficiency' which uses %).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRefineryCapacity(ctx: any, username: string): bigint {
  let capacity = REFINERY_BASE_CAPACITY;
  for (const up of ctx.db.structureUpgradeDefinition.structure_upgrade_definition_structure.filter('refinery')) {
    if (up.kind !== 'capacity') continue;
    const lvl = upgradeLevel(ctx, username, up.upgradeId);
    capacity += BigInt(lvl) * BigInt(up.yieldPerLevelPer100);
  }
  return capacity;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOrCreateRefineryState(ctx: any, username: string) {
  const existing = ctx.db.refineryState.username.find(username);
  if (existing !== null) return existing;
  return ctx.db.refineryState.insert({
    username,
    loadedScrap: 0n,
    readyParts: 0n,
    processingStartedAt: undefined,
  });
}

// Fast-forward the row: consume scrap and accrue ready parts for any 30s
// part-completions since processingStartedAt. Stops when scrap runs out.
// Returns the updated state (already written to the DB if anything changed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tickRefineryState(ctx: any, username: string, state: any) {
  if (state.processingStartedAt === undefined) return state;
  const nowMicros: bigint = ctx.timestamp.microsSinceUnixEpoch;
  const startMicros: bigint = state.processingStartedAt.microsSinceUnixEpoch;
  if (nowMicros <= startMicros) return state;

  const elapsed = nowMicros - startMicros;
  const completedByTime = elapsed / REFINERY_PART_DURATION_MICROS;
  const completableFromScrap = state.loadedScrap / REFINERY_SCRAP_PER_PART;
  const completed =
    completedByTime < completableFromScrap ? completedByTime : completableFromScrap;

  if (completed === 0n) return state;

  // Yield per refinement = (1 base + structure efficiency upgrade)
  //   then minor flat (+2/lvl) + major % (+75%/lvl) from Parts skill chain.
  const efficiencyPercent = getEfficiencyBonusPercent(ctx, username, 'refinery');
  const baseYield = 1n + BigInt(Math.floor(efficiencyPercent / 100));
  const yieldPerPart = applyResourceYieldBonus(ctx, username, 'parts', baseYield);

  const newLoadedScrap = state.loadedScrap - completed * REFINERY_SCRAP_PER_PART;
  const newReadyParts = state.readyParts + completed * yieldPerPart;

  // Carry forward partial progress on the next part. If we couldn't finish
  // every part the timer would have allowed (scrap ran out), processing stops.
  let newProcessingStartedAt: Timestamp | undefined = undefined;
  if (newLoadedScrap >= REFINERY_SCRAP_PER_PART && completed === completedByTime) {
    newProcessingStartedAt = new Timestamp(
      startMicros + completed * REFINERY_PART_DURATION_MICROS
    );
  }

  const updated = {
    ...state,
    loadedScrap: newLoadedScrap,
    readyParts: newReadyParts,
    processingStartedAt: newProcessingStartedAt,
  };
  ctx.db.refineryState.username.update(updated);
  return updated;
}

export const loadRefinery = spacetimedb.reducer(
  { amount: t.u64() },
  (ctx, { amount }) => {
    const username = getSenderUsername(ctx);
    if (findPlayerStructure(ctx, username, 'refinery') === null) {
      throw new SenderError('Refinery not built');
    }
    if (amount === 0n) throw new SenderError('Amount must be greater than 0');
    let state = getOrCreateRefineryState(ctx, username);
    state = tickRefineryState(ctx, username, state);

    const capacity = getRefineryCapacity(ctx, username);
    const room = capacity > state.loadedScrap ? capacity - state.loadedScrap : 0n;
    if (room === 0n) throw new SenderError('Refinery is full');

    const scrapBalance = getResourceAmount(ctx, username, 'scrap');
    if (scrapBalance === 0n) throw new SenderError('Not enough scrap');

    let toLoad = amount;
    if (toLoad > room) toLoad = room;
    if (toLoad > scrapBalance) toLoad = scrapBalance;
    if (toLoad === 0n) throw new SenderError('Nothing to load');

    addResourceAmount(ctx, username, 'scrap', -toLoad);
    ctx.db.refineryState.username.update({
      ...state,
      loadedScrap: state.loadedScrap + toLoad,
    });
  }
);

export const startRefinery = spacetimedb.reducer((ctx) => {
  const username = getSenderUsername(ctx);
  if (findPlayerStructure(ctx, username, 'refinery') === null) {
    throw new SenderError('Refinery not built');
  }
  let state = getOrCreateRefineryState(ctx, username);
  state = tickRefineryState(ctx, username, state);
  if (state.processingStartedAt !== undefined) {
    throw new SenderError('Refinery is already running');
  }
  if (state.loadedScrap < REFINERY_SCRAP_PER_PART) {
    throw new SenderError('Need at least 10 scrap loaded to refine');
  }
  ctx.db.refineryState.username.update({
    ...state,
    processingStartedAt: ctx.timestamp,
  });
});

export const claimRefineryParts = spacetimedb.reducer((ctx) => {
  const username = getSenderUsername(ctx);
  if (findPlayerStructure(ctx, username, 'refinery') === null) {
    throw new SenderError('Refinery not built');
  }
  let state = getOrCreateRefineryState(ctx, username);
  state = tickRefineryState(ctx, username, state);
  if (state.readyParts === 0n) throw new SenderError('No parts ready to claim');
  addResourceAmount(ctx, username, 'parts', state.readyParts);
  ctx.db.refineryState.username.update({
    ...state,
    readyParts: 0n,
  });
});

// ---------- Smelter: scrap + parts -> metal ----------

const SMELTER_SCRAP_COST = 5n;
const SMELTER_PARTS_COST = 2n;
const SMELTER_BASE_DURATION_MICROS = 60_000_000n; // 60s

export const startSmelterJob = spacetimedb.reducer((ctx) => {
  const username = getSenderUsername(ctx);
  if (findPlayerStructure(ctx, username, 'smelter') === null) {
    throw new SenderError('Smelter not built');
  }
  const slotCount = getStructureSlots(ctx, username, 'smelter');
  const occupied = [...ctx.db.smelterJob.smelter_job_username.filter(username)].map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (j: any) => j.slotIndex
  );
  const slot = findEmptySlot(occupied, slotCount);
  if (slot < 0) throw new SenderError('All smelter slots are busy');

  if (getResourceAmount(ctx, username, 'scrap') < SMELTER_SCRAP_COST) {
    throw new SenderError('Not enough scrap');
  }
  if (getResourceAmount(ctx, username, 'parts') < SMELTER_PARTS_COST) {
    throw new SenderError('Not enough parts');
  }
  addResourceAmount(ctx, username, 'scrap', -SMELTER_SCRAP_COST);
  addResourceAmount(ctx, username, 'parts', -SMELTER_PARTS_COST);

  const completesAt = new Timestamp(
    ctx.timestamp.microsSinceUnixEpoch + SMELTER_BASE_DURATION_MICROS
  );
  ctx.db.smelterJob.insert({
    id: 0n,
    username,
    slotIndex: slot,
    startedAt: ctx.timestamp,
    completesAt,
  });
});

export const collectSmelterJob = spacetimedb.reducer(
  { jobId: t.u64() },
  (ctx, { jobId }) => {
    const username = getSenderUsername(ctx);
    const job = ctx.db.smelterJob.id.find(jobId);
    if (job === null) throw new SenderError('Job not found');
    if (job.username !== username) throw new SenderError('Not your job');
    if (ctx.timestamp.microsSinceUnixEpoch < job.completesAt.microsSinceUnixEpoch) {
      throw new SenderError('Job not yet complete');
    }
    const bonusPercent = getEfficiencyBonusPercent(ctx, username, 'smelter');
    const baseYield = 1n + BigInt(Math.floor(bonusPercent / 100));
    const yieldAmount = applyResourceYieldBonus(ctx, username, 'metal', baseYield);
    addResourceAmount(ctx, username, 'metal', yieldAmount);
    ctx.db.smelterJob.id.delete(jobId);
  }
);

// ---------- Garden: food -> more food (with Ripe/Stale window) ----------

const GARDEN_BASE_DURATION_MICROS = 60_000_000n; // 60s
const GARDEN_RIPE_WINDOW_MICROS = 30_000_000n;   // 30s after completion
const GARDEN_STALE_MULTIPLIER = 2n;
const GARDEN_RIPE_MULTIPLIER = 3n;

export const startGardenJob = spacetimedb.reducer(
  { inputAmount: t.u64() },
  (ctx, { inputAmount }) => {
    const username = getSenderUsername(ctx);
    if (findPlayerStructure(ctx, username, 'garden') === null) {
      throw new SenderError('Garden not built');
    }
    if (inputAmount === 0n) throw new SenderError('Input must be greater than 0');
    const slotCount = getStructureSlots(ctx, username, 'garden');
    const occupied = [...ctx.db.gardenJob.garden_job_username.filter(username)].map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (j: any) => j.slotIndex
    );
    const slot = findEmptySlot(occupied, slotCount);
    if (slot < 0) throw new SenderError('All garden slots are busy');

    if (getResourceAmount(ctx, username, 'food') < inputAmount) {
      throw new SenderError('Not enough food');
    }
    addResourceAmount(ctx, username, 'food', -inputAmount);

    const completesAtMicros = ctx.timestamp.microsSinceUnixEpoch + GARDEN_BASE_DURATION_MICROS;
    const ripeEndsMicros = completesAtMicros + GARDEN_RIPE_WINDOW_MICROS;
    ctx.db.gardenJob.insert({
      id: 0n,
      username,
      slotIndex: slot,
      inputAmount,
      startedAt: ctx.timestamp,
      completesAt: new Timestamp(completesAtMicros),
      ripeWindowEndsAt: new Timestamp(ripeEndsMicros),
    });
  }
);

export const collectGardenJob = spacetimedb.reducer(
  { jobId: t.u64() },
  (ctx, { jobId }) => {
    const username = getSenderUsername(ctx);
    const job = ctx.db.gardenJob.id.find(jobId);
    if (job === null) throw new SenderError('Job not found');
    if (job.username !== username) throw new SenderError('Not your job');
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (nowMicros < job.completesAt.microsSinceUnixEpoch) {
      throw new SenderError('Job not yet complete');
    }
    const isRipe = nowMicros <= job.ripeWindowEndsAt.microsSinceUnixEpoch;
    const baseMultiplier = isRipe ? GARDEN_RIPE_MULTIPLIER : GARDEN_STALE_MULTIPLIER;
    const bonusPercent = getEfficiencyBonusPercent(ctx, username, 'garden');
    const baseYield = job.inputAmount * baseMultiplier;
    const withEfficiency = baseYield + (baseYield * BigInt(bonusPercent)) / 100n;
    // Food skill chain (minor flat + major %) layered on top of the harvest.
    const finalYield = applyResourceYieldBonus(ctx, username, 'food', withEfficiency);
    addResourceAmount(ctx, username, 'food', finalYield);
    ctx.db.gardenJob.id.delete(jobId);
  }
);

// ---------- Workbench: instant Fabric craft ----------

const FABRIC_SCRAP_COST = 5n;
const FABRIC_PARTS_COST = 2n;
const FABRIC_METAL_COST = 1n;

export const craftFabric = spacetimedb.reducer(
  { batchSize: t.u8() },
  (ctx, { batchSize }) => {
    const username = getSenderUsername(ctx);
    if (batchSize === 0 || batchSize > 10) {
      throw new SenderError('Batch size must be 1-10');
    }
    if (findPlayerStructure(ctx, username, 'workbench') === null) {
      throw new SenderError('Workbench not built');
    }
    const batch = BigInt(batchSize);
    const scrapNeeded = FABRIC_SCRAP_COST * batch;
    const partsNeeded = FABRIC_PARTS_COST * batch;
    const metalNeeded = FABRIC_METAL_COST * batch;
    if (getResourceAmount(ctx, username, 'scrap') < scrapNeeded) {
      throw new SenderError('Not enough scrap');
    }
    if (getResourceAmount(ctx, username, 'parts') < partsNeeded) {
      throw new SenderError('Not enough parts');
    }
    if (getResourceAmount(ctx, username, 'metal') < metalNeeded) {
      throw new SenderError('Not enough metal');
    }
    addResourceAmount(ctx, username, 'scrap', -scrapNeeded);
    addResourceAmount(ctx, username, 'parts', -partsNeeded);
    addResourceAmount(ctx, username, 'metal', -metalNeeded);
    // Fabric skill chain (minor flat + major %) applied to the whole batch.
    const yieldAmount = applyResourceYieldBonus(ctx, username, 'fabric', batch);
    addResourceAmount(ctx, username, 'fabric', yieldAmount);
  }
);

// ---------- Views ----------

export const myRefineryState = spacetimedb.view(
  { name: 'my_refinery_state', public: true },
  t.array(refineryState.rowType),
  (ctx) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const row = ctx.db.refineryState.username.find(s.username);
    return row === null ? [] : [row];
  }
);

export const mySmelterJobs = spacetimedb.view(
  { name: 'my_smelter_jobs', public: true },
  t.array(smelterJob.rowType),
  (ctx) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.smelterJob.smelter_job_username.filter(s.username)];
  }
);

export const myGardenJobs = spacetimedb.view(
  { name: 'my_garden_jobs', public: true },
  t.array(gardenJob.rowType),
  (ctx) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.gardenJob.garden_job_username.filter(s.username)];
  }
);
