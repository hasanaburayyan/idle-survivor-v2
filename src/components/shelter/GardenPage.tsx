import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import JobSlot, { type SlotPhase } from './JobSlot';
import StructureUpgradesSection from './StructureUpgradesSection';

const DEFAULT_INPUT = 5n;
const DURATION_SEC = 60;
const RIPE_WINDOW_SEC = 30;
const STALE_MULT = 2;
const RIPE_MULT = 3;

const INPUT_OPTIONS: bigint[] = [1n, 5n, 10n, 25n];

export default function GardenPage() {
  const [jobs] = useTable(tables.myGardenJobs);
  const [resources] = useTable(tables.myResources);
  const [upgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);
  const [playerSkills] = useTable(tables.mySkills);
  const start = useReducer(reducers.startGardenJob);
  const collect = useReducer(reducers.collectGardenJob);
  const [busy, setBusy] = useState<string | null>(null);
  const [inputAmount, setInputAmount] = useState<bigint>(DEFAULT_INPUT);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  const foodBalance = resources.find((r) => r.resourceId === 'food')?.amount ?? 0n;

  const slotCount = 1;
  const efficiencyBonus = upgrades
    .filter((u) => u.structureId === 'garden' && u.kind === 'efficiency')
    .reduce((sum, u) => {
      const lvl = playerUpgrades.find((p) => p.upgradeId === u.upgradeId)?.level ?? 0;
      return sum + lvl * u.yieldPerLevelPer100;
    }, 0);

  // Food skill chain — Minor flat (+2/lvl) + Major % (+75%/lvl) layered on top
  // of the Stale/Ripe multiplier × structure efficiency. Mirrors the server's
  // applyResourceYieldBonus call in collectGardenJob.
  const foodMinorLevel =
    playerSkills.find((s) => s.skillId === 'food_minor_multiplier')?.level ?? 0;
  const foodMajorLevel =
    playerSkills.find((s) => s.skillId === 'food_major_multiplier')?.level ?? 0;
  const foodFlat = BigInt(foodMinorLevel * 2);
  const foodMajorPct = foodMajorLevel * 75;

  const applyFoodChain = (amount: bigint): bigint => {
    const withFlat = amount + foodFlat;
    return withFlat + (withFlat * BigInt(foodMajorPct)) / 100n;
  };
  const ripePayout = (input: bigint): bigint => {
    const base = input * BigInt(RIPE_MULT);
    const withEfficiency = base + (base * BigInt(efficiencyBonus)) / 100n;
    return applyFoodChain(withEfficiency);
  };
  const stalePayout = (input: bigint): bigint => {
    const base = input * BigInt(STALE_MULT);
    const withEfficiency = base + (base * BigInt(efficiencyBonus)) / 100n;
    return applyFoodChain(withEfficiency);
  };

  const onStart = async () => {
    if (busy) return;
    if (foodBalance < inputAmount) return;
    setBusy('start');
    try {
      await start({ inputAmount });
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

  // "Collect All" — call collectGardenJob for every collectable slot.
  const collectableJobs = jobs.filter(
    (j) => nowMicros >= j.completesAt.microsSinceUnixEpoch,
  );
  const onCollectAll = async () => {
    if (busy) return;
    setBusy('collect-all');
    try {
      for (const j of collectableJobs) {
        await collect({ jobId: j.id });
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View>
        <Text className="text-xs uppercase tracking-widest text-slate-500">Garden</Text>
        <Text className="text-xs text-slate-400 mt-1">
          Multiplies stored food. Harvest within {RIPE_WINDOW_SEC}s of completion for the Ripe ({RIPE_MULT}x) bonus tier; later harvests yield Stale ({STALE_MULT}x). No spoilage.
        </Text>
        <Text className="text-xs text-slate-400 mt-2">🍖 {foodBalance.toString()}</Text>
      </View>

      {/* Input picker — pre-job slot picks how much food to plant. */}
      <View className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3">
        <Text className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
          Input per harvest
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {INPUT_OPTIONS.map((opt) => {
            const isActive = opt === inputAmount;
            const affordable = foodBalance >= opt;
            return (
              <SafePressable
                key={opt.toString()}
                onPress={() => setInputAmount(opt)}
                className={`rounded-lg px-3 py-1.5 border ${
                  isActive
                    ? 'bg-amber-500 border-amber-500'
                    : affordable
                      ? 'bg-slate-800 border-slate-700'
                      : 'bg-slate-950 border-slate-800'
                }`}
              >
                <Text
                  className={`text-xs font-medium ${
                    isActive ? 'text-slate-950' : affordable ? 'text-slate-200' : 'text-slate-500'
                  }`}
                >
                  {opt.toString()} 🍖
                </Text>
              </SafePressable>
            );
          })}
        </View>
        <Text className="text-[11px] text-slate-500 mt-2">
          Ripe yield: {ripePayout(inputAmount).toString()} 🍖 · Stale yield: {stalePayout(inputAmount).toString()} 🍖
        </Text>
        {(efficiencyBonus > 0 || foodFlat > 0n || foodMajorPct > 0) ? (
          <Text className="text-[11px] text-slate-600 mt-1">
            {[
              efficiencyBonus > 0 ? `Efficiency +${efficiencyBonus}%` : null,
              foodFlat > 0n ? `Food Minor +${foodFlat.toString()} flat` : null,
              foodMajorPct > 0 ? `Food Major +${foodMajorPct}%` : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>

      {collectableJobs.length > 1 ? (
        <SafePressable
          onPress={onCollectAll}
          disabled={busy !== null}
          className={`rounded-lg py-2 items-center ${busy ? 'bg-slate-800' : 'bg-emerald-600'}`}
        >
          <Text className={`text-sm font-medium ${busy ? 'text-slate-500' : 'text-slate-100'}`}>
            Harvest All ({collectableJobs.length})
          </Text>
        </SafePressable>
      ) : null}

      {Array.from({ length: slotCount }, (_, i) => i).map((slotIndex) => {
        const job = jobBySlot.get(slotIndex);
        if (!job) {
          const canStart = foodBalance >= inputAmount;
          return (
            <JobSlot
              key={slotIndex}
              slotIndex={slotIndex}
              phase="empty"
              caption={
                canStart
                  ? `Plant ${inputAmount.toString()} 🍖 — harvest in ${DURATION_SEC}s`
                  : `Need ${inputAmount.toString()} 🍖`
              }
              actionLabel={canStart ? `Plant · ${inputAmount.toString()} 🍖` : `Need ${inputAmount.toString()} 🍖`}
              onAction={onStart}
              busy={busy === 'start'}
              disabled={!canStart}
            />
          );
        }
        const completesAt = job.completesAt.microsSinceUnixEpoch;
        const ripeEndsAt = job.ripeWindowEndsAt.microsSinceUnixEpoch;
        const isComplete = nowMicros >= completesAt;
        const isRipe = isComplete && nowMicros <= ripeEndsAt;
        const isStale = isComplete && nowMicros > ripeEndsAt;
        const phase: SlotPhase = isRipe ? 'ripe' : isStale ? 'stale' : 'running';
        const secondsRemaining = isRipe
          ? Number((ripeEndsAt - nowMicros) / 1_000_000n)
          : isComplete
            ? undefined
            : Number((completesAt - nowMicros) / 1_000_000n);
        const caption = isRipe
          ? `${ripePayout(job.inputAmount).toString()} 🍖 — Ripe! Harvest now for the bonus.`
          : isStale
            ? `${stalePayout(job.inputAmount).toString()} 🍖 — still good, but past the bonus window.`
            : `Growing ${job.inputAmount.toString()} 🍖 → up to ${ripePayout(job.inputAmount).toString()} 🍖`;
        const actionLabel = isRipe
          ? 'Harvest!'
          : isStale
            ? 'Harvest (Stale)'
            : 'Growing…';
        return (
          <JobSlot
            key={slotIndex}
            slotIndex={slotIndex}
            phase={phase}
            secondsRemaining={secondsRemaining}
            caption={caption}
            actionLabel={actionLabel}
            onAction={() => onCollect(job.id)}
            busy={busy === `collect-${job.id}`}
            disabled={!isComplete}
          />
        );
      })}

      <StructureUpgradesSection structureId="garden" />
    </ScrollView>
  );
}
