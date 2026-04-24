import { useEffect, useRef } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { useScrapFlow } from './ScrapFlow';

export default function AutomationFeedback() {
  const [events] = useTable(tables.myAutomationEvents);
  const { spawnReturnBurst } = useScrapFlow();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(events.map(e => e.eventId.toString()));
      return;
    }
    for (const e of events) {
      const id = e.eventId.toString();
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      if (!e.resourceId) continue;
      spawnReturnBurst(e.resourceId, e.amount);
    }
  }, [events, spawnReturnBurst]);

  return null;
}
