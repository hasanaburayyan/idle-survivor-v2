import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';
import { formatScrap } from '../lib/scavenge';
import ScrapIcon from './ScrapIcon';
import GroupPanel from './GroupPanel';
import TabBar, { type TabKey } from './TabBar';
import WastesTab from './WastesTab';
import SkillTreeTab from './SkillTreeTab';
import SocialTab from './SocialTab';
import { ScrapFlowProvider, useScrapFlow } from './ScrapFlow';

interface HomeScreenProps {
  username: string;
}

export default function HomeScreen({ username }: HomeScreenProps) {
  return (
    <ScrapFlowProvider>
      <HomeScreenInner username={username} />
    </ScrapFlowProvider>
  );
}

function HomeScreenInner({ username }: HomeScreenProps) {
  const [playerStates] = useTable(tables.myPlayerState);
  const ps = playerStates[0];
  const logout = useReducer(reducers.logout);
  const { setCounterRef } = useScrapFlow();
  const [tab, setTab] = useState<TabKey>('wastes');

  const scrap = ps?.scrap ?? 0n;

  const onLogout = () => {
    logout().catch(() => {});
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="flex-row items-center justify-between px-6 py-4 border-b border-slate-800">
        <View
          ref={r => setCounterRef(r)}
          className="flex-row items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-4 py-2"
        >
          <ScrapIcon size={18} />
          <Text className="font-semibold text-lg text-slate-100">
            {formatScrap(scrap)}
          </Text>
          <Text className="text-xs text-slate-500">scrap</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <Text className="text-xs text-slate-500">
            <Text className="text-slate-300">{username}</Text>
          </Text>
          <Pressable
            onPress={onLogout}
            className="rounded-lg bg-slate-800 px-3 py-1.5"
          >
            <Text className="text-xs font-medium text-slate-100">Log out</Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-1">
        {tab === 'wastes' ? <WastesTab /> : null}
        {tab === 'skill_tree' ? <SkillTreeTab /> : null}
        {tab === 'social' ? <SocialTab /> : null}
      </View>

      <TabBar active={tab} onChange={setTab} />
      <GroupPanel username={username} />
    </SafeAreaView>
  );
}
