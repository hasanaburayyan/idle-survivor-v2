import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';
import { CLASS_ACCENT_TEXT, CLASS_GLYPH, CLASS_TREE_IDS } from './ClassEquipModal';
import { formatScrap } from '../lib/scavenge';


interface ClassCraftingScreenProps {
  onBack: () => void;
}

/** u32::MAX — sentinel for "this tier has no upper bound" in pointsInTier. */
const U32_MAX = 0xffffffff;

const TIER_LABEL = ['Tier 1', 'Tier 2', 'Tier 3'] as const;
const TIER_COLOR_TEXT = [
  'text-emerald-400',
  'text-amber-400',
  'text-red-400',
] as const;
const TIER_COLOR_BORDER = [
  'border-emerald-800/60',
  'border-amber-800/60',
  'border-red-800/60',
] as const;
const TIER_COLOR_BG = [
  'bg-emerald-900/20',
  'bg-amber-900/20',
  'bg-red-900/20',
] as const;

/** Compute 0-based tier index from how many points have been crafted so far. */
function computeTierIndex(
  pointsCrafted: bigint,
  costRows: ReadonlyArray<{ tierIndex: number; pointsInTier: number }>
): number {
  // Deduplicate by tierIndex — multiple rows per tier (one per resource).
  const tierMap = new Map<number, number>(); // tierIndex → pointsInTier
  for (const row of costRows) {
    if (!tierMap.has(row.tierIndex)) tierMap.set(row.tierIndex, row.pointsInTier);
  }
  const tiers = [...tierMap.entries()].sort((a, b) => a[0] - b[0]);
  let remaining = pointsCrafted;
  for (const [tierIdx, pointsInTier] of tiers) {
    if (pointsInTier === U32_MAX) return tierIdx; // unbounded — always in this tier
    if (remaining < BigInt(pointsInTier)) return tierIdx;
    remaining -= BigInt(pointsInTier);
  }
  return tiers.at(-1)?.[0] ?? 0;
}

export default function ClassCraftingScreen({ onBack }: ClassCraftingScreenProps) {
  const [visibleTrees] = useTable(tables.myVisibleSkillTrees);
  const [craftCosts] = useTable(tables.classCraftCost);
  const [craftProgress] = useTable(tables.myClassCraftProgress);
  const [pointBalances] = useTable(tables.myPointBalances);
  const [resources] = useTable(tables.myResources);
  const [resourceDefs] = useTable(tables.resourceDefinition);
  const [playerStates] = useTable(tables.myPlayerState);

  const craftClassPointReducer = useReducer(reducers.craftClassPoint);
  const doCraftClassPoint = useCallback(
    async (classId: string): Promise<void> => {
      craftClassPointReducer({ classId });
    },
    [craftClassPointReducer]
  );

  const [busy, setBusy] = useState<string | null>(null); // classId being crafted
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const playerLocation = playerStates[0]?.location ?? '';
  const inMinigame =
    playerLocation.startsWith('defensive_battle:') ||
    playerLocation.startsWith('minigame:');

  // Only class trees that are actually visible to this player.
  const unlockedClasses = useMemo(
    () =>
      [...visibleTrees]
        .filter(t => CLASS_TREE_IDS.has(t.treeId))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [visibleTrees]
  );

  // Resource lookups.
  const resourceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of resourceDefs) m.set(d.resourceId, d.name);
    return m;
  }, [resourceDefs]);

  const resourceIconById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of resourceDefs) m.set(d.resourceId, d.icon);
    return m;
  }, [resourceDefs]);

  const resourceAmountById = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const r of resources) m.set(r.resourceId, r.amount);
    // Scrap lives on player_state.scrap, not in player_resource — mirror the
    // server-side special case in craftClassPoint / equipClass so the cost preview
    // and affordability gating reflect the player's real scrap balance.
    const scrap = playerStates[0]?.scrap;
    if (scrap !== undefined) m.set('scrap', scrap);
    return m;
  }, [resources, playerStates]);

  // Craft cost rows grouped by classId.
  // Map values are explicitly mutable — do not use typeof craftCosts (readonly).
  type CraftCostRow = (typeof craftCosts)[number];
  const costsByClass = useMemo(() => {
    const m = new Map<string, CraftCostRow[]>();
    for (const row of craftCosts) {
      const list: CraftCostRow[] = m.get(row.classId) ?? [];
      list.push(row);
      m.set(row.classId, list);
    }
    return m;
  }, [craftCosts]);

  // Points crafted per class.
  const craftedByClass = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const p of craftProgress) m.set(p.classId, p.pointsCrafted);
    return m;
  }, [craftProgress]);

  // Spendable point balance per pool (class_brute, class_generalist, etc.).
  const balanceByPool = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of pointBalances) m.set(b.poolId, b.amount);
    return m;
  }, [pointBalances]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const showToast = useCallback(
    (msg: string) => {
      setToastMessage(msg);
      toastOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(1800),
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 400,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => setToastMessage(null));
    },
    [toastOpacity]
  );

  const handleCraft = async (classId: string, displayName: string) => {
    if (busy || inMinigame) return;
    setBusy(classId);
    try {
      await doCraftClassPoint(classId);
      showToast(`${displayName} point crafted. Spend in the ${displayName} tree.`);
    } catch {
      /* server error — surfaces in logs */
    } finally {
      setBusy(null);
    }
  };

  if (unlockedClasses.length === 0) {
    return (
      <View className="flex-1 bg-slate-950">
        <ScreenHeader onBack={onBack} />
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <Text className="text-3xl">⚗</Text>
          <Text className="text-base font-semibold text-slate-300 text-center">
            No classes unlocked yet
          </Text>
          <Text className="text-sm text-slate-500 text-center leading-5">
            Master a stat pair in Intermediate to unlock a class tree, then
            return here to craft points.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <ScreenHeader onBack={onBack} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Help text */}
        <View className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
          <Text className="text-xs text-slate-500 leading-4">
            Spend resources to craft class-specific skill points. Points are added
            to the class's pool — head to the Skill Tree to spend them. Costs
            increase in tiers as you craft more points.
          </Text>
        </View>

        {inMinigame ? (
          <View className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-2">
            <Text className="text-xs text-red-400 text-center">
              Crafting is disabled during minigame sessions.
            </Text>
          </View>
        ) : null}

        {unlockedClasses.map(tree => {
          const classId = tree.treeId;
          const poolId = `class_${classId}`;
          const classCosts = costsByClass.get(classId) ?? [];
          const pointsCrafted = craftedByClass.get(classId) ?? 0n;
          const spendable = balanceByPool.get(poolId) ?? 0;
          const tierIdx = computeTierIndex(pointsCrafted, classCosts);
          const currentTierRows = classCosts
            .filter(r => r.tierIndex === tierIdx)
            .sort((a, b) => (a.id < b.id ? -1 : 1));
          const canAfford =
            currentTierRows.length > 0 &&
            currentTierRows.every(r => {
              const have = resourceAmountById.get(r.resourceId) ?? 0n;
              return have >= r.amountPerPoint;
            });
          const accentText = CLASS_ACCENT_TEXT[classId] ?? 'text-amber-300';
          const glyph = CLASS_GLYPH[classId] ?? '?';
          const tierLabel = TIER_LABEL[Math.min(tierIdx, 2)] ?? `Tier ${tierIdx + 1}`;
          const tierTextClass = TIER_COLOR_TEXT[Math.min(tierIdx, 2)] ?? 'text-slate-400';
          const tierBorderClass =
            TIER_COLOR_BORDER[Math.min(tierIdx, 2)] ?? 'border-slate-800';
          const tierBgClass = TIER_COLOR_BG[Math.min(tierIdx, 2)] ?? 'bg-slate-900/20';
          const isBusy = busy === classId;

          return (
            <View
              key={classId}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden"
            >
              {/* Class header */}
              <View className="flex-row items-center justify-between px-4 pt-4 pb-3 border-b border-slate-800/60">
                <View className="flex-row items-center gap-3">
                  <Text className={`text-2xl ${accentText}`}>{glyph}</Text>
                  <View>
                    <Text className={`text-base font-semibold ${accentText}`}>
                      {tree.displayName}
                    </Text>
                    <Text className="text-[11px] text-slate-500 mt-0.5">
                      {Number(pointsCrafted)} crafted ·{' '}
                      <Text className="text-slate-400">{spendable} spendable</Text>
                    </Text>
                  </View>
                </View>
                {/* Tier badge */}
                <View
                  className={`rounded-full border px-2.5 py-0.5 ${tierBorderClass} ${tierBgClass}`}
                >
                  <Text className={`text-[10px] font-semibold ${tierTextClass}`}>
                    {tierLabel}
                  </Text>
                </View>
              </View>

              {/* Cost breakdown */}
              <View className="px-4 py-3 gap-2">
                <Text className="text-[10px] uppercase tracking-widest text-slate-500">
                  Cost per point
                </Text>
                {currentTierRows.length === 0 ? (
                  <Text className="text-sm text-slate-500 italic">
                    No cost data yet — backend pending.
                  </Text>
                ) : (
                  <View className="gap-1.5">
                    {currentTierRows.map(row => {
                      const have = resourceAmountById.get(row.resourceId) ?? 0n;
                      const needed = row.amountPerPoint;
                      const affordable = have >= needed;
                      return (
                        <View
                          key={`${row.classId}-${row.tierIndex}-${row.resourceId}`}
                          className="flex-row items-center justify-between"
                        >
                          <View className="flex-row items-center gap-2">
                            <Text className="text-base">
                              {resourceIconById.get(row.resourceId) ?? '•'}
                            </Text>
                            <Text className="text-sm text-slate-300">
                              {resourceNameById.get(row.resourceId) ?? row.resourceId}
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-2">
                            <Text
                              className={`text-xs ${affordable ? 'text-slate-400' : 'text-slate-600'}`}
                            >
                              {formatScrap(have)} /
                            </Text>
                            <Text
                              className={`text-sm font-semibold ${
                                affordable ? 'text-emerald-300' : 'text-red-400'
                              }`}
                            >
                              {formatScrap(needed)}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* Craft button */}
              <View className="px-4 pb-4">
                <SafePressable
                  disabled={isBusy || !canAfford || inMinigame || currentTierRows.length === 0}
                  onPress={() => handleCraft(classId, tree.displayName)}
                  className={`rounded-xl py-3 items-center ${
                    isBusy || !canAfford || inMinigame || currentTierRows.length === 0
                      ? 'bg-slate-800'
                      : `bg-slate-800 border ${tierBorderClass}`
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      isBusy
                        ? 'text-slate-500'
                        : !canAfford || inMinigame || currentTierRows.length === 0
                          ? 'text-slate-600'
                          : accentText
                    }`}
                  >
                    {isBusy
                      ? 'Crafting…'
                      : !canAfford
                        ? "Can't afford"
                        : inMinigame
                          ? 'Locked (minigame)'
                          : `Craft ${tree.displayName} Point`}
                  </Text>
                </SafePressable>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Toast overlay */}
      {toastMessage ? (
        <Animated.View
          pointerEvents="none"
          style={{ opacity: toastOpacity }}
          className="absolute bottom-10 left-6 right-6 items-center"
        >
          <View className="rounded-xl border border-slate-700 bg-slate-800/95 px-5 py-3">
            <Text className="text-sm text-slate-200 text-center">{toastMessage}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ScreenHeader
// ---------------------------------------------------------------------------

function ScreenHeader({ onBack }: { onBack: () => void }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-slate-800 px-4 py-3">
      <SafePressable
        onPress={onBack}
        className="h-8 w-8 items-center justify-center rounded-full bg-slate-800"
        accessibilityLabel="Back"
      >
        <Text className="text-base text-slate-300">←</Text>
      </SafePressable>
      <View>
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Shelter
        </Text>
        <Text className="text-sm font-semibold text-slate-200">
          Class Crafting
        </Text>
      </View>
    </View>
  );
}
