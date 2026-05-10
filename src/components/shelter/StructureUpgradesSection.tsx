import { useState } from 'react';
import { Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import UpgradeButton from '../UpgradeButton';

interface Props {
  structureId: string;
}

function upgradeCostFor(costBase: bigint, growthPer100: number, level: number): bigint {
  let cost = costBase;
  const growth = BigInt(growthPer100);
  for (let i = 0; i < level; i++) {
    cost = (cost * growth) / 100n;
  }
  return cost;
}

// Per-structure upgrades list. Each row: name, level meter, description,
// cost label, and a small UpgradeButton on the right edge — designed for
// rapid repeat presses (refinery_capacity has 9 levels, workbench_efficiency
// has 20).
export default function StructureUpgradesSection({ structureId }: Props) {
  const [allUpgrades] = useTable(tables.structureUpgradeDefinition);
  const [playerUpgrades] = useTable(tables.myStructureUpgrades);
  const [playerStates] = useTable(tables.myPlayerState);
  const upgrade = useReducer(reducers.upgradeStructure);
  const [busyId, setBusyId] = useState<string | null>(null);

  const scrap = playerStates[0]?.scrap ?? 0n;
  const upgrades = [...allUpgrades]
    .filter((u) => u.structureId === structureId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (upgrades.length === 0) return null;

  return (
    <View className="gap-2 mt-2">
      <Text className="text-xs uppercase tracking-widest text-slate-500">Upgrades</Text>
      {upgrades.map((up) => {
        const level = playerUpgrades.find((p) => p.upgradeId === up.upgradeId)?.level ?? 0;
        const atMax = level >= up.maxLevel;
        const cost = atMax ? 0n : upgradeCostFor(up.costBase, up.costGrowthPer100, level);
        const canAfford = !atMax && scrap >= cost;
        const isBusy = busyId === up.upgradeId;
        const onPress = async () => {
          if (busyId || atMax || !canAfford) return;
          setBusyId(up.upgradeId);
          try {
            await upgrade({ upgradeId: up.upgradeId });
          } catch {
            /* ignore */
          } finally {
            setBusyId(null);
          }
        };
        return (
          <View
            key={up.upgradeId}
            className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3 flex-row items-center gap-3"
          >
            <View className="flex-1 gap-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-slate-100">{up.name}</Text>
                <Text className="text-[11px] text-slate-500">
                  Lv {level} / {up.maxLevel}
                </Text>
              </View>
              <Text className="text-xs text-slate-400">{up.description}</Text>
              <Text
                className={`text-[11px] mt-0.5 ${
                  atMax
                    ? 'text-slate-600'
                    : canAfford
                      ? 'text-emerald-300'
                      : 'text-rose-400'
                }`}
              >
                {atMax
                  ? 'Maxed out'
                  : `${level === 0 ? 'Unlock' : 'Next'}: ${cost.toString()} scrap`}
              </Text>
            </View>
            <UpgradeButton
              onPress={onPress}
              disabled={atMax || !canAfford}
              busy={isBusy}
              accessibilityLabel={`Upgrade ${up.name}`}
            />
          </View>
        );
      })}
    </View>
  );
}
