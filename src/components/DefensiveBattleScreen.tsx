import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';
import BattleLogDrawer from './BattleLogDrawer';
import BattleChatDrawer from './BattleChatDrawer';
import {
  DamagePop,
  FlashOverlay,
  LaggingHpBar,
  PlayedCardPopout,
  Wiggle,
  COLOR_DAMAGE,
  COLOR_HEAL_VIBRANT,
  COLOR_PLAY,
  COLOR_SHIELD,
  COLOR_ZOMBIE_HIT,
  SHRINK_OUT_MS,
} from './feedback';
import { useSpotlightRegistry, useSpotlightTarget } from './SpotlightTargetRegistry';

interface DefensiveBattleScreenProps {
  username: string;
}

const NO_TARGET = 0n;

export default function DefensiveBattleScreen({ username }: DefensiveBattleScreenProps) {
  const [sessions] = useTable(tables.myDefensiveBattleSession);
  const [participants] = useTable(tables.myDefensiveBattleParticipants);
  const [zombies] = useTable(tables.myDefensiveBattleZombies);
  const [hand] = useTable(tables.myDefensiveBattleHand);
  const [partyDecks] = useTable(tables.partyDefensiveBattleDecks);
  const [actionDefs] = useTable(tables.actionDefinition);
  const [previews] = useTable(tables.myActionPreviews);
  const [logs] = useTable(tables.myDefensiveBattleLog);

  const performAction = useReducer(reducers.performAction);
  const forfeit = useReducer(reducers.forfeitBattle);

  const session = sessions[0];
  const me = useMemo(
    () => participants.find(p => p.username === username),
    [participants, username]
  );

  // Cycling Deck: hand = entire deck sorted by deckOrder; the first handSize
  // entries are the playable hand, the rest are queue (visible but inert).
  const sortedHand = useMemo(
    () => [...hand].sort((a, b) => a.deckOrder - b.deckOrder),
    [hand]
  );

  // Co-op coordination: top-of-deck card for every party member, excluding
  // self. Surfaces "Sarah has Revive next" so duplicate-cast races become
  // information problems instead of timing problems.
  const teammateNextCardByUsername = useMemo(() => {
    const m = new Map<string, string>();
    const sorted = [...partyDecks].sort((a, b) => a.deckOrder - b.deckOrder);
    for (const c of sorted) {
      if (c.username === username) continue;
      if (m.has(c.username)) continue;
      m.set(c.username, c.actionId);
    }
    return m;
  }, [partyDecks, username]);
  const liveZombies = useMemo(() => zombies.filter(z => !z.isDead), [zombies]);
  const liveZombieCount = liveZombies.length;
  // Sum of live zombie attack values — what the next self-damage tick will be.
  const liveThreatTotal = useMemo(
    () => liveZombies.reduce((sum, z) => sum + z.attack, 0),
    [liveZombies]
  );

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

  // Hover/long-press preview helpers.
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

  // Preview-stale guard.
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

  // -------------------------------------------------------------------------
  // Animation state
  // -------------------------------------------------------------------------

  // Per-participant triggers: keyed by participant id (bigint → string).
  const [participantWiggleTriggers, setParticipantWiggleTriggers] = useState<Map<string, number>>(new Map());
  const [participantPlayFlashTriggers, setParticipantPlayFlashTriggers] = useState<Map<string, number>>(new Map());
  const [participantDamageFlashTriggers, setParticipantDamageFlashTriggers] = useState<Map<string, number>>(new Map());
  const [participantHealFlashTriggers, setParticipantHealFlashTriggers] = useState<Map<string, number>>(new Map());
  const [participantShieldFlashTriggers, setParticipantShieldFlashTriggers] = useState<Map<string, number>>(new Map());

  // Per-zombie triggers: keyed by zombie id string.
  const [zombieDamageFlashTriggers, setZombieDamageFlashTriggers] = useState<Map<string, number>>(new Map());
  // Zombie death shrink: set of zombie id strings currently animating shrink-out.
  const [shrinkingZombies, setShrinkingZombies] = useState<Set<string>>(new Set());

  // Played-card popout: per-participant trigger + last-resolved payload. Most-
  // recent-wins (a new bump cancels any in-flight popout for that participant).
  interface PopoutPayload {
    displayName: string;
    targetingTag: string;
    kind: string;
    totalAmount: number;
    targetCount: number;
  }
  const [popoutTriggers, setPopoutTriggers] = useState<Map<string, number>>(new Map());
  const [popoutPayloads, setPopoutPayloads] = useState<Map<string, PopoutPayload>>(new Map());

  // -------------------------------------------------------------------------
  // Log-driven: actor nameplate wiggle + green flash
  // -------------------------------------------------------------------------

  // Prime lastSeenLogId on mount so historical rows don't replay as animations.
  // We use a ref (not state) so the priming happens synchronously before the
  // first log-diff useEffect runs.
  const lastSeenLogId = useRef<bigint>(-1n);
  const logPrimedRef = useRef(false);

  useEffect(() => {
    if (!logPrimedRef.current && logs.length > 0) {
      // Set to current max id — any rows already present when we mounted are "old".
      const maxId = logs.reduce((max, r) => (r.id > max ? r.id : max), 0n);
      lastSeenLogId.current = maxId;
      logPrimedRef.current = true;
    }
  }, [logs]);

  useEffect(() => {
    if (!logPrimedRef.current) return;

    const newRows = logs.filter(r => r.id > lastSeenLogId.current);
    if (newRows.length === 0) return;

    const maxSeen = newRows.reduce((max, r) => (r.id > max ? r.id : max), lastSeenLogId.current);
    lastSeenLogId.current = maxSeen;

    // For each new ActionResolved entry, find the matching participant and bump their triggers.
    const actionResolvedRows = newRows.filter(r => r.eventKind.tag === 'ActionResolved');
    if (actionResolvedRows.length === 0) return;

    setParticipantWiggleTriggers(prev => {
      const next = new Map(prev);
      for (const row of actionResolvedRows) {
        const p = participants.find(p => p.username === row.actorUsername);
        if (p) {
          const key = p.id.toString();
          next.set(key, (next.get(key) ?? 0) + 1);
        }
      }
      return next;
    });
    setParticipantPlayFlashTriggers(prev => {
      const next = new Map(prev);
      for (const row of actionResolvedRows) {
        const p = participants.find(p => p.username === row.actorUsername);
        if (p) {
          const key = p.id.toString();
          next.set(key, (next.get(key) ?? 0) + 1);
        }
      }
      return next;
    });

    // Per-participant played-card popout: parse payload, look up the action
    // def, store the latest resolved outcome. Replace-on-new (most-recent-wins).
    const nextPayloads = new Map(popoutPayloads);
    const triggerBumps = new Map<string, number>();
    for (const row of actionResolvedRows) {
      const p = participants.find(p => p.username === row.actorUsername);
      if (!p) continue;
      let parsed: {
        actionId?: string;
        kind?: string;
        totalAmount?: number;
        targetCount?: number;
      } = {};
      try {
        parsed = JSON.parse(row.payload);
      } catch {
        continue;
      }
      const actionId = parsed.actionId;
      if (!actionId) continue;
      const def = defById.get(actionId);
      if (!def) continue;
      const key = p.id.toString();
      nextPayloads.set(key, {
        displayName: def.displayName,
        targetingTag: def.targeting.tag,
        kind: parsed.kind ?? 'damage',
        totalAmount: Number(parsed.totalAmount ?? 0),
        targetCount: Number(parsed.targetCount ?? 1),
      });
      triggerBumps.set(key, (triggerBumps.get(key) ?? 0) + 1);
    }
    if (triggerBumps.size > 0) {
      setPopoutPayloads(nextPayloads);
      setPopoutTriggers(prev => {
        const next = new Map(prev);
        for (const [key, bump] of triggerBumps) {
          next.set(key, (next.get(key) ?? 0) + bump);
        }
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs]);

  // -------------------------------------------------------------------------
  // State-diff-driven: per-participant HP / wardCount diffs
  // -------------------------------------------------------------------------

  const prevParticipantHp = useRef(new Map<string, number>());
  const prevParticipantWard = useRef(new Map<string, number>());
  const prevParticipantDefeated = useRef(new Map<string, boolean>());
  const participantDiffPrimedRef = useRef(false);

  useEffect(() => {
    if (!participantDiffPrimedRef.current) {
      // Seed refs without animating.
      for (const p of participants) {
        const key = p.id.toString();
        prevParticipantHp.current.set(key, p.currentHp);
        prevParticipantWard.current.set(key, p.wardCount);
        prevParticipantDefeated.current.set(key, p.isDefeated);
      }
      participantDiffPrimedRef.current = true;
      return;
    }

    const newDamage = new Map(participantDamageFlashTriggers);
    const newHeal = new Map(participantHealFlashTriggers);
    const newShield = new Map(participantShieldFlashTriggers);
    let anyChange = false;

    for (const p of participants) {
      const key = p.id.toString();
      const prevHp = prevParticipantHp.current.get(key);
      const prevWard = prevParticipantWard.current.get(key);
      const prevDefeated = prevParticipantDefeated.current.get(key);

      if (prevHp !== undefined) {
        if (p.currentHp < prevHp) {
          // HP dropped — damage flash.
          newDamage.set(key, (newDamage.get(key) ?? 0) + 1);
          anyChange = true;
        } else if (p.currentHp > prevHp || (prevDefeated === true && !p.isDefeated)) {
          // HP rose or revived — heal flash.
          newHeal.set(key, (newHeal.get(key) ?? 0) + 1);
          anyChange = true;
        }
      }

      if (prevWard !== undefined && p.wardCount > prevWard) {
        // Ward count increased — shield flash.
        newShield.set(key, (newShield.get(key) ?? 0) + 1);
        anyChange = true;
      }

      prevParticipantHp.current.set(key, p.currentHp);
      prevParticipantWard.current.set(key, p.wardCount);
      prevParticipantDefeated.current.set(key, p.isDefeated);
    }

    if (anyChange) {
      setParticipantDamageFlashTriggers(newDamage);
      setParticipantHealFlashTriggers(newHeal);
      setParticipantShieldFlashTriggers(newShield);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  // -------------------------------------------------------------------------
  // State-diff-driven: zombie HP diffs + death shrink
  // -------------------------------------------------------------------------

  const prevZombieHp = useRef(new Map<string, number>());
  const prevZombieDead = useRef(new Map<string, boolean>());
  const zombieDiffPrimedRef = useRef(false);

  useEffect(() => {
    if (!zombieDiffPrimedRef.current) {
      for (const z of zombies) {
        const key = z.id.toString();
        prevZombieHp.current.set(key, z.currentHp);
        prevZombieDead.current.set(key, z.isDead);
      }
      zombieDiffPrimedRef.current = true;
      return;
    }

    const newZombieDamage = new Map(zombieDamageFlashTriggers);
    let anyZombieChange = false;
    const newShrinking: string[] = [];

    for (const z of zombies) {
      const key = z.id.toString();
      const prevHp = prevZombieHp.current.get(key);
      const wasDead = prevZombieDead.current.get(key);

      if (prevHp !== undefined && z.currentHp < prevHp && !z.isDead) {
        // HP dropped and still alive — damage flash.
        newZombieDamage.set(key, (newZombieDamage.get(key) ?? 0) + 1);
        anyZombieChange = true;
      }

      if (wasDead === false && z.isDead) {
        // Just died — start shrink-out animation.
        newShrinking.push(key);
      }

      prevZombieHp.current.set(key, z.currentHp);
      prevZombieDead.current.set(key, z.isDead);
    }

    if (anyZombieChange) setZombieDamageFlashTriggers(newZombieDamage);
    if (newShrinking.length > 0) {
      setShrinkingZombies(prev => {
        const next = new Set(prev);
        for (const k of newShrinking) next.add(k);
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zombies]);

  if (!session || !me) return null;

  const isCompleted = session.state.tag === 'Completed';
  const sessionId = session.sessionId;
  const currentWave = session.currentWave;

  // selectedHandIndex is now a position into sortedHand (0..length-1).
  const selectedSlot =
    selectedHandIndex !== null
      ? sortedHand[selectedHandIndex] ?? null
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

  // handIndex is the position in sortedHand (0..handSize-1, top of deck first).
  const onHandTap = (handIndex: number) => {
    const slot = sortedHand[handIndex];
    if (!slot) return;
    const def = defById.get(slot.actionId);
    if (!def) return;
    const tag = def.targeting.tag;
    if (tag === 'AllEnemies' || tag === 'AllAllies' || tag === 'PartyIncludingSelf') {
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
      {/* Top bar */}
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
            {participants.map(p => {
              const key = p.id.toString();
              const nextActionId = teammateNextCardByUsername.get(p.username);
              const nextCardName = nextActionId
                ? defById.get(nextActionId)?.displayName ?? null
                : null;
              return (
                <ParticipantCard
                  key={key}
                  participantId={p.id}
                  username={p.username}
                  isMe={p.username === username}
                  nextCardName={nextCardName}
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
                  wiggleTrigger={participantWiggleTriggers.get(key) ?? 0}
                  playFlashTrigger={participantPlayFlashTriggers.get(key) ?? 0}
                  damageFlashTrigger={participantDamageFlashTriggers.get(key) ?? 0}
                  healFlashTrigger={participantHealFlashTriggers.get(key) ?? 0}
                  shieldFlashTrigger={participantShieldFlashTriggers.get(key) ?? 0}
                />
              );
            })}
          </ScrollView>
          <BattleChatDrawer username={username} />
        </View>

        {/* Zombie column */}
        <View className="flex-1 p-2 gap-2">
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingRight: 32 }}>
            {zombies.map(z => {
              const key = z.id.toString();
              const kindTag = (z.kind?.tag ?? 'basic') as 'basic' | 'armored' | 'juggernaut';
              return (
                <ZombieCard
                  key={key}
                  kind={kindTag}
                  currentHp={z.currentHp}
                  maxHp={z.maxHp}
                  armor={z.armor ?? 0}
                  attack={z.attack ?? 1}
                  isDead={z.isDead}
                  highlight={selectedTargeting === 'SingleEnemy' || selectedTargeting === 'AllEnemies'}
                  onTap={() => onZombieTap(z.id)}
                  damageFlashTrigger={zombieDamageFlashTriggers.get(key) ?? 0}
                  isShrinking={shrinkingZombies.has(key)}
                  onShrinkDone={() =>
                    setShrinkingZombies(prev => {
                      const next = new Set(prev);
                      next.delete(key);
                      return next;
                    })
                  }
                />
              );
            })}
            {zombies.length === 0 ? (
              <Text className="text-xs text-slate-500">Spawning…</Text>
            ) : null}
          </ScrollView>
          <BattleLogDrawer />
        </View>
      </View>

      {/* Hand strip */}
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
            {sortedHand.map((slot, idx) => {
              const def = defById.get(slot.actionId);
              const preview = previewByActionId.get(slot.actionId);
              const isInHand = idx < me.handSize;
              const isSelected = selectedHandIndex === idx;
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
                  busy={busy || !isInHand}
                  dimmed={!isInHand}
                  onTap={() => isInHand && onHandTap(idx)}
                  onPreviewIn={() => openPreview(slot.id)}
                  onPreviewOut={() => schedulePreviewDismiss(slot.id)}
                />
              );
            })}
            {sortedHand.length === 0 ? (
              <Text className="text-xs text-slate-500">Deck empty.</Text>
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
            -{liveThreatTotal} HP / action
          </Text>
        </View>
      </View>

      {/* Card preview */}
      <CardPreviewPanel def={previewDef} preview={previewPreview} />

      {/* Played-card popout layer — one popout per participant, anchored to
          their nameplate via SpotlightTargetRegistry. */}
      <PlayedCardPopoutLayer
        participants={participants}
        triggers={popoutTriggers}
        payloads={popoutPayloads}
      />

      {/* Game-over overlay */}
      {isCompleted ? <BattleEndedOverlay finalWave={currentWave} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PlayedCardPopoutLayer — one popout per participant, anchored via the
// shared SpotlightTargetRegistry. Renders absolutely over the screen.
// ---------------------------------------------------------------------------

interface PlayedCardPopoutLayerPayload {
  displayName: string;
  targetingTag: string;
  kind: string;
  totalAmount: number;
  targetCount: number;
}

function PlayedCardPopoutLayer({
  participants,
  triggers,
  payloads,
}: {
  participants: ReadonlyArray<{ id: bigint }>;
  triggers: Map<string, number>;
  payloads: Map<string, PlayedCardPopoutLayerPayload>;
}) {
  const { getTarget } = useSpotlightRegistry();
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0"
      style={{ zIndex: 250 }}
    >
      {participants.map(p => {
        const key = p.id.toString();
        const trigger = triggers.get(key) ?? 0;
        const payload = payloads.get(key);
        if (trigger <= 0 || !payload) return null;
        const anchor = getTarget('participant:' + key);
        return (
          <PlayedCardPopout
            key={key}
            trigger={trigger}
            displayName={payload.displayName}
            targetingTag={payload.targetingTag}
            kind={payload.kind}
            totalAmount={payload.totalAmount}
            targetCount={payload.targetCount}
            anchor={anchor}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ParticipantCard — wrapped with Wiggle + FlashOverlay triggers
// ---------------------------------------------------------------------------

function ParticipantCard({
  participantId,
  username,
  isMe,
  currentHp,
  maxHp,
  wardCount,
  isDefeated,
  highlight,
  onTap,
  wiggleTrigger,
  playFlashTrigger,
  damageFlashTrigger,
  healFlashTrigger,
  shieldFlashTrigger,
  nextCardName,
}: {
  participantId: bigint;
  username: string;
  isMe: boolean;
  currentHp: number;
  maxHp: number;
  wardCount: number;
  isDefeated: boolean;
  highlight: boolean;
  onTap: () => void;
  wiggleTrigger: number;
  playFlashTrigger: number;
  damageFlashTrigger: number;
  healFlashTrigger: number;
  shieldFlashTrigger: number;
  // Top-of-deck preview from co-op view. null for self / unknown.
  nextCardName: string | null;
}) {
  // Register this nameplate's screen-relative position for the popout layer.
  // Reuses SpotlightTargetRegistry with a participant: namespace per the spec.
  const spotlight = useSpotlightTarget('participant:' + participantId.toString());
  const safeHp = Math.max(0, currentHp);
  const borderClass = isDefeated
    ? 'border-slate-800 opacity-60'
    : highlight
      ? 'border-emerald-400 shadow-emerald-500/40'
      : isMe
        ? 'border-amber-500/40'
        : 'border-slate-700';
  const bgClass = isDefeated ? 'bg-slate-900' : 'bg-slate-900';
  return (
    <Wiggle trigger={wiggleTrigger} axis="x" amplitude={4}>
      <View ref={spotlight.ref} onLayout={spotlight.onLayout} collapsable={false}>
      <SafePressable
        onPress={onTap}
        disabled={!highlight}
        style={{ position: 'relative' }}
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
        <View className="mt-1.5">
          <LaggingHpBar currentHp={currentHp} maxHp={maxHp} height={8} />
        </View>
        <View className="flex-row items-center justify-between mt-1">
          <DamagePop value={currentHp} color={COLOR_DAMAGE} />
          <Text className="text-[11px] text-slate-400">
            {safeHp} / {maxHp}
          </Text>
        </View>
        {isDefeated ? (
          <Text className="text-[10px] text-rose-400 uppercase tracking-widest mt-1">
            Defeated
          </Text>
        ) : nextCardName ? (
          <Text className="text-[10px] text-slate-400 mt-1" numberOfLines={1}>
            Next: <Text className="text-slate-200">{nextCardName}</Text>
          </Text>
        ) : null}
        {/* Flash overlays — unconditionally mounted, invisible until triggered */}
        <FlashOverlay trigger={playFlashTrigger} color={COLOR_PLAY} fillMode="tint" intensity={0.45} />
        <FlashOverlay trigger={damageFlashTrigger} color={COLOR_DAMAGE} fillMode="tint" intensity={0.45} />
        <FlashOverlay trigger={healFlashTrigger} color={COLOR_HEAL_VIBRANT} fillMode="tint" intensity={0.45} />
        <FlashOverlay trigger={shieldFlashTrigger} color={COLOR_SHIELD} fillMode="tint" intensity={0.45} />
      </SafePressable>
      </View>
    </Wiggle>
  );
}

// ---------------------------------------------------------------------------
// ZombieCard — wrapped with damage flash + shrink-out animation
// ---------------------------------------------------------------------------

function ZombieCard({
  kind,
  currentHp,
  maxHp,
  armor,
  attack,
  isDead,
  highlight,
  onTap,
  damageFlashTrigger,
  isShrinking,
  onShrinkDone,
}: {
  kind: 'basic' | 'armored' | 'juggernaut';
  currentHp: number;
  maxHp: number;
  armor: number;
  attack: number;
  isDead: boolean;
  highlight: boolean;
  onTap: () => void;
  damageFlashTrigger: number;
  isShrinking: boolean;
  onShrinkDone: () => void;
}) {
  const safeHp = Math.max(0, currentHp);
  const opacity = isDead && !isShrinking ? 0.25 : 1;
  const isJugg = kind === 'juggernaut';
  const isArmored = kind === 'armored';
  const tileWidth = isJugg ? 120 : 80;
  const tileHeight = isJugg ? 100 : 76;
  const label = isJugg ? 'Juggernaut' : isArmored ? 'Armored' : 'Zombie';
  const labelColor = isJugg
    ? 'text-amber-400'
    : isArmored
      ? 'text-sky-400'
      : 'text-slate-500';
  const tileBg = isJugg
    ? 'bg-amber-950/40'
    : isArmored
      ? 'bg-sky-950/30'
      : 'bg-slate-900';
  const borderClass = isDead
    ? 'border-slate-800'
    : highlight
      ? 'border-amber-400'
      : isJugg
        ? 'border-amber-700/60'
        : isArmored
          ? 'border-sky-700/60'
          : 'border-slate-700';

  // Shrink-out animation when zombie dies.
  const shrinkScale = useRef(new Animated.Value(1)).current;
  const shrinkOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isShrinking) {
      Animated.parallel([
        Animated.timing(shrinkScale, {
          toValue: 0,
          duration: SHRINK_OUT_MS,
          useNativeDriver: true,
        }),
        Animated.timing(shrinkOpacity, {
          toValue: 0,
          duration: SHRINK_OUT_MS,
          useNativeDriver: true,
        }),
      ]).start(() => onShrinkDone());
    } else {
      shrinkScale.setValue(1);
      shrinkOpacity.setValue(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShrinking]);

  return (
    <Animated.View
      style={{
        transform: [{ scale: shrinkScale }],
        opacity: isShrinking ? shrinkOpacity : opacity,
      }}
    >
      <SafePressable
        onPress={onTap}
        disabled={!highlight || isDead}
        style={{ width: tileWidth, height: tileHeight, position: 'relative' }}
        className={`rounded-xl border ${tileBg} px-2 py-1.5 ${borderClass}`}
      >
        <Text className={`text-[10px] uppercase tracking-widest ${labelColor}`}>
          {label}
        </Text>
        {/* Threat badge — sum of live zombies' attack = next self-damage tick. */}
        {!isDead ? (
          <View
            className="absolute flex-row items-center"
            style={{ top: 4, right: 6, gap: 1 }}
            pointerEvents="none"
          >
            <Text className="text-[9px] text-rose-400">⚔</Text>
            <Text className={`${isJugg ? 'text-sm' : 'text-[11px]'} font-semibold text-rose-300`}>
              {attack}
            </Text>
          </View>
        ) : null}
        {isArmored && armor > 0 ? (
          <View className="flex-row gap-0.5 mt-1">
            {Array.from({ length: armor }).map((_, i) => (
              <View
                key={i}
                className="rounded-sm bg-sky-400/80"
                style={{ width: 6, height: 6 }}
              />
            ))}
          </View>
        ) : null}
        <View className="mt-1">
          <LaggingHpBar
            currentHp={currentHp}
            maxHp={maxHp}
            height={isJugg ? 8 : 6}
            ghostColor={COLOR_DAMAGE}
          />
        </View>
        <View className="flex-row items-center justify-between mt-1">
          <DamagePop value={currentHp} color={COLOR_ZOMBIE_HIT} />
          <Text className={`${isJugg ? 'text-xs' : 'text-[10px]'} text-slate-400`}>
            {safeHp}/{maxHp}
          </Text>
        </View>
        {/* Damage border flash — border mode for dense small tiles */}
        <FlashOverlay
          trigger={damageFlashTrigger}
          color={COLOR_DAMAGE}
          fillMode="border"
          intensity={0.9}
        />
      </SafePressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Hand card
// ---------------------------------------------------------------------------

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
  dimmed = false,
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
  dimmed?: boolean;
  onTap: () => void;
  onPreviewIn: () => void;
  onPreviewOut: () => void;
}) {
  const borderClass = selected
    ? 'border-amber-400 bg-amber-500/15'
    : dimmed
      ? 'border-slate-800 bg-slate-950'
      : 'border-slate-700 bg-slate-900';
  const range = formatRange(resolvedKind, resolvedMin, resolvedMax, resolvedCount);
  const targetingLabel = TARGETING_LABEL[targetingTag] ?? targetingTag;

  const hoverProps =
    Platform.OS === 'web'
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onHoverIn: onPreviewIn as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onHoverOut: onPreviewOut as any,
        }
      : {};

  // Queue cards (dimmed) shrink horizontally and lower their opacity so the
  // hand vs queue split is visually obvious without blocking horizontal scroll.
  return (
    <SafePressable
      onPress={onTap}
      onLongPress={onPreviewIn}
      onPressOut={() => {
        if (Platform.OS !== 'web') onPreviewOut();
      }}
      disabled={busy}
      style={{
        width: dimmed ? 100 : 140,
        height: dimmed ? 110 : 126,
        opacity: dimmed ? 0.55 : 1,
      }}
      className={`rounded-xl border px-2 py-1.5 ${borderClass}`}
      {...hoverProps}
    >
      <Text className="text-[13px] font-semibold text-slate-100" numberOfLines={1}>
        {name}
      </Text>
      <Text className="text-[10px] text-slate-400 mt-0.5" numberOfLines={dimmed ? 2 : 3}>
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

// ---------------------------------------------------------------------------
// Card preview panel (fixed reserved zone) — unchanged from original
// ---------------------------------------------------------------------------

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

  const HAND_STRIP_OFFSET = 156;
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

// DamagePop relocated to src/components/feedback/DamagePop.tsx

// ---------------------------------------------------------------------------
// Game-over overlay — unchanged from original
// ---------------------------------------------------------------------------

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
