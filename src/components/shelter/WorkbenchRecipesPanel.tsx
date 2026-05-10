import { useState } from 'react';
import { Text, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';

const FABRIC_SCRAP_COST = 5n;
const FABRIC_PARTS_COST = 2n;
const FABRIC_METAL_COST = 1n;

// Right-hand region of the Workbench page (alongside the existing Automation
// Slot region). Lists instant-craft recipes the workbench knows how to make.
// First recipe: Fabric. Future recipes extend this list.
export default function WorkbenchRecipesPanel() {
  const [playerStates] = useTable(tables.myPlayerState);
  const [resources] = useTable(tables.myResources);
  const [playerSkills] = useTable(tables.mySkills);
  const craft = useReducer(reducers.craftFabric);
  const [busy, setBusy] = useState<number | null>(null);

  const scrap = playerStates[0]?.scrap ?? 0n;
  const parts = resources.find((r) => r.resourceId === 'parts')?.amount ?? 0n;
  const metal = resources.find((r) => r.resourceId === 'metal')?.amount ?? 0n;
  const fabric = resources.find((r) => r.resourceId === 'fabric')?.amount ?? 0n;

  // Fabric skill chain. Workbench has no per-structure efficiency upgrade for
  // fabric (the existing workbench_efficiency targets the slotted activity);
  // skill chain is the only multiplier on the batch.
  const fabricMinor =
    playerSkills.find((s) => s.skillId === 'fabric_minor_multiplier')?.level ?? 0;
  const fabricMajor =
    playerSkills.find((s) => s.skillId === 'fabric_major_multiplier')?.level ?? 0;
  const fabricFlat = BigInt(fabricMinor * 2);
  const fabricMajorPct = fabricMajor * 75;
  const fabricYield = (batch: bigint): bigint => {
    const withFlat = batch + fabricFlat;
    return withFlat + (withFlat * BigInt(fabricMajorPct)) / 100n;
  };
  const yieldOne = fabricYield(1n);
  const yieldTen = fabricYield(10n);

  const onCraft = async (batchSize: number) => {
    if (busy) return;
    setBusy(batchSize);
    try {
      await craft({ batchSize });
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const canAffordOne =
    scrap >= FABRIC_SCRAP_COST && parts >= FABRIC_PARTS_COST && metal >= FABRIC_METAL_COST;
  const canAffordTen =
    scrap >= FABRIC_SCRAP_COST * 10n &&
    parts >= FABRIC_PARTS_COST * 10n &&
    metal >= FABRIC_METAL_COST * 10n;

  return (
    <View className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3 gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-[11px] uppercase tracking-widest text-slate-500">Recipes</Text>
        <Text className="text-[11px] text-slate-600">Instant craft</Text>
      </View>

      {/* Fabric recipe card */}
      <View className="rounded-lg bg-slate-900 border border-slate-800 p-3 gap-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text className="text-2xl">🧵</Text>
            <View>
              <Text className="text-sm font-semibold text-slate-100">Fabric</Text>
              <Text className="text-[11px] text-slate-500">Owned: {fabric.toString()}</Text>
            </View>
          </View>
        </View>

        <View className="flex-row gap-3">
          <Text className={`text-xs ${scrap >= FABRIC_SCRAP_COST ? 'text-slate-300' : 'text-rose-400'}`}>
            ⚙️ {FABRIC_SCRAP_COST.toString()}
          </Text>
          <Text className={`text-xs ${parts >= FABRIC_PARTS_COST ? 'text-slate-300' : 'text-rose-400'}`}>
            🔩 {FABRIC_PARTS_COST.toString()}
          </Text>
          <Text className={`text-xs ${metal >= FABRIC_METAL_COST ? 'text-slate-300' : 'text-rose-400'}`}>
            🪙 {FABRIC_METAL_COST.toString()}
          </Text>
          <Text className="text-xs text-emerald-400">→ {yieldOne.toString()} 🧵</Text>
        </View>
        {(fabricFlat > 0n || fabricMajorPct > 0) ? (
          <Text className="text-[11px] text-slate-600">
            {[
              fabricFlat > 0n ? `Minor +${fabricFlat.toString()} flat` : null,
              fabricMajorPct > 0 ? `Major +${fabricMajorPct}%` : null,
            ].filter(Boolean).join(' · ')}
            {' · '}x10 → {yieldTen.toString()} 🧵
          </Text>
        ) : null}

        <View className="flex-row gap-2">
          <SafePressable
            onPress={() => onCraft(1)}
            disabled={busy !== null || !canAffordOne}
            className={`flex-1 rounded-lg py-2 items-center ${
              busy === 1 || !canAffordOne ? 'bg-slate-800' : 'bg-emerald-500'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                busy === 1 || !canAffordOne ? 'text-slate-500' : 'text-slate-950'
              }`}
            >
              Craft
            </Text>
          </SafePressable>
          <SafePressable
            onPress={() => onCraft(10)}
            disabled={busy !== null || !canAffordTen}
            className={`flex-1 rounded-lg py-2 items-center ${
              busy === 10 || !canAffordTen ? 'bg-slate-800' : 'bg-emerald-500'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                busy === 10 || !canAffordTen ? 'text-slate-500' : 'text-slate-950'
              }`}
            >
              Craft x10
            </Text>
          </SafePressable>
        </View>
      </View>
    </View>
  );
}
