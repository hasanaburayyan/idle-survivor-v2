import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
}

interface CardListPayload {
  cardDefIds: string[];
}

const NUM_SLOTS = 5;

function decodeCardList(data: string): string[] {
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as CardListPayload;
    return parsed.cardDefIds ?? [];
  } catch {
    return [];
  }
}

export default function CardDuelView({ session }: Props) {
  const [boards] = useTable(tables.cardDuelBoard);
  const [players] = useTable(tables.cardDuelPlayer);
  const [boardCards] = useTable(tables.cardDuelCardOnBoard);
  const [defs] = useTable(tables.cardDefinition);
  const [privateState] = useTable(tables.myMinigamePrivateState);
  const [mySessions] = useTable(tables.mySession);
  const myUsername = mySessions[0]?.username;

  const board = boards.find(b => b.sessionId === session.id);
  const sessionPlayers = players.filter(p => p.sessionId === session.id);
  const sessionCards = boardCards.filter(c => c.sessionId === session.id);
  const me = sessionPlayers.find(p => p.username === myUsername);
  const opponent = sessionPlayers.find(p => p.username !== myUsername);

  const handRow = privateState.find(
    p => p.sessionId === session.id && p.slot === 0 && p.username === myUsername,
  );
  const deckRow = privateState.find(
    p => p.sessionId === session.id && p.slot === 1 && p.username === myUsername,
  );
  const hand = handRow ? decodeCardList(handRow.data) : [];
  const deckSize = deckRow ? decodeCardList(deckRow.data).length : 0;

  const cdPlayCard = useReducer(reducers.cdPlayCard);
  const cdAttack = useReducer(reducers.cdAttack);
  const cdEndTurn = useReducer(reducers.cdEndTurn);

  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [selectedAttackerId, setSelectedAttackerId] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  const myTurn = me !== undefined && board !== undefined && board.activeSeat === me.seat;
  const myCards = sessionCards.filter(c => c.ownerSeat === me?.seat);
  const enemyCards = sessionCards.filter(c => c.ownerSeat === opponent?.seat);

  const cardName = (defId: string) => defs.find(d => d.cardDefId === defId)?.name ?? defId;
  const cardCost = (defId: string) => defs.find(d => d.cardDefId === defId)?.cost ?? 0;

  const playCard = async (slot: number) => {
    if (!myTurn || selectedHandIndex === null || busy) return;
    setBusy(true);
    try {
      await cdPlayCard({ handIndex: selectedHandIndex, targetSlot: slot });
      setSelectedHandIndex(null);
    } catch (e) {
      console.error('[minigame] cdPlayCard failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const tapMyCard = (id: bigint) => {
    if (!myTurn) return;
    setSelectedAttackerId(prev => (prev === id ? null : id));
  };

  const attackTarget = async (defenderCardId: bigint) => {
    if (!myTurn || selectedAttackerId === null || busy) return;
    setBusy(true);
    try {
      await cdAttack({ attackerCardId: selectedAttackerId, defenderCardId });
      setSelectedAttackerId(null);
    } catch (e) {
      console.error('[minigame] cdAttack failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const endTurn = async () => {
    if (!myTurn || busy) return;
    setBusy(true);
    try {
      await cdEndTurn();
      setSelectedAttackerId(null);
      setSelectedHandIndex(null);
    } catch (e) {
      console.error('[minigame] cdEndTurn failed:', e);
    } finally {
      setBusy(false);
    }
  };

  if (!board || !me || !opponent) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-sm text-slate-500">Setting up duel…</Text>
      </View>
    );
  }

  const slots = Array.from({ length: NUM_SLOTS });

  return (
    <View className="flex-1 px-3 pt-1 pb-2 gap-1">
      {/* Header */}
      <View className="flex-row items-center justify-between">
        <Text className="text-[11px] uppercase tracking-widest text-amber-400">
          Card Duel · Turn {board.turnNumber}
        </Text>
        <Text
          className={`text-[11px] font-semibold ${
            myTurn ? 'text-emerald-400' : 'text-slate-500'
          }`}
        >
          {myTurn ? 'Your turn' : `${opponent.username}'s turn`}
        </Text>
      </View>

      {/* Opponent header row */}
      <View className="flex-row items-center justify-between px-1">
        <Text className="text-xs text-slate-300" numberOfLines={1}>
          {opponent.username}
        </Text>
        <Text className="text-xs text-rose-400">❤ {opponent.health}</Text>
      </View>

      {/* Opponent board */}
      <View className="flex-row gap-1 h-20">
        {slots.map((_, slot) => {
          const c = enemyCards.find(card => card.slot === slot);
          const isAttackable =
            myTurn && selectedAttackerId !== null && c !== undefined;
          return (
            <SafePressable
              key={slot}
              onPress={() => c && attackTarget(c.id)}
              disabled={!isAttackable}
              className={`flex-1 rounded-md items-center justify-center px-1 ${
                c
                  ? isAttackable
                    ? 'bg-rose-700 border border-rose-400'
                    : 'bg-slate-800 border border-slate-700'
                  : 'border border-slate-800'
              }`}
            >
              {c ? (
                <View className="items-center">
                  <Text className="text-[9px] text-slate-300 text-center" numberOfLines={2}>
                    {cardName(c.cardDefId)}
                  </Text>
                  <Text className="text-[11px] font-bold text-slate-100">
                    {c.attack}/{c.health}
                  </Text>
                </View>
              ) : null}
            </SafePressable>
          );
        })}
      </View>

      {/* Direct attack button */}
      {myTurn && selectedAttackerId !== null ? (
        <SafePressable
          onPress={() => attackTarget(0n)}
          className="rounded-md bg-rose-700 py-1 items-center"
        >
          <Text className="text-[11px] font-medium text-slate-100">
            Attack {opponent.username} directly
          </Text>
        </SafePressable>
      ) : null}

      {/* My board */}
      <View className="flex-row gap-1 h-20">
        {slots.map((_, slot) => {
          const c = myCards.find(card => card.slot === slot);
          const isPlayTarget = myTurn && selectedHandIndex !== null && !c;
          return (
            <SafePressable
              key={slot}
              onPress={() => {
                if (isPlayTarget) playCard(slot);
                else if (c) tapMyCard(c.id);
              }}
              disabled={!myTurn || (!c && selectedHandIndex === null)}
              className={`flex-1 rounded-md items-center justify-center px-1 ${
                c
                  ? selectedAttackerId === c.id
                    ? 'bg-amber-600 border border-amber-300'
                    : 'bg-slate-800 border border-slate-700'
                  : isPlayTarget
                  ? 'bg-emerald-900/50 border border-emerald-600'
                  : 'border border-slate-800'
              }`}
            >
              {c ? (
                <View className="items-center">
                  <Text className="text-[9px] text-slate-100 text-center" numberOfLines={2}>
                    {cardName(c.cardDefId)}
                  </Text>
                  <Text className="text-[11px] font-bold text-slate-100">
                    {c.attack}/{c.health}
                  </Text>
                </View>
              ) : null}
            </SafePressable>
          );
        })}
      </View>

      {/* My status bar */}
      <View className="flex-row items-center justify-between gap-2 mt-1 px-1">
        <Text className="text-xs text-slate-100" numberOfLines={1}>
          {me.username}
        </Text>
        <Text className="text-xs text-emerald-400">❤ {me.health}</Text>
        <Text className="text-xs text-sky-400">
          ✨ {me.manaCurrent}/{me.manaMax}
        </Text>
        <Text className="text-[11px] text-slate-500">🃏 {deckSize}</Text>
        <SafePressable
          onPress={endTurn}
          disabled={!myTurn || busy}
          className={`rounded-md px-3 py-1 ${
            myTurn && !busy ? 'bg-amber-500' : 'bg-slate-800 opacity-60'
          }`}
        >
          <Text
            className={`text-[11px] font-semibold ${
              myTurn && !busy ? 'text-slate-950' : 'text-slate-400'
            }`}
          >
            End turn
          </Text>
        </SafePressable>
      </View>

      {/* Hand — single row, horizontal scroll */}
      <View className="flex-1 mt-1">
        <Text className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 px-1">
          Hand · {hand.length}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}
        >
          {hand.length === 0 ? (
            <Text className="text-xs text-slate-500 self-center">
              No cards in hand
            </Text>
          ) : (
            hand.map((cardDefId, i) => {
              const cost = cardCost(cardDefId);
              const playable = myTurn && me.manaCurrent >= cost;
              const selected = selectedHandIndex === i;
              return (
                <SafePressable
                  key={`${cardDefId}-${i}`}
                  onPress={() =>
                    playable && setSelectedHandIndex(selected ? null : i)
                  }
                  disabled={!playable}
                  className={`w-16 rounded-md px-1 py-2 items-center justify-between ${
                    selected
                      ? 'bg-emerald-700 border border-emerald-300'
                      : playable
                      ? 'bg-slate-800 border border-slate-700'
                      : 'bg-slate-950 border border-slate-800 opacity-50'
                  }`}
                >
                  <Text
                    className="text-[10px] text-slate-100 text-center"
                    numberOfLines={2}
                  >
                    {cardName(cardDefId)}
                  </Text>
                  <Text className="text-[10px] text-sky-400 mt-1">cost {cost}</Text>
                </SafePressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </View>
  );
}
