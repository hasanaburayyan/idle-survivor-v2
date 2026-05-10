import { Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { useSpotlightTarget } from './SpotlightTargetRegistry';

// Six-tab sidebar that replaces the old bottom TabBar. Acts and Travel are
// gone (Scavenge has its own panel; location is implicit). The narrow-viewport
// layout renders this same component as a horizontal strip via the `layout`
// prop.

export type SidebarTabKey =
  | 'shelter'
  | 'skill_tree'
  | 'character'
  | 'social'
  | 'minigames'
  | 'chat';

interface TabSpec {
  key: SidebarTabKey;
  label: string;
  icon: string;
}

const TABS: TabSpec[] = [
  { key: 'shelter', label: 'Shelter', icon: '🛖' },
  { key: 'skill_tree', label: 'Skills', icon: '🌳' },
  { key: 'character', label: 'Character', icon: '👤' },
  { key: 'social', label: 'Social', icon: '👥' },
  { key: 'minigames', label: 'Games', icon: '🎲' },
  { key: 'chat', label: 'Chat', icon: '💬' },
];

interface Props {
  active: SidebarTabKey;
  onChange: (key: SidebarTabKey) => void;
  layout: 'vertical' | 'horizontal';
}

export default function Sidebar({ active, onChange, layout }: Props) {
  if (layout === 'horizontal') {
    return (
      <View className="flex-row border-t border-slate-800 bg-slate-950">
        {TABS.map(t => (
          <SidebarItem
            key={t.key}
            spec={t}
            isActive={t.key === active}
            onPress={() => onChange(t.key)}
            layout="horizontal"
          />
        ))}
      </View>
    );
  }

  return (
    <View className="border-l border-slate-800 bg-slate-950 py-2 gap-1">
      {TABS.map(t => (
        <SidebarItem
          key={t.key}
          spec={t}
          isActive={t.key === active}
          onPress={() => onChange(t.key)}
          layout="vertical"
        />
      ))}
    </View>
  );
}

function SidebarItem({
  spec,
  isActive,
  onPress,
  layout,
}: {
  spec: TabSpec;
  isActive: boolean;
  onPress: () => void;
  layout: 'vertical' | 'horizontal';
}) {
  const spotlight = useSpotlightTarget(`tab:${spec.key}`);

  if (layout === 'horizontal') {
    return (
      <View
        ref={spotlight.ref}
        onLayout={spotlight.onLayout}
        className="flex-1"
      >
        <SafePressable
          onPress={onPress}
          className={`items-center py-2 ${isActive ? 'bg-slate-900' : ''}`}
        >
          <Text className="text-base">{spec.icon}</Text>
          <Text
            className={`text-[10px] font-medium ${
              isActive ? 'text-amber-400' : 'text-slate-400'
            }`}
            numberOfLines={1}
          >
            {spec.label}
          </Text>
        </SafePressable>
      </View>
    );
  }

  return (
    <View ref={spotlight.ref} onLayout={spotlight.onLayout}>
      <SafePressable
        onPress={onPress}
        className={`mx-1.5 rounded-lg items-center py-3 gap-1 ${
          isActive ? 'bg-slate-900 border border-amber-700/50' : ''
        }`}
      >
        <Text className="text-xl">{spec.icon}</Text>
        <Text
          className={`text-[10px] font-medium ${
            isActive ? 'text-amber-400' : 'text-slate-400'
          }`}
          numberOfLines={1}
        >
          {spec.label}
        </Text>
      </SafePressable>
    </View>
  );
}
