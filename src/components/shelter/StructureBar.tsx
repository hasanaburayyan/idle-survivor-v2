import { ScrollView, Text, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useTable } from 'spacetimedb/react';
import { tables } from '../../module_bindings';
import { STRUCTURE_BAR_ORDER } from './structureLayout';
import { useStructureStatuses } from './useStructureStatuses';
import StructureStatusBadge from './StructureStatusBadge';

interface Props {
  selectedStructureId: string | null;
  onSelectStructure: (id: string | null) => void;
}

// Sticky strip that lives at the top of every structure page. One click
// from any structure to any other (or back to the floor plan).
export default function StructureBar({ selectedStructureId, onSelectStructure }: Props) {
  const [structures] = useTable(tables.myStructures);
  const [structureDefs] = useTable(tables.structureDefinition);
  const statuses = useStructureStatuses();

  const built = new Set(structures.map((s) => s.structureId));

  // Render bar entries in the canonical layout order, but only show built ones.
  const entries = STRUCTURE_BAR_ORDER
    .filter((id) => built.has(id))
    .map((id) => {
      const def = structureDefs.find((d) => d.structureId === id);
      return def ? { id, def } : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return (
    <View className="border-b border-slate-800 bg-slate-950/95">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
      >
        <SafePressable
          onPress={() => onSelectStructure(null)}
          className={`rounded-lg px-3 py-1.5 flex-row items-center gap-1.5 ${
            selectedStructureId === null
              ? 'bg-amber-500'
              : 'bg-slate-800 border border-slate-700'
          }`}
        >
          <Text className="text-base">🏠</Text>
          <Text
            className={`text-xs font-medium ${
              selectedStructureId === null ? 'text-slate-950' : 'text-slate-200'
            }`}
          >
            Floor Plan
          </Text>
        </SafePressable>

        {entries.map(({ id, def }) => {
          const isActive = selectedStructureId === id;
          const status = statuses[id] ?? 'idle';
          return (
            <SafePressable
              key={id}
              onPress={() => onSelectStructure(id)}
              className={`rounded-lg px-3 py-1.5 flex-row items-center gap-1.5 ${
                isActive
                  ? 'bg-amber-500'
                  : 'bg-slate-800 border border-slate-700'
              }`}
            >
              <Text className="text-base">{def.icon}</Text>
              <Text
                className={`text-xs font-medium ${
                  isActive ? 'text-slate-950' : 'text-slate-200'
                }`}
                numberOfLines={1}
              >
                {def.name}
              </Text>
              <StructureStatusBadge status={status} compact />
            </SafePressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
