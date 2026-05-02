import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';
import LoadoutPanel from './LoadoutPanel';

type ArmoryTab = 'craft' | 'loadout';

const MAX_ARMORY_LEVEL = 10;

interface ArmoryScreenProps {
  onBack: () => void;
}

export default function ArmoryScreen({ onBack }: ArmoryScreenProps) {
  const [armoryStates] = useTable(tables.myArmoryState);
  const [recipes] = useTable(tables.myAvailableRecipes);
  const [recipeCosts] = useTable(tables.craftingRecipeCost);
  const [discountedUpgradeCosts] = useTable(tables.myArmoryUpgradeCost);
  const [resources] = useTable(tables.myResources);
  const [playerStates] = useTable(tables.myPlayerState);
  const [items] = useTable(tables.myItemInstances);
  const [itemAffixes] = useTable(tables.myItemInstanceAffixes);
  const [itemDefs] = useTable(tables.itemDefinition);
  const [equipment] = useTable(tables.myEquipment);
  const [statDefs] = useTable(tables.statDefinition);
  const [slots] = useTable(tables.myVisibleEquipmentSlots);

  const upgradeArmory = useReducer(reducers.upgradeArmory);
  const craftItem = useReducer(reducers.craftItem);
  const equipItem = useReducer(reducers.equipItem);
  const unequipItem = useReducer(reducers.unequipItem);

  const armory = armoryStates[0];
  const level = armory?.level ?? 1;
  const atMax = level >= MAX_ARMORY_LEVEL;

  const scrap = playerStates[0]?.scrap ?? 0n;
  const resourceMap = useMemo(() => {
    const m = new Map<string, bigint>();
    m.set('scrap', scrap);
    for (const r of resources) m.set(r.resourceId, r.amount);
    return m;
  }, [resources, scrap]);

  const statNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of statDefs) m.set(d.statId, d.displayName);
    return m;
  }, [statDefs]);

  const itemDefById = useMemo(() => {
    const m = new Map<string, (typeof itemDefs)[number]>();
    for (const d of itemDefs) m.set(d.itemDefId, d);
    return m;
  }, [itemDefs]);

  const slotById = useMemo(() => {
    const m = new Map<string, (typeof slots)[number]>();
    for (const s of slots) m.set(s.slotId, s);
    return m;
  }, [slots]);

  const equippedInstanceIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of equipment) s.add(e.itemInstanceId.toString());
    return s;
  }, [equipment]);

  type ItemAffix = (typeof itemAffixes)[number];
  const affixesByInstance = useMemo(() => {
    const m = new Map<string, ItemAffix[]>();
    for (const a of itemAffixes) {
      const k = a.instanceId.toString();
      const list = m.get(k) ?? [];
      list.push(a);
      m.set(k, list);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemAffixes]);

  const nextLevelCosts = useMemo(() => {
    if (atMax) return [];
    return discountedUpgradeCosts.filter(c => c.targetLevel === level + 1);
  }, [discountedUpgradeCosts, level, atMax]);

  const canAffordUpgrade = useMemo(() => {
    if (atMax || nextLevelCosts.length === 0) return false;
    return nextLevelCosts.every(
      c => (resourceMap.get(c.resourceId) ?? 0n) >= c.discountedAmount
    );
  }, [nextLevelCosts, resourceMap, atMax]);

  const sortedRecipes = useMemo(() => {
    return [...recipes].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [recipes]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const aEquipped = equippedInstanceIds.has(a.instanceId.toString()) ? 0 : 1;
      const bEquipped = equippedInstanceIds.has(b.instanceId.toString()) ? 0 : 1;
      if (aEquipped !== bEquipped) return aEquipped - bEquipped;
      // newer crafts first
      if (b.craftedAt.microsSinceUnixEpoch > a.craftedAt.microsSinceUnixEpoch) return 1;
      if (b.craftedAt.microsSinceUnixEpoch < a.craftedAt.microsSinceUnixEpoch) return -1;
      return 0;
    });
  }, [items, equippedInstanceIds]);

  const [busy, setBusy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ArmoryTab>('craft');

  const guarded = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch {
      /* surface via UI later; reducer errors are silent for now */
    } finally {
      setBusy(null);
    }
  };

  const onUpgrade = () =>
    guarded('upgrade', async () => {
      await upgradeArmory();
    });

  const onCraft = (recipeId: string) =>
    guarded(`craft:${recipeId}`, async () => {
      await craftItem({ recipeId });
    });

  const onEquip = (instanceId: bigint) =>
    guarded(`equip:${instanceId.toString()}`, async () => {
      await equipItem({ itemInstanceId: instanceId });
    });

  const onUnequip = (slotId: string) =>
    guarded(`unequip:${slotId}`, async () => {
      await unequipItem({ slotId });
    });

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
          <Text className="text-2xl">⚒</Text>
          <View className="flex-1">
            <Text className="text-base font-semibold text-slate-100">Armory</Text>
            <Text className="text-[11px] text-slate-500">
              Level {level} {atMax ? '· Max' : ''}
            </Text>
          </View>
        </View>
      </View>

      <View className="border-b border-slate-800 bg-slate-950 flex-row gap-2 px-4 py-2">
        <ArmoryTabPill
          name="Craft"
          active={activeTab === 'craft'}
          onPress={() => setActiveTab('craft')}
        />
        <ArmoryTabPill
          name="Loadout"
          active={activeTab === 'loadout'}
          onPress={() => setActiveTab('loadout')}
        />
      </View>

      {activeTab === 'loadout' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <LoadoutPanel />
        </ScrollView>
      ) : (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3 gap-2">
          <Text className="text-[11px] uppercase tracking-widest text-slate-500">
            Armory Level
          </Text>
          {atMax ? (
            <Text className="text-sm text-slate-300">
              You've maxed out the Armory. Crafted gear rolls near the top of every
              affix range.
            </Text>
          ) : nextLevelCosts.length === 0 ? (
            <Text className="text-xs text-slate-500">
              No upgrade path defined.
            </Text>
          ) : (
            <>
              <Text className="text-xs text-slate-400">
                Higher levels unlock new recipes and bias every craft toward the top
                of its affix range.
              </Text>
              <View className="flex-row flex-wrap gap-1">
                {nextLevelCosts.map(c => {
                  const have = resourceMap.get(c.resourceId) ?? 0n;
                  const enough = have >= c.discountedAmount;
                  const hasDiscount = c.discountedAmount < c.originalAmount;
                  return (
                    <View
                      key={c.resourceId}
                      className={`rounded-md px-2 py-0.5 ${enough ? 'bg-slate-800' : 'bg-rose-950/50'}`}
                    >
                      <Text
                        className={`text-[11px] ${enough ? 'text-slate-300' : 'text-rose-300'}`}
                      >
                        {c.discountedAmount.toString()} {c.resourceId}
                        {hasDiscount ? (
                          <Text className="text-[10px] text-emerald-400"> ↓</Text>
                        ) : null}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <SafePressable
                onPress={onUpgrade}
                disabled={busy !== null || !canAffordUpgrade}
                className={`rounded-lg py-2 items-center ${canAffordUpgrade && busy === null ? 'bg-emerald-500' : 'bg-slate-800'}`}
              >
                <Text
                  className={`text-xs font-medium ${canAffordUpgrade && busy === null ? 'text-slate-950' : 'text-slate-500'}`}
                >
                  {busy === 'upgrade'
                    ? 'Upgrading…'
                    : `Upgrade to Level ${level + 1}`}
                </Text>
              </SafePressable>
            </>
          )}
        </View>

        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Craft ({sortedRecipes.length})
        </Text>
        {sortedRecipes.length === 0 ? (
          <Text className="text-xs text-slate-500">
            No recipes available yet.
          </Text>
        ) : (
          sortedRecipes.map(r => {
            const itemDef = itemDefById.get(r.itemDefId);
            const costs = recipeCosts.filter(c => c.recipeId === r.recipeId);
            const canAfford = costs.every(
              c => (resourceMap.get(c.resourceId) ?? 0n) >= c.amount
            );
            const busyKey = `craft:${r.recipeId}`;
            return (
              <View
                key={r.recipeId}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-3 gap-2"
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-slate-100">
                    {itemDef?.displayName ?? r.itemDefId}
                  </Text>
                  <Text className="text-[10px] uppercase tracking-widest text-slate-500">
                    Lv {r.unlockedAtArmoryLevel}+
                  </Text>
                </View>
                {itemDef ? (
                  <Text className="text-xs text-slate-400">
                    {itemDef.description}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-1">
                  {costs.map(c => {
                    const have = resourceMap.get(c.resourceId) ?? 0n;
                    const enough = have >= c.amount;
                    return (
                      <View
                        key={c.resourceId}
                        className={`rounded-md px-2 py-0.5 ${enough ? 'bg-slate-800' : 'bg-rose-950/50'}`}
                      >
                        <Text
                          className={`text-[11px] ${enough ? 'text-slate-300' : 'text-rose-300'}`}
                        >
                          {c.amount.toString()} {c.resourceId}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <SafePressable
                  onPress={() => onCraft(r.recipeId)}
                  disabled={busy !== null || !canAfford}
                  className={`rounded-lg py-2 items-center ${canAfford && busy === null ? 'bg-emerald-500' : 'bg-slate-800'}`}
                >
                  <Text
                    className={`text-xs font-medium ${canAfford && busy === null ? 'text-slate-950' : 'text-slate-500'}`}
                  >
                    {busy === busyKey ? 'Crafting…' : 'Craft'}
                  </Text>
                </SafePressable>
              </View>
            );
          })
        )}

        <Text className="text-xs uppercase tracking-widest text-slate-500 mt-2">
          Inventory ({sortedItems.length})
        </Text>
        {sortedItems.length === 0 ? (
          <Text className="text-xs text-slate-500">
            Nothing crafted yet. Build something above.
          </Text>
        ) : (
          sortedItems.map(it => {
            const def = itemDefById.get(it.itemDefId);
            const slot = def ? slotById.get(def.slotId) : undefined;
            const isEquipped = equippedInstanceIds.has(it.instanceId.toString());
            const affixes = affixesByInstance.get(it.instanceId.toString()) ?? [];
            const busyKey = isEquipped
              ? `unequip:${def?.slotId ?? ''}`
              : `equip:${it.instanceId.toString()}`;
            return (
              <View
                key={it.instanceId.toString()}
                className={`rounded-xl bg-slate-950 px-4 py-3 gap-2 border ${isEquipped ? 'border-emerald-700' : 'border-slate-800'}`}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-slate-100">
                    {def?.displayName ?? it.itemDefId}
                  </Text>
                  <Text className="text-[10px] uppercase tracking-widest text-slate-500">
                    {isEquipped
                      ? `Equipped · ${slot?.displayName ?? def?.slotId ?? ''}`
                      : `Lv ${it.armoryLevelAtCraft} craft`}
                  </Text>
                </View>
                <View className="flex-row flex-wrap gap-1">
                  {affixes.length === 0 ? (
                    <Text className="text-[11px] text-slate-500">No affixes</Text>
                  ) : (
                    affixes.map(a => (
                      <View
                        key={`${a.instanceId.toString()}:${a.statId}`}
                        className="rounded-md bg-slate-800 px-2 py-0.5"
                      >
                        <Text className="text-[11px] text-amber-300">
                          +{a.amount} {statNameById.get(a.statId) ?? a.statId}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
                <SafePressable
                  onPress={() =>
                    isEquipped
                      ? def
                        ? onUnequip(def.slotId)
                        : null
                      : onEquip(it.instanceId)
                  }
                  disabled={busy !== null || (!isEquipped && !slot)}
                  className={`rounded-lg py-2 items-center ${
                    busy === null && (isEquipped || slot)
                      ? isEquipped
                        ? 'bg-slate-800'
                        : 'bg-emerald-500'
                      : 'bg-slate-800'
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      busy === null && !isEquipped && slot
                        ? 'text-slate-950'
                        : 'text-slate-200'
                    }`}
                  >
                    {busy === busyKey
                      ? isEquipped
                        ? 'Unequipping…'
                        : 'Equipping…'
                      : isEquipped
                        ? 'Unequip'
                        : !slot
                          ? 'Slot locked'
                          : 'Equip'}
                  </Text>
                </SafePressable>
              </View>
            );
          })
        )}
      </ScrollView>
      )}
    </View>
  );
}

function ArmoryTabPill({
  name,
  active,
  onPress,
}: {
  name: string;
  active: boolean;
  onPress: () => void;
}) {
  const containerClass = active
    ? 'bg-amber-500/15 border border-amber-500/40'
    : 'bg-slate-800 border border-transparent';
  const nameColor = active ? 'text-amber-300 font-semibold' : 'text-slate-300';
  return (
    <SafePressable onPress={onPress} className={`rounded-full px-4 py-1.5 ${containerClass}`}>
      <Text className={`text-sm ${nameColor}`}>{name}</Text>
    </SafePressable>
  );
}
