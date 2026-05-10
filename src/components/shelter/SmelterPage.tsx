import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import JobSlot, { type SlotPhase } from './JobSlot';
import StructureUpgradesSection from './StructureUpgradesSection';
import YieldBreakdown from './YieldBreakdown';
import { computeNonScrapYield } from './yieldMath';

const SCRAP_COST = 5n;
const PARTS_COST = 2n;
const DURATION_SEC = 60;

export default function SmelterPage() {
  const [jobs] = useTable(tables.mySmelterJobs);
  const [playerStates] = useTable(tables.myPlayerState);
  const [resources] = useTable(tables.myResources);
  const [upgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);
  const [playerSkills] = useTable(tables.mySkills);
  const start = useReducer(reducers.startSmelterJob);
  const collect = useReducer(reducers.collectSmelterJob);
  const [busy, setBusy] = useState<string | null>(null);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  const scrap = playerStates[0]?.scrap ?? 0n;
  const partsBalance = resources.find((r) => r.resourceId === 'parts')?.amount ?? 0n;
  const metalBalance = resources.find((r) => r.resourceId === 'metal')?.amount ?? 0n;

  const slotCount = 1;
  const yieldBreakdown = computeNonScrapYield(
    1n,
    'smelter',
    'metal',
    upgrades,
    playerUpgrades,
    playerSkills
  );
  const yieldPerJob = Number(yieldBreakdown.finalYield);

  const onStart = async () => {
    if (busy) return;
    setBusy('start');
    try {
      await start();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const onCollect = async (jobId: bigint) => {
    if (busy) return;
    setBusy(`collect-${jobId}`);
    try {
      await collect({ jobId });
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const nowMicros = BigInt(Date.now()) * 1000n;
  const jobBySlot = new Map<number, (typeof jobs)[number]>();
  for (const j of jobs) jobBySlot.set(j.slotIndex, j);

  const canStart = scrap >= SCRAP_COST && partsBalance >= PARTS_COST;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View>
        <Text className="text-xs uppercase tracking-widest text-slate-500">Smelter</Text>
        <Text className="text-xs text-slate-400 mt-1">
          Smelts {SCRAP_COST.toString()} scrap + {PARTS_COST.toString()} parts into {yieldPerJob} metal every {DURATION_SEC}s.
        </Text>
        <View className="flex-row gap-3 mt-2">
          <Text className={`text-xs ${scrap >= SCRAP_COST ? 'text-slate-400' : 'text-rose-400'}`}>
            ⚙️ {scrap.toString()}
          </Text>
          <Text className={`text-xs ${partsBalance >= PARTS_COST ? 'text-slate-400' : 'text-rose-400'}`}>
            🔩 {partsBalance.toString()}
          </Text>
          <Text className="text-xs text-slate-400">🪙 {metalBalance.toString()}</Text>
        </View>
      </View>

      <YieldBreakdown
        resourceLabel={yieldBreakdown.finalYield === 1n ? 'Metal' : 'Metal'}
        perEventLabel="per smelt"
        breakdown={yieldBreakdown}
      />

      {Array.from({ length: slotCount }, (_, i) => i).map((slotIndex) => {
        const job = jobBySlot.get(slotIndex);
        if (!job) {
          return (
            <JobSlot
              key={slotIndex}
              slotIndex={slotIndex}
              phase="empty"
              caption={
                canStart
                  ? `Spend ${SCRAP_COST.toString()} scrap + ${PARTS_COST.toString()} parts → ${yieldPerJob} metal in ${DURATION_SEC}s`
                  : scrap < SCRAP_COST
                    ? `Need ${SCRAP_COST.toString()} scrap`
                    : `Need ${PARTS_COST.toString()} parts`
              }
              actionLabel={canStart ? `Smelt · ${SCRAP_COST.toString()} ⚙️ + ${PARTS_COST.toString()} 🔩` : 'Need ingredients'}
              onAction={onStart}
              busy={busy === 'start'}
              disabled={!canStart}
            />
          );
        }
        const completesAt = job.completesAt.microsSinceUnixEpoch;
        const isReady = nowMicros >= completesAt;
        const phase: SlotPhase = isReady ? 'ready' : 'running';
        const secondsRemaining = Number((completesAt - nowMicros) / 1_000_000n);
        return (
          <JobSlot
            key={slotIndex}
            slotIndex={slotIndex}
            phase={phase}
            secondsRemaining={isReady ? undefined : secondsRemaining}
            caption={
              isReady
                ? `+${yieldPerJob} metal ready to collect`
                : `Smelting ${yieldPerJob} metal…`
            }
            actionLabel={isReady ? 'Collect' : 'Smelting…'}
            onAction={() => onCollect(job.id)}
            busy={busy === `collect-${job.id}`}
            disabled={!isReady}
          />
        );
      })}

      <StructureUpgradesSection structureId="smelter" />
    </ScrollView>
  );
}
