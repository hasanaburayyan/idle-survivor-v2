import { useEffect, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../../module_bindings';
import {
  type StructureStatus,
  gardenJobsStatus,
  jobsStatus,
  refineryStateStatus,
  workbenchStatus,
} from './structureStatus';

// Single source of truth for "what is each of my structures' current status".
// Re-computes whenever the underlying tables update, plus on a 1s timer so
// time-driven transitions (Running → Ready, Ripe → Stale) actually surface
// without requiring a row to change.
//
// Returns a Record<structureId, StructureStatus>. Missing structures are
// omitted — callers default to 'idle' on lookup miss.
export function useStructureStatuses(): Record<string, StructureStatus> {
  const [structures] = useTable(tables.myStructures);
  const [refineryStates] = useTable(tables.myRefineryState);
  const [smelterJobs] = useTable(tables.mySmelterJobs);
  const [gardenJobs] = useTable(tables.myGardenJobs);
  const [upgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);

  // Tick once per second so progress-only transitions update the UI even
  // when no rows are inserted/deleted. Using a counter triggers re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  const result: Record<string, StructureStatus> = {};
  for (const s of structures) {
    if (s.structureId === 'refinery') {
      result[s.structureId] = refineryStateStatus(refineryStates[0], upgrades, playerUpgrades);
    } else if (s.structureId === 'smelter') {
      result[s.structureId] = jobsStatus(smelterJobs);
    } else if (s.structureId === 'garden') {
      result[s.structureId] = gardenJobsStatus(gardenJobs);
    } else if (s.structureId === 'workbench') {
      result[s.structureId] = workbenchStatus(s.slottedActivityId);
    } else {
      result[s.structureId] = 'idle';
    }
  }
  return result;
}
