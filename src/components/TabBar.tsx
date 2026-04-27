import { Text, View } from 'react-native';

import SafePressable from './SafePressable';
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
      {TABS.map(tab => {
        const isActive = tab.key === active;
        return (
          <SafePressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            className={`flex-1 items-center py-3 ${
              isActive ? 'bg-slate-900' : ''
            }`}
          >
            <Text
              className={`text-[11px] font-medium ${
                isActive ? 'text-amber-400' : 'text-slate-400'
              }`}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </SafePressable>
        );
      })}
    </View>
  );
}
