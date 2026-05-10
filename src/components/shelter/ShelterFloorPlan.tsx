import { ScrollView, Text, View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import SafePressable from '../SafePressable';
import { tables } from '../../module_bindings';
import {
  CONSTRUCTION_SITE_LAYOUT,
  SHELTER_LAYOUT,
  findStructureLayout,
} from './structureLayout';
import { useStructureStatuses } from './useStructureStatuses';
import StructureStatusBadge from './StructureStatusBadge';

interface Props {
  /** Activities visible at the shelter location (used to render unbuilt construction sites). */
  shelterActivities: Array<{
    activityId: string;
    name: string;
    icon: string;
    progressTarget: bigint;
  }>;
  activityState: Array<{ activityId: string; progress: bigint; timesUsed: number }>;
  onSelectStructure: (id: string) => void;
  onSelectActivity: (id: string) => void;
}

// The Shelter "home" view. Shows built structures as tiles and unbuilt
// construction sites as progress-bar tiles. Tapping a structure opens its
// page; tapping a construction site opens its build flow (handled by
// onSelectActivity, which surfaces the existing build UI).
export default function ShelterFloorPlan({
  shelterActivities,
  activityState,
  onSelectStructure,
  onSelectActivity,
}: Props) {
  const [structures] = useTable(tables.myStructures);
  const [structureDefs] = useTable(tables.structureDefinition);
  const statuses = useStructureStatuses();

  const builtIds = new Set(structures.map((s) => s.structureId));

  // Group tiles by row for layout. Each row gets its own flex line.
  const maxRow = Math.max(
    ...SHELTER_LAYOUT.map((s) => s.row),
    ...Object.values(CONSTRUCTION_SITE_LAYOUT).map((p) => p.row),
    0,
  );

  const rows: Array<Array<{ key: string; render: () => React.ReactNode; col: number }>> = [];
  for (let r = 0; r <= maxRow; r++) rows.push([]);

  for (const layout of SHELTER_LAYOUT) {
    if (!builtIds.has(layout.structureId)) continue;
    const def = structureDefs.find((d) => d.structureId === layout.structureId);
    if (!def) continue;
    const status = statuses[layout.structureId] ?? 'idle';
    rows[layout.row].push({
      key: `s_${layout.structureId}`,
      col: layout.col,
      render: () => (
        <StructureTile
          key={`s_${layout.structureId}`}
          icon={def.icon}
          name={def.name}
          accent={layout.accent}
          status={status}
          onPress={() => onSelectStructure(layout.structureId)}
        />
      ),
    });
  }

  for (const activity of shelterActivities) {
    const layout = CONSTRUCTION_SITE_LAYOUT[activity.activityId];
    if (!layout) continue;
    // Skip construction site if the structure already exists (built tile takes its slot).
    const matchingStructureLayout = SHELTER_LAYOUT.find(
      (s) => s.col === layout.col && s.row === layout.row,
    );
    if (matchingStructureLayout && builtIds.has(matchingStructureLayout.structureId)) continue;
    const state = activityState.find((a) => a.activityId === activity.activityId);
    const progress = state?.progress ?? 0n;
    const target = activity.progressTarget;
    const pct = target > 0n ? Math.min(100, Number((progress * 100n) / target)) : 0;
    rows[layout.row].push({
      key: `a_${activity.activityId}`,
      col: layout.col,
      render: () => (
        <ConstructionSiteTile
          key={`a_${activity.activityId}`}
          icon={activity.icon}
          name={activity.name}
          progressPct={pct}
          progress={progress}
          target={target}
          onPress={() => onSelectActivity(activity.activityId)}
        />
      ),
    });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View className="mb-2">
        <Text className="text-xs uppercase tracking-widest text-slate-500">The Shelter</Text>
        <Text className="text-xs text-slate-400">
          Tap a structure to open it. Construction sites show their build progress.
        </Text>
      </View>

      {rows.map((row, idx) => {
        if (row.length === 0) return null;
        return (
          <View key={`row_${idx}`} className="flex-row flex-wrap gap-3">
            {row.sort((a, b) => a.col - b.col).map((cell) => cell.render())}
          </View>
        );
      })}

      {/* Empty-state hint when no structures built yet. */}
      {builtIds.size === 0 && shelterActivities.length === 0 ? (
        <View className="items-center py-8 gap-2">
          <Text className="text-4xl">🏚</Text>
          <Text className="text-xs text-slate-500 text-center">
            Empty for now. New construction sites unlock as you progress.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

interface StructureTileProps {
  icon: string;
  name: string;
  accent: string;
  status: ReturnType<typeof useStructureStatuses>[string];
  onPress: () => void;
}

function StructureTile({ icon, name, accent, status, onPress }: StructureTileProps) {
  return (
    <SafePressable
      onPress={onPress}
      className={`rounded-2xl bg-slate-900 border-2 ${accent} p-4 min-w-[140px] flex-1 max-w-[220px]`}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-3xl">{icon}</Text>
        <StructureStatusBadge status={status} />
      </View>
      <Text className="text-sm font-semibold text-slate-100 mt-2">{name}</Text>
    </SafePressable>
  );
}

interface ConstructionSiteTileProps {
  icon: string;
  name: string;
  progressPct: number;
  progress: bigint;
  target: bigint;
  onPress: () => void;
}

function ConstructionSiteTile({
  icon,
  name,
  progressPct,
  progress,
  target,
  onPress,
}: ConstructionSiteTileProps) {
  return (
    <SafePressable
      onPress={onPress}
      className="rounded-2xl bg-slate-950 border-2 border-dashed border-slate-700 p-4 min-w-[140px] flex-1 max-w-[220px]"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-3xl opacity-60">{icon}</Text>
        <Text className="text-[10px] uppercase tracking-widest text-slate-500">Build</Text>
      </View>
      <Text className="text-sm font-semibold text-slate-200 mt-2">{name}</Text>
      <View className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <View className="h-full bg-amber-500" style={{ width: `${progressPct}%` }} />
      </View>
      <Text className="text-[10px] text-slate-500 mt-1">
        {progress.toString()} / {target.toString()}
      </Text>
    </SafePressable>
  );
}
