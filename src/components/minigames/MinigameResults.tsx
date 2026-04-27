import { Text, View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../../module_bindings';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
}

export default function MinigameResults({ session }: Props) {
  const [results] = useTable(tables.minigameResult);
  const [mySessions] = useTable(tables.mySession);
  const myUsername = mySessions[0]?.username;
  const sessionResults = results
    .filter(r => r.sessionId === session.id)
    .sort((a, b) => a.placement - b.placement);

  const isCancelled = session.state.tag === 'cancelled';

  return (
    <View className="flex-1 px-6 py-8 gap-5">
      <View>
        <Text className="text-xs uppercase tracking-widest text-amber-400">
          {isCancelled ? 'Cancelled' : 'Results'}
        </Text>
        <Text className="text-xs text-slate-500 mt-2">
          The session is over. Close to head back to the menu.
        </Text>
      </View>

      <View className="gap-2">
        {sessionResults.map(r => {
          const rewards = parseRewards(r.rewardsJson);
          return (
            <View
              key={`${r.sessionId.toString()}:${r.username}`}
              className={`rounded-2xl px-4 py-3 border ${
                r.placement === 1
                  ? 'bg-emerald-900/40 border-emerald-700'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-slate-100">
                  #{r.placement} {r.username}
                  {r.username === myUsername ? ' (you)' : ''}
                </Text>
                <Text className="text-xs text-slate-400">
                  Score: {r.finalScore.toString()}
                </Text>
              </View>
              {rewards.length > 0 ? (
                <View className="mt-2 gap-1">
                  {rewards.map((reward, i) => (
                    <Text key={i} className="text-[11px] text-amber-300">
                      + {formatReward(reward)}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
        {sessionResults.length === 0 ? (
          <Text className="text-sm text-slate-500">
            No results recorded.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function parseRewards(json: string): unknown[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatReward(reward: unknown): string {
  if (!reward || typeof reward !== 'object') return 'reward';
  const r = reward as { kind?: string; amount?: string; resourceId?: string; quantity?: string; description?: string };
  if (r.kind === 'scrap') return `${r.amount ?? '0'} scrap`;
  if (r.kind === 'xp') return `${r.amount ?? '0'} XP`;
  if (r.kind === 'item') return `${r.quantity ?? '0'} × ${r.resourceId ?? 'item'}`;
  if (r.kind === 'custom') return r.description ?? 'reward';
  return 'reward';
}
