import { ScrollView, Text, View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { ActivityGrid, type ActivityDef } from './ActivityGrid';

// Always-visible left panel. Houses the Scavenge cookie + any build cards
// the player has currently unlocked but not yet completed. When nothing's
// in progress, the panel is just Scavenge — the cleanest possible idle hub.
//
// Subscribes to myAvailableActivities (server-filtered: skill prereq +
// maxUses + shelter-built gate). Build cards appear and disappear without
// any client-side filtering.
export default function ScavengePanel() {
  const [activities] = useTable(tables.myAvailableActivities);
  const [activityState] = useTable(tables.myActivityState);

  const sorted = ([...activities] as ActivityDef[]).sort((a, b) => {
    // Pin scavenge first; everything else by sortOrder.
    if (a.activityId === 'scavenge') return -1;
    if (b.activityId === 'scavenge') return 1;
    return a.sortOrder - b.sortOrder;
  });

  const buildCount = sorted.filter(a => a.kind === 'build_progress').length;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
      <View>
        <Text className="text-[10px] uppercase tracking-widest text-slate-500">
          The Wastes
        </Text>
      </View>
      <ActivityGrid activities={sorted} activityState={activityState} layout="stack" />
      {buildCount === 0 ? (
        <Text className="text-[10px] text-slate-600 text-center mt-2">
          New construction sites appear here as you unlock them.
        </Text>
      ) : null}
    </ScrollView>
  );
}
