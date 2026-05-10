// Status computation shared between the floor plan, structure bar, and
// individual structure pages. All inputs are subscribed table rows so the
// computation re-runs on any underlying change.

export type StructureStatus = 'idle' | 'running' | 'outputReady' | 'needsAttention';

interface JobLike {
  username: string;
  completesAt: { microsSinceUnixEpoch: bigint };
  ripeWindowEndsAt?: { microsSinceUnixEpoch: bigint };
}

// Convert browser-local Date.now() (millis) to the same micros-since-epoch
// scale SpacetimeDB uses, so we can compare against job timestamps.
function nowMicros(): bigint {
  return BigInt(Date.now()) * 1000n;
}

// Simple jobs (refinery, smelter): running until completesAt; output-ready after.
export function jobsStatus(jobs: readonly JobLike[]): StructureStatus {
  if (jobs.length === 0) return 'idle';
  const now = nowMicros();
  let anyReady = false;
  let anyRunning = false;
  for (const j of jobs) {
    if (now >= j.completesAt.microsSinceUnixEpoch) {
      anyReady = true;
    } else {
      anyRunning = true;
    }
  }
  if (anyReady) return 'outputReady';
  if (anyRunning) return 'running';
  return 'idle';
}

// Garden has the extra Ripe window — needs-attention takes priority over
// output-ready, output-ready takes priority over running.
export function gardenJobsStatus(jobs: readonly JobLike[]): StructureStatus {
  if (jobs.length === 0) return 'idle';
  const now = nowMicros();
  let anyRipe = false;
  let anyStale = false;
  let anyRunning = false;
  for (const j of jobs) {
    const completesAt = j.completesAt.microsSinceUnixEpoch;
    const ripeEndsAt = j.ripeWindowEndsAt?.microsSinceUnixEpoch ?? completesAt;
    if (now < completesAt) {
      anyRunning = true;
    } else if (now <= ripeEndsAt) {
      anyRipe = true;
    } else {
      anyStale = true;
    }
  }
  if (anyRipe) return 'needsAttention';
  if (anyStale) return 'outputReady';
  if (anyRunning) return 'running';
  return 'idle';
}

// Workbench: idle if no slotted activity, running if there is one. The
// existing automation tick fires it on a timer; there's no "output ready"
// state because rewards are auto-credited.
export function workbenchStatus(slottedActivityId: string | null | undefined): StructureStatus {
  return slottedActivityId ? 'running' : 'idle';
}

interface RefineryStateLike {
  loadedScrap: bigint;
  readyParts: bigint;
  processingStartedAt?: { microsSinceUnixEpoch: bigint };
}

interface UpgradeDefLike {
  upgradeId: string;
  structureId: string;
  kind: string;
  yieldPerLevelPer100: number;
}

interface PlayerUpgradeLike {
  upgradeId: string;
  level: number;
}

const REFINERY_SCRAP_PER_PART = 10n;
const REFINERY_PART_DURATION_MICROS = 30_000_000n;

// Refinery: idle if no scrap loaded and no parts ready and not processing;
// outputReady when there are parts ready to claim (live-extrapolated from
// the snapshot to flip on without a server tick); running otherwise.
export function refineryStateStatus(
  state: RefineryStateLike | undefined,
  upgrades: readonly UpgradeDefLike[],
  playerUpgrades: readonly PlayerUpgradeLike[]
): StructureStatus {
  if (!state) return 'idle';

  // Compute live (extrapolated) ready parts and loaded scrap, mirroring
  // tickRefineryState on the server.
  const efficiencyBonus = upgrades.reduce((sum, up) => {
    if (up.structureId !== 'refinery' || up.kind !== 'efficiency') return sum;
    const lvl = playerUpgrades.find((p) => p.upgradeId === up.upgradeId)?.level ?? 0;
    return sum + lvl * up.yieldPerLevelPer100;
  }, 0);
  const yieldPerPart = BigInt(1 + Math.floor(efficiencyBonus / 100));

  let liveLoaded = state.loadedScrap;
  let liveReady = state.readyParts;
  let stillProcessing = false;
  if (state.processingStartedAt) {
    const startMicros = state.processingStartedAt.microsSinceUnixEpoch;
    const elapsed = nowMicros() - startMicros;
    const completedByTime = elapsed > 0n ? elapsed / REFINERY_PART_DURATION_MICROS : 0n;
    const completableFromScrap = liveLoaded / REFINERY_SCRAP_PER_PART;
    const completed =
      completedByTime < completableFromScrap ? completedByTime : completableFromScrap;
    liveLoaded -= completed * REFINERY_SCRAP_PER_PART;
    liveReady += completed * yieldPerPart;
    stillProcessing =
      liveLoaded >= REFINERY_SCRAP_PER_PART && completed === completedByTime;
  }

  if (liveReady > 0n) return 'outputReady';
  if (stillProcessing) return 'running';
  return 'idle';
}
