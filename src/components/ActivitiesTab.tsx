import { ScrollView } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { ActivityGrid, type ActivityDef } from './ActivityGrid';

export default function ActivitiesTab() {
  const [activities] = useTable(tables.myVisibleActivities);
  const [activityState] = useTable(tables.myActivityState);

  const sorted = ([...activities] as ActivityDef[]).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ActivityGrid activities={sorted} activityState={activityState} />
    </ScrollView>
  );
}
