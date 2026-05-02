import { ScrollView, Text, View } from 'react-native';
import SafePressable from './SafePressable';

interface ClassCraftingScreenProps {
  onBack: () => void;
}

/**
 * Class Crafting — Phase 2 surface.
 * Spend class-specific resources to craft class points for a given tree.
 * This stub renders a placeholder until Phase 2 ships.
 *
 * TODO (Phase 2): subscribe to classCraftCost, playerClassCraftProgress,
 * playerSkillPointBalance (class pools), myResources; render per-class
 * craft rows with current tier, cost breakdown, and craftClassPoint reducer.
 */
export default function ClassCraftingScreen({ onBack }: ClassCraftingScreenProps) {
  return (
    <View className="flex-1 bg-slate-950">
      {/* Header */}
      <View className="flex-row items-center gap-3 px-4 py-3 border-b border-slate-800">
        <SafePressable
          onPress={onBack}
          className="rounded-full w-8 h-8 items-center justify-center bg-slate-800"
        >
          <Text className="text-slate-300 text-base">←</Text>
        </SafePressable>
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Class Crafting
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ flex: 1, padding: 24 }}>
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-3xl">⚗</Text>
          <Text className="text-base font-semibold text-slate-300 text-center">
            Class Crafting — Coming in Phase 2
          </Text>
          <Text className="text-sm text-slate-500 text-center leading-5">
            Spend resources (Metal, Parts, Food, Medicine, Fabric, Scrap) here
            to craft class-specific skill points. Unlock classes first via the
            Intermediate skill tree.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
