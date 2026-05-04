import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Text, View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import SafePressable from './SafePressable';

const COLLAPSED_WIDTH = 24;
const EXPANDED_WIDTH = 200;

type EventTag =
  | 'VoteCast'
  | 'BattleStarted'
  | 'ActionResolved'
  | 'DamageDealt'
  | 'PlayerDefeated'
  | 'WaveCompleted'
  | 'WaveStarted'
  | 'BattleEnded';

interface RenderedEvent {
  id: bigint;
  icon: string;
  colorClass: string;
  text: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeParse(payload: string): any {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function renderEvent(
  id: bigint,
  tag: EventTag,
  actor: string,
  payload: string,
  defNameById: Map<string, string>
): RenderedEvent {
  const p = safeParse(payload);
  switch (tag) {
    case 'BattleStarted':
      return {
        id,
        icon: '⚔',
        colorClass: 'text-amber-300',
        text: `Battle started — ${p.participantCount ?? '?'} players`,
      };
    case 'WaveStarted':
      return {
        id,
        icon: '~',
        colorClass: 'text-amber-400',
        text: `Wave ${p.wave ?? '?'} begins — ${p.zombieCount ?? '?'} zombies`,
      };
    case 'WaveCompleted':
      return {
        id,
        icon: '✓',
        colorClass: 'text-sky-300',
        text: `Wave ${p.wave ?? '?'} cleared`,
      };
    case 'ActionResolved': {
      const name = defNameById.get(p.actionId) ?? p.actionId;
      return {
        id,
        icon: '⚡',
        colorClass: 'text-emerald-400',
        text: `${actor}: ${name}`,
      };
    }
    case 'DamageDealt': {
      const amount = p.amount ?? 0;
      if (p.source === 'self') {
        return {
          id,
          icon: '●',
          colorClass: 'text-rose-400',
          text: `${actor} took ${amount} self-damage`,
        };
      }
      return {
        id,
        icon: '●',
        colorClass: 'text-rose-300',
        text: `${actor} hit for ${amount}`,
      };
    }
    case 'PlayerDefeated':
      return {
        id,
        icon: '✕',
        colorClass: 'text-rose-500 font-semibold',
        text: `${p.username ?? actor} defeated`,
      };
    case 'BattleEnded':
      return {
        id,
        icon: '⚑',
        colorClass: 'text-slate-300 italic',
        text: `Battle ended at wave ${p.finalWave ?? '?'}`,
      };
    case 'VoteCast':
      return {
        id,
        icon: '·',
        colorClass: 'text-slate-500',
        text: `${p.username ?? actor} voted ${p.vote ?? ''}`,
      };
    default:
      return {
        id,
        icon: '·',
        colorClass: 'text-slate-500',
        text: `${actor}: ${tag}`,
      };
  }
}

export default function BattleLogDrawer() {
  const [logs] = useTable(tables.myDefensiveBattleLog);
  const [actionDefs] = useTable(tables.actionDefinition);
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(0);
  const lastSeenIdRef = useRef<bigint>(0n);

  const widthAnim = useRef(new Animated.Value(COLLAPSED_WIDTH)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width can't use native driver
    }).start();
  }, [expanded, widthAnim]);

  const defNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of actionDefs) m.set(d.actionId, d.displayName);
    return m;
  }, [actionDefs]);

  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [logs]);

  const rendered = useMemo(() => {
    return sortedLogs.map(row =>
      renderEvent(
        row.id,
        row.eventKind.tag as EventTag,
        row.actorUsername,
        row.payload,
        defNameById
      )
    );
  }, [sortedLogs, defNameById]);

  // Track unread count while collapsed.
  useEffect(() => {
    if (expanded) {
      // Mark everything as read.
      const last = sortedLogs[sortedLogs.length - 1];
      if (last) lastSeenIdRef.current = last.id;
      setUnread(0);
      return;
    }
    let count = 0;
    for (const row of sortedLogs) {
      if (row.id > lastSeenIdRef.current) count += 1;
    }
    setUnread(count);
  }, [sortedLogs, expanded]);

  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    if (expanded) {
      // Defer to next frame so layout has stabilized.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: false });
      });
    }
  }, [expanded, rendered.length]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: widthAnim,
        zIndex: 10,
      }}
      className="border-l border-slate-800 bg-slate-950/95"
    >
      {expanded ? (
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-2 py-1.5 border-b border-slate-800">
            <Text className="text-[10px] uppercase tracking-widest text-slate-500">
              Battle Log
            </Text>
            <SafePressable
              onPress={() => setExpanded(false)}
              className="rounded-md bg-slate-800 px-2 py-0.5"
            >
              <Text className="text-[10px] text-slate-300">›</Text>
            </SafePressable>
          </View>
          <ScrollView
            ref={r => {
              scrollRef.current = r;
            }}
            contentContainerStyle={{ padding: 6, gap: 3 }}
          >
            {rendered.length === 0 ? (
              <Text className="text-[11px] text-slate-500">Awaiting events…</Text>
            ) : (
              rendered.map(ev => (
                <View
                  key={ev.id.toString()}
                  className="flex-row items-start gap-1.5"
                >
                  <Text className={`text-[11px] ${ev.colorClass}`}>{ev.icon}</Text>
                  <Text className={`flex-1 text-[11px] ${ev.colorClass}`}>
                    {ev.text}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      ) : (
        <SafePressable
          onPress={() => setExpanded(true)}
          className="flex-1 items-center justify-center"
          accessibilityLabel={`Open battle log${unread > 0 ? `, ${unread} unread` : ''}`}
        >
          <Text
            className="text-[10px] uppercase tracking-widest text-slate-500"
            style={{
              transform: [{ rotate: '90deg' }],
            }}
          >
            LOG
          </Text>
          {unread > 0 ? (
            <View
              className="absolute top-1 left-1 min-w-[14px] h-[14px] items-center justify-center rounded-full bg-amber-400 px-1"
            >
              <Text className="text-[9px] font-semibold text-slate-950">
                {unread > 9 ? '9+' : unread}
              </Text>
            </View>
          ) : null}
        </SafePressable>
      )}
    </Animated.View>
  );
}
