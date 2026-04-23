import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';

const NODE_WIDTH = 150;
const NODE_HEIGHT = 120;
const CANVAS_PADDING = 80;

interface SkillDef {
  skillId: string;
  name: string;
  description: string;
  maxLevel: number;
  prerequisiteSkillId: string;
  prerequisiteLevel: number;
  positionX: number;
  positionY: number;
  sortOrder: number;
}

export default function SkillTreeTab() {
  const [definitions] = useTable(tables.skillDefinition);
  const [mySkills] = useTable(tables.mySkills);
  const [playerStates] = useTable(tables.myPlayerState);
  const upgrade = useReducer(reducers.upgradeSkill);

  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const skillPoints = playerStates[0]?.skillPoints ?? 0;

  const levelBySkill = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of mySkills) map.set(s.skillId, s.level);
    return map;
  }, [mySkills]);

  const sorted = useMemo(
    () =>
      [...definitions].sort((a, b) => a.sortOrder - b.sortOrder) as SkillDef[],
    [definitions]
  );

  const visible = useMemo(() => {
    return sorted.filter(def => {
      if (def.prerequisiteSkillId === '') return true;
      const prereqLevel = levelBySkill.get(def.prerequisiteSkillId) ?? 0;
      return prereqLevel >= def.prerequisiteLevel;
    });
  }, [sorted, levelBySkill]);

  const visibleIds = useMemo(
    () => new Set(visible.map(d => d.skillId)),
    [visible]
  );

  const canvasWidth = useMemo(() => {
    if (visible.length === 0) return 0;
    const maxX = Math.max(...visible.map(d => d.positionX));
    return maxX + NODE_WIDTH + CANVAS_PADDING * 2;
  }, [visible]);

  const canvasHeight = useMemo(() => {
    if (visible.length === 0) return 0;
    const maxY = Math.max(...visible.map(d => d.positionY));
    return maxY + NODE_HEIGHT + CANVAS_PADDING * 2;
  }, [visible]);

  const onUpgrade = async (skillId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await upgrade({ skillId });
    } catch {
      /* swallow — error surfaces in server logs */
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

  const selectedDef = selected
    ? sorted.find(d => d.skillId === selected)
    : null;
  const selectedLevel = selectedDef
    ? levelBySkill.get(selectedDef.skillId) ?? 0
    : 0;
  const selectedAtMax = selectedDef
    ? selectedLevel >= selectedDef.maxLevel
    : false;
  const selectedPrereqMet = selectedDef
    ? selectedDef.prerequisiteSkillId === '' ||
      (levelBySkill.get(selectedDef.prerequisiteSkillId) ?? 0) >=
        selectedDef.prerequisiteLevel
    : false;
  const canAfford = skillPoints >= 1;

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-6 py-3 border-b border-slate-800">
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Skill Tree
        </Text>
        <Text className="text-sm text-slate-300">
          {skillPoints} point{skillPoints === 1 ? '' : 's'}
        </Text>
      </View>
      <ScrollView
        horizontal
        contentContainerStyle={{ minWidth: canvasWidth }}
        showsHorizontalScrollIndicator={false}
      >
        <ScrollView
          contentContainerStyle={{ minHeight: canvasHeight }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: canvasWidth, height: canvasHeight }}>
            {visible.map(def => {
              if (def.prerequisiteSkillId === '') return null;
              if (!visibleIds.has(def.prerequisiteSkillId)) return null;
              const prereq = sorted.find(
                d => d.skillId === def.prerequisiteSkillId
              );
              if (!prereq) return null;
              return (
                <Connector
                  key={`c-${def.skillId}`}
                  from={{
                    x: prereq.positionX + CANVAS_PADDING + NODE_WIDTH / 2,
                    y: prereq.positionY + CANVAS_PADDING + NODE_HEIGHT / 2,
                  }}
                  to={{
                    x: def.positionX + CANVAS_PADDING + NODE_WIDTH / 2,
                    y: def.positionY + CANVAS_PADDING + NODE_HEIGHT / 2,
                  }}
                />
              );
            })}
            {visible.map(def => {
              const level = levelBySkill.get(def.skillId) ?? 0;
              return (
                <SkillNode
                  key={def.skillId}
                  def={def}
                  level={level}
                  selected={selected === def.skillId}
                  onPress={() => setSelected(def.skillId)}
                />
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>
      {selectedDef ? (
        <View className="px-6 py-4 border-t border-slate-800 bg-slate-900 gap-2">
          <Text className="text-sm font-semibold text-slate-100">
            {selectedDef.name}{' '}
            <Text className="text-xs text-slate-400">
              Lv {selectedLevel} / {selectedDef.maxLevel}
            </Text>
          </Text>
          <Text className="text-xs text-slate-400">
            {selectedDef.description}
          </Text>
          <Pressable
            disabled={busy || !canAfford || selectedAtMax || !selectedPrereqMet}
            onPress={() => onUpgrade(selectedDef.skillId)}
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
                    ? 'Need a skill point'
                    : selectedLevel === 0
                      ? 'Unlock · 1 point'
                      : 'Upgrade · 1 point'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SkillNode({
  def,
  level,
  selected,
  onPress,
}: {
  def: SkillDef;
  level: number;
  selected: boolean;
  onPress: () => void;
}) {
  const unlocked = level > 0;
  const borderClass = selected
    ? 'border-amber-400'
    : unlocked
      ? 'border-emerald-500'
      : 'border-slate-700';
  const bgClass = unlocked ? 'bg-slate-900' : 'bg-slate-950';
  return (
    <Pressable
      onPress={onPress}
      style={{
        position: 'absolute',
        left: def.positionX + CANVAS_PADDING,
        top: def.positionY + CANVAS_PADDING,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
      className={`rounded-xl border-2 p-3 ${borderClass} ${bgClass}`}
    >
      <Text
        className="text-xs font-semibold text-slate-100"
        numberOfLines={2}
      >
        {def.name}
      </Text>
      <View className="mt-auto">
        <Text className="text-[11px] text-slate-400">
          {unlocked ? `Lv ${level} / ${def.maxLevel}` : 'Locked'}
        </Text>
      </View>
    </Pressable>
  );
}

function Connector({
  from,
  to,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  return (
    <View
      style={{
        position: 'absolute',
        left: midX - length / 2,
        top: midY - 1,
        width: length,
        height: 2,
        backgroundColor: '#334155',
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}
