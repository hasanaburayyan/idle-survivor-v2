import { Pressable, Text, View } from 'react-native';

export type TabKey = 'social' | 'skill_tree' | 'wastes';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'social', label: 'Social' },
  { key: 'skill_tree', label: 'Skill Tree' },
  { key: 'wastes', label: 'The Wastes' },
];

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export default function TabBar({ active, onChange }: Props) {
  return (
    <View className="flex-row border-t border-slate-800 bg-slate-950">
      {TABS.map(tab => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            className={`flex-1 items-center py-3 ${
              isActive ? 'bg-slate-900' : ''
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                isActive ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
