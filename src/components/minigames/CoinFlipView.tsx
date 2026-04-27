import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
}

export default function CoinFlipView({ session }: Props) {
  const [games] = useTable(tables.coinFlipGame);
  const [bets] = useTable(tables.coinFlipBet);
  const [members] = useTable(tables.minigameMember);
  const [mySessions] = useTable(tables.mySession);
  const [playerStates] = useTable(tables.myPlayerState);
  const myUsername = mySessions[0]?.username;
  const myScrap = playerStates[0]?.scrap ?? 0n;

  const game = games.find(g => g.sessionId === session.id);
  const sessionBets = bets.filter(b => b.sessionId === session.id);
  const sessionMembers = members
    .filter(m => m.sessionId === session.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) => m.active);
  const myBet = sessionBets.find(b => b.username === myUsername);
  const revealed = game?.result !== undefined;

  const cfPick = useReducer(reducers.cfPick);
  const cfReveal = useReducer(reducers.cfReveal);
  const leaveMinigame = useReducer(reducers.leaveMinigame);

  const [wagerText, setWagerText] = useState('10');
  const [busy, setBusy] = useState(false);

  const wagerNum = (() => {
    const n = parseInt(wagerText, 10);
    if (Number.isNaN(n) || n <= 0) return 0n;
    return BigInt(n);
  })();
  const canAfford = wagerNum > 0n && wagerNum <= myScrap;

  const pick = async (tag: 'Heads' | 'Tails') => {
    if (busy || (myBet && !revealed) || !canAfford) return;
    setBusy(true);
    try {
      await cfPick({ pick: { tag }, wager: wagerNum });
    } catch (e) {
      console.error('[minigame] cfPick failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const onReveal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cfReveal();
    } catch (e) {
      console.error('[minigame] cfReveal failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const onLeave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await leaveMinigame();
    } catch (e) {
      console.error('[minigame] leaveMinigame failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const setWagerPreset = (n: number | 'max') => {
    if (n === 'max') {
      setWagerText(myScrap.toString());
    } else {
      setWagerText(String(n));
    }
  };

  return (
    <View className="flex-1 px-6 py-6 gap-5">
      <View className="flex-row items-start justify-between">
        <View>
          <Text className="text-xs uppercase tracking-widest text-amber-400">
            Coin Flip · Round {game?.roundNumber ?? 1}
          </Text>
          <Text className="text-2xl font-bold text-slate-100 mt-1">
            Pot: {(game?.pot ?? 0n).toString()} scrap
          </Text>
          <Text className="text-xs text-slate-500 mt-1">
            {sessionBets.length} / {sessionMembers.length} bets in
          </Text>
        </View>
        <SafePressable
          onPress={onLeave}
          disabled={busy}
          className="rounded-lg bg-slate-800 px-3 py-2"
        >
          <Text className="text-xs font-medium text-slate-100">Leave</Text>
        </SafePressable>
      </View>

      {revealed ? (
        <RevealCard game={game} sessionBets={sessionBets} myUsername={myUsername} />
      ) : null}

      {!revealed && myBet ? (
        <View className="rounded-2xl bg-slate-900 border border-slate-800 px-5 py-5 gap-2">
          <Text className="text-xs uppercase tracking-widest text-slate-500">
            Your bet
          </Text>
          <Text className="text-3xl font-bold text-slate-100">
            {myBet.pick.tag} · {myBet.wager.toString()} scrap
          </Text>
          <Text className="text-xs text-slate-500 mt-2">
            Waiting for {sessionMembers.length - sessionBets.length} more
            {sessionMembers.length - sessionBets.length === 1 ? ' bet' : ' bets'}…
          </Text>
          {sessionBets.length > 0 ? (
            <SafePressable
              onPress={onReveal}
              disabled={busy}
              className="rounded-lg bg-amber-500 py-2 items-center mt-2"
            >
              <Text className="text-xs font-medium text-slate-950">Reveal now</Text>
            </SafePressable>
          ) : null}
        </View>
      ) : null}

      {(!myBet || revealed) ? (
        <View className="gap-3">
          <Text className="text-xs uppercase tracking-widest text-slate-500">
            {revealed ? 'Bet on the next round' : 'Wager and pick a side'}
          </Text>
          <View className="rounded-2xl bg-slate-900 border border-slate-800 px-4 py-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-slate-500">Wager</Text>
              <Text className="text-[11px] text-slate-500">
                You have {myScrap.toString()} scrap
              </Text>
            </View>
            <TextInput
              value={wagerText}
              onChangeText={t => setWagerText(t.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#64748b"
              className={`rounded-lg bg-slate-950 border px-3 py-2 text-2xl text-slate-100 ${
                canAfford ? 'border-slate-800' : 'border-rose-700'
              }`}
            />
            <View className="flex-row gap-2">
              {[10, 100, 1000].map(n => (
                <SafePressable
                  key={n}
                  onPress={() => setWagerPreset(n)}
                  disabled={BigInt(n) > myScrap}
                  className={`flex-1 rounded-lg py-2 items-center ${
                    BigInt(n) > myScrap ? 'bg-slate-950 opacity-50' : 'bg-slate-800'
                  }`}
                >
                  <Text className="text-xs font-medium text-slate-100">{n}</Text>
                </SafePressable>
              ))}
              <SafePressable
                onPress={() => setWagerPreset('max')}
                disabled={myScrap === 0n}
                className={`flex-1 rounded-lg py-2 items-center ${
                  myScrap === 0n ? 'bg-slate-950 opacity-50' : 'bg-amber-700'
                }`}
              >
                <Text className="text-xs font-medium text-slate-100">Max</Text>
              </SafePressable>
            </View>
            {!canAfford && wagerText.length > 0 ? (
              <Text className="text-[11px] text-rose-400">
                {wagerNum === 0n ? 'Wager must be greater than 0' : 'Not enough scrap'}
              </Text>
            ) : null}
          </View>

          <View className="flex-row gap-3">
            <SafePressable
              onPress={() => pick('Heads')}
              disabled={busy || !canAfford}
              className={`flex-1 rounded-2xl py-6 items-center ${
                busy || !canAfford ? 'bg-amber-700 opacity-60' : 'bg-amber-500'
              }`}
            >
              <Text className="text-2xl font-bold text-slate-950">Heads</Text>
            </SafePressable>
            <SafePressable
              onPress={() => pick('Tails')}
              disabled={busy || !canAfford}
              className={`flex-1 rounded-2xl py-6 items-center ${
                busy || !canAfford ? 'bg-sky-700 opacity-60' : 'bg-sky-500'
              }`}
            >
              <Text className="text-2xl font-bold text-slate-950">Tails</Text>
            </SafePressable>
          </View>
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Players
        </Text>
        {sessionMembers.map(m => {
          const bet = sessionBets.find(b => b.username === m.username);
          return (
            <View
              key={m.username}
              className="flex-row items-center justify-between rounded-lg bg-slate-900 border border-slate-800 px-3 py-2"
            >
              <Text className="text-sm text-slate-100">
                {m.username}
                {m.username === myUsername ? ' (you)' : ''}
              </Text>
              <Text className="text-xs text-slate-500">
                {bet
                  ? revealed
                    ? `${bet.pick.tag} · ${bet.wager.toString()} → ${bet.payout.toString()}`
                    : `${bet.pick.tag} · ${bet.wager.toString()}`
                  : 'Thinking…'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RevealCard({
  game,
  sessionBets,
  myUsername,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  game: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionBets: any[];
  myUsername: string | undefined;
}) {
  const myBet = sessionBets.find(b => b.username === myUsername);
  const won = myBet && game.result && myBet.pick.tag === game.result.tag;
  const profit = myBet ? myBet.payout - myBet.wager : 0n;

  return (
    <View className="rounded-2xl bg-slate-900 border border-amber-700 px-5 py-5 gap-2">
      <Text className="text-xs uppercase tracking-widest text-amber-400">
        Round {game.roundNumber} result
      </Text>
      <Text className="text-3xl font-bold text-slate-100">
        {game.result.tag}!
      </Text>
      {myBet ? (
        <Text
          className={`text-sm font-medium ${
            won ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {won
            ? profit > 0n
              ? `You won ${profit.toString()} scrap`
              : 'Refund (no contest)'
            : `You lost ${myBet.wager.toString()} scrap`}
        </Text>
      ) : (
        <Text className="text-xs text-slate-500">You sat this round out.</Text>
      )}
      <Text className="text-[11px] text-slate-500 mt-2">
        Place a bet below to start the next round.
      </Text>
    </View>
  );
}
