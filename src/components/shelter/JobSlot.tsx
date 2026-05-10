import { Text, View } from 'react-native';
import SafePressable from '../SafePressable';

export type SlotPhase = 'empty' | 'running' | 'ready' | 'ripe' | 'stale';

interface Props {
  slotIndex: number;
  phase: SlotPhase;
  /** Seconds remaining (running) or until stale (ripe). undefined for empty/ready/stale. */
  secondsRemaining?: number;
  /** Status text overlay for the slot, e.g. "5x Food → 15x Food (Ripe!)". */
  caption?: string;
  /** Action button label (varies per phase: "Refine", "Collect", "Harvest!", "Collect Stale"). */
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
  disabled?: boolean;
}

const PHASE_BORDER: Record<SlotPhase, string> = {
  empty: 'border-slate-800',
  running: 'border-cyan-700',
  ready: 'border-emerald-600',
  ripe: 'border-amber-500',
  stale: 'border-emerald-700',
};

const PHASE_BG: Record<SlotPhase, string> = {
  empty: 'bg-slate-950',
  running: 'bg-slate-900',
  ready: 'bg-slate-900',
  ripe: 'bg-amber-950/40',
  stale: 'bg-slate-900',
};

const ACTION_BG: Record<SlotPhase, string> = {
  empty: 'bg-emerald-500',
  running: 'bg-slate-700',
  ready: 'bg-emerald-500',
  ripe: 'bg-amber-400',
  stale: 'bg-emerald-700',
};

const ACTION_TEXT: Record<SlotPhase, string> = {
  empty: 'text-slate-950',
  running: 'text-slate-400',
  ready: 'text-slate-950',
  ripe: 'text-slate-950',
  stale: 'text-slate-100',
};

export default function JobSlot({
  slotIndex,
  phase,
  secondsRemaining,
  caption,
  actionLabel,
  onAction,
  busy = false,
  disabled = false,
}: Props) {
  const cantPress = busy || disabled || phase === 'running';
  return (
    <View className={`rounded-xl ${PHASE_BG[phase]} border-2 ${PHASE_BORDER[phase]} px-4 py-3 gap-2`}>
      <View className="flex-row items-center justify-between">
        <Text className="text-[11px] uppercase tracking-widest text-slate-500">
          Slot {slotIndex + 1}
        </Text>
        {phase === 'running' && secondsRemaining !== undefined ? (
          <Text className="text-xs text-cyan-300">
            {formatSeconds(secondsRemaining)} left
          </Text>
        ) : null}
        {phase === 'ripe' && secondsRemaining !== undefined ? (
          <Text className="text-xs text-amber-200">
            {formatSeconds(secondsRemaining)} until stale
          </Text>
        ) : null}
        {phase === 'ready' ? (
          <Text className="text-xs text-emerald-300">Ready</Text>
        ) : null}
        {phase === 'stale' ? (
          <Text className="text-xs text-slate-400">Stale</Text>
        ) : null}
      </View>
      {caption ? <Text className="text-xs text-slate-300">{caption}</Text> : null}
      <SafePressable
        onPress={onAction}
        disabled={cantPress}
        className={`rounded-lg py-2 items-center ${cantPress ? 'bg-slate-800' : ACTION_BG[phase]}`}
      >
        <Text className={`text-sm font-medium ${cantPress ? 'text-slate-500' : ACTION_TEXT[phase]}`}>
          {actionLabel}
        </Text>
      </SafePressable>
    </View>
  );
}

function formatSeconds(s: number): string {
  if (s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}m ${r}s`;
}
