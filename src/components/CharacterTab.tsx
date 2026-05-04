import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';
import ClassEquipModal, {
  CLASS_GLYPH,
  CLASS_ACCENT_TEXT,
  CLASS_TREE_IDS,
  type ClassTreeRef,
} from './ClassEquipModal';

interface StatDefRow {
  statId: string;
  displayName: string;
  description: string;
  iconKey: string;
  sortOrder: number;
}

interface StatTotalRow {
  statId: string;
  total: number;
}

interface StatBreakdownRow {
  sourceKey: string;
  statId: string;
  amount: number;
}

// Distinct unicode glyphs per stat — readable on all mobile platforms without
// requiring emoji fonts. Each is visually distinguishable from the others.
const STAT_GLYPH: Record<string, string> = {
  vigor: '♥',
  power: '✦',
  focus: '◎',
  fortune: '✧',
};

export default function CharacterTab() {
  const [statDefs, defsReady] = useTable(tables.statDefinition);
  const [totals, totalsReady] = useTable(tables.myStatTotals);
  const [breakdown, breakdownReady] = useTable(tables.myStatBreakdown);
  const [skillDefs] = useTable(tables.skillDefinition);
  const [itemInstances] = useTable(tables.myItemInstances);
  const [itemDefs] = useTable(tables.itemDefinition);
  const [playerStates] = useTable(tables.myPlayerState);
  const [visibleTrees] = useTable(tables.myVisibleSkillTrees);

  const [equippedClassRows] = useTable(tables.myEquippedClass);
  const equipClassReducer = useReducer(reducers.equipClass);
  const unequipClassReducer = useReducer(reducers.unequipClass);
  const doEquipClass = useCallback(async (classId: string): Promise<void> => {
    equipClassReducer({ classId });
  }, [equipClassReducer]);
  const doUnequipClass = useCallback(async (): Promise<void> => {
    unequipClassReducer();
  }, [unequipClassReducer]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [equipModalOpen, setEquipModalOpen] = useState(false);

  const sortedDefs = useMemo(() => {
    return [...(statDefs as StatDefRow[])].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
  }, [statDefs]);

  const playerLocation = playerStates[0]?.location ?? '';
  const inMinigame =
    playerLocation.startsWith('defensive_battle:') ||
    playerLocation.startsWith('minigame:');

  const equippedClassId = equippedClassRows[0]?.classId ?? '';

  const unlockedClassTrees = useMemo<ClassTreeRef[]>(
    () =>
      [...visibleTrees]
        .filter(t => CLASS_TREE_IDS.has(t.treeId))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(t => ({ treeId: t.treeId, displayName: t.displayName })),
    [visibleTrees]
  );

  const equippedDisplayName = useMemo(() => {
    if (equippedClassId === '') return '';
    return (
      unlockedClassTrees.find(c => c.treeId === equippedClassId)?.displayName ??
      equippedClassId
    );
  }, [equippedClassId, unlockedClassTrees]);

  const totalByStat = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of totals as StatTotalRow[]) m.set(t.statId, t.total);
    return m;
  }, [totals]);

  const breakdownByStat = useMemo(() => {
    const m = new Map<string, StatBreakdownRow[]>();
    for (const row of breakdown as StatBreakdownRow[]) {
      const list = m.get(row.statId);
      if (list) list.push(row);
      else m.set(row.statId, [row]);
    }
    return m;
  }, [breakdown]);

  const skillNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of skillDefs) m.set(s.skillId, s.name);
    return m;
  }, [skillDefs]);

  const itemNameByInstanceId = useMemo(() => {
    const defByDefId = new Map<string, string>();
    for (const d of itemDefs) defByDefId.set(d.itemDefId, d.displayName);
    const m = new Map<string, string>();
    for (const inst of itemInstances) {
      const name = defByDefId.get(inst.itemDefId);
      if (name) m.set(inst.instanceId.toString(), name);
    }
    return m;
  }, [itemInstances, itemDefs]);

  const isLoading = !defsReady || !totalsReady || !breakdownReady;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <Text className="text-sm text-slate-500">Loading stats…</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      className="flex-1 bg-slate-950"
      contentContainerStyle={{ padding: 16, gap: 8 }}
    >
      <ClassEquipSection
        equippedClassId={equippedClassId}
        equippedDisplayName={equippedDisplayName}
        unlockedClasses={unlockedClassTrees}
        inMinigame={inMinigame}
        onChangePress={() => setEquipModalOpen(true)}
      />

      <View className="mb-1">
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Character
        </Text>
        <Text className="mt-0.5 text-lg font-semibold text-slate-100">
          Core Stats
        </Text>
        <Text className="mt-1 text-xs leading-4 text-slate-500">
          Bonuses from skills, gear, and other sources combine into four core stats.
          Tap a stat to see where the points came from.
        </Text>
      </View>

      {sortedDefs.map(def => {
        const total = totalByStat.get(def.statId) ?? 0;
        const sources = breakdownByStat.get(def.statId) ?? [];
        const isExpanded = expandedId === def.statId;
        return (
          <StatRow
            key={def.statId}
            def={def}
            total={total}
            sources={sources}
            skillNameById={skillNameById}
            itemNameByInstanceId={itemNameByInstanceId}
            expanded={isExpanded}
            onToggle={() => setExpandedId(isExpanded ? null : def.statId)}
          />
        );
      })}
    </ScrollView>

    <ClassEquipModal
      visible={equipModalOpen}
      onClose={() => setEquipModalOpen(false)}
      equippedClassId={equippedClassId}
      unlockedClasses={unlockedClassTrees}
      inMinigame={inMinigame}
      onEquip={doEquipClass}
      onUnequip={doUnequipClass}
    />
    </>
  );
}

// ---------------------------------------------------------------------------
// ClassEquipSection — top-of-CharacterTab class badge + change button
// ---------------------------------------------------------------------------

function ClassEquipSection({
  equippedClassId,
  equippedDisplayName,
  unlockedClasses,
  inMinigame,
  onChangePress,
}: {
  equippedClassId: string;
  equippedDisplayName: string;
  unlockedClasses: ClassTreeRef[];
  inMinigame: boolean;
  onChangePress: () => void;
}) {
  return (
    <View className="rounded-xl border border-slate-800 bg-slate-900/70 overflow-hidden">
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="flex-1">
          <Text className="text-xs uppercase tracking-widest text-slate-500">Class</Text>
          <View className="flex-row items-center gap-2 mt-1 flex-wrap">
            {equippedClassId !== '' ? (
              <>
                <Text
                  className={`text-base ${CLASS_ACCENT_TEXT[equippedClassId] ?? 'text-amber-300'}`}
                >
                  {CLASS_GLYPH[equippedClassId] ?? '?'}
                </Text>
                <Text className="text-base font-semibold text-slate-100">
                  {equippedDisplayName}
                </Text>
                <View className="rounded-full bg-amber-500/15 px-2 py-0.5">
                  <Text className="text-[10px] text-amber-300">◉ Active</Text>
                </View>
              </>
            ) : unlockedClasses.length > 0 ? (
              <Text className="text-sm text-slate-500 mt-0.5">
                None equipped — {unlockedClasses.length} available
              </Text>
            ) : (
              <Text className="text-sm text-slate-500 mt-0.5">
                Locked — master a stat to unlock a class
              </Text>
            )}
          </View>
        </View>
        <SafePressable
          onPress={onChangePress}
          disabled={inMinigame || unlockedClasses.length === 0}
          accessibilityLabel={
            inMinigame
              ? 'Cannot change class during minigame'
              : unlockedClasses.length === 0
                ? 'No classes unlocked yet'
                : 'Change equipped class'
          }
          className={`rounded-lg px-3 py-2 border ml-3 ${
            inMinigame || unlockedClasses.length === 0
              ? 'border-slate-800 bg-slate-800'
              : 'border-amber-500/30 bg-amber-500/10'
          }`}
        >
          <Text
            className={`text-xs font-medium ${
              inMinigame || unlockedClasses.length === 0 ? 'text-slate-600' : 'text-amber-300'
            }`}
          >
            {inMinigame ? 'Locked' : unlockedClasses.length === 0 ? '—' : 'Change'}
          </Text>
        </SafePressable>
      </View>
    </View>
  );
}

interface StatRowProps {
  def: StatDefRow;
  total: number;
  sources: StatBreakdownRow[];
  skillNameById: Map<string, string>;
  itemNameByInstanceId: Map<string, string>;
  expanded: boolean;
  onToggle: () => void;
}

function StatRow({
  def,
  total,
  sources,
  skillNameById,
  itemNameByInstanceId,
  expanded,
  onToggle,
}: StatRowProps) {
  // Scale-only flash. Color stays driven by `total === 0` (resting state),
  // which avoids interpolating between two different resting colors when a
  // stat goes from 0 to non-zero (or back) — that would produce a wrong
  // start color on the most visually important transition.
  const flash = useRef(new Animated.Value(0)).current;
  const expandFade = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const prevTotal = useRef(total);
  const [renderBreakdown, setRenderBreakdown] = useState(expanded);

  useEffect(() => {
    if (total !== prevTotal.current) {
      prevTotal.current = total;
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
  }, [total, flash]);

  useEffect(() => {
    if (expanded) setRenderBreakdown(true);
    Animated.timing(expandFade, {
      toValue: expanded ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !expanded) setRenderBreakdown(false);
    });
  }, [expanded, expandFade]);

  const totalScale = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.18],
  });

  const isZero = total === 0;
  const glyph = STAT_GLYPH[def.statId] ?? def.displayName[0] ?? '?';

  return (
    <View
      className={`overflow-hidden rounded-xl border ${
        expanded
          ? 'border-amber-500/50 bg-slate-900'
          : 'border-slate-800 bg-slate-900/70'
      }`}
    >
      <SafePressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${def.displayName}, total ${total}, tap to ${
          expanded ? 'collapse' : 'expand'
        } breakdown`}
        className="flex-row items-center gap-3 px-4 py-3"
      >
        <View
          className={`h-9 w-9 items-center justify-center rounded-lg ${
            isZero
              ? 'bg-slate-800'
              : 'bg-amber-500/15 border border-amber-500/30'
          }`}
        >
          <Text
            className={`text-sm font-bold ${
              isZero ? 'text-slate-600' : 'text-amber-300'
            }`}
          >
            {glyph}
          </Text>
        </View>
        <Text
          className={`flex-1 text-base font-semibold ${
            isZero ? 'text-slate-500' : 'text-slate-100'
          }`}
        >
          {def.displayName}
        </Text>
        <Animated.Text
          style={{
            color: isZero ? '#64748b' : '#fbbf24',
            transform: [{ scale: totalScale }],
            fontSize: 18,
            fontWeight: '700',
          }}
        >
          {total}
        </Animated.Text>
        <Text
          className={`ml-1 text-xs ${
            expanded ? 'text-amber-400' : 'text-slate-500'
          }`}
        >
          {expanded ? '▾' : '▸'}
        </Text>
      </SafePressable>

      {renderBreakdown ? (
        <Animated.View style={{ opacity: expandFade }}>
          <View className="border-t border-slate-800 bg-slate-950/40 px-4 py-3">
            <Text className="text-xs italic leading-4 text-slate-400">
              {def.description}
            </Text>
            <View className="mt-3 gap-1.5">
              {sources.length === 0 ? (
                <Text className="text-xs text-slate-500">
                  No sources yet — invest in skills or equip gear that grants{' '}
                  {def.displayName}.
                </Text>
              ) : (
                sources.map(s => (
                  <BreakdownLine
                    key={s.sourceKey}
                    row={s}
                    skillNameById={skillNameById}
                    itemNameByInstanceId={itemNameByInstanceId}
                  />
                ))
              )}
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

interface BreakdownLineProps {
  row: StatBreakdownRow;
  skillNameById: Map<string, string>;
  itemNameByInstanceId: Map<string, string>;
}

function BreakdownLine({ row, skillNameById, itemNameByInstanceId }: BreakdownLineProps) {
  const { label, resolved } = useMemo(
    () => resolveSourceLabel(row.sourceKey, skillNameById, itemNameByInstanceId),
    [row.sourceKey, skillNameById, itemNameByInstanceId]
  );
  const positive = row.amount > 0;
  const sign = positive ? '+' : '';

  return (
    <View
      className="flex-row items-center justify-between"
      accessibilityLabel={`${label}, ${
        positive ? 'plus' : 'minus'
      } ${Math.abs(row.amount)}`}
    >
      <Text
        className={`flex-1 text-xs ${
          resolved ? 'text-slate-300' : 'font-mono text-slate-500'
        }`}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        className={`text-xs font-semibold ${
          row.amount === 0
            ? 'text-slate-500'
            : positive
            ? 'text-emerald-400'
            : 'text-rose-400'
        }`}
      >
        {sign}
        {row.amount}
      </Text>
    </View>
  );
}

// sourceKey format: {username}:{kind}:{refId}[:{statId}]
// We ignore the username (it's always the calling player) and resolve {kind}:{refId}.
function resolveSourceLabel(
  sourceKey: string,
  skillNameById: Map<string, string>,
  itemNameByInstanceId: Map<string, string>
): { label: string; resolved: boolean } {
  const parts = sourceKey.split(':');
  if (parts.length < 3) return { label: sourceKey, resolved: false };
  const kind = parts[1];
  const refId = parts[2];
  if (kind === 'skill') {
    const name = skillNameById.get(refId);
    if (name) return { label: `Skill: ${name}`, resolved: true };
    return { label: sourceKey, resolved: false };
  }
  if (kind === 'equipment') {
    const name = itemNameByInstanceId.get(refId);
    if (name) return { label: name, resolved: true };
    return { label: sourceKey, resolved: false };
  }
  // Class source keys: {username}:class:{classId}:{skillId}:{...}
  if (kind === 'class') {
    const classId = refId; // parts[2]
    const skillId = parts[3]; // may be undefined for coarser source keys
    const skillName = skillId ? skillNameById.get(skillId) : undefined;
    const classLabel = classId.charAt(0).toUpperCase() + classId.slice(1);
    if (skillName) return { label: `${classLabel}: ${skillName}`, resolved: true };
    return { label: `Class (${classLabel})`, resolved: true };
  }
  return { label: sourceKey, resolved: false };
}
