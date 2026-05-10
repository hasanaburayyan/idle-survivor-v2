import { Text, View } from 'react-native';
import type { StructureStatus } from './structureStatus';

interface Props {
  status: StructureStatus;
  /** When true, render as a tiny inline dot (used in the structure bar). */
  compact?: boolean;
}

const STATUS_LABEL: Record<StructureStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  outputReady: 'Ready',
  needsAttention: 'Ripe!',
};

const STATUS_DOT_BG: Record<StructureStatus, string> = {
  idle: 'bg-slate-600',
  running: 'bg-cyan-500',
  outputReady: 'bg-emerald-400',
  needsAttention: 'bg-amber-400',
};

const STATUS_PILL_BG: Record<StructureStatus, string> = {
  idle: 'bg-slate-800/80 border border-slate-700',
  running: 'bg-cyan-900/60 border border-cyan-700',
  outputReady: 'bg-emerald-900/60 border border-emerald-600',
  needsAttention: 'bg-amber-900/60 border border-amber-500',
};

const STATUS_PILL_TEXT: Record<StructureStatus, string> = {
  idle: 'text-slate-400',
  running: 'text-cyan-200',
  outputReady: 'text-emerald-200',
  needsAttention: 'text-amber-200',
};

export default function StructureStatusBadge({ status, compact = false }: Props) {
  if (compact) {
    return <View className={`w-2 h-2 rounded-full ${STATUS_DOT_BG[status]}`} />;
  }
  return (
    <View className={`flex-row items-center gap-1.5 px-2 py-0.5 rounded-full ${STATUS_PILL_BG[status]}`}>
      <View className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_BG[status]}`} />
      <Text className={`text-[10px] font-medium uppercase tracking-wider ${STATUS_PILL_TEXT[status]}`}>
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}
