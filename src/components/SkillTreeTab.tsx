import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import SafePressable from './SafePressable';
import { useSpotlightTarget } from './SpotlightTargetRegistry';
import Svg, { Line, Rect } from 'react-native-svg';
import RefundCapstoneModal from './RefundCapstoneModal';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { formatScrap } from '../lib/scavenge';
import ClassEquipModal, {
  CLASS_GLYPH,
  CLASS_ACCENT_TEXT,
  CLASS_TREE_IDS,
  type ClassTreeRef,
} from './ClassEquipModal';

const NODE_DIAMETER = 96;
const CANVAS_PADDING = 220;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const WHEEL_STEP = 0.1;
const PAN_MIN_DISTANCE = 10; // px before pan claims the gesture (so node taps still fire)

function clampScale(s: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

interface SkillDef {
  skillId: string;
  name: string;
  description: string;
  maxLevel: number;
  prerequisiteSkillId: string;
  prerequisiteLevel: number;
  prerequisitePlayerLevel: number;
  costSkillPoints: number;
  positionX: number;
  positionY: number;
  sortOrder: number;
  treeId: string;
  // Phase 1 additions — new columns from the class-trees schema migration.
  /** Non-empty only for capstone branch nodes; groups mutually-exclusive choices. */
  capstoneBranchId: string;
  /** When true, node has no hard max level — progressByTree skips it for completion. */
  infiniteScaling: boolean;
  /** When non-empty, prerequisiteStatValue is compared to this stat total instead of player level. */
  prerequisiteStatId: string;
  /** Minimum value of prerequisiteStatId required (0 = unused). */
  prerequisiteStatValue: number;
}


// Distinct unicode glyphs per stat — mirrors CharacterTab.STAT_GLYPH so the
// same visual shorthand reads consistently across screens.
const STAT_GLYPH: Record<string, string> = {
  vigor: '♥',
  power: '✦',
  focus: '◎',
  fortune: '✧',
};

interface SkillPrereqRow {
  id: bigint;
  skillId: string;
  requiredSkillId: string;
  requiredLevel: number;
}

function nodePosition(def: SkillDef): { x: number; y: number } {
  return { x: def.positionX, y: def.positionY };
}

export default function SkillTreeTab() {
  const [definitions] = useTable(tables.skillDefinition);
  const [extraPrereqs] = useTable(tables.skillPrerequisite);
  const [mySkills] = useTable(tables.mySkills);
  const [playerStates] = useTable(tables.myPlayerState);
  const [visibleTrees] = useTable(tables.myVisibleSkillTrees);
  const [pointBalances] = useTable(tables.myPointBalances);
  const [statGrants] = useTable(tables.skillStatGrant);
  const [statDefs] = useTable(tables.statDefinition);
  const [statTotals] = useTable(tables.myStatTotals);
  const upgrade = useReducer(reducers.upgradeSkill);

  const [capstoneChoices] = useTable(tables.myCapstoneChoices);
  const [craftCosts] = useTable(tables.classCraftCost);
  const [craftProgress] = useTable(tables.myClassCraftProgress);
  const [resourceDefs] = useTable(tables.resourceDefinition);

  const refundCapstoneReducer = useReducer(reducers.refundCapstoneChoice);
  const doRefundCapstone = useCallback(
    async (classId: string, capstoneBranchId: string): Promise<void> => {
      refundCapstoneReducer({ classId, capstoneBranchId });
    },
    [refundCapstoneReducer]
  );

  const [equippedClassRows] = useTable(tables.myEquippedClass);
  const equipClassReducer = useReducer(reducers.equipClass);
  const unequipClassReducer = useReducer(reducers.unequipClass);
  const doEquipClass = useCallback(async (classId: string): Promise<void> => {
    equipClassReducer({ classId });
  }, [equipClassReducer]);
  const doUnequipClass = useCallback(async (): Promise<void> => {
    unequipClassReducer();
  }, [unequipClassReducer]);

  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTreeId, setActiveTreeId] = useState<string | null>(null);
  const [equipModalOpen, setEquipModalOpen] = useState(false);
  /**
   * When non-null, the RefundCapstoneModal is open for this branch.
   * Holds enough info to render the modal without extra lookups.
   */
  const [refundModal, setRefundModal] = useState<{
    classId: string;
    capstoneBranchId: string;
    chosenSkillName: string;
    refundCostLabel: string;
  } | null>(null);
  const playerLevel = playerStates[0]?.playerLevel ?? 0;
  const playerLocation = playerStates[0]?.location ?? '';
  const inMinigame =
    playerLocation.startsWith('defensive_battle:') ||
    playerLocation.startsWith('minigame:');

  const levelBySkill = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of mySkills) map.set(s.skillId, s.level);
    return map;
  }, [mySkills]);

  const extraPrereqsBySkill = useMemo(() => {
    const map = new Map<string, SkillPrereqRow[]>();
    for (const row of extraPrereqs as SkillPrereqRow[]) {
      const list = map.get(row.skillId);
      if (list) list.push(row);
      else map.set(row.skillId, [row]);
    }
    return map;
  }, [extraPrereqs]);

  const sorted = useMemo(
    () =>
      [...definitions].sort((a, b) => a.sortOrder - b.sortOrder) as SkillDef[],
    [definitions]
  );

  const sortedTrees = useMemo(
    () => [...visibleTrees].sort((a, b) => a.sortOrder - b.sortOrder),
    [visibleTrees]
  );

  const pointsByPool = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of pointBalances) m.set(b.poolId, b.amount);
    return m;
  }, [pointBalances]);

  const statTotalById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of statTotals) m.set(s.statId, s.total);
    return m;
  }, [statTotals]);

  /** treeId of the currently equipped class, or empty string for none. */
  const equippedClassId = equippedClassRows[0]?.classId ?? '';

  // ── Phase 2: capstone + tier data ─────────────────────────────────────────

  /** Map of capstoneBranchId → chosenSkillId for this player. */
  const capstoneChoiceByBranch = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of capstoneChoices) m.set(c.capstoneBranchId, c.chosenSkillId);
    return m;
  }, [capstoneChoices]);

  /** Craft costs grouped by classId. Map values are mutable — don't use typeof craftCosts. */
  type CraftCostRow = (typeof craftCosts)[number];
  const craftCostsByClass = useMemo(() => {
    const m = new Map<string, CraftCostRow[]>();
    for (const row of craftCosts) {
      const list: CraftCostRow[] = m.get(row.classId) ?? [];
      list.push(row);
      m.set(row.classId, list);
    }
    return m;
  }, [craftCosts]);

  /** Points crafted per classId. */
  const craftProgressByClass = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const p of craftProgress) m.set(p.classId, p.pointsCrafted);
    return m;
  }, [craftProgress]);

  /** Resource display names for refund cost labels. */
  const resourceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of resourceDefs) m.set(d.resourceId, d.name);
    return m;
  }, [resourceDefs]);

  /**
   * 0-based tier index for the currently active class tree.
   * null when the active tree is not a class tree or cost data is absent.
   */
  const activeTierIndex = useMemo((): number | null => {
    if (!activeTreeId || !CLASS_TREE_IDS.has(activeTreeId)) return null;
    const rows = craftCostsByClass.get(activeTreeId);
    if (!rows || rows.length === 0) return null;
    const crafted = craftProgressByClass.get(activeTreeId) ?? 0n;
    const U32_MAX = 0xffffffff;
    // Deduplicate by tierIndex
    const tierMap = new Map<number, number>();
    for (const row of rows) {
      if (!tierMap.has(row.tierIndex)) tierMap.set(row.tierIndex, row.pointsInTier);
    }
    const tiers = [...tierMap.entries()].sort((a, b) => a[0] - b[0]);
    let remaining = crafted;
    for (const [tierIdx, pointsInTier] of tiers) {
      if (pointsInTier === U32_MAX) return tierIdx;
      if (remaining < BigInt(pointsInTier)) return tierIdx;
      remaining -= BigInt(pointsInTier);
    }
    return tiers.at(-1)?.[0] ?? 0;
  }, [activeTreeId, craftCostsByClass, craftProgressByClass]);

  /**
   * Build a pre-formatted refund cost label for a given class.
   * Formula: 10 × tier-0 primary resource amountPerPoint.
   * Returns null if cost data is not yet seeded.
   */
  const getRefundCostLabel = useCallback(
    (classId: string): string => {
      const rows = craftCostsByClass.get(classId) ?? [];
      const tier0Rows = rows
        .filter(r => r.tierIndex === 0)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const primary = tier0Rows[0];
      if (!primary) return '(cost unknown — seeding pending)';
      const amount = primary.amountPerPoint * 10n;
      const resName = resourceNameById.get(primary.resourceId) ?? primary.resourceId;
      return `${formatScrap(amount)} ${resName}`;
    },
    [craftCostsByClass, resourceNameById]
  );

  // ── End Phase 2 data ──────────────────────────────────────────────────────

  /** Class trees the player has unlocked (visible in myVisibleSkillTrees). */
  const unlockedClassTrees = useMemo<ClassTreeRef[]>(
    () =>
      sortedTrees
        .filter(t => CLASS_TREE_IDS.has(t.treeId))
        .map(t => ({ treeId: t.treeId, displayName: t.displayName })),
    [sortedTrees]
  );

  const equippedDisplayName = useMemo(() => {
    if (equippedClassId === '') return '';
    return (
      unlockedClassTrees.find(c => c.treeId === equippedClassId)?.displayName ??
      equippedClassId
    );
  }, [equippedClassId, unlockedClassTrees]);

  const skillsByTree = useMemo(() => {
    const m = new Map<string, SkillDef[]>();
    for (const def of sorted) {
      const list = m.get(def.treeId) ?? [];
      list.push(def);
      m.set(def.treeId, list);
    }
    return m;
  }, [sorted]);

  // Per-tree progress: { maxed, total } counts. Used by the tab strip.
  // Infinite-scaling nodes are excluded — they have no hard max.
  // Capstone branches count as ONE slot total: only one of the N nodes in a
  // branch can ever be taken (the others lock out), so counting them
  // individually would make the "done" badge unreachable.
  const progressByTree = useMemo(() => {
    const m = new Map<string, { maxed: number; total: number }>();
    for (const tree of sortedTrees) {
      const skills = skillsByTree.get(tree.treeId) ?? [];
      let maxed = 0;
      let total = 0;
      const capstoneBranches = new Map<string, { anyMaxed: boolean }>();
      for (const def of skills as SkillDef[]) {
        if (def.infiniteScaling) continue;
        const lvl = levelBySkill.get(def.skillId) ?? 0;
        if (def.capstoneBranchId) {
          const entry = capstoneBranches.get(def.capstoneBranchId) ?? { anyMaxed: false };
          if (lvl >= def.maxLevel) entry.anyMaxed = true;
          capstoneBranches.set(def.capstoneBranchId, entry);
        } else {
          total += 1;
          if (lvl >= def.maxLevel) maxed += 1;
        }
      }
      for (const branch of capstoneBranches.values()) {
        total += 1;
        if (branch.anyMaxed) maxed += 1;
      }
      m.set(tree.treeId, { maxed, total });
    }
    return m;
  }, [sortedTrees, skillsByTree, levelBySkill]);

  const grantsBySkill = useMemo(() => {
    const m = new Map<string, { statId: string; amountPerLevel: number }[]>();
    for (const g of statGrants) {
      const list = m.get(g.skillId) ?? [];
      list.push({ statId: g.statId, amountPerLevel: g.amountPerLevel });
      m.set(g.skillId, list);
    }
    return m;
  }, [statGrants]);

  const statNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of statDefs) m.set(d.statId, d.displayName);
    return m;
  }, [statDefs]);

  const allPrereqsMet = (def: SkillDef): boolean => {
    if (def.prerequisiteSkillId !== '') {
      const lvl = levelBySkill.get(def.prerequisiteSkillId) ?? 0;
      if (lvl < def.prerequisiteLevel) return false;
    }
    // Stat-gated prereq (class tree deep nodes, e.g. capstone gates on Vigor 30).
    // When prerequisiteStatId is set, compare stat total instead of player level.
    if (def.prerequisiteStatId !== '') {
      const statTotal = statTotalById.get(def.prerequisiteStatId) ?? 0;
      if (statTotal < def.prerequisiteStatValue) return false;
    } else if (def.prerequisitePlayerLevel > 0 && playerLevel < def.prerequisitePlayerLevel) {
      return false;
    }
    const extras = extraPrereqsBySkill.get(def.skillId);
    if (extras) {
      for (const extra of extras) {
        const lvl = levelBySkill.get(extra.requiredSkillId) ?? 0;
        if (lvl < extra.requiredLevel) return false;
      }
    }
    return true;
  };

  // Default tab: lowest-sortOrder visible tree that has both unspent pool
  // points AND at least one non-maxed visible node. This avoids landing on
  // a fully-maxed Beginner with unspent points earmarked for Intermediate.
  // Falls back to lowest-sortOrder visible tree overall.
  useEffect(() => {
    if (sortedTrees.length === 0) {
      if (activeTreeId !== null) setActiveTreeId(null);
      return;
    }
    // Honor an existing selection if it's still visible.
    if (activeTreeId && sortedTrees.some(t => t.treeId === activeTreeId)) {
      return;
    }
    let pick: string | null = null;
    for (const tree of sortedTrees) {
      const skills = skillsByTree.get(tree.treeId) ?? [];
      const hasSpendable = skills.some(d => {
        // Infinite-scaling nodes are always spendable (no upper bound)
        if ((d as SkillDef).infiniteScaling) return true;
        const lvl = levelBySkill.get(d.skillId) ?? 0;
        return lvl < d.maxLevel;
      });
      const poolBalance = pointsByPool.get(tree.pointPoolId) ?? 0;
      if (hasSpendable && poolBalance > 0) {
        pick = tree.treeId;
        break;
      }
    }
    setActiveTreeId(pick ?? sortedTrees[0]?.treeId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedTrees, skillsByTree, pointsByPool, levelBySkill]);

  const activeTree = useMemo(
    () => sortedTrees.find(t => t.treeId === activeTreeId) ?? null,
    [sortedTrees, activeTreeId]
  );

  const activePoolPoints = activeTree
    ? pointsByPool.get(activeTree.pointPoolId) ?? 0
    : 0;

  const visible = useMemo(() => {
    if (!activeTreeId) return [];
    return sorted.filter(
      def => def.treeId === activeTreeId && allPrereqsMet(def)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sorted,
    activeTreeId,
    levelBySkill,
    extraPrereqsBySkill,
    playerLevel,
  ]);

  const visibleIds = useMemo(
    () => new Set(visible.map(d => d.skillId)),
    [visible]
  );

  const { canvasWidth, canvasHeight, originX, originY } = useMemo(() => {
    if (visible.length === 0) {
      return { canvasWidth: 0, canvasHeight: 0, originX: 0, originY: 0 };
    }
    const xs = visible.map(d => nodePosition(d).x);
    const ys = visible.map(d => nodePosition(d).y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      canvasWidth: maxX - minX + NODE_DIAMETER + CANVAS_PADDING * 2,
      canvasHeight: maxY - minY + NODE_DIAMETER + CANVAS_PADDING * 2,
      originX: CANVAS_PADDING - minX + NODE_DIAMETER / 2,
      originY: CANVAS_PADDING - minY + NODE_DIAMETER / 2,
    };
  }, [visible]);

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;
  const panOffset = useRef({ x: 0, y: 0 });
  const scaleOffset = useRef(1);
  const viewport = useRef({ width: 0, height: 0 });

  const onContainerLayout = (e: LayoutChangeEvent) => {
    viewport.current = {
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    };
  };

  const clampX = (x: number, s: number): number => {
    const contentW = canvasWidth * s;
    const vpW = viewport.current.width;
    if (contentW <= vpW) return (vpW - contentW) / 2;
    return Math.min(0, Math.max(vpW - contentW, x));
  };
  const clampY = (y: number, s: number): number => {
    const contentH = canvasHeight * s;
    const vpH = viewport.current.height;
    if (contentH <= vpH) return (vpH - contentH) / 2;
    return Math.min(0, Math.max(vpH - contentH, y));
  };

  const composedGesture = useMemo(() => {
    const panGesture = Gesture.Pan()
      .minDistance(PAN_MIN_DISTANCE)
      .onChange(e => {
        const nx = clampX(panOffset.current.x + e.translationX, scaleOffset.current);
        const ny = clampY(panOffset.current.y + e.translationY, scaleOffset.current);
        pan.setValue({ x: nx, y: ny });
      })
      .onEnd(e => {
        const nx = clampX(panOffset.current.x + e.translationX, scaleOffset.current);
        const ny = clampY(panOffset.current.y + e.translationY, scaleOffset.current);
        panOffset.current = { x: nx, y: ny };
        pan.setValue(panOffset.current);
      });

    const pinchGesture = Gesture.Pinch()
      .onChange(e => {
        const ns = clampScale(scaleOffset.current * e.scale);
        scale.setValue(ns);
      })
      .onEnd(e => {
        const ns = clampScale(scaleOffset.current * e.scale);
        scaleOffset.current = ns;
        scale.setValue(ns);
        const nx = clampX(panOffset.current.x, ns);
        const ny = clampY(panOffset.current.y, ns);
        panOffset.current = { x: nx, y: ny };
        pan.setValue(panOffset.current);
      });

    return Gesture.Simultaneous(panGesture, pinchGesture);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan, scale, canvasWidth, canvasHeight]);

  const resetView = () => {
    panOffset.current = { x: 0, y: 0 };
    scaleOffset.current = 1;
    Animated.parallel([
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
    ]).start();
  };

  // Web-only ctrl+wheel zoom. Plain wheel falls through to default (no-op here
  // since the parent container has overflow: hidden).
  const wheelProps =
    Platform.OS === 'web'
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onWheel: (e: any) => {
            if (!e.ctrlKey) return;
            e.preventDefault?.();
            const dir = Math.sign(e.deltaY);
            const ns = clampScale(scaleOffset.current - dir * WHEEL_STEP);
            scaleOffset.current = ns;
            scale.setValue(ns);
            const nx = clampX(panOffset.current.x, ns);
            const ny = clampY(panOffset.current.y, ns);
            panOffset.current = { x: nx, y: ny };
            pan.setValue(panOffset.current);
          },
        }
      : {};

  const onUpgrade = async (skillId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await upgrade({ skillId });
    } catch {
      /* error shown in server logs */
    } finally {
      setBusy(false);
    }
  };

  if (definitions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-sm text-slate-500">Loading skill tree…</Text>
      </View>
    );
  }

  // Drop the selection if its skill is no longer in the active tree.
  const selectedDef = selected
    ? sorted.find(d => d.skillId === selected) ?? null
    : null;
  const selectedInActive =
    selectedDef !== null && selectedDef.treeId === activeTreeId;
  const effectiveSelectedDef = selectedInActive ? selectedDef : null;

  const selectedLevel = effectiveSelectedDef
    ? levelBySkill.get(effectiveSelectedDef.skillId) ?? 0
    : 0;
  const selectedAtMax = effectiveSelectedDef
    ? !effectiveSelectedDef.infiniteScaling &&
      selectedLevel >= effectiveSelectedDef.maxLevel
    : false;
  const selectedPrereqMet = effectiveSelectedDef
    ? allPrereqsMet(effectiveSelectedDef)
    : false;
  const selectedCost = effectiveSelectedDef?.costSkillPoints ?? 1;
  const canAfford = activePoolPoints >= selectedCost;
  const selectedGrants = effectiveSelectedDef
    ? grantsBySkill.get(effectiveSelectedDef.skillId) ?? []
    : [];

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-6 py-3 border-b border-slate-800">
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Skill Tree
        </Text>
        <PoolPointCounter
          points={activePoolPoints}
          poolName={
            sortedTrees.length > 1 && activeTree
              ? activeTree.displayName
              : null
          }
          tierIndex={activeTierIndex}
        />
      </View>

      {sortedTrees.length > 1 ? (
        <View className="border-b border-slate-800 bg-slate-950">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              gap: 8,
              alignItems: 'center',
            }}
          >
            {sortedTrees.map(tree => {
              const progress = progressByTree.get(tree.treeId) ?? {
                maxed: 0,
                total: 0,
              };
              return (
                <TreeTab
                  key={tree.treeId}
                  name={tree.displayName}
                  progress={progress}
                  active={activeTreeId === tree.treeId}
                  onPress={() => {
                    setActiveTreeId(tree.treeId);
                    setSelected(null);
                  }}
                />
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Class equip banner — visible once at least one class tree is unlocked */}
      {unlockedClassTrees.length > 0 ? (
        <ClassEquipBanner
          equippedClassId={equippedClassId}
          equippedDisplayName={equippedDisplayName}
          inMinigame={inMinigame}
          onChangePress={() => setEquipModalOpen(true)}
        />
      ) : null}

      <View
        className="flex-1 bg-slate-950"
        style={
          Platform.OS === 'web'
            ? // userSelect cast needed — RN ViewStyle doesn't expose it.
              ({ overflow: 'hidden', userSelect: 'none' } as unknown as object)
            : { overflow: 'hidden' }
        }
        onLayout={onContainerLayout}
        {...wheelProps}
      >
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            style={{
              width: canvasWidth,
              height: canvasHeight,
              transform: [
                { translateX: pan.x },
                { translateY: pan.y },
                { scale: scale },
              ],
            }}
          >
          <Svg
            width={canvasWidth}
            height={canvasHeight}
            style={{ position: 'absolute', top: 0, left: 0 }}
            pointerEvents="none"
          >
            {/* Capstone branch group backgrounds — rendered behind edges */}
            {(() => {
              const rectsByBranch = new Map<
                string,
                { minX: number; minY: number; maxX: number; maxY: number }
              >();
              for (const def of visible) {
                if (!def.capstoneBranchId) continue;
                const pos = nodePosition(def);
                const existing = rectsByBranch.get(def.capstoneBranchId);
                if (!existing) {
                  rectsByBranch.set(def.capstoneBranchId, {
                    minX: pos.x,
                    minY: pos.y,
                    maxX: pos.x,
                    maxY: pos.y,
                  });
                } else {
                  rectsByBranch.set(def.capstoneBranchId, {
                    minX: Math.min(existing.minX, pos.x),
                    minY: Math.min(existing.minY, pos.y),
                    maxX: Math.max(existing.maxX, pos.x),
                    maxY: Math.max(existing.maxY, pos.y),
                  });
                }
              }
              const PAD = NODE_DIAMETER / 2 + 20;
              return [...rectsByBranch.entries()].map(([branchId, r]) => {
                const hasChoice = capstoneChoiceByBranch.has(branchId);
                return (
                  <Rect
                    key={`capstone-bg-${branchId}`}
                    x={originX + r.minX - PAD}
                    y={originY + r.minY - PAD}
                    width={r.maxX - r.minX + PAD * 2}
                    height={r.maxY - r.minY + PAD * 2}
                    rx={20}
                    ry={20}
                    fill={
                      hasChoice
                        ? 'rgba(217,119,6,0.07)'
                        : 'rgba(100,116,139,0.07)'
                    }
                    stroke={
                      hasChoice
                        ? 'rgba(217,119,6,0.25)'
                        : 'rgba(100,116,139,0.18)'
                    }
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                  />
                );
              });
            })()}
            {visible.flatMap(def => {
              const edges: {
                fromId: string;
                requiredLevel: number;
              }[] = [];
              if (def.prerequisiteSkillId !== '') {
                edges.push({
                  fromId: def.prerequisiteSkillId,
                  requiredLevel: def.prerequisiteLevel,
                });
              }
              const extras = extraPrereqsBySkill.get(def.skillId) ?? [];
              for (const extra of extras) {
                edges.push({
                  fromId: extra.requiredSkillId,
                  requiredLevel: extra.requiredLevel,
                });
              }
              return edges
                .map(edge => {
                  if (!visibleIds.has(edge.fromId)) return null;
                  const prereq = sorted.find(d => d.skillId === edge.fromId);
                  if (!prereq) return null;
                  const from = nodePosition(prereq);
                  const to = nodePosition(def);
                  const fromLevel = levelBySkill.get(prereq.skillId) ?? 0;
                  const toLevel = levelBySkill.get(def.skillId) ?? 0;
                  const satisfied = fromLevel >= edge.requiredLevel;
                  const stroke =
                    satisfied && toLevel > 0
                      ? '#10b981'
                      : satisfied
                        ? '#64748b'
                        : '#334155';
                  return (
                    <Line
                      key={`c-${def.skillId}-${edge.fromId}`}
                      x1={originX + from.x}
                      y1={originY + from.y}
                      x2={originX + to.x}
                      y2={originY + to.y}
                      stroke={stroke}
                      strokeWidth={3}
                      strokeLinecap="round"
                    />
                  );
                })
                .filter(Boolean);
            })}
          </Svg>

          {visible.map(def => {
            const pos = nodePosition(def);
            const level = levelBySkill.get(def.skillId) ?? 0;

            // Capstone state derivation
            let capstoneState: 'none' | 'available' | 'chosen' | 'locked-out' = 'none';
            if (def.capstoneBranchId) {
              const chosenId = capstoneChoiceByBranch.get(def.capstoneBranchId);
              if (!chosenId) {
                capstoneState = 'available';
              } else if (chosenId === def.skillId) {
                capstoneState = 'chosen';
              } else {
                capstoneState = 'locked-out';
              }
            }

            const handlePress =
              capstoneState === 'locked-out'
                ? () => {
                    // Tapping a locked-out capstone opens the refund modal
                    const chosenId = capstoneChoiceByBranch.get(def.capstoneBranchId) ?? '';
                    const chosenDef = sorted.find(d => d.skillId === chosenId);
                    const classId = def.treeId;
                    setRefundModal({
                      classId,
                      capstoneBranchId: def.capstoneBranchId,
                      chosenSkillName: chosenDef?.name ?? chosenId,
                      refundCostLabel: getRefundCostLabel(classId),
                    });
                  }
                : () => setSelected(def.skillId);

            return (
              <SkillNode
                key={def.skillId}
                def={def}
                level={level}
                selected={selected === def.skillId}
                capstoneState={capstoneState}
                onPress={handlePress}
                x={originX + pos.x - NODE_DIAMETER / 2}
                y={originY + pos.y - NODE_DIAMETER / 2}
                spotlightKey={`skill_node:${def.skillId}`}
              />
            );
          })}
          </Animated.View>
        </GestureDetector>
        <SafePressable
          onPress={resetView}
          style={{ position: 'absolute', top: 8, right: 8 }}
          className="rounded-full bg-slate-800/90 border border-slate-700 w-9 h-9 items-center justify-center"
        >
          <Text className="text-base text-slate-200">⟲</Text>
        </SafePressable>
      </View>

      {effectiveSelectedDef ? (
        <View className="px-6 py-4 border-t border-slate-800 bg-slate-900 gap-2">
          <Text className="text-sm font-semibold text-slate-100">
            {effectiveSelectedDef.name}{' '}
            <Text className="text-xs text-slate-400">
              Lv {selectedLevel}
              {effectiveSelectedDef.infiniteScaling
                ? ' · ∞'
                : ` / ${effectiveSelectedDef.maxLevel}`}
            </Text>
          </Text>
          <Text className="text-xs text-slate-400">
            {effectiveSelectedDef.description}
          </Text>
          {selectedGrants.length > 0 ? (
            <View className="border-t border-slate-800/60 mt-2 pt-2 gap-1">
              {selectedGrants.map(g => {
                const total = selectedLevel * g.amountPerLevel;
                const totalColor =
                  selectedLevel === 0
                    ? 'text-slate-500'
                    : !effectiveSelectedDef.infiniteScaling &&
                        selectedLevel >= effectiveSelectedDef.maxLevel
                      ? 'text-emerald-300 font-semibold'
                      : 'text-emerald-400';
                return (
                  <View
                    key={g.statId}
                    className="flex-row items-center justify-between"
                  >
                    <View className="flex-row items-center gap-2 flex-1">
                      <Text className="text-[11px] text-amber-300">
                        {STAT_GLYPH[g.statId] ?? '•'}
                      </Text>
                      <Text className="text-xs text-slate-300">
                        +{g.amountPerLevel} {statNameById.get(g.statId) ?? g.statId} per level
                      </Text>
                    </View>
                    <Text className={`text-xs ${totalColor}`}>
                      → +{total}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          <SafePressable
            disabled={busy || !canAfford || selectedAtMax || !selectedPrereqMet}
            onPress={() => onUpgrade(effectiveSelectedDef.skillId)}
            className={`rounded-lg py-2.5 items-center mt-1 ${
              busy || !canAfford || selectedAtMax || !selectedPrereqMet
                ? 'bg-slate-800'
                : 'bg-emerald-500'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                busy || !canAfford || selectedAtMax || !selectedPrereqMet
                  ? 'text-slate-500'
                  : 'text-slate-950'
              }`}
            >
              {selectedAtMax
                ? 'Maxed out'
                : !selectedPrereqMet
                  ? 'Prerequisite not met'
                  : !canAfford
                    ? `Need ${selectedCost} skill point${selectedCost === 1 ? '' : 's'}`
                    : `${selectedLevel === 0 ? 'Unlock' : 'Upgrade'} · ${
                        selectedCost === 0
                          ? 'free'
                          : `${selectedCost} point${selectedCost === 1 ? '' : 's'}`
                      }`}
            </Text>
          </SafePressable>
        </View>
      ) : null}

      {/* Class equip modal — rendered at root so it overlays the full screen */}
      <ClassEquipModal
        visible={equipModalOpen}
        onClose={() => setEquipModalOpen(false)}
        equippedClassId={equippedClassId}
        unlockedClasses={unlockedClassTrees}
        inMinigame={inMinigame}
        onEquip={doEquipClass}
        onUnequip={doUnequipClass}
      />

      {/* Capstone refund modal */}
      {refundModal ? (
        <RefundCapstoneModal
          visible
          onClose={() => setRefundModal(null)}
          classId={refundModal.classId}
          capstoneBranchId={refundModal.capstoneBranchId}
          chosenSkillName={refundModal.chosenSkillName}
          refundCostLabel={refundModal.refundCostLabel}
          inMinigame={inMinigame}
          onRefund={doRefundCapstone}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ClassEquipBanner — shown above the canvas when any class tree is unlocked
// ---------------------------------------------------------------------------

function ClassEquipBanner({
  equippedClassId,
  equippedDisplayName,
  inMinigame,
  onChangePress,
}: {
  equippedClassId: string;
  equippedDisplayName: string;
  inMinigame: boolean;
  onChangePress: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-800">
      <View className="flex-row items-center gap-2">
        {equippedClassId !== '' ? (
          <>
            <Text className={`text-sm ${CLASS_ACCENT_TEXT[equippedClassId] ?? 'text-amber-300'}`}>
              {CLASS_GLYPH[equippedClassId] ?? '?'}
            </Text>
            <Text className="text-xs text-slate-300">
              <Text className="text-slate-500">Active: </Text>
              {equippedDisplayName}
            </Text>
          </>
        ) : (
          <Text className="text-xs text-slate-500">No class equipped</Text>
        )}
      </View>
      <SafePressable
        onPress={onChangePress}
        disabled={inMinigame}
        accessibilityLabel="Change equipped class"
        className={`rounded-md px-3 py-1 border ${
          inMinigame ? 'border-slate-800 bg-slate-800' : 'border-slate-700 bg-slate-800'
        }`}
      >
        <Text
          className={`text-[11px] ${inMinigame ? 'text-slate-600' : 'text-slate-300'}`}
        >
          {inMinigame ? 'Locked' : 'Change'}
        </Text>
      </SafePressable>
    </View>
  );
}

function TreeTab({
  name,
  progress,
  active,
  onPress,
}: {
  name: string;
  progress: { maxed: number; total: number };
  active: boolean;
  onPress: () => void;
}) {
  const allDone = progress.total > 0 && progress.maxed === progress.total;
  const containerClass = active
    ? 'bg-amber-500/15 border border-amber-500/40'
    : 'bg-slate-800 border border-transparent';
  const nameColor = active ? 'text-amber-300 font-semibold' : 'text-slate-300';
  const progressColor = allDone
    ? 'text-emerald-400/70'
    : active
      ? 'text-amber-400/70'
      : 'text-slate-500';
  return (
    <SafePressable
      onPress={onPress}
      className={`rounded-full px-4 py-1.5 ${containerClass}`}
      accessibilityLabel={`${name} skill tree, ${progress.maxed} of ${progress.total} maxed`}
    >
      <Text className={`text-sm ${nameColor}`}>{name}</Text>
      <Text className={`text-[10px] ${progressColor}`}>
        {allDone ? 'done' : `${progress.maxed} / ${progress.total}`}
      </Text>
    </SafePressable>
  );
}

const TIER_BADGE_COLORS = [
  { text: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-800/50' },
  { text: 'text-amber-400',   bg: 'bg-amber-900/30',   border: 'border-amber-800/50'   },
  { text: 'text-red-400',     bg: 'bg-red-900/30',     border: 'border-red-800/50'     },
] as const;

function PoolPointCounter({
  points,
  poolName,
  tierIndex,
}: {
  points: number;
  poolName: string | null;
  /** 0-based tier index for class pool trees; null for non-class trees. */
  tierIndex?: number | null;
}) {
  const flash = useRef(new Animated.Value(0)).current;
  const prevPoints = useRef(points);

  useEffect(() => {
    if (points !== prevPoints.current) {
      prevPoints.current = points;
      flash.setValue(0);
      Animated.sequence([
        Animated.timing(flash, {
          toValue: 1,
          duration: 120,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(flash, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [points, flash]);

  const scale = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.18],
  });

  const tierColors = tierIndex != null
    ? TIER_BADGE_COLORS[Math.min(tierIndex, 2)]
    : null;

  return (
    <Animated.View
      style={{ transform: [{ scale }] }}
      className="flex-row items-center gap-2"
    >
      <Text className="text-sm text-slate-300">
        {poolName ? `${poolName} · ` : ''}
        {points} point{points === 1 ? '' : 's'}
      </Text>
      {tierColors ? (
        <View
          className={`rounded-full border px-2 py-0.5 ${tierColors.bg} ${tierColors.border}`}
        >
          <Text className={`text-[10px] font-semibold ${tierColors.text}`}>
            T{(tierIndex ?? 0) + 1}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

function SkillNode({
  def,
  level,
  selected,
  capstoneState = 'none',
  onPress,
  x,
  y,
  spotlightKey,
}: {
  def: SkillDef;
  level: number;
  selected: boolean;
  capstoneState?: 'none' | 'available' | 'chosen' | 'locked-out';
  onPress: () => void;
  x: number;
  y: number;
  spotlightKey?: string;
}) {
  const spotlight = useSpotlightTarget(spotlightKey ?? '');
  const unlocked = level > 0;

  const isLockedOut = capstoneState === 'locked-out';
  const isChosen = capstoneState === 'chosen';

  const borderClass = isLockedOut
    ? 'border-red-900/60'
    : isChosen
      ? 'border-amber-400'
      : selected
        ? 'border-amber-400'
        : unlocked
          ? 'border-emerald-500'
          : capstoneState === 'available'
            ? 'border-amber-700/50'
            : 'border-slate-700';

  const bgClass = isLockedOut
    ? 'bg-slate-950'
    : unlocked
      ? 'bg-slate-900'
      : 'bg-slate-950';

  const glow =
    isChosen
      ? {
          shadowColor: '#f59e0b',
          shadowOpacity: 0.45,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        }
      : unlocked && !isLockedOut
        ? {
            shadowColor: '#10b981',
            shadowOpacity: 0.6,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
            elevation: 6,
          }
        : null;

  return (
    <SafePressable
      ref={spotlight.ref}
      onLayout={spotlight.onLayout}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: NODE_DIAMETER,
        height: NODE_DIAMETER,
        borderRadius: NODE_DIAMETER / 2,
        opacity: isLockedOut ? 0.35 : 1,
        ...(glow ?? {}),
      }}
      className={`items-center justify-center border-2 px-2 ${borderClass} ${bgClass}`}
    >
      {/* Pulsing halo for the chosen capstone */}
      {isChosen ? <ChosenHalo size={NODE_DIAMETER} /> : null}

      <Text
        className="text-[10px] font-semibold text-slate-100 text-center leading-tight"
        numberOfLines={3}
      >
        {def.name}
      </Text>
      {unlocked ? (
        <View className="mt-1 rounded-full bg-emerald-500/20 px-2 py-0.5">
          <Text className="text-[10px] text-emerald-300">Lv {level}</Text>
        </View>
      ) : isLockedOut ? (
        <Text className="text-[9px] text-red-500 mt-1">Locked out</Text>
      ) : capstoneState === 'available' ? (
        <Text className="text-[9px] text-amber-600 mt-1">Capstone</Text>
      ) : (
        <Text className="text-[9px] text-slate-500 mt-1">Locked</Text>
      )}
    </SafePressable>
  );
}

// ---------------------------------------------------------------------------
// ChosenHalo — pulsing amber ring around the chosen capstone node
// ---------------------------------------------------------------------------

function ChosenHalo({ size }: { size: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.75],
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, 1.14],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2.5,
        borderColor: '#f59e0b', // amber-400
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}
