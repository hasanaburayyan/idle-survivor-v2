import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { EventFloater, FlashOverlay, COLOR_FORTUNE_PROC } from './feedback';

/**
 * Watches `myNotifications` for fortune-proc system rows (dedupeKey prefix
 * `fortuneProc:`) and reacts with a screen flash + a top-center text floater.
 *
 * The server inserts/updates one notification row per dedup window (5s) and
 * accumulates the summary. Each new row OR each updatedAt-bumped row triggers
 * a single flash + floater here. Conservative on stack-up: if multiple events
 * arrive within 1s, we only re-trigger once per second on the client side.
 */
export default function FortuneProcFeedback() {
  const [notifications] = useTable(tables.myNotifications);
  const [flashTrigger, setFlashTrigger] = useState(0);
  const [floaterTrigger, setFloaterTrigger] = useState(0);
  const [floaterLabel, setFloaterLabel] = useState('');
  const seen = useRef<Map<string, number> | null>(null);
  const lastFireAt = useRef(0);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Map();
      for (const n of notifications) {
        if (n.dedupeKey.startsWith('fortuneProc:')) {
          seen.current.set(
            n.dedupeKey,
            Number(n.createdAt.microsSinceUnixEpoch / 1000n),
          );
        }
      }
      return;
    }
    let pendingLabel: string | null = null;
    for (const n of notifications) {
      if (n.kind.tag !== 'System') continue;
      if (!n.dedupeKey.startsWith('fortuneProc:')) continue;
      const updatedMs = Number(n.createdAt.microsSinceUnixEpoch / 1000n);
      const prevMs = seen.current.get(n.dedupeKey);
      if (prevMs !== undefined && prevMs >= updatedMs) continue;
      seen.current.set(n.dedupeKey, updatedMs);
      pendingLabel = n.summary;
    }
    if (pendingLabel === null) return;
    const now = Date.now();
    if (now - lastFireAt.current < 1000) return;
    lastFireAt.current = now;
    setFloaterLabel(pendingLabel);
    setFloaterTrigger(t => t + 1);
    setFlashTrigger(t => t + 1);
  }, [notifications]);

  return (
    <>
      <FlashOverlay
        trigger={flashTrigger}
        color={COLOR_FORTUNE_PROC}
        intensity={0.2}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 80,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 100,
        }}
      >
        <EventFloater label={floaterLabel} trigger={floaterTrigger} />
      </View>
    </>
  );
}
