import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type {
  PlayerActivity,
  PlayerSkill,
  PlayerState,
  PlayerTutorialProgress,
  TutorialStepDefinition,
  TutorialTriggerCondition,
} from '../module_bindings/types';
import { useSpotlightRegistry } from './SpotlightTargetRegistry';

function isTriggerSatisfied(
  trigger: TutorialTriggerCondition,
  playerState: PlayerState | undefined,
  skills: readonly PlayerSkill[],
  activityState: readonly PlayerActivity[],
  skillDefs: readonly { skillId: string; maxLevel: number }[]
): boolean {
  switch (trigger.tag) {
    case 'Chained':
      return true;
    case 'PlayerLevelAtLeast':
      return (playerState?.playerLevel ?? 0) >= trigger.value.level;
    case 'SkillPurchased':
      return skills.some(
        s =>
          s.skillId === trigger.value.skillId &&
          s.level >= trigger.value.minLevel
      );
    case 'ActivityPerformed':
      return activityState.some(
        a =>
          a.activityId === trigger.value.activityId &&
          a.timesUsed >= trigger.value.minTimes
      );
    case 'TreeCompleted': {
      const levels = new Map<string, number>();
      for (const s of skills) levels.set(s.skillId, s.level);
      for (const def of skillDefs) {
        const lvl = levels.get(def.skillId) ?? 0;
        if (lvl < def.maxLevel) return false;
      }
      return true;
    }
  }
  return false;
}

function findActiveStep(
  steps: readonly TutorialStepDefinition[],
  completed: readonly PlayerTutorialProgress[],
  playerState: PlayerState | undefined,
  skills: readonly PlayerSkill[],
  activityState: readonly PlayerActivity[],
  skillDefs: readonly { skillId: string; maxLevel: number }[]
): TutorialStepDefinition | null {
  const completedSet = new Set(completed.map(c => c.stepId));
  const sorted = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const step of sorted) {
    if (completedSet.has(step.stepId)) continue;
    if (step.prereqStepId !== '' && !completedSet.has(step.prereqStepId))
      continue;
    if (
      !isTriggerSatisfied(
        step.triggerCondition,
        playerState,
        skills,
        activityState,
        skillDefs
      )
    )
      continue;
    return step;
  }
  return null;
}

export default function TutorialPopup() {
  const [steps] = useTable(tables.tutorialStepDefinition);
  const [progress] = useTable(tables.myTutorialProgress);
  const [playerStates] = useTable(tables.myPlayerState);
  const [skills] = useTable(tables.mySkills);
  const [activityState] = useTable(tables.myActivityState);
  const [skillDefs] = useTable(tables.skillDefinition);

  const completeStep = useReducer(reducers.completeTutorialStep);
  const skipAll = useReducer(reducers.skipTutorial);

  const [submitting, setSubmitting] = useState(false);

  const activeStep = useMemo(
    () =>
      findActiveStep(
        steps,
        progress,
        playerStates[0],
        skills,
        activityState,
        skillDefs
      ),
    [steps, progress, playerStates, skills, activityState, skillDefs]
  );

  const { getTarget } = useSpotlightRegistry();
  const spotlightRect =
    activeStep && activeStep.spotlightTargetKey
      ? getTarget(activeStep.spotlightTargetKey)
      : null;

  if (!activeStep) return null;

  const onCta = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await completeStep({ stepId: activeStep.stepId });
    } catch {
      /* ignore — view will recompute */
    } finally {
      setSubmitting(false);
    }
  };

  const onSkip = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await skipAll();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  };

  const isInCharacter = activeStep.tone.tag === 'InCharacter';

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-0"
      style={{ zIndex: 100 }}
    >
      <View
        pointerEvents="auto"
        className="absolute inset-0 bg-black/60"
      />
      {spotlightRect ? (
        <View
          pointerEvents="none"
          className="absolute rounded-xl border-2 border-amber-400"
          style={{
            left: spotlightRect.x - 6,
            top: spotlightRect.y - 6,
            width: spotlightRect.width + 12,
            height: spotlightRect.height + 12,
            shadowColor: '#fbbf24',
            shadowOpacity: 0.9,
            shadowRadius: 16,
            elevation: 8,
          }}
        />
      ) : null}
      <View
        pointerEvents="box-none"
        className="absolute inset-0 items-center justify-end pb-32 px-6"
      >
        <View
          pointerEvents="auto"
          className={`w-full max-w-md rounded-2xl border px-5 py-5 gap-3 ${
            isInCharacter
              ? 'border-amber-700/60 bg-stone-900'
              : 'border-slate-700 bg-slate-900'
          }`}
        >
          <Text
            className={`text-lg font-semibold ${
              isInCharacter ? 'text-amber-200' : 'text-slate-100'
            }`}
          >
            {activeStep.headline}
          </Text>
          <Text
            className={`text-sm leading-5 ${
              isInCharacter ? 'text-stone-300' : 'text-slate-300'
            }`}
          >
            {activeStep.body}
          </Text>
          <View className="flex-row items-center justify-between mt-1">
            <SafePressable onPress={onSkip} disabled={submitting}>
              <Text className="text-[11px] text-slate-500 underline">
                Skip tutorial
              </Text>
            </SafePressable>
            <SafePressable
              onPress={onCta}
              disabled={submitting}
              className={`rounded-lg px-4 py-2 ${
                isInCharacter ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
            >
              <Text className="text-sm font-medium text-slate-950">
                {submitting ? '…' : activeStep.primaryCtaLabel}
              </Text>
            </SafePressable>
          </View>
        </View>
      </View>
    </View>
  );
}
