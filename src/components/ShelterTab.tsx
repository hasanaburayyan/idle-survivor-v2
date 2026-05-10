import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { ActivityGrid, type ActivityDef } from './ActivityGrid';
import StructureDetailScreen from './StructureDetailScreen';
import ArmoryScreen from './ArmoryScreen';
import ClassCraftingScreen from './ClassCraftingScreen';
import ShelterFloorPlan from './shelter/ShelterFloorPlan';
import StructureBar from './shelter/StructureBar';
import RefineryPage from './shelter/RefineryPage';
import SmelterPage from './shelter/SmelterPage';
import GardenPage from './shelter/GardenPage';

const SHELTER_LOCATION_KEY = 'the_shelter';

export default function ShelterTab() {
  const [activities] = useTable(tables.myShelterActivities);
  const [activityState] = useTable(tables.myActivityState);
  const [structures] = useTable(tables.myStructures);
  const [structureDefs] = useTable(tables.structureDefinition);

  // Two pieces of view state:
  // - selectedStructureId: which structure page is active. Null = floor plan.
  // - selectedActivityId: which build-progress Activity is being focused.
  //   Activities are NOT structures; they render via the existing ActivityGrid
  //   rather than a dedicated page.
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);

  const shelterBuilt =
    (activityState.find((a) => a.activityId === 'build_shelter')?.timesUsed ?? 0) >= 1;

  if (!shelterBuilt) {
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2">
        <Text className="text-5xl">🏚</Text>
        <Text className="text-xs uppercase tracking-widest text-slate-500">Shelter</Text>
        <Text className="text-sm text-slate-400 text-center">
          Build your shelter in The Wastes to unlock this menu.
        </Text>
      </View>
    );
  }

  const sortedActivities = ([...activities] as ActivityDef[]).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  // Helper to render a specific structure's page when one is selected.
  const renderStructurePage = (structureId: string) => {
    if (structureId === 'refinery') return <RefineryPage />;
    if (structureId === 'smelter') return <SmelterPage />;
    if (structureId === 'garden') return <GardenPage />;
    if (structureId === 'armory') {
      return <ArmoryScreen onBack={() => setSelectedStructureId(null)} />;
    }
    if (structureId === 'class_crafting') {
      return <ClassCraftingScreen onBack={() => setSelectedStructureId(null)} />;
    }
    // Fall back to generic detail screen (workbench).
    const playerStructure = structures.find((s) => s.structureId === structureId);
    const def = structureDefs.find((d) => d.structureId === structureId);
    if (!playerStructure || !def) return null;
    return (
      <StructureDetailScreen
        def={def}
        state={playerStructure}
        onBack={() => setSelectedStructureId(null)}
      />
    );
  };

  // Activity-focused view: an activity (e.g. Build Workbench construction site)
  // was tapped on the floor plan. Render the existing ActivityGrid scoped to
  // just that activity, with a back affordance.
  if (selectedActivityId) {
    const activity = sortedActivities.find((a) => a.activityId === selectedActivityId);
    if (!activity) {
      // Activity disappeared (built or otherwise) — bail back to floor plan.
      setSelectedActivityId(null);
      return null;
    }
    return (
      <View className="flex-1">
        <StructureBar
          selectedStructureId={null}
          onSelectStructure={(id) => {
            setSelectedActivityId(null);
            setSelectedStructureId(id);
          }}
        />
        <View className="px-4 pt-3 pb-1">
          <Text className="text-[11px] uppercase tracking-widest text-slate-500">
            Construction Site
          </Text>
          <Text className="text-sm font-semibold text-slate-100">{activity.name}</Text>
        </View>
        <ActivityGrid activities={[activity]} activityState={activityState} />
      </View>
    );
  }

  // Structure-focused view: the bar is sticky at the top, page renders below.
  if (selectedStructureId) {
    return (
      <View className="flex-1">
        <StructureBar
          selectedStructureId={selectedStructureId}
          onSelectStructure={(id) => setSelectedStructureId(id)}
        />
        {renderStructurePage(selectedStructureId)}
      </View>
    );
  }

  // Floor plan (default Shelter view).
  return (
    <View className="flex-1">
      <StructureBar
        selectedStructureId={null}
        onSelectStructure={(id) => setSelectedStructureId(id)}
      />
      <ShelterFloorPlan
        shelterActivities={sortedActivities.map((a) => ({
          activityId: a.activityId,
          name: a.name,
          icon: a.icon,
          progressTarget: a.progressTarget,
        }))}
        activityState={activityState.map((a) => ({
          activityId: a.activityId,
          progress: a.progress,
          timesUsed: a.timesUsed,
        }))}
        onSelectStructure={(id) => setSelectedStructureId(id)}
        onSelectActivity={(id) => setSelectedActivityId(id)}
      />
    </View>
  );
}
