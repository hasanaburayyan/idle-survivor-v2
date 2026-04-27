import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import SafePressable from './SafePressable';
import Svg, { Line } from 'react-native-svg';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';

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
}

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
  const upgrade = useReducer(reducers.upgradeSkill);

  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const skillPoints = playerStates[0]?.skillPoints ?? 0;
  const playerLevel = playerStates[0]?.playerLevel ?? 0;

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

  const allPrereqsMet = (def: SkillDef): boolean => {
    if (def.prerequisiteSkillId !== '') {
      const lvl = levelBySkill.get(def.prerequisiteSkillId) ?? 0;
      if (lvl < def.prerequisiteLevel) return false;
    }
    if (def.prerequisitePlayerLevel > 0 && playerLevel < def.prerequisitePlayerLevel) {
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

  const visible = useMemo(() => {
    return sorted.filter(def => allPrereqsMet(def));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, levelBySkill, extraPrereqsBySkill, playerLevel]);

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

  const selectedDef = selected
    ? sorted.find(d => d.skillId === selected) ?? null
    : null;
  const selectedLevel = selectedDef
    ? levelBySkill.get(selectedDef.skillId) ?? 0
    : 0;
  const selectedAtMax = selectedDef
    ? selectedLevel >= selectedDef.maxLevel
    : false;
  const selectedPrereqMet = selectedDef ? allPrereqsMet(selectedDef) : false;
  const selectedCost = selectedDef?.costSkillPoints ?? 1;
  const canAfford = skillPoints >= selectedCost;

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
            return (
              <SkillNode
                key={def.skillId}
                def={def}
                level={level}
                selected={selected === def.skillId}
                onPress={() => setSelected(def.skillId)}
                x={originX + pos.x - NODE_DIAMETER / 2}
                y={originY + pos.y - NODE_DIAMETER / 2}
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
          <SafePressable
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
    </View>
  );
}

function SkillNode({
  def,
  level,
  selected,
  onPress,
  x,
  y,
}: {
  def: SkillDef;
  level: number;
  selected: boolean;
  onPress: () => void;
  x: number;
  y: number;
}) {
  const unlocked = level > 0;
  const borderClass = selected
    ? 'border-amber-400'
    : unlocked
      ? 'border-emerald-500'
      : 'border-slate-700';
  const bgClass = unlocked ? 'bg-slate-900' : 'bg-slate-950';
  const glow = unlocked
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
      onPress={onPress}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: NODE_DIAMETER,
        height: NODE_DIAMETER,
        borderRadius: NODE_DIAMETER / 2,
        ...(glow ?? {}),
      }}
      className={`items-center justify-center border-2 px-2 ${borderClass} ${bgClass}`}
    >
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
      ) : (
        <Text className="text-[9px] text-slate-500 mt-1">Locked</Text>
      )}
    </SafePressable>
  );
}
