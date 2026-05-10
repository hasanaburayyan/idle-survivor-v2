import { table, t } from 'spacetimedb/server';

// One row per player. The refinery is a continuous-buffer machine:
//   - loadedScrap: scrap inside the buffer, capped by upgradable capacity.
//   - readyParts: completed parts waiting to be claimed.
//   - processingStartedAt: when the in-progress part started; null if idle.
//
// The DB stores state as of the last reducer call. Reducers tick the row
// forward (consume scrap and accrue ready parts based on elapsed time)
// before performing their action; the client extrapolates a live preview
// for display only.
export const refineryState = table(
  { name: 'refinery_state' },
  {
    username: t.string().primaryKey(),
    loadedScrap: t.u64(),
    readyParts: t.u64(),
    processingStartedAt: t.timestamp().optional(),
  }
);

export const smelterJob = table(
  {
    name: 'smelter_job',
    indexes: [
      {
        accessor: 'smelter_job_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    slotIndex: t.u8(),
    startedAt: t.timestamp(),
    completesAt: t.timestamp(),
  }
);

// Garden has an extra ripeWindowEndsAt: between completesAt and ripeWindowEndsAt
// the job pays the Ripe (3x) multiplier; after, the Stale (2x) multiplier.
// inputAmount is captured at start so the payout is deterministic w.r.t. the
// input even if game balance changes mid-job.
export const gardenJob = table(
  {
    name: 'garden_job',
    indexes: [
      {
        accessor: 'garden_job_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    slotIndex: t.u8(),
    inputAmount: t.u64(),
    startedAt: t.timestamp(),
    completesAt: t.timestamp(),
    ripeWindowEndsAt: t.timestamp(),
  }
);
