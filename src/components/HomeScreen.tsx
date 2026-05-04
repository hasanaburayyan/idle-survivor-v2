import { useState } from 'react';
import { Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';
import { xpToNextLevel } from '../lib/progression';
import GroupPanel from './GroupPanel';
import TabBar, { type TabKey } from './TabBar';
import ActivitiesTab from './ActivitiesTab';
import TravelTab from './TravelTab';
import ShelterTab from './ShelterTab';
import SkillTreeTab from './SkillTreeTab';
import CharacterTab from './CharacterTab';
import SocialTab from './SocialTab';
import ChatTab from './ChatTab';
import MinigamesTab from './MinigamesTab';
import MinigameModal from './minigames/MinigameModal';
import DefensiveBattleLobby from './DefensiveBattleLobby';
import DefensiveBattleScreen from './DefensiveBattleScreen';
import { ScrapFlowProvider } from './ScrapFlow';
import AutomationFeedback from './AutomationFeedback';
import FortuneProcFeedback from './FortuneProcFeedback';
import NotificationBell from './NotificationBell';
import ResourceStrip from './ResourceStrip';
import { SpotlightTargetProvider } from './SpotlightTargetRegistry';
import TutorialPopup from './TutorialPopup';

interface HomeScreenProps {
  username: string;
}

export default function HomeScreen({ username }: HomeScreenProps) {
  return (
    <SpotlightTargetProvider>
      <ScrapFlowProvider>
        <HomeScreenInner username={username} />
      </ScrapFlowProvider>
    </SpotlightTargetProvider>
  );
}

function HomeScreenInner({ username }: HomeScreenProps) {
  const [playerStates] = useTable(tables.myPlayerState);
  const ps = playerStates[0];
  const logout = useReducer(reducers.logout);
  const cheatLevel = useReducer(reducers.cheatAddLevel);
  const cheatScrap = useReducer(reducers.cheatAddScrap);
  const [tab, setTab] = useState<TabKey>('activities');
  const [devOpen, setDevOpen] = useState(false);

  const playerLevel = ps?.playerLevel ?? 0;
  const xp = ps?.xp ?? 0n;
  const inBattle = ps?.location?.startsWith('defensive_battle:') ?? false;
  const nextLevelXp = xpToNextLevel(playerLevel);
  const xpPct =
    nextLevelXp === 0n ? 0 : Math.min(100, Number((xp * 100n) / nextLevelXp));

  const onLogout = () => {
    logout().catch(() => {});
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <AutomationFeedback />
      <FortuneProcFeedback />
      <View
        className="px-4 py-2 border-b border-slate-800 gap-2"
        style={{ zIndex: 50, elevation: 50 }}
      >
        <View
          className="flex-row items-center justify-between gap-2"
          style={{ zIndex: 10 }}
        >
          <View className="flex-1">
            <ResourceStrip />
          </View>
          <View className="flex-row items-center gap-2">
            <Text className="text-xs text-slate-500">
              <Text className="text-slate-300">{username}</Text>
            </Text>
            <NotificationBell closeSignal={tab} />
            <SafePressable
              onPress={() => setDevOpen(o => !o)}
              className={`rounded-lg px-2 py-1.5 ${
                devOpen ? 'bg-fuchsia-600' : 'bg-slate-800'
              }`}
            >
              <Text
                className={`text-[11px] font-medium ${
                  devOpen ? 'text-slate-950' : 'text-slate-300'
                }`}
              >
                ⚡
              </Text>
            </SafePressable>
            {devOpen ? (
              <>
                <SafePressable
                  onPress={() => cheatLevel().catch(() => {})}
                  className="rounded-lg bg-fuchsia-600 px-2 py-1.5"
                >
                  <Text className="text-[11px] font-medium text-slate-950">
                    +Lv
                  </Text>
                </SafePressable>
                <SafePressable
                  onPress={() => cheatScrap().catch(() => {})}
                  className="rounded-lg bg-fuchsia-600 px-2 py-1.5"
                >
                  <Text className="text-[11px] font-medium text-slate-950">
                    +10K
                  </Text>
                </SafePressable>
              </>
            ) : null}
            <SafePressable
              onPress={onLogout}
              className="rounded-lg bg-slate-800 px-3 py-1.5"
            >
              <Text className="text-xs font-medium text-slate-100">Log out</Text>
            </SafePressable>
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-[11px] font-semibold text-slate-400">
            Lv {playerLevel}
          </Text>
          <View className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <View
              className="h-full bg-amber-500"
              style={{ width: `${xpPct}%` }}
            />
          </View>
          <Text className="text-[11px] text-slate-500">
            {xp.toString()} / {nextLevelXp.toString()}
          </Text>
        </View>
      </View>

      <View className="flex-1">
        {tab === 'activities' ? <ActivitiesTab /> : null}
        {tab === 'travel' ? <TravelTab /> : null}
        {tab === 'shelter' ? <ShelterTab /> : null}
        {tab === 'skill_tree' ? <SkillTreeTab /> : null}
        {tab === 'character' ? <CharacterTab /> : null}
        {tab === 'social' ? <SocialTab /> : null}
        {tab === 'minigames' ? <MinigamesTab /> : null}
        {tab === 'chat' ? <ChatTab username={username} /> : null}
      </View>

      <TabBar active={tab} onChange={setTab} />
      <GroupPanel username={username} />
      <MinigameModal />
      <TutorialPopup />
      <DefensiveBattleLobby username={username} />
      {inBattle ? <DefensiveBattleScreen username={username} /> : null}
    </SafeAreaView>
  );
}
