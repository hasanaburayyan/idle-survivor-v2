import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Modal, ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';
import LoadoutPanel from './LoadoutPanel';

interface DefensiveBattleLobbyProps {
  username: string;
}

export default function DefensiveBattleLobby({ username }: DefensiveBattleLobbyProps) {
  const [sessions] = useTable(tables.myDefensiveBattleSession);
  const [participants] = useTable(tables.myDefensiveBattleParticipants);

  const session = sessions[0];
  const isVoting = session?.state.tag === 'Voting';
  const isInProgress = session?.state.tag === 'InProgress';
  const visible = !!session && (isVoting || isInProgress) && participants.length > 0;

  const myParticipant = useMemo(
    () => participants.find(p => p.username === username),
    [participants, username]
  );

  const [now, setNow] = useState(() => Date.now() * 1000);
  useEffect(() => {
    if (!isVoting) return;
    const id = setInterval(() => setNow(Date.now() * 1000), 250);
    return () => clearInterval(id);
  }, [isVoting]);

  // Cross-fade animator: visible while voting, fades out when battle starts
  // (the battle screen mounts immediately, so a quick fade-out feels natural).
  const fade = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible && isVoting ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, isVoting, fade]);

  const voteBattle = useReducer(reducers.voteDefensiveBattle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hide modal entirely once we transition to inProgress — the battle screen takes over.
  if (!visible || !isVoting || !session || !myParticipant) return null;

  const remainingMicros = Number(session.voteDeadlineMicros) - now;
  const remainingSec = Math.max(0, Math.ceil(remainingMicros / 1_000_000));
  const timerColor =
    remainingSec <= 10 ? 'text-rose-400' : 'text-amber-400';

  const myVote = myParticipant.vote.tag;
  const isPending = myVote === 'Pending';
  const isYay = myVote === 'Yay';
  const allYay = participants.every(p => p.vote.tag === 'Yay');
  const someNay = participants.some(p => p.vote.tag === 'Nay');

  const submitVote = async (yay: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await voteBattle({ sessionId: session.sessionId, voteYay: yay });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="none">
      <Animated.View
        style={{ flex: 1, opacity: fade, backgroundColor: 'rgba(0,0,0,0.6)' }}
        className="items-center justify-center px-4"
      >
        <View className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-slate-100">⚔ Defensive Battle</Text>
            <Text className={`text-sm font-mono ${timerColor}`}>
              0:{remainingSec.toString().padStart(2, '0')}
            </Text>
          </View>
          <Text className="text-xs text-slate-400">
            All players must vote Yay before the deadline.
          </Text>

          <View className="flex-row flex-wrap gap-2">
            {participants.map(p => {
              const tag = p.vote.tag;
              const chipClass =
                tag === 'Yay'
                  ? 'bg-emerald-500/20 border border-emerald-500/40'
                  : tag === 'Nay'
                    ? 'bg-rose-500/20 border border-rose-500/40'
                    : 'bg-slate-800 border border-slate-700';
              const dot =
                tag === 'Yay' ? '✓' : tag === 'Nay' ? '✕' : '·';
              const dotColor =
                tag === 'Yay'
                  ? 'text-emerald-400'
                  : tag === 'Nay'
                    ? 'text-rose-400'
                    : 'text-slate-500';
              return (
                <View
                  key={p.username}
                  className={`rounded-full px-3 py-1 flex-row items-center gap-1.5 ${chipClass}`}
                >
                  <Text className={`text-xs ${dotColor}`}>{dot}</Text>
                  <Text className="text-xs text-slate-100">{p.username}</Text>
                </View>
              );
            })}
          </View>

          <View className="border-t border-slate-800 pt-3">
            <ScrollView style={{ maxHeight: 360 }}>
              <LoadoutPanel compact />
            </ScrollView>
          </View>

          {error ? (
            <Text className="text-[11px] text-rose-300">{error}</Text>
          ) : null}

          <View className="flex-row gap-2">
            {isPending ? (
              <>
                <SafePressable
                  onPress={() => submitVote(true)}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-emerald-500 py-2 items-center"
                >
                  <Text className="text-sm font-semibold text-slate-950">
                    {busy ? 'Submitting…' : 'Yay — join battle'}
                  </Text>
                </SafePressable>
                <SafePressable
                  onPress={() => submitVote(false)}
                  disabled={busy}
                  className="rounded-lg bg-slate-800 px-4 py-2 items-center"
                >
                  <Text className="text-sm font-semibold text-slate-100">Nay</Text>
                </SafePressable>
              </>
            ) : isYay ? (
              <>
                <View className="flex-1 rounded-lg bg-slate-800 py-2 items-center">
                  <Text className="text-sm text-slate-300">
                    {allYay
                      ? 'Starting…'
                      : someNay
                        ? 'Vote failed.'
                        : `Waiting on ${participants.filter(p => p.vote.tag === 'Pending').length} more…`}
                  </Text>
                </View>
                <SafePressable
                  onPress={() => submitVote(false)}
                  disabled={busy}
                  className="rounded-lg bg-slate-800 px-4 py-2 items-center"
                >
                  <Text className="text-sm font-semibold text-slate-300">
                    Cancel vote
                  </Text>
                </SafePressable>
              </>
            ) : (
              <View className="flex-1 rounded-lg bg-rose-900/40 py-2 items-center">
                <Text className="text-sm text-rose-300">You voted Nay — battle cancelled.</Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}
