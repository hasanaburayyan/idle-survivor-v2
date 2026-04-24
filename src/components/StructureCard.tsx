import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';

export interface StructureDef {
  structureId: string;
  name: string;
  description: string;
  icon: string;
  locationKey: string;
  buildActivityId: string;
  sortOrder: number;
}

export interface StructureRow {
  id: bigint;
  username: string;
  structureId: string;
  slottedActivityId: string;
}

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

export default function StructureCard({
  def,
  state,
}: {
  def: StructureDef;
  state: StructureRow;
}) {
  const [allUpgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);
  const [playerStates] = useTable(tables.myPlayerState);
  const [activityDefs] = useTable(tables.activityDefinition);

  const slot = useReducer(reducers.slotActivity);
  const clear = useReducer(reducers.clearSlot);

  const scrap = playerStates[0]?.scrap ?? 0n;

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
  const [upgradesOpen, setUpgradesOpen] = useState(false);

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
    <View className="rounded-2xl bg-slate-900 border border-slate-800 px-4 py-4 gap-4">
      <View className="flex-row items-center gap-2">
        <Text className="text-lg">{def.icon}</Text>
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Structure · {def.name}
        </Text>
      </View>
      <Text className="text-xs text-slate-400">{def.description}</Text>

      <View className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3">
        <Text className="text-[11px] uppercase tracking-widest text-slate-500">
          Automation slot
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
            <Pressable
              onPress={onClear}
              disabled={busy}
              className="rounded-lg bg-slate-800 px-3 py-1.5"
            >
              <Text className="text-xs font-medium text-slate-100">Clear</Text>
            </Pressable>
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
                <Pressable
                  key={actId}
                  onPress={() => onSlot(actId)}
                  disabled={busy}
                  className="rounded-lg bg-emerald-500 py-2 items-center"
                >
                  <Text className="text-sm font-medium text-slate-950">
                    {a.icon} {a.name}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setPicking(false)}
              className="rounded-lg bg-slate-800 py-2 items-center"
            >
              <Text className="text-sm font-medium text-slate-100">Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setPicking(true)}
            className="rounded-lg bg-emerald-500 py-2 items-center mt-2"
          >
            <Text className="text-sm font-medium text-slate-950">
              Slot activity
            </Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => setUpgradesOpen(o => !o)}
          className="flex-row items-center gap-2"
        >
          <Text className="text-slate-500 text-xs">
            {upgradesOpen ? '▾' : '▸'}
          </Text>
          <Text className="text-xs uppercase tracking-widest text-slate-500">
            Upgrades ({upgrades.length})
          </Text>
        </Pressable>
        {efficiencyLevel > 0 ? (
          <Text className="text-[11px] text-slate-500">
            Efficiency Lv {efficiencyLevel} · +{yieldBonus}%
          </Text>
        ) : null}
      </View>

      {upgradesOpen
        ? upgrades.map(up => {
            const level =
              playerUpgrades.find(p => p.upgradeId === up.upgradeId)?.level ??
              0;
            return (
              <StructureUpgradeRow
                key={up.upgradeId}
                def={up}
                level={level}
                scrap={scrap}
              />
            );
          })
        : null}
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
      <Pressable
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
      </Pressable>
    </View>
  );
}
