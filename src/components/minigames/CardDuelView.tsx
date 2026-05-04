import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, Text, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import {
  FlashOverlay,
  LaggingHpBar,
  Wiggle,
  COLOR_DAMAGE,
  COLOR_PLAY,
  SHRINK_OUT_MS,
} from '../feedback';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
}

interface CardListPayload {
  cardDefIds: string[];
}

const NUM_SLOTS = 5;

// Mirrors STARTING_HEALTH in spacetimedb/src/minigames/cardDuel.ts.
// cardDuelPlayer has no maxHp column; if backend STARTING_HEALTH changes, update this too.
const PLAYER_MAX_HP = 20;

function decodeCardList(data: string): string[] {
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as CardListPayload;
    return parsed.cardDefIds ?? [];
  } catch {
    return [];
  }
}

// Shape of a "ghost slot" shown while a removed card shrinks out.
interface RemovingCard {
  id: bigint;
  slot: number;
  ownerSeat: number;
  cardDefId: string;
  attack: number;
  health: number;
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
  const myCards = sessionCards.filter(c => c.ownerSeat === me?.seat);
  const enemyCards = sessionCards.filter(c => c.ownerSeat === opponent?.seat);

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

  // -------------------------------------------------------------------------
  // Animation state
  // -------------------------------------------------------------------------

  // Per-card slot flash triggers (damage): keyed by card id string.
  const [cardFlashTriggers, setCardFlashTriggers] = useState<Map<string, number>>(new Map());
  // Per-player face-damage flash: keyed by seat number.
  const [playerFlashTriggers, setPlayerFlashTriggers] = useState<Map<number, number>>(new Map());
  // Opponent nameplate: wiggle + green flash when they play a card.
  const [opponentWiggleTrigger, setOpponentWiggleTrigger] = useState(0);
  const [opponentPlayFlashTrigger, setOpponentPlayFlashTrigger] = useState(0);
  // Ghost cards being shrunk out after removal.
  const [removingCards, setRemovingCards] = useState<Map<string, RemovingCard>>(new Map());

  // -------------------------------------------------------------------------
  // Diff-tracking refs — state snapshots from the previous render
  // -------------------------------------------------------------------------
  const prevCardHp = useRef(new Map<string, number>());
  const prevCardIds = useRef(new Map<number, Set<string>>()); // seat → set of id strings
  const prevPlayerHp = useRef(new Map<number, number>());    // seat → hp
  const prevTurnNumber = useRef<number>(-1); // -1 = uninitialized; suppresses first-render animation
  const prevEnemyCardCount = useRef<number>(0);

  // Last-known card data: seeded from every live render so removals have
  // enough info to build a ghost slot.
  const lastKnownCards = useRef(new Map<string, RemovingCard>());
  useEffect(() => {
    for (const c of sessionCards) {
      lastKnownCards.current.set(c.id.toString(), {
        id: c.id,
        slot: c.slot,
        ownerSeat: c.ownerSeat,
        cardDefId: c.cardDefId,
        attack: c.attack,
        health: c.health,
      });
    }
  }, [sessionCards]);

  // -------------------------------------------------------------------------
  // Main diff-tracking effect — fires whenever board state changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!board || !me || !opponent) return;

    const currentTurn = board.turnNumber;
    const isInitialMount = prevTurnNumber.current === -1;

    if (isInitialMount) {
      // Seed refs without triggering any animation. This is the "prime on mount"
      // pattern that prevents initial subscription data from burst-firing animations.
      prevTurnNumber.current = currentTurn;
      prevEnemyCardCount.current = enemyCards.length;
      for (const c of sessionCards) {
        prevCardHp.current.set(c.id.toString(), c.health);
      }
      for (const p of sessionPlayers) {
        prevPlayerHp.current.set(p.seat, p.health);
      }
      prevCardIds.current.set(me.seat, new Set(myCards.map(c => c.id.toString())));
      prevCardIds.current.set(opponent.seat, new Set(enemyCards.map(c => c.id.toString())));
      return;
    }

    const newCardFlash = new Map(cardFlashTriggers);
    const newPlayerFlash = new Map(playerFlashTriggers);
    let bumpOpponentWiggle = false;

    // --- Card HP drops → per-slot red border flash ---
    for (const c of sessionCards) {
      const key = c.id.toString();
      const prev = prevCardHp.current.get(key);
      if (prev !== undefined && c.health < prev) {
        newCardFlash.set(key, (newCardFlash.get(key) ?? 0) + 1);
      }
      prevCardHp.current.set(key, c.health);
    }

    // --- Player HP drops → face-damage tint flash ---
    for (const p of sessionPlayers) {
      const prev = prevPlayerHp.current.get(p.seat);
      if (prev !== undefined && p.health < prev) {
        newPlayerFlash.set(p.seat, (newPlayerFlash.get(p.seat) ?? 0) + 1);
      }
      prevPlayerHp.current.set(p.seat, p.health);
    }

    // --- Card removal → register ghost slot for shrink-out animation ---
    const prevEnemyIds = prevCardIds.current.get(opponent.seat) ?? new Set<string>();
    const currentEnemyIds = new Set(enemyCards.map(c => c.id.toString()));
    const prevMyIds = prevCardIds.current.get(me.seat) ?? new Set<string>();
    const currentMyIds = new Set(myCards.map(c => c.id.toString()));

    const disappeared: Array<{ id: string; seat: number }> = [
      ...[...prevEnemyIds].filter(id => !currentEnemyIds.has(id)).map(id => ({ id, seat: opponent.seat })),
      ...[...prevMyIds].filter(id => !currentMyIds.has(id)).map(id => ({ id, seat: me.seat })),
    ];

    if (disappeared.length > 0) {
      setRemovingCards(prev => {
        const next = new Map(prev);
        for (const { id, seat } of disappeared) {
          if (!next.has(id)) {
            // Use last-known data if available; fall back to a minimal ghost.
            const known = lastKnownCards.current.get(id);
            next.set(id, known ?? { id: BigInt(id), slot: 0, ownerSeat: seat, cardDefId: '', attack: 0, health: 0 });
          }
        }
        return next;
      });
    }

    prevCardIds.current.set(opponent.seat, currentEnemyIds);
    prevCardIds.current.set(me.seat, currentMyIds);

    // --- Opponent plays a card: enemy count increases → nameplate wiggle + green flash ---
    // The initial deal is already suppressed by the isInitialMount early-return above;
    // turn-number gating would delay the signal until cdEndTurn (up to a full turn late).
    if (enemyCards.length > prevEnemyCardCount.current) {
      bumpOpponentWiggle = true;
    }
    prevTurnNumber.current = currentTurn;
    prevEnemyCardCount.current = enemyCards.length;

    // Batch state updates to avoid multiple re-renders.
    const cardFlashChanged = [...newCardFlash.entries()].some(([k, v]) => cardFlashTriggers.get(k) !== v)
      || newCardFlash.size !== cardFlashTriggers.size;
    const playerFlashChanged = [...newPlayerFlash.entries()].some(([k, v]) => playerFlashTriggers.get(k) !== v);

    if (cardFlashChanged) setCardFlashTriggers(newCardFlash);
    if (playerFlashChanged) setPlayerFlashTriggers(newPlayerFlash);
    if (bumpOpponentWiggle) {
      setOpponentWiggleTrigger(n => n + 1);
      setOpponentPlayFlashTrigger(n => n + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCards, sessionPlayers, board]);

  const myTurn = me !== undefined && board !== undefined && board.activeSeat === me.seat;

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
  const myFaceFlashTrigger = playerFlashTriggers.get(me.seat) ?? 0;
  const opponentFaceFlashTrigger = playerFlashTriggers.get(opponent.seat) ?? 0;

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

      {/* ---------------------------------------------------------------- */}
      {/* Opponent header row — wiggle + green border flash on card play   */}
      {/* ---------------------------------------------------------------- */}
      <Wiggle trigger={opponentWiggleTrigger} axis="x" amplitude={5}>
        <View
          className="flex-row items-center justify-between rounded-md px-2 py-1"
          style={{ position: 'relative' }}
        >
          <Text className="text-xs text-slate-300" numberOfLines={1}>
            {opponent.username}
          </Text>
          {/* Opponent face HP as lagging bar + numeric */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 64 }}>
              <LaggingHpBar currentHp={opponent.health} maxHp={PLAYER_MAX_HP} height={6} />
            </View>
            <Text className="text-xs text-rose-400">{opponent.health} HP</Text>
          </View>
          {/* "Played a card" green border flash */}
          <FlashOverlay
            trigger={opponentPlayFlashTrigger}
            color={COLOR_PLAY}
            fillMode="border"
            intensity={0.85}
          />
          {/* Face-damage red tint flash */}
          <FlashOverlay
            trigger={opponentFaceFlashTrigger}
            color={COLOR_DAMAGE}
            fillMode="tint"
            intensity={0.35}
          />
        </View>
      </Wiggle>

      {/* ---------------------------------------------------------------- */}
      {/* Opponent board                                                    */}
      {/* ---------------------------------------------------------------- */}
      <View className="flex-row gap-1 h-20">
        {slots.map((_, slot) => {
          const c = enemyCards.find(card => card.slot === slot);
          const ghost = [...removingCards.values()].find(
            r => r.ownerSeat === opponent.seat && r.slot === slot
          );
          const cardKey = c?.id.toString() ?? null;
          const slotFlashTrigger = cardKey ? (cardFlashTriggers.get(cardKey) ?? 0) : 0;
          const isAttackable = myTurn && selectedAttackerId !== null && c !== undefined;
          return (
            <SafePressable
              key={slot}
              onPress={() => c && attackTarget(c.id)}
              disabled={!isAttackable}
              style={{ flex: 1, position: 'relative' }}
              className={`rounded-md items-center justify-center px-1 ${
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
              ) : ghost ? (
                <ShrinkOutCard
                  name={cardName(ghost.cardDefId)}
                  attack={ghost.attack}
                  health={ghost.health}
                  onDone={() =>
                    setRemovingCards(prev => {
                      const next = new Map(prev);
                      next.delete(ghost.id.toString());
                      return next;
                    })
                  }
                />
              ) : null}
              {/* Per-slot damage border flash — pointerEvents none is guaranteed by FlashOverlay */}
              <FlashOverlay
                trigger={slotFlashTrigger}
                color={COLOR_DAMAGE}
                fillMode="border"
                intensity={0.9}
              />
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

      {/* ---------------------------------------------------------------- */}
      {/* My board                                                          */}
      {/* ---------------------------------------------------------------- */}
      <View className="flex-row gap-1 h-20">
        {slots.map((_, slot) => {
          const c = myCards.find(card => card.slot === slot);
          const ghost = [...removingCards.values()].find(
            r => r.ownerSeat === me.seat && r.slot === slot
          );
          const cardKey = c?.id.toString() ?? null;
          const slotFlashTrigger = cardKey ? (cardFlashTriggers.get(cardKey) ?? 0) : 0;
          const isPlayTarget = myTurn && selectedHandIndex !== null && !c;
          return (
            <SafePressable
              key={slot}
              onPress={() => {
                if (isPlayTarget) playCard(slot);
                else if (c) tapMyCard(c.id);
              }}
              disabled={!myTurn || (!c && selectedHandIndex === null)}
              style={{ flex: 1, position: 'relative' }}
              className={`rounded-md items-center justify-center px-1 ${
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
              ) : ghost ? (
                <ShrinkOutCard
                  name={cardName(ghost.cardDefId)}
                  attack={ghost.attack}
                  health={ghost.health}
                  onDone={() =>
                    setRemovingCards(prev => {
                      const next = new Map(prev);
                      next.delete(ghost.id.toString());
                      return next;
                    })
                  }
                />
              ) : null}
              <FlashOverlay
                trigger={slotFlashTrigger}
                color={COLOR_DAMAGE}
                fillMode="border"
                intensity={0.9}
              />
            </SafePressable>
          );
        })}
      </View>

      {/* ---------------------------------------------------------------- */}
      {/* My status bar — lagging HP bar + face-damage flash               */}
      {/* ---------------------------------------------------------------- */}
      <View
        className="flex-row items-center justify-between gap-2 mt-1 px-1"
        style={{ position: 'relative' }}
      >
        <Text className="text-xs text-slate-100" numberOfLines={1}>
          {me.username}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <View style={{ flex: 1 }}>
            <LaggingHpBar currentHp={me.health} maxHp={PLAYER_MAX_HP} height={6} />
          </View>
          <Text className="text-xs text-emerald-400">{me.health} HP</Text>
        </View>
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
        {/* Face-damage red tint flash on my status row */}
        <FlashOverlay
          trigger={myFaceFlashTrigger}
          color={COLOR_DAMAGE}
          fillMode="tint"
          intensity={0.35}
        />
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

// ---------------------------------------------------------------------------
// ShrinkOutCard — ghost card that scales and fades out on removal
// ---------------------------------------------------------------------------

function ShrinkOutCard({
  name,
  attack,
  health,
  onDone,
}: {
  name: string;
  attack: number;
  health: number;
  onDone: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 0,
        duration: SHRINK_OUT_MS,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: SHRINK_OUT_MS,
        useNativeDriver: true,
      }),
    ]).start(() => onDone());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }} className="items-center">
      {name ? (
        <Text className="text-[9px] text-slate-300 text-center" numberOfLines={2}>
          {name}
        </Text>
      ) : null}
      <Text className="text-[11px] font-bold text-slate-400">
        {attack}/{health}
      </Text>
    </Animated.View>
  );
}
