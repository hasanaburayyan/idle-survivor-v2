import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';
import type { StructureDef, StructureRow } from './StructureCard';
import WorkbenchRecipesPanel from './shelter/WorkbenchRecipesPanel';

interface StructureUpgradeDef {
  upgradeId: string;
  structureId: string;
  name: string;
  description: string;
  kind: string;
  targetActivityId: string;
  maxLevel: number;
  costBase: bigint;
  costGrowthPer100: number;
  yieldPerLevelPer100: number;
  sortOrder: number;
}

function upgradeCostFor(
  costBase: bigint,
  growthPer100: number,
  level: number
): bigint {
  let cost = costBase;
  const growth = BigInt(growthPer100);
  for (let i = 0; i < level; i++) {
    cost = (cost * growth) / 100n;
  }
  return cost;
}

interface StructureDetailScreenProps {
  def: StructureDef;
  state: StructureRow;
  onBack: () => void;
}

export default function StructureDetailScreen({
  def,
  state,
  onBack,
}: StructureDetailScreenProps) {
  const [allUpgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);
  const [playerStates] = useTable(tables.myPlayerState);
  const [activityDefs] = useTable(tables.activityDefinition);
  const [capabilityTotals] = useTable(tables.myCapabilityTotals);

  const slot = useReducer(reducers.slotActivity);
  const clear = useReducer(reducers.clearSlot);

  const scrap = playerStates[0]?.scrap ?? 0n;
  const totalAutomationSlots =
    1 + (capabilityTotals.find(c => c.effectKey === 'automation_slot')?.total ?? 0);

  const upgrades = [...allUpgrades]
    .filter(u => u.structureId === def.structureId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const unlockedActivityIds = new Set<string>();
  for (const up of upgrades) {
    if (up.kind !== 'unlock_activity') continue;
    const lvl =
      playerUpgrades.find(p => p.upgradeId === up.upgradeId)?.level ?? 0;
    if (lvl >= 1) unlockedActivityIds.add(up.targetActivityId);
  }

  const efficiencyLevel = upgrades
    .filter(u => u.kind === 'efficiency')
    .map(u => playerUpgrades.find(p => p.upgradeId === u.upgradeId)?.level ?? 0)
    .reduce((s, l) => s + l, 0);
  const yieldBonus = upgrades
    .filter(u => u.kind === 'efficiency')
    .reduce((sum, u) => {
      const lvl =
        playerUpgrades.find(p => p.upgradeId === u.upgradeId)?.level ?? 0;
      return sum + lvl * u.yieldPerLevelPer100;
    }, 0);

  const slottedDef = state.slottedActivityId
    ? activityDefs.find(a => a.activityId === state.slottedActivityId)
    : undefined;

  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSlot = async (activityId: string) => {
    if (busy) return;
    setBusy(true);
    setPicking(false);
    try {
      await slot({ structureId: def.structureId, activityId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clear({ structureId: def.structureId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1">
      <View className="px-4 py-3 border-b border-slate-800 flex-row items-center gap-3">
        <SafePressable
          onPress={onBack}
          className="rounded-lg bg-slate-800 px-3 py-1.5"
        >
          <Text className="text-xs font-medium text-slate-100">‹ Shelter</Text>
        </SafePressable>
        <View className="flex-row items-center gap-2 flex-1">
          <Text className="text-2xl">{def.icon}</Text>
          <View className="flex-1">
            <Text className="text-base font-semibold text-slate-100">
              {def.name}
            </Text>
            {efficiencyLevel > 0 ? (
              <Text className="text-[11px] text-slate-500">
                Efficiency Lv {efficiencyLevel} · +{yieldBonus}%
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text className="text-xs text-slate-400">{def.description}</Text>

        {def.structureId === 'workbench' ? <WorkbenchRecipesPanel /> : null}

        <View className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3">
          <Text className="text-[11px] uppercase tracking-widest text-slate-500">
            Automation slot
            {totalAutomationSlots > 1 ? (
              <Text className="text-[11px] text-slate-600">
                {' '}· {totalAutomationSlots} total
              </Text>
            ) : null}
          </Text>
          {slottedDef ? (
            <View className="flex-row items-center justify-between mt-1">
              <View>
                <Text className="text-sm font-semibold text-slate-100">
                  {slottedDef.icon} {slottedDef.name}
                </Text>
                <Text className="text-[11px] text-slate-500">
                  Runs every 1s · {100 + yieldBonus}% yield
                </Text>
              </View>
              <SafePressable
                onPress={onClear}
                disabled={busy}
                className="rounded-lg bg-slate-800 px-3 py-1.5"
              >
                <Text className="text-xs font-medium text-slate-100">Clear</Text>
              </SafePressable>
            </View>
          ) : unlockedActivityIds.size === 0 ? (
            <Text className="text-xs text-slate-500 mt-1">
              No applicable activities yet. Purchase an unlock below.
            </Text>
          ) : picking ? (
            <View className="gap-2 mt-2">
              {[...unlockedActivityIds].map(actId => {
                const a = activityDefs.find(x => x.activityId === actId);
                if (!a) return null;
                return (
                  <SafePressable
                    key={actId}
                    onPress={() => onSlot(actId)}
                    disabled={busy}
                    className="rounded-lg bg-emerald-500 py-2 items-center"
                  >
                    <Text className="text-sm font-medium text-slate-950">
                      {a.icon} {a.name}
                    </Text>
                  </SafePressable>
                );
              })}
              <SafePressable
                onPress={() => setPicking(false)}
                className="rounded-lg bg-slate-800 py-2 items-center"
              >
                <Text className="text-sm font-medium text-slate-100">
                  Cancel
                </Text>
              </SafePressable>
            </View>
          ) : (
            <SafePressable
              onPress={() => setPicking(true)}
              className="rounded-lg bg-emerald-500 py-2 items-center mt-2"
            >
              <Text className="text-sm font-medium text-slate-950">
                Slot activity
              </Text>
            </SafePressable>
          )}
        </View>

        {(() => {
          const unlockUps = upgrades.filter(u => u.kind === 'unlock_activity');
          const otherUps = upgrades.filter(u => u.kind !== 'unlock_activity');
          const unlockedCount = unlockUps.filter(
            u =>
              (playerUpgrades.find(p => p.upgradeId === u.upgradeId)?.level ?? 0) >= 1
          ).length;
          return (
            <>
              {unlockUps.length > 0 ? (
                <>
                  <View className="flex-row items-baseline justify-between mt-2">
                    <Text className="text-xs uppercase tracking-widest text-slate-500">
                      Activities
                    </Text>
                    <Text className="text-[11px] text-slate-500">
                      {unlockedCount} / {unlockUps.length} unlocked
                    </Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {unlockUps.map(up => {
                      const level =
                        playerUpgrades.find(p => p.upgradeId === up.upgradeId)
                          ?.level ?? 0;
                      const activityDef = activityDefs.find(
                        a => a.activityId === up.targetActivityId
                      );
                      return (
                        <ActivityUnlockChip
                          key={up.upgradeId}
                          def={up}
                          level={level}
                          activityName={activityDef?.name ?? up.targetActivityId}
                          activityIcon={activityDef?.icon ?? '•'}
                          scrap={scrap}
                        />
                      );
                    })}
                  </View>
                </>
              ) : null}

              {otherUps.length > 0 ? (
                <>
                  <Text className="text-xs uppercase tracking-widest text-slate-500 mt-2">
                    Upgrades
                  </Text>
                  {otherUps.map(up => {
                    const level =
                      playerUpgrades.find(p => p.upgradeId === up.upgradeId)
                        ?.level ?? 0;
                    return (
                      <StructureUpgradeRow
                        key={up.upgradeId}
                        def={up}
                        level={level}
                        scrap={scrap}
                      />
                    );
                  })}
                </>
              ) : null}
            </>
          );
        })()}
      </ScrollView>
    </View>
  );
}

function StructureUpgradeRow({
  def,
  level,
  scrap,
}: {
  def: StructureUpgradeDef;
  level: number;
  scrap: bigint;
}) {
  const upgrade = useReducer(reducers.upgradeStructure);
  const [busy, setBusy] = useState(false);
  const atMax = level >= def.maxLevel;
  const cost = atMax
    ? 0n
    : upgradeCostFor(def.costBase, def.costGrowthPer100, level);
  const canAfford = !atMax && scrap >= cost;

  const onPress = async () => {
    if (busy || atMax || !canAfford) return;
    setBusy(true);
    try {
      await upgrade({ upgradeId: def.upgradeId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3 gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-slate-100">{def.name}</Text>
        <Text className="text-[11px] text-slate-500">
          Lv {level} / {def.maxLevel}
        </Text>
      </View>
      <Text className="text-xs text-slate-400">{def.description}</Text>
      <SafePressable
        onPress={onPress}
        disabled={busy || atMax || !canAfford}
        className={`rounded-lg py-2 items-center ${
          busy || atMax || !canAfford ? 'bg-slate-800' : 'bg-emerald-500'
        }`}
      >
        <Text
          className={`text-xs font-medium ${
            busy || atMax || !canAfford ? 'text-slate-500' : 'text-slate-950'
          }`}
        >
          {atMax
            ? 'Maxed out'
            : !canAfford
              ? `Need ${cost.toString()} scrap`
              : `${level === 0 ? 'Unlock' : 'Upgrade'} · ${cost.toString()} scrap`}
        </Text>
      </SafePressable>
    </View>
  );
}

interface ActivityUnlockChipProps {
  def: StructureUpgradeDef;
  level: number;
  activityName: string;
  activityIcon: string;
  scrap: bigint;
}

function ActivityUnlockChip({
  def,
  level,
  activityName,
  activityIcon,
  scrap,
}: ActivityUnlockChipProps) {
  const upgrade = useReducer(reducers.upgradeStructure);
  const [busy, setBusy] = useState(false);
  const isUnlocked = level >= 1;
  const cost = upgradeCostFor(def.costBase, def.costGrowthPer100, 0);
  const canAfford = !isUnlocked && scrap >= cost;

  const onPress = async () => {
    if (busy || isUnlocked || !canAfford) return;
    setBusy(true);
    try {
      await upgrade({ upgradeId: def.upgradeId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const containerClass = isUnlocked
    ? 'border border-emerald-700 bg-slate-900'
    : canAfford
      ? 'border border-emerald-500/40 bg-slate-900'
      : 'border border-slate-800 bg-slate-950';

  return (
    <SafePressable
      onPress={onPress}
      disabled={busy || isUnlocked || !canAfford}
      className={`rounded-xl px-3 py-2 min-w-[100px] ${containerClass}`}
      accessibilityLabel={
        isUnlocked
          ? `${activityName} unlocked`
          : `${activityName} costs ${cost.toString()} scrap`
      }
    >
      <View className="flex-row items-center gap-1.5">
        <Text className="text-base">{activityIcon}</Text>
        <Text
          className={`text-xs font-semibold ${
            isUnlocked ? 'text-slate-100' : 'text-slate-200'
          }`}
          numberOfLines={1}
        >
          {activityName}
        </Text>
        {isUnlocked ? (
          <Text className="text-[11px] text-emerald-400">✓</Text>
        ) : null}
      </View>
      {isUnlocked ? null : (
        <Text
          className={`text-[10px] mt-0.5 ${
            canAfford ? 'text-amber-400' : 'text-slate-500'
          }`}
        >
          {busy ? 'Unlocking…' : `${cost.toString()} scrap`}
        </Text>
      )}
    </SafePressable>
  );
}
