import { Text, View } from 'react-native';

import SafePressable from './SafePressable';
import { useSpotlightTarget } from './SpotlightTargetRegistry';
export type TabKey =
  | 'activities'
  | 'travel'
  | 'shelter'
  | 'skill_tree'
  | 'social'
  | 'minigames'
  | 'chat';

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'activities', label: 'Activities' },
  { key: 'travel', label: 'Travel' },
  { key: 'shelter', label: 'Shelter' },
  { key: 'skill_tree', label: 'Skill Tree' },
  { key: 'social', label: 'Social' },
  { key: 'minigames', label: 'Minigames' },
  { key: 'chat', label: 'Chat' },
];

export default function TabBar({ active, onChange }: Props) {
  return (
    <View className="flex-row border-t border-slate-800 bg-slate-950">
      {TABS.map(tab => (
        <TabButton
          key={tab.key}
          tabKey={tab.key}
          label={tab.label}
          isActive={tab.key === active}
          onPress={() => onChange(tab.key)}
        />
      ))}
    </View>
  );
}

function TabButton({
  tabKey,
  label,
  isActive,
  onPress,
}: {
  tabKey: TabKey;
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const spotlightKey =
    tabKey === 'skill_tree'
      ? 'tab:skill_tree'
      : tabKey === 'travel'
      ? 'tab:travel'
      : '';
  const spotlight = useSpotlightTarget(spotlightKey);
  return (
    <View
      ref={spotlight.ref}
      onLayout={spotlight.onLayout}
      className="flex-1"
    >
      <SafePressable
        onPress={onPress}
        className={`items-center py-3 ${isActive ? 'bg-slate-900' : ''}`}
      >
        <Text
          className={`text-[11px] font-medium ${
            isActive ? 'text-amber-400' : 'text-slate-400'
          }`}
          numberOfLines={1}
        >
          {label}
        </Text>
      </SafePressable>
    </View>
  );
}
