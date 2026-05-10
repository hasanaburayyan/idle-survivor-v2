import { Text, View } from 'react-native';
import type { YieldBreakdown as YieldData } from './yieldMath';

interface Props {
  resourceLabel: string;     // "Parts", "Metal", "Fabric", "Food"
  perEventLabel: string;     // "per refinement", "per smelt", "per craft", "per harvest"
  breakdown: YieldData;
}

// Renders a compact yield breakdown:
//   Yield: 36 Parts per refinement
//   Base 1 · Efficiency +0% · Minor +8 flat · Major +300%
// Hidden lines for any contribution that's still 0 (clean for unskilled players).
export default function YieldBreakdown({ resourceLabel, perEventLabel, breakdown }: Props) {
  const parts: string[] = [`Base ${breakdown.baseYield.toString()}`];
  if (breakdown.efficiencyPct > 0) {
    parts.push(`Efficiency +${breakdown.efficiencyPct}%`);
  }
  if (breakdown.flatBonus > 0n) {
    parts.push(`Minor +${breakdown.flatBonus.toString()} flat`);
  }
  if (breakdown.majorPct > 0) {
    parts.push(`Major +${breakdown.majorPct}%`);
  }

  return (
    <View className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 gap-1">
      <Text className="text-xs text-slate-300">
        Yield:{' '}
        <Text className="text-slate-100 font-semibold">
          {breakdown.finalYield.toString()} {resourceLabel}
        </Text>{' '}
        {perEventLabel}
      </Text>
      <Text className="text-[11px] text-slate-500">{parts.join(' · ')}</Text>
    </View>
  );
}
