import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { minigameRegistry, type MinigameKindTag } from './minigames/registry';

export default function MinigamesTab() {
  const [members] = useTable(tables.myMinigameMember);
  const inMinigame = members.length > 0;

  return (
    <ScrollView className="flex-1 bg-slate-950">
      <View className="px-5 py-5 gap-4">
        <View>
          <Text className="text-xs uppercase tracking-widest text-amber-400">
            Minigames
          </Text>
          <Text className="text-sm text-slate-400 mt-1">
            Quick games to play solo or with party members. Idle activities keep
            running while you play.
          </Text>
        </View>

        {inMinigame ? (
          <View className="rounded-2xl bg-slate-900 border border-slate-800 px-4 py-4">
            <Text className="text-sm text-slate-300">
              You&rsquo;re currently in a minigame. The game window will appear
              shortly.
            </Text>
          </View>
        ) : null}

        <View className="gap-3">
          {Object.values(minigameRegistry).map(d => {
            if (!d) return null;
            return (
              <MinigameCard
                key={d.kind}
                kind={d.kind}
                displayName={d.displayName}
                description={d.description}
                disabled={inMinigame}
              />
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

function MinigameCard({
  kind,
  displayName,
  description,
  disabled,
}: {
  kind: MinigameKindTag;
  displayName: string;
  description: string;
  disabled: boolean;
}) {
  const createMinigame = useReducer(reducers.createMinigame);
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      console.log('[minigame] createMinigame: kind=', kind);
      await createMinigame({ kind: { tag: kind } });
      console.log('[minigame] createMinigame: reducer resolved');
    } catch (e) { console.error('[minigame] createMinigame failed:', e); }
    finally { setBusy(false); }
  };

  return (
    <View className="rounded-2xl bg-slate-900 border border-slate-800 px-4 py-4 gap-3">
      <View>
        <Text className="text-base font-semibold text-slate-100">
          {displayName}
        </Text>
        <Text className="text-xs text-slate-400 mt-1">{description}</Text>
      </View>
      <SafePressable
        onPress={onPress}
        disabled={busy || disabled}
        className={`rounded-lg py-3 items-center ${
          busy || disabled ? 'bg-amber-700' : 'bg-amber-500'
        }`}
      >
        <Text className="text-sm font-medium text-slate-950">
          {disabled ? 'In minigame…' : busy ? 'Starting…' : 'Play'}
        </Text>
      </SafePressable>
    </View>
  );
}
