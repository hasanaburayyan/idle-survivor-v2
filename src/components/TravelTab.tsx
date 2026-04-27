import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';

interface LocationDef {
  locationKey: string;
  name: string;
  icon: string;
  description: string;
  sortOrder: number;
  prerequisiteActivityId: string;
  prerequisiteActivityUses: number;
}

export default function TravelTab() {
  const [travelable] = useTable(tables.myTravelableLocations);
  const [playerStates] = useTable(tables.myPlayerState);

  const currentKey = playerStates[0]?.location ?? 'the_wastes';
  const sorted = ([...travelable] as LocationDef[]).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text className="text-xs uppercase tracking-widest text-slate-500">
        Destinations
      </Text>
      {sorted.map(loc => (
        <LocationCard
          key={loc.locationKey}
          loc={loc}
          isCurrent={loc.locationKey === currentKey}
        />
      ))}
    </ScrollView>
  );
}

function LocationCard({
  loc,
  isCurrent,
}: {
  loc: LocationDef;
  isCurrent: boolean;
}) {
  const travel = useReducer(reducers.travelTo);
  const [busy, setBusy] = useState(false);

  const onTravel = async () => {
    if (busy || isCurrent) return;
    setBusy(true);
    try {
      await travel({ location: loc.locationKey });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      className={`rounded-2xl border px-5 py-4 gap-3 ${
        isCurrent
          ? 'border-amber-400 bg-slate-900'
          : 'border-slate-800 bg-slate-900'
      }`}
    >
      <View className="flex-row items-center gap-3">
        <Text className="text-3xl">{loc.icon}</Text>
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-100">
            {loc.name}
          </Text>
          <Text className="text-xs text-slate-400 mt-0.5">
            {loc.description}
          </Text>
        </View>
      </View>
      <SafePressable
        onPress={onTravel}
        disabled={busy || isCurrent}
        className={`rounded-lg py-2 items-center ${
          isCurrent ? 'bg-slate-800' : 'bg-emerald-500'
        }`}
      >
        <Text
          className={`text-sm font-medium ${
            isCurrent ? 'text-slate-500' : 'text-slate-950'
          }`}
        >
          {isCurrent ? 'You are here' : busy ? 'Traveling…' : 'Travel'}
        </Text>
      </SafePressable>
    </View>
  );
}
