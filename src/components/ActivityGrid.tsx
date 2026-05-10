import { useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';
import { formatScrap } from '../lib/scavenge';
import { computeScavengeGain, upgradeCost } from '../lib/progression';
import { useScrapFlow } from './ScrapFlow';
import { useSpotlightTarget } from './SpotlightTargetRegistry';

export interface ActivityDef {
  activityId: string;
  name: string;
  description: string;
  icon: string;
  locationKey: string;
  kind: string;
  maxUses: number;
  prerequisiteSkillId: string;
  prerequisiteSkillLevel: number;
  progressTarget: bigint;
  maxPerClick: bigint;
  yieldResourceId: string;
  skillChainPrefix: string;
  sortOrder: number;
}

export interface ActivityStateRow {
  id: bigint;
  username: string;
  activityId: string;
  timesUsed: number;
  progress: bigint;
  level: number;
}

export function ActivityGrid({
  activities,
  activityState,
  layout = 'grid',
}: {
  activities: ActivityDef[];
  activityState: readonly ActivityStateRow[];
  // 'grid' = 3-up tiled (used in narrow construction-site panels). 'stack' =
  // one row per activity at full width (used in the always-visible Scavenge
  // panel where horizontal space is too tight for a grid).
  layout?: 'grid' | 'stack';
}) {
  if (layout === 'stack') {
    return (
      <View className="gap-2">
        {activities.map(def => {
          const state = activityState.find(s => s.activityId === def.activityId);
          return (
            <View key={def.activityId} className="flex-row">
              <ActivityCell def={def} state={state} />
            </View>
          );
        })}
      </View>
    );
  }

  const rows: ActivityDef[][] = [];
  for (let i = 0; i < activities.length; i += 3) {
    rows.push(activities.slice(i, i + 3));
  }
  return (
    <View className="gap-2">
      {rows.map((row, i) => (
        <View key={i} className="flex-row gap-2">
          {row.map(def => {
            const state = activityState.find(
              s => s.activityId === def.activityId
            );
            return (
              <ActivityCell key={def.activityId} def={def} state={state} />
            );
          })}
          {row.length < 3
            ? Array.from({ length: 3 - row.length }).map((_, j) => (
                <View key={`slot-${j}`} className="flex-1" />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

function ActivityCell({
  def,
  state,
}: {
  def: ActivityDef;
  state: ActivityStateRow | undefined;
}) {
  switch (def.kind) {
    case 'scavenge':
      return <ScavengeCell def={def} state={state} />;
    case 'build_progress':
      return <BuildProgressCell def={def} state={state} />;
    case 'placeholder':
    default:
      return <PlaceholderCell def={def} />;
  }
}

function ScavengeCell({
  def,
  state,
}: {
  def: ActivityDef;
  state: ActivityStateRow | undefined;
}) {
  const [playerStates] = useTable(tables.myPlayerState);
  const [playerResources] = useTable(tables.myResources);
  const [skills] = useTable(tables.mySkills);
  const [allCosts] = useTable(tables.activityCost);
  const [resourceDefs] = useTable(tables.resourceDefinition);
  const scavengeActivity = useReducer(reducers.scavengeActivity);
  const upgradeScavengeActivity = useReducer(reducers.upgradeScavengeActivity);
  const { spawnBurst } = useScrapFlow();

  const pressAnim = useRef(new Animated.Value(1)).current;
  const buttonRef = useRef<View | null>(null);
  const spotlight = useSpotlightTarget(
    def.activityId === 'scavenge' ? 'activity_button:scavenge' : ''
  );

  const [capabilityTotals] = useTable(tables.myCapabilityTotals);

  const activityLevel = state?.level ?? 0;
  const scrap = playerStates[0]?.scrap ?? 0n;
  const comboBp = playerStates[0]?.comboBp ?? 0;
  const wideNetBp = capabilityTotals.find(c => c.effectKey === 'wide_net_pct_bp')?.total ?? 0;

  const prefix = def.skillChainPrefix || 'scavenge';
  const multiplierLvl =
    skills.find(s => s.skillId === `${prefix}_multiplier`)?.level ?? 0;
  const power = computeScavengeGain(activityLevel, multiplierLvl);
  const nextUpgradeCost = upgradeCost(activityLevel);
  const yieldDef = resourceDefs.find(r => r.resourceId === def.yieldResourceId);

  const costs = useMemo(
    () => [...allCosts].filter(c => c.activityId === def.activityId),
    [allCosts, def.activityId]
  );

  const balanceOf = (resourceId: string): bigint => {
    if (resourceId === 'scrap') return scrap;
    return (
      playerResources.find(r => r.resourceId === resourceId)?.amount ?? 0n
    );
  };

  const canAfford = costs.every(c => balanceOf(c.resourceId) >= c.amount);
  const upgradeResourceBalance = def.yieldResourceId
    ? balanceOf(def.yieldResourceId)
    : 0n;
  const canAffordUpgrade =
    !!def.yieldResourceId && upgradeResourceBalance >= nextUpgradeCost;

  const onScavenge = () => {
    if (!canAfford) return;
    Animated.sequence([
      Animated.timing(pressAnim, {
        toValue: 0.95,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.timing(pressAnim, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    spawnBurst(buttonRef.current, def.yieldResourceId, power);
    scavengeActivity({ activityId: def.activityId }).catch(() => {});
  };

  const onUpgrade = () => {
    if (!canAffordUpgrade) return;
    upgradeScavengeActivity({ activityId: def.activityId }).catch(() => {});
  };

  return (
    <View className="flex-1 rounded-xl bg-slate-900 border border-slate-800 p-2.5 gap-2 items-center">
      <Text
        className="text-[11px] font-semibold text-slate-100 text-center"
        numberOfLines={1}
      >
        {def.name}
      </Text>
      <View ref={spotlight.ref} onLayout={spotlight.onLayout}>
        {comboBp > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -6,
              right: -10,
              zIndex: 5,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor:
                comboBp >= 3000 ? '#f43f5e' : comboBp >= 1000 ? '#f59e0b' : '#475569',
            }}
          >
            <Text className="text-[10px] font-semibold text-white">
              {(comboBp / 100).toFixed(0)}%
            </Text>
          </View>
        ) : null}
        <Animated.View style={{ transform: [{ scale: pressAnim }] }}>
          <SafePressable
            ref={r => (buttonRef.current = r)}
            onPress={onScavenge}
            disabled={!canAfford}
            className={`items-center justify-center w-16 h-16 rounded-full ${
              canAfford ? 'bg-amber-500' : 'bg-slate-800'
            }`}
            style={
              canAfford
                ? {
                    shadowColor: '#f59e0b',
                    shadowOffset: { width: 0, height: 6 },
                    shadowOpacity: 0.5,
                    shadowRadius: 12,
                    elevation: 6,
                  }
                : undefined
            }
          >
            <Text className="text-2xl">{def.icon}</Text>
          </SafePressable>
        </Animated.View>
      </View>
      {yieldDef ? (
        <Text className="text-[10px] text-slate-400">
          +{formatScrap(power)} {yieldDef.icon}
        </Text>
      ) : null}
      {wideNetBp > 0 ? (
        <Text className="text-[10px] text-blue-400">✦ Wide Net</Text>
      ) : null}
      {costs.length > 0 ? (
        <View className="flex-row flex-wrap justify-center gap-x-1.5 gap-y-0.5">
          {costs.map(c => {
            const r = resourceDefs.find(d => d.resourceId === c.resourceId);
            const ok = balanceOf(c.resourceId) >= c.amount;
            return (
              <Text
                key={c.resourceId}
                className={`text-[10px] ${ok ? 'text-slate-500' : 'text-rose-400'}`}
              >
                {r?.icon ?? ''}
                {c.amount.toString()}
              </Text>
            );
          })}
        </View>
      ) : null}
      {yieldDef ? (
        <SafePressable
          onPress={onUpgrade}
          disabled={!canAffordUpgrade}
          className={`self-stretch rounded py-1.5 items-center ${
            canAffordUpgrade ? 'bg-emerald-500' : 'bg-slate-800'
          }`}
        >
          <Text
            className={`text-[10px] font-medium ${
              canAffordUpgrade ? 'text-slate-950' : 'text-slate-500'
            }`}
          >
            Lv {activityLevel} · ⬆ {formatScrap(nextUpgradeCost)} {yieldDef.icon}
          </Text>
        </SafePressable>
      ) : null}
    </View>
  );
}

function BuildProgressCell({
  def,
  state,
}: {
  def: ActivityDef;
  state: ActivityStateRow | undefined;
}) {
  const [playerStates] = useTable(tables.myPlayerState);
  const [resourceDefs] = useTable(tables.resourceDefinition);
  const ps = playerStates[0];
  const build = useReducer(reducers.advanceBuild);
  const [busy, setBusy] = useState(false);

  const scrap = ps?.scrap ?? 0n;
  const progress = state?.progress ?? 0n;
  const target = def.progressTarget;
  const remaining = target - progress;
  const maxClick = remaining < def.maxPerClick ? remaining : def.maxPerClick;
  const thisClick = scrap < maxClick ? scrap : maxClick;
  const canContribute = thisClick > 0n;
  const pct = target === 0n ? 0 : Math.min(100, Number((progress * 100n) / target));
  const scrapIcon =
    resourceDefs.find(r => r.resourceId === 'scrap')?.icon ?? '⚙';

  const onBuild = async () => {
    if (busy || !canContribute) return;
    setBusy(true);
    try {
      await build({ activityId: def.activityId, amount: thisClick });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 rounded-xl bg-slate-900 border border-slate-800 p-2.5 gap-2">
      <View className="flex-row items-center gap-1">
        <Text className="text-base">{def.icon}</Text>
        <Text
          className="text-[11px] font-semibold text-slate-100 flex-1"
          numberOfLines={1}
        >
          {def.name}
        </Text>
      </View>
      <View className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <View className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
      </View>
      <Text className="text-[10px] text-slate-500">
        {progress.toString()}/{target.toString()} {scrapIcon}
      </Text>
      <SafePressable
        onPress={onBuild}
        disabled={busy || !canContribute}
        className={`rounded py-2 items-center ${
          busy || !canContribute ? 'bg-slate-800' : 'bg-emerald-500'
        }`}
      >
        <Text
          className={`text-[11px] font-medium ${
            busy || !canContribute ? 'text-slate-500' : 'text-slate-950'
          }`}
        >
          {!canContribute
            ? `Need ${scrapIcon}`
            : `+${thisClick.toString()} ${scrapIcon}`}
        </Text>
      </SafePressable>
    </View>
  );
}

function PlaceholderCell({ def }: { def: ActivityDef }) {
  return (
    <View className="flex-1 rounded-xl bg-slate-900 border border-slate-800 p-2.5 gap-2">
      <View className="flex-row items-center gap-1">
        <Text className="text-base">{def.icon}</Text>
        <Text
          className="text-[11px] font-semibold text-slate-100 flex-1"
          numberOfLines={1}
        >
          {def.name}
        </Text>
      </View>
      <Text className="text-[10px] text-slate-500 flex-1">Coming soon</Text>
      <SafePressable disabled className="rounded py-2 items-center bg-slate-800">
        <Text className="text-[11px] text-slate-500">—</Text>
      </SafePressable>
    </View>
  );
}
