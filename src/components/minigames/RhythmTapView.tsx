import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
}

const NOTE_TRAVEL_MS = 1500; // how long notes are visible before their hit time
const HIT_WINDOW_MS = 150;
const NUM_LANES = 4;

export default function RhythmTapView({ session }: Props) {
  const [games] = useTable(tables.rhythmTapGame);
  const [notes] = useTable(tables.rhythmTapNote);
  const [scores] = useTable(tables.rhythmTapScore);
  const [mySessions] = useTable(tables.mySession);
  const myUsername = mySessions[0]?.username;

  const game = games.find(g => g.sessionId === session.id);
  const sessionNotes = useMemo(
    () => notes.filter(n => n.sessionId === session.id).sort((a, b) => a.timeMs - b.timeMs),
    [notes, session.id]
  );
  const sessionScores = scores.filter(s => s.sessionId === session.id);
  const myScore = sessionScores.find(s => s.username === myUsername);

  const rtTap = useReducer(reducers.rtTap);

  const [now, setNow] = useState(Date.now());
  const animRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  if (!game || game.startMicros === 0n) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-sm text-slate-500">Loading chart…</Text>
      </View>
    );
  }

  const startMs = Number(game.startMicros / 1000n);
  const elapsedMs = now - startMs;

  const tapNote = (lane: number) => {
    const candidate = sessionNotes
      .filter(n => n.lane === lane && n.hitByUsername === undefined)
      .map(n => ({ note: n, offset: Math.abs(n.timeMs - elapsedMs) }))
      .sort((a, b) => a.offset - b.offset)[0];
    if (!candidate || candidate.offset > HIT_WINDOW_MS * 2) return;
    const clientHitMicros = BigInt(now) * 1000n;
    rtTap({ noteId: candidate.note.id, clientHitMicros }).catch(() => {
      /* ignore */
    });
  };

  return (
    <View className="flex-1">
      <View className="px-6 pt-4 gap-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs uppercase tracking-widest text-amber-400">
            Rhythm Tap
          </Text>
          <Text className="text-xs text-slate-500">
            {Math.max(0, game.durationMs - elapsedMs) > 0
              ? `${((game.durationMs - elapsedMs) / 1000).toFixed(1)}s`
              : 'Ending…'}
          </Text>
        </View>
        {myScore ? (
          <Text className="text-sm text-slate-100">
            Hits: {myScore.hits} · Misses: {myScore.misses} · Combo: {myScore.combo}
          </Text>
        ) : null}
      </View>

      <View className="flex-1 mx-6 mt-4 rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <View className="flex-1 flex-row">
          {Array.from({ length: NUM_LANES }).map((_, lane) => (
            <View key={lane} className="flex-1 border-r border-slate-800 last:border-r-0">
              <View className="flex-1 relative">
                {sessionNotes
                  .filter(n => n.lane === lane && n.hitByUsername === undefined)
                  .map(n => {
                    const remaining = n.timeMs - elapsedMs;
                    if (remaining > NOTE_TRAVEL_MS) return null;
                    if (remaining < -HIT_WINDOW_MS) return null;
                    const pct = Math.max(
                      0,
                      Math.min(100, ((NOTE_TRAVEL_MS - remaining) / NOTE_TRAVEL_MS) * 100)
                    );
                    return (
                      <View
                        key={n.id.toString()}
                        style={{ position: 'absolute', top: `${pct}%`, left: 4, right: 4 }}
                      >
                        <View className="h-8 rounded-lg bg-amber-400" />
                      </View>
                    );
                  })}
              </View>
              <View className="h-1 bg-amber-500/60" />
              <SafePressable
                onPress={() => tapNote(lane)}
                className="h-20 items-center justify-center bg-slate-950 active:bg-slate-800"
              >
                <Text className="text-2xl font-bold text-slate-300">▼</Text>
              </SafePressable>
            </View>
          ))}
        </View>
      </View>

      {sessionScores.length > 1 ? (
        <View className="px-6 py-3 gap-1">
          <Text className="text-[11px] uppercase tracking-widest text-slate-500">
            Squad
          </Text>
          {sessionScores.map(s => (
            <View
              key={s.username}
              className="flex-row items-center justify-between"
            >
              <Text className="text-xs text-slate-300">
                {s.username}
                {s.username === myUsername ? ' (you)' : ''}
              </Text>
              <Text className="text-xs text-slate-500">
                {s.hits} hits
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
