import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';
import BattleLogDrawer from './BattleLogDrawer';
import BattleChatDrawer from './BattleChatDrawer';

interface DefensiveBattleScreenProps {
  username: string;
}

const NO_TARGET = 0n;

export default function DefensiveBattleScreen({ username }: DefensiveBattleScreenProps) {
  const [sessions] = useTable(tables.myDefensiveBattleSession);
  const [participants] = useTable(tables.myDefensiveBattleParticipants);
  const [zombies] = useTable(tables.myDefensiveBattleZombies);
  const [hand] = useTable(tables.myDefensiveBattleHand);
  const [actionDefs] = useTable(tables.actionDefinition);
  const [previews] = useTable(tables.myActionPreviews);

  const performAction = useReducer(reducers.performAction);
  const forfeit = useReducer(reducers.forfeitBattle);

  const session = sessions[0];
  const me = useMemo(
    () => participants.find(p => p.username === username),
    [participants, username]
  );

  const sortedHand = useMemo(
    () => [...hand].sort((a, b) => a.handIndex - b.handIndex),
    [hand]
  );
  const liveZombies = useMemo(() => zombies.filter(z => !z.isDead), [zombies]);
  const liveZombieCount = liveZombies.length;

  const defById = useMemo(() => {
    const m = new Map<string, (typeof actionDefs)[number]>();
    for (const d of actionDefs) m.set(d.actionId, d);
    return m;
  }, [actionDefs]);

  const previewByActionId = useMemo(() => {
    const m = new Map<string, (typeof previews)[number]>();
    for (const p of previews) m.set(p.actionId, p);
    return m;
  }, [previews]);

  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [previewSlotId, setPreviewSlotId] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  // Hover/long-press preview helpers. The 150ms grace period on dismiss
  // prevents flicker when the mouse slides across the gap between adjacent
  // cards: a new card's onPreviewIn arriving within the window cancels the
  // pending dismiss before it fires.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDismiss = () => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };
  const openPreview = (slotId: bigint) => {
    cancelDismiss();
    setPreviewSlotId(slotId);
  };
  const schedulePreviewDismiss = (slotId: bigint) => {
    cancelDismiss();
    dismissTimerRef.current = setTimeout(() => {
      setPreviewSlotId(prev => (prev === slotId ? null : prev));
      dismissTimerRef.current = null;
    }, 150);
  };
  useEffect(() => {
    return () => cancelDismiss();
  }, []);

  // Preview-stale guard: if the previewed slot's actionId changes underneath
  // us (server refilled the slot), dismiss the preview to avoid showing
  // stale data. Track both slotId and actionId so that switching to a
  // different slot doesn't false-positive as a stale refill.
  const previewActionIdRef = useRef<{ slotId: bigint; actionId: string } | null>(null);
  useEffect(() => {
    if (previewSlotId === null) {
      previewActionIdRef.current = null;
      return;
    }
    const slot = sortedHand.find(s => s.id === previewSlotId);
    if (!slot) {
      setPreviewSlotId(null);
      return;
    }
    if (
      previewActionIdRef.current === null ||
      previewActionIdRef.current.slotId !== previewSlotId
    ) {
      previewActionIdRef.current = { slotId: previewSlotId, actionId: slot.actionId };
      return;
    }
    if (previewActionIdRef.current.actionId !== slot.actionId) {
      setPreviewSlotId(null);
      previewActionIdRef.current = null;
    }
  }, [previewSlotId, sortedHand]);

  if (!session || !me) return null;

  const isCompleted = session.state.tag === 'Completed';
  const sessionId = session.sessionId;
  const currentWave = session.currentWave;

  const selectedSlot =
    selectedHandIndex !== null
      ? sortedHand.find(s => s.handIndex === selectedHandIndex) ?? null
      : null;
  const selectedDef = selectedSlot ? defById.get(selectedSlot.actionId) : null;
  const selectedTargeting = selectedDef?.targeting.tag ?? null;

  const fireAction = async (
    handIndex: number,
    targetKind: 'zombie' | 'participant' | 'noTarget',
    targetId: bigint
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      await performAction({ sessionId, handIndex, targetKind, targetId });
      setSelectedHandIndex(null);
    } catch {
      // ignore — server will reject invalid moves
    } finally {
      setBusy(false);
    }
  };

  const onHandTap = (handIndex: number) => {
    const slot = sortedHand.find(s => s.handIndex === handIndex);
    if (!slot) return;
    const def = defById.get(slot.actionId);
    if (!def) return;
    const tag = def.targeting.tag;
    if (tag === 'AllEnemies' || tag === 'AllAllies' || tag === 'PartyIncludingSelf') {
      // No target needed — fire immediately.
      fireAction(handIndex, 'noTarget', NO_TARGET);
      return;
    }
    setSelectedHandIndex(prev => (prev === handIndex ? null : handIndex));
  };

  const onZombieTap = (zombieId: bigint) => {
    if (selectedHandIndex === null || selectedTargeting !== 'SingleEnemy') return;
    fireAction(selectedHandIndex, 'zombie', zombieId);
  };

  const onParticipantTap = (participantId: bigint) => {
    if (selectedHandIndex === null || selectedTargeting !== 'SingleAlly') return;
    fireAction(selectedHandIndex, 'participant', participantId);
  };

  const onForfeit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await forfeit({ sessionId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const previewSlot = previewSlotId !== null
    ? sortedHand.find(s => s.id === previewSlotId) ?? null
    : null;
  const previewDef = previewSlot ? defById.get(previewSlot.actionId) ?? null : null;
  const previewPreview = previewSlot ? previewByActionId.get(previewSlot.actionId) ?? null : null;

  return (
    <View
      className="absolute inset-0 bg-slate-950"
      style={{ zIndex: 200, elevation: 200 }}
    >
      {/* Top bar — compact: title + wave/zombie count + forfeit */}
      <View className="px-4 py-2 border-b border-slate-800 flex-row items-center justify-between">
        <Text className="text-base font-semibold text-slate-100">
          Wave {currentWave} · {liveZombieCount} zombie{liveZombieCount === 1 ? '' : 's'}
        </Text>
        {!me.isDefeated && !isCompleted ? (
          <SafePressable
            onPress={onForfeit}
            className="rounded-lg bg-rose-900/40 border border-rose-700/40 px-3 py-1"
          >
            <Text className="text-xs font-medium text-rose-200">Forfeit</Text>
          </SafePressable>
        ) : null}
      </View>

      {/* Main combat area */}
      <View className="flex-1 flex-row">
        {/* Party column */}
        <View className="w-[40%] border-r border-slate-800 p-2 gap-2">
          <Text className="text-[10px] uppercase tracking-widest text-slate-500" style={{ paddingLeft: 28 }}>
            Party
          </Text>
          <ScrollView contentContainerStyle={{ gap: 8, paddingLeft: 28 }}>
            {participants.map(p => (
              <ParticipantCard
                key={p.id.toString()}
                username={p.username}
                isMe={p.username === username}
                currentHp={p.currentHp}
                maxHp={p.maxHp}
                wardCount={p.wardCount}
                isDefeated={p.isDefeated}
                highlight={
                  selectedTargeting === 'SingleAlly' ||
                  selectedTargeting === 'AllAllies' ||
                  selectedTargeting === 'PartyIncludingSelf'
                }
                onTap={() => onParticipantTap(p.id)}
              />
            ))}
          </ScrollView>
          <BattleChatDrawer username={username} />
        </View>

        {/* Zombie column with log drawer overlay */}
        <View className="flex-1 p-2 gap-2">
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingRight: 32 }}>
            {zombies.map(z => (
              <ZombieCard
                key={z.id.toString()}
                currentHp={z.currentHp}
                maxHp={z.maxHp}
                isDead={z.isDead}
                highlight={selectedTargeting === 'SingleEnemy' || selectedTargeting === 'AllEnemies'}
                onTap={() => onZombieTap(z.id)}
              />
            ))}
            {zombies.length === 0 ? (
              <Text className="text-xs text-slate-500">Spawning…</Text>
            ) : null}
          </ScrollView>
          <BattleLogDrawer />
        </View>
      </View>

      {/* Hand strip — horizontal scroll, single row always.
          The card preview panel sits ABOVE this strip as an absolute overlay,
          so hovering between cards never causes a reflow that yanks the
          card out from under the mouse. */}
      <View className="border-t border-slate-800 px-2 py-2 bg-slate-900">
        {me.isDefeated ? (
          <View className="items-center py-3">
            <Text className="text-sm text-rose-300">You are defeated. Spectating…</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 4, alignItems: 'center' }}
          >
            {sortedHand.map(slot => {
              const def = defById.get(slot.actionId);
              const preview = previewByActionId.get(slot.actionId);
              const isSelected = selectedHandIndex === slot.handIndex;
              return (
                <HandCard
                  key={slot.id.toString()}
                  name={def?.displayName ?? slot.actionId}
                  description={def?.description ?? ''}
                  targetingTag={def?.targeting.tag ?? ''}
                  resolvedKind={preview?.kind ?? ''}
                  resolvedMin={preview?.resolvedMin ?? 0}
                  resolvedMax={preview?.resolvedMax ?? 0}
                  resolvedCount={preview?.resolvedCount ?? 0}
                  selected={isSelected}
                  busy={busy}
                  onTap={() => onHandTap(slot.handIndex)}
                  onPreviewIn={() => openPreview(slot.id)}
                  onPreviewOut={() => schedulePreviewDismiss(slot.id)}
                />
              );
            })}
            {sortedHand.length === 0 ? (
              <Text className="text-xs text-slate-500">Hand empty.</Text>
            ) : null}
          </ScrollView>
        )}
        <View className="flex-row items-center justify-between mt-1.5 px-1">
          <Text className="text-[11px] text-slate-500" numberOfLines={1}>
            {selectedDef
              ? `${selectedDef.displayName} — tap a target`
              : 'Tap a card to play it'}
          </Text>
          <Text className="text-[11px] text-rose-300">
            -{liveZombieCount} HP / action
          </Text>
        </View>
      </View>

      {/* Card preview — absolute overlay above the hand strip. Doesn't
          affect layout when it springs open, so hovering between cards is
          stable. */}
      <CardPreviewPanel def={previewDef} preview={previewPreview} />

      {/* Game-over overlay */}
      {isCompleted ? <BattleEndedOverlay finalWave={currentWave} /> : null}
    </View>
  );
}

// ---------- Participant card with HP bar + damage pop ----------

function ParticipantCard({
  username,
  isMe,
  currentHp,
  maxHp,
  wardCount,
  isDefeated,
  highlight,
  onTap,
}: {
  username: string;
  isMe: boolean;
  currentHp: number;
  maxHp: number;
  wardCount: number;
  isDefeated: boolean;
  highlight: boolean;
  onTap: () => void;
}) {
  const safeHp = Math.max(0, currentHp);
  const pct = maxHp > 0 ? (safeHp / maxHp) * 100 : 0;
  const borderClass = isDefeated
    ? 'border-slate-800 opacity-60'
    : highlight
      ? 'border-emerald-400 shadow-emerald-500/40'
      : isMe
        ? 'border-amber-500/40'
        : 'border-slate-700';
  const bgClass = isDefeated ? 'bg-slate-900' : 'bg-slate-900';
  return (
    <SafePressable
      onPress={onTap}
      disabled={!highlight || isDefeated}
      className={`rounded-xl border px-3 py-2 ${borderClass} ${bgClass}`}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-slate-100">
          {username}
          {isMe ? ' (you)' : ''}
        </Text>
        {wardCount > 0 ? (
          <View className="rounded-md bg-cyan-500/20 px-1.5 py-0.5">
            <Text className="text-[10px] text-cyan-300">⛨ {wardCount}</Text>
          </View>
        ) : null}
      </View>
      <View className="h-2 rounded-full bg-slate-800 overflow-hidden mt-1.5">
        <View
          className={pct > 33 ? 'h-full bg-emerald-500' : 'h-full bg-rose-500'}
          style={{ width: `${pct}%` }}
        />
      </View>
      <View className="flex-row items-center justify-between mt-1">
        <DamagePop value={currentHp} kind="participant" />
        <Text className="text-[11px] text-slate-400">
          {safeHp} / {maxHp}
        </Text>
      </View>
      {isDefeated ? (
        <Text className="text-[10px] text-rose-400 uppercase tracking-widest mt-1">
          Defeated
        </Text>
      ) : null}
    </SafePressable>
  );
}

// ---------- Zombie card ----------

function ZombieCard({
  currentHp,
  maxHp,
  isDead,
  highlight,
  onTap,
}: {
  currentHp: number;
  maxHp: number;
  isDead: boolean;
  highlight: boolean;
  onTap: () => void;
}) {
  const safeHp = Math.max(0, currentHp);
  const pct = maxHp > 0 ? (safeHp / maxHp) * 100 : 0;
  const opacity = isDead ? 0.25 : 1;
  const borderClass = isDead
    ? 'border-slate-800'
    : highlight
      ? 'border-amber-400'
      : 'border-slate-700';
  return (
    <SafePressable
      onPress={onTap}
      disabled={!highlight || isDead}
      style={{ opacity, width: 80, height: 76 }}
      className={`rounded-xl border bg-slate-900 px-2 py-1.5 ${borderClass}`}
    >
      <Text className="text-[10px] uppercase tracking-widest text-slate-500">
        Zombie
      </Text>
      <View className="h-1.5 rounded-full bg-slate-800 overflow-hidden mt-1">
        <View
          className="h-full bg-rose-500"
          style={{ width: `${pct}%` }}
        />
      </View>
      <View className="flex-row items-center justify-between mt-1">
        <DamagePop value={currentHp} kind="zombie" />
        <Text className="text-[10px] text-slate-400">
          {safeHp}/{maxHp}
        </Text>
      </View>
    </SafePressable>
  );
}

// ---------- Hand card ----------

const TARGETING_LABEL: Record<string, string> = {
  SingleEnemy: '1 enemy',
  AllEnemies: 'all enemies',
  SingleAlly: '1 ally',
  AllAllies: 'all allies',
  PartyIncludingSelf: 'party',
};

function formatRange(kind: string, min: number, max: number, count: number): string {
  if (kind === 'damage') return min === max ? `${min} dmg` : `${min}–${max} dmg`;
  if (kind === 'healAmount') return min === max ? `+${min} HP` : `+${min}–${max} HP`;
  if (kind === 'healFull') return 'Full heal';
  if (kind === 'ward') return count === 1 ? `${count} ward` : `${count} wards`;
  return '';
}

function HandCard({
  name,
  description,
  targetingTag,
  resolvedKind,
  resolvedMin,
  resolvedMax,
  resolvedCount,
  selected,
  busy,
  onTap,
  onPreviewIn,
  onPreviewOut,
}: {
  name: string;
  description: string;
  targetingTag: string;
  resolvedKind: string;
  resolvedMin: number;
  resolvedMax: number;
  resolvedCount: number;
  selected: boolean;
  busy: boolean;
  onTap: () => void;
  onPreviewIn: () => void;
  onPreviewOut: () => void;
}) {
  const borderClass = selected
    ? 'border-amber-400 bg-amber-500/15'
    : 'border-slate-700 bg-slate-900';
  const range = formatRange(resolvedKind, resolvedMin, resolvedMax, resolvedCount);
  const targetingLabel = TARGETING_LABEL[targetingTag] ?? targetingTag;

  // Web: hover to preview. Mobile: long-press to preview. The
  // gesture-recognizer concern from devils-advocate is that pairing
  // onLongPress with onPress can delay onPress. SafePressable wraps
  // Pressable, which keeps onPress instant; onLongPress fires after the
  // 500ms threshold WITHOUT delaying onPress.
  const hoverProps =
    Platform.OS === 'web'
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onHoverIn: onPreviewIn as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onHoverOut: onPreviewOut as any,
        }
      : {};

  return (
    <SafePressable
      onPress={onTap}
      onLongPress={onPreviewIn}
      onPressOut={() => {
        // On mobile, dismiss the preview when finger releases (preview lives
        // for the duration of the long-press). On web this is harmless since
        // hoverOut also fires.
        if (Platform.OS !== 'web') onPreviewOut();
      }}
      disabled={busy}
      style={{ width: 140, height: 126 }}
      className={`rounded-xl border px-2 py-1.5 ${borderClass}`}
      {...hoverProps}
    >
      <Text className="text-[13px] font-semibold text-slate-100" numberOfLines={1}>
        {name}
      </Text>
      <Text className="text-[10px] text-slate-400 mt-0.5" numberOfLines={3}>
        {description}
      </Text>
      <Text className="text-[10px] text-amber-300 mt-1" numberOfLines={1}>
        {range}
      </Text>
      <View className="self-start rounded-md bg-slate-800 px-1.5 py-0.5 mt-auto">
        <Text className="text-[9px] uppercase tracking-widest text-amber-300">
          {targetingLabel}
        </Text>
      </View>
    </SafePressable>
  );
}

// ---------- Card preview panel (fixed reserved zone) ----------
//
// When the player hovers (web) or long-presses (mobile) a hand card, this
// panel springs open to show full details: full description, plain-English
// targeting, and the resolved effect range. Lives between the battlefield
// and the hand strip — same screen region regardless of which card was
// triggered, so no popover anchor math.

function CardPreviewPanel({
  def,
  preview,
}: {
  def: {
    displayName: string;
    description: string;
    targeting: { tag: string };
  } | null;
  preview: {
    kind: string;
    resolvedMin: number;
    resolvedMax: number;
    resolvedCount: number;
  } | null;
}) {
  const heightAnim = useRef(new Animated.Value(0)).current;
  const visible = def !== null;
  useEffect(() => {
    Animated.spring(heightAnim, {
      toValue: visible ? 110 : 0,
      tension: 200,
      friction: 20,
      useNativeDriver: false,
    }).start();
  }, [visible, heightAnim]);

  // Absolute-positioned overlay anchored to the bottom of the screen ABOVE
  // the hand strip. Doesn't reflow when it opens, so hovering between cards
  // doesn't cause the cards to move out from under the mouse cursor.
  // The HAND_STRIP_OFFSET below pins the panel just above the hand strip.
  const HAND_STRIP_OFFSET = 156; // approx hand strip height + footer
  const overlayStyle = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: HAND_STRIP_OFFSET,
    height: heightAnim,
    overflow: 'hidden' as const,
    zIndex: 50,
  };

  if (!def) {
    return (
      <Animated.View
        style={overlayStyle}
        className="bg-slate-900/95 border-t border-b border-slate-800"
        pointerEvents="none"
      />
    );
  }

  const targetingLabel = TARGETING_LABEL[def.targeting.tag] ?? def.targeting.tag;
  const range = preview
    ? formatRange(
        preview.kind,
        preview.resolvedMin,
        preview.resolvedMax,
        preview.resolvedCount
      )
    : '';

  return (
    <Animated.View
      style={overlayStyle}
      className="bg-slate-900/95 border-t border-b border-slate-800"
      pointerEvents="none"
    >
      <View className="px-4 py-2 gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-semibold text-slate-100">
            {def.displayName}
          </Text>
          <View className="rounded-md bg-slate-800 px-1.5 py-0.5">
            <Text className="text-[10px] uppercase tracking-widest text-amber-300">
              {targetingLabel}
            </Text>
          </View>
          {range ? (
            <Text className="text-[12px] font-semibold text-amber-300">
              {range}
            </Text>
          ) : null}
        </View>
        <Text className="text-[12px] text-slate-300">{def.description}</Text>
      </View>
    </Animated.View>
  );
}

// ---------- Damage-pop animation (the quality bar) ----------
//
// Detects HP changes and pops the delta as an animated number that floats up
// and fades out. Mounts a tiny floating Text over the caller's location on
// each change. Matches PM's "self-damage arc must be visible" requirement.

function DamagePop({ value, kind }: { value: number; kind: 'participant' | 'zombie' }) {
  const prev = useRef(value);
  const [delta, setDelta] = useState<number | null>(null);
  const [seq, setSeq] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (value !== prev.current) {
      const diff = value - prev.current;
      prev.current = value;
      if (diff !== 0) {
        setDelta(diff);
        setSeq(s => s + 1);
        anim.setValue(0);
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 480,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setDelta(null);
        });
      }
    }
  }, [value, anim]);

  if (delta === null) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -16],
  });
  const opacity = anim.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 1, 0],
  });
  const isHeal = delta > 0;
  const colorClass = isHeal
    ? 'text-emerald-300'
    : kind === 'participant'
      ? 'text-rose-400'
      : 'text-amber-300';
  return (
    <Animated.Text
      key={seq}
      className={`text-xs font-semibold ${colorClass}`}
      style={{ transform: [{ translateY }], opacity }}
    >
      {isHeal ? `+${delta}` : delta}
    </Animated.Text>
  );
}

// ---------- Game-over overlay ----------

function BattleEndedOverlay({ finalWave }: { finalWave: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade]);
  return (
    <Animated.View
      className="absolute inset-0 items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', opacity: fade }}
    >
      <Text className="text-2xl font-bold text-slate-100">Battle ended.</Text>
      <Text className="text-sm text-slate-400 mt-2">
        You held out through wave {finalWave}.
      </Text>
      <Text className="text-xs text-slate-500 mt-4">
        Loot summary in your notifications. Returning…
      </Text>
    </Animated.View>
  );
}
