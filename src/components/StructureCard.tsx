import { Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { tables } from '../module_bindings';
import { useTable } from 'spacetimedb/react';

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
  onSelect,
}: {
  def: StructureDef;
  state: StructureRow;
  onSelect: () => void;
}) {
  const [allUpgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);
  const [playerStates] = useTable(tables.myPlayerState);
  const [activityDefs] = useTable(tables.activityDefinition);

  const scrap = playerStates[0]?.scrap ?? 0n;

  const upgrades = allUpgrades.filter(u => u.structureId === def.structureId);

  const efficiencyLevel = upgrades
    .filter(u => u.kind === 'efficiency')
    .map(u => playerUpgrades.find(p => p.upgradeId === u.upgradeId)?.level ?? 0)
    .reduce((s, l) => s + l, 0);

  const hasAffordableUpgrade = upgrades.some(up => {
    const level =
      playerUpgrades.find(p => p.upgradeId === up.upgradeId)?.level ?? 0;
    if (level >= up.maxLevel) return false;
    const cost = upgradeCostFor(up.costBase, up.costGrowthPer100, level);
    return scrap >= cost;
  });

  const slottedDef = state.slottedActivityId
    ? activityDefs.find(a => a.activityId === state.slottedActivityId)
    : undefined;

  const automationLine = slottedDef
    ? `${slottedDef.icon} ${slottedDef.name}`
    : 'Automation: Empty';

  return (
    <SafePressable
      onPress={onSelect}
      className="rounded-2xl bg-slate-900 border border-slate-800 px-4 py-3"
    >
      <View className="flex-row items-center gap-3">
        <Text className="text-2xl">{def.icon}</Text>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm font-semibold text-slate-100">
              {def.name}
            </Text>
            {efficiencyLevel > 0 ? (
              <Text className="text-[10px] uppercase tracking-widest text-slate-500">
                Lv {efficiencyLevel}
              </Text>
            ) : null}
            {hasAffordableUpgrade ? (
              <View
                className="w-2 h-2 rounded-full bg-emerald-400"
                accessibilityLabel="Upgrade available"
              />
            ) : null}
          </View>
          <Text className="text-[11px] text-slate-500" numberOfLines={1}>
            {automationLine}
          </Text>
        </View>
        <Text className="text-slate-500 text-lg">›</Text>
      </View>
    </SafePressable>
  );
}
