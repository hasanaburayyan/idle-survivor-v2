import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { ActivityGrid, type ActivityDef } from './ActivityGrid';
import StructureCard from './StructureCard';
import StructureDetailScreen from './StructureDetailScreen';
import ArmoryScreen from './ArmoryScreen';
import ClassCraftingScreen from './ClassCraftingScreen';

const SHELTER_LOCATION_KEY = 'the_shelter';

export default function ShelterTab() {
  const [activities] = useTable(tables.myShelterActivities);
  const [activityState] = useTable(tables.myActivityState);
  const [structures] = useTable(tables.myStructures);
  const [structureDefs] = useTable(tables.structureDefinition);
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(
    null
  );

  const shelterBuilt =
    (activityState.find(a => a.activityId === 'build_shelter')?.timesUsed ??
      0) >= 1;

  if (!shelterBuilt) {
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2">
        <Text className="text-5xl">🏚</Text>
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Shelter
        </Text>
        <Text className="text-sm text-slate-400 text-center">
          Build your shelter in The Wastes to unlock this menu.
        </Text>
      </View>
    );
  }

  const sortedActivities = ([...activities] as ActivityDef[]).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
  const visibleStructures = structures
    .map(s => {
      const def = structureDefs.find(d => d.structureId === s.structureId);
      return def ? { state: s, def } : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .filter(v => v.def.locationKey === SHELTER_LOCATION_KEY)
    .sort((a, b) => a.def.sortOrder - b.def.sortOrder);

  if (selectedStructureId) {
    const selected = visibleStructures.find(
      s => s.def.structureId === selectedStructureId
    );
    if (selected) {
      if (selected.def.structureId === 'armory') {
        return <ArmoryScreen onBack={() => setSelectedStructureId(null)} />;
      }
      if (selected.def.structureId === 'class_crafting') {
        return <ClassCraftingScreen onBack={() => setSelectedStructureId(null)} />;
      }
      return (
        <StructureDetailScreen
          def={selected.def}
          state={selected.state}
          onBack={() => setSelectedStructureId(null)}
        />
      );
    }
    // Selected structure no longer visible (e.g. data desync) — fall through to list.
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ActivityGrid activities={sortedActivities} activityState={activityState} />
      {visibleStructures.map(s => (
        <StructureCard
          key={s.state.id.toString()}
          state={s.state}
          def={s.def}
          onSelect={() => setSelectedStructureId(s.def.structureId)}
        />
      ))}
    </ScrollView>
  );
}
