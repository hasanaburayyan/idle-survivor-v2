import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import SafePressable from '../SafePressable';
import StructureUpgradesSection from './StructureUpgradesSection';
import YieldBreakdown from './YieldBreakdown';
import { computeNonScrapYield } from './yieldMath';

const SCRAP_PER_PART = 10n;
const PART_DURATION_MICROS = 30_000_000n;
const PART_DURATION_SEC = 30;
const BASE_CAPACITY = 20n;

export default function RefineryPage() {
  const [refineryStates] = useTable(tables.myRefineryState);
  const [playerStates] = useTable(tables.myPlayerState);
  const [resources] = useTable(tables.myResources);
  const [upgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);
  const [playerSkills] = useTable(tables.mySkills);
  const load = useReducer(reducers.loadRefinery);
  const start = useReducer(reducers.startRefinery);
  const claim = useReducer(reducers.claimRefineryParts);
  const [busy, setBusy] = useState<string | null>(null);

  // Tick once per second so the simulated processing display stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  const scrap = playerStates[0]?.scrap ?? 0n;
  const partsBalance = resources.find((r) => r.resourceId === 'parts')?.amount ?? 0n;

  // Capacity = 20 + sum(level * yieldPerLevelPer100) over 'capacity' upgrades.
  const refineryUpgrades = upgrades.filter((u) => u.structureId === 'refinery');
  const capacity = refineryUpgrades.reduce((cap, up) => {
    if (up.kind !== 'capacity') return cap;
    const lvl = playerUpgrades.find((p) => p.upgradeId === up.upgradeId)?.level ?? 0;
    return cap + BigInt(lvl) * BigInt(up.yieldPerLevelPer100);
  }, BASE_CAPACITY);

  const yieldBreakdown = computeNonScrapYield(
    1n,
    'refinery',
    'parts',
    upgrades,
    playerUpgrades,
    playerSkills
  );
  const yieldPerPart = Number(yieldBreakdown.finalYield);

  // Simulate forward from the persisted snapshot: how much scrap remains and
  // how many parts are ready right now? Mirrors tickRefineryState on server.
  const dbState = refineryStates[0];
  const dbLoaded = dbState?.loadedScrap ?? 0n;
  const dbReady = dbState?.readyParts ?? 0n;
  const dbStartMicros = dbState?.processingStartedAt?.microsSinceUnixEpoch;
  const nowMicros = BigInt(Date.now()) * 1000n;

  let liveLoaded = dbLoaded;
  let liveReady = dbReady;
  let isProcessing = false;
  let secondsToNextPart: number | null = null;

  if (dbStartMicros !== undefined) {
    const elapsed = nowMicros - dbStartMicros;
    const completedByTime = elapsed > 0n ? elapsed / PART_DURATION_MICROS : 0n;
    const completableFromScrap = dbLoaded / SCRAP_PER_PART;
    const completed = completedByTime < completableFromScrap ? completedByTime : completableFromScrap;
    liveLoaded = dbLoaded - completed * SCRAP_PER_PART;
    liveReady = dbReady + completed * BigInt(yieldPerPart);
    const stillProcessing =
      liveLoaded >= SCRAP_PER_PART && completed === completedByTime;
    if (stillProcessing) {
      isProcessing = true;
      const nextPartStartMicros = dbStartMicros + completed * PART_DURATION_MICROS;
      const remainingMicros = nextPartStartMicros + PART_DURATION_MICROS - nowMicros;
      secondsToNextPart = Math.max(0, Math.ceil(Number(remainingMicros) / 1_000_000));
    }
  }

  const room = capacity > liveLoaded ? capacity - liveLoaded : 0n;
  const loadable = room < scrap ? room : scrap;
  const canLoad = loadable > 0n;
  const canStart = !isProcessing && liveLoaded >= SCRAP_PER_PART;
  const canClaim = liveReady > 0n;

  const onLoad = async () => {
    if (busy || !canLoad) return;
    setBusy('load');
    try {
      await load({ amount: loadable });
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const onStart = async () => {
    if (busy || !canStart) return;
    setBusy('start');
    try {
      await start();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const onClaim = async () => {
    if (busy || !canClaim) return;
    setBusy('claim');
    try {
      await claim();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const fillPercent = capacity > 0n ? Math.min(100, Number((liveLoaded * 100n) / capacity)) : 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View>
        <Text className="text-xs uppercase tracking-widest text-slate-500">Refinery</Text>
        <Text className="text-xs text-slate-400 mt-1">
          Load up to {capacity.toString()} scrap, then refine to convert {SCRAP_PER_PART.toString()}{' '}
          scrap → {yieldPerPart} part{yieldPerPart === 1 ? '' : 's'} every {PART_DURATION_SEC}s.
        </Text>
        <View className="flex-row gap-3 mt-2">
          <Text className="text-xs text-slate-400">⚙️ {scrap.toString()}</Text>
          <Text className="text-xs text-slate-400">🔩 {partsBalance.toString()}</Text>
        </View>
      </View>

      <YieldBreakdown
        resourceLabel={yieldBreakdown.finalYield === 1n ? 'Part' : 'Parts'}
        perEventLabel="per refinement"
        breakdown={yieldBreakdown}
      />


      {/* Buffer card */}
      <View
        className={`rounded-xl ${
          isProcessing ? 'bg-slate-900' : 'bg-slate-950'
        } border-2 ${
          isProcessing ? 'border-cyan-700' : 'border-slate-800'
        } px-4 py-3 gap-3`}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-[11px] uppercase tracking-widest text-slate-500">
            Scrap Buffer
          </Text>
          <Text className="text-xs text-slate-300">
            {liveLoaded.toString()} / {capacity.toString()}
          </Text>
        </View>

        {/* Capacity bar */}
        <View className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <View
            className={`h-full ${isProcessing ? 'bg-cyan-500' : 'bg-slate-600'}`}
            style={{ width: `${fillPercent}%` }}
          />
        </View>

        {isProcessing && secondsToNextPart !== null ? (
          <Text className="text-xs text-cyan-300">
            {secondsToNextPart === 0
              ? 'Finalizing part…'
              : `Refining… next part in ${formatSeconds(secondsToNextPart)}`}
          </Text>
        ) : liveLoaded >= SCRAP_PER_PART ? (
          <Text className="text-xs text-slate-400">
            Ready to refine. Press Refine to start processing.
          </Text>
        ) : liveLoaded > 0n ? (
          <Text className="text-xs text-slate-400">
            Need {(SCRAP_PER_PART - liveLoaded).toString()} more scrap loaded to refine.
          </Text>
        ) : (
          <Text className="text-xs text-slate-400">
            Buffer is empty. Load scrap to begin.
          </Text>
        )}

        <View className="flex-row gap-2">
          <SafePressable
            onPress={onLoad}
            disabled={!!busy || !canLoad}
            className={`flex-1 rounded-lg py-2 items-center ${
              !canLoad ? 'bg-slate-800' : 'bg-slate-700'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                !canLoad ? 'text-slate-500' : 'text-slate-100'
              }`}
            >
              {room === 0n
                ? 'Full'
                : scrap === 0n
                  ? 'No scrap'
                  : `Load · ${loadable.toString()} scrap`}
            </Text>
          </SafePressable>

          <SafePressable
            onPress={onStart}
            disabled={!!busy || !canStart}
            className={`flex-1 rounded-lg py-2 items-center ${
              !canStart ? 'bg-slate-800' : 'bg-emerald-500'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                !canStart ? 'text-slate-500' : 'text-slate-950'
              }`}
            >
              {isProcessing
                ? 'Refining…'
                : liveLoaded === 0n
                  ? 'Load scrap first'
                  : liveLoaded < SCRAP_PER_PART
                    ? `Need ${(SCRAP_PER_PART - liveLoaded).toString()} more`
                    : 'Refine'}
            </Text>
          </SafePressable>
        </View>
      </View>

      {/* Output card */}
      <View
        className={`rounded-xl ${
          canClaim ? 'bg-slate-900' : 'bg-slate-950'
        } border-2 ${canClaim ? 'border-emerald-600' : 'border-slate-800'} px-4 py-3 gap-2`}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-[11px] uppercase tracking-widest text-slate-500">
            Output
          </Text>
          {canClaim ? (
            <Text className="text-xs text-emerald-300">Ready</Text>
          ) : null}
        </View>
        <Text className="text-xs text-slate-300">
          {liveReady.toString()} part{liveReady === 1n ? '' : 's'} ready to claim
        </Text>
        <SafePressable
          onPress={onClaim}
          disabled={!!busy || !canClaim}
          className={`rounded-lg py-2 items-center ${
            !canClaim ? 'bg-slate-800' : 'bg-emerald-500'
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              !canClaim ? 'text-slate-500' : 'text-slate-950'
            }`}
          >
            {canClaim ? `Claim ${liveReady.toString()} part${liveReady === 1n ? '' : 's'}` : 'Nothing to claim'}
          </Text>
        </SafePressable>
      </View>

      <StructureUpgradesSection structureId="refinery" />
    </ScrollView>
  );
}

function formatSeconds(s: number): string {
  if (s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}m ${r}s`;
}
