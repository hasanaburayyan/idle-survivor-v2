import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { formatScrap } from '../lib/scavenge';
import { useScrapFlow } from './ScrapFlow';

export default function ResourceStrip() {
  const [resourceDefs] = useTable(tables.resourceDefinition);
  const [playerStates] = useTable(tables.myPlayerState);
  const [playerResources] = useTable(tables.myResources);
  const [skills] = useTable(tables.mySkills);
  const { setCounterRef } = useScrapFlow();

  const scrap = playerStates[0]?.scrap ?? 0n;

  const amounts = useMemo(() => {
    const map = new Map<string, bigint>();
    map.set('scrap', scrap);
    for (const row of playerResources) {
      map.set(row.resourceId, row.amount);
    }
    return map;
  }, [scrap, playerResources]);

  const skillLevels = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of skills) m.set(s.skillId, s.level);
    return m;
  }, [skills]);

  const visible = useMemo(() => {
    return [...resourceDefs]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter(def => {
        if (!def.unlockSkillId) return true;
        return (skillLevels.get(def.unlockSkillId) ?? 0) >= def.unlockSkillLevel;
      });
  }, [resourceDefs, skillLevels]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {visible.map(def => {
        const amount = amounts.get(def.resourceId) ?? 0n;
        const isScrap = def.resourceId === 'scrap';
        return (
          <View
            key={def.resourceId}
            ref={r => setCounterRef(def.resourceId, r, def.icon)}
            className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${
              isScrap
                ? 'border-amber-500/40 bg-slate-900'
                : 'border-slate-800 bg-slate-900'
            }`}
          >
            <Text className="text-sm">{def.icon}</Text>
            <Text className="text-sm font-semibold text-slate-100">
              {formatScrap(amount)}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
