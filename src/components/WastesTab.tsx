import { useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';
import { formatScrap } from '../lib/scavenge';
import { computeScavengeGain, xpToNextLevel } from '../lib/progression';
import { useScrapFlow } from './ScrapFlow';

export default function WastesTab() {
  const [playerStates] = useTable(tables.myPlayerState);
  const [skills] = useTable(tables.mySkills);
  const ps = playerStates[0];

  const scavenge = useReducer(reducers.scavenge);
  const { spawnBurst } = useScrapFlow();

  const pressAnim = useRef(new Animated.Value(1)).current;
  const buttonRef = useRef<View | null>(null);

  const playerLevel = ps?.playerLevel ?? 0;
  const xp = ps?.xp ?? 0n;
  const skillPoints = ps?.skillPoints ?? 0;

  const scavengeBase =
    skills.find(s => s.skillId === 'scavenge_base')?.level ?? 0;
  const scavengePct =
    skills.find(s => s.skillId === 'scavenge_percent')?.level ?? 0;
  const power = computeScavengeGain(scavengeBase, scavengePct);
  const nextLevelXp = xpToNextLevel(playerLevel);

  const onScavenge = () => {
    Animated.sequence([
      Animated.timing(pressAnim, {
        toValue: 0.95,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.timing(pressAnim, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    spawnBurst(buttonRef.current, power);
    scavenge().catch(() => {});
  };

  return (
    <View className="flex-1 items-center justify-center gap-10 px-6">
      <Animated.View style={{ transform: [{ scale: pressAnim }] }}>
        <Pressable
          ref={r => (buttonRef.current = r)}
          onPress={onScavenge}
          className="items-center justify-center w-48 h-48 rounded-full bg-amber-500"
          style={{
            shadowColor: '#f59e0b',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.6,
            shadowRadius: 20,
            elevation: 10,
          }}
        >
          <Text className="text-slate-950 font-bold text-2xl">Scavenge</Text>
        </Pressable>
      </Animated.View>

      <View className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 gap-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs uppercase tracking-widest text-slate-500">
              Scavenge power
            </Text>
            <Text className="text-lg font-semibold text-slate-100">
              {formatScrap(power)}{' '}
              <Text className="text-sm text-slate-400 font-normal">
                per click
              </Text>
            </Text>
          </View>
          <View>
            <Text className="text-xs uppercase tracking-widest text-slate-500 text-right">
              Level
            </Text>
            <Text className="text-lg font-semibold text-slate-100 text-right">
              {playerLevel}
            </Text>
          </View>
        </View>
        <View>
          <View className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <View
              className="h-full bg-amber-500"
              style={{
                width: `${
                  nextLevelXp === 0n
                    ? 0
                    : Math.min(100, Number((xp * 100n) / nextLevelXp))
                }%`,
              }}
            />
          </View>
          <View className="flex-row justify-between mt-1">
            <Text className="text-[11px] text-slate-500">
              {xp.toString()} / {nextLevelXp.toString()} xp
            </Text>
            <Text className="text-[11px] text-slate-500">
              {skillPoints} skill point{skillPoints === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
