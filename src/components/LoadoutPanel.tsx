import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';

const SLOT_COUNT = 6;

const TARGETING_LABEL: Record<string, string> = {
  singleEnemy: '1 enemy',
  allEnemies: 'all enemies',
  singleAlly: '1 ally',
  allAllies: 'all allies',
  partyIncludingSelf: 'party',
};

interface LoadoutPanelProps {
  // Future: lobby variant uses compact mode
  compact?: boolean;
}

export default function LoadoutPanel({ compact = false }: LoadoutPanelProps) {
  const [actionDefs] = useTable(tables.actionDefinition);
  const [knownActions] = useTable(tables.myKnownActions);
  const [loadoutRows] = useTable(tables.myActionLoadout);
  const [previews] = useTable(tables.myActionPreviews);

  const setSlot = useReducer(reducers.setLoadoutSlot);
  const clearSlot = useReducer(reducers.clearLoadoutSlot);

  const [selectedKnownActionId, setSelectedKnownActionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defById = useMemo(() => {
    const m = new Map<string, (typeof actionDefs)[number]>();
    for (const d of actionDefs) m.set(d.actionId, d);
    return m;
  }, [actionDefs]);

  const previewById = useMemo(() => {
    const m = new Map<string, (typeof previews)[number]>();
    for (const p of previews) m.set(p.actionId, p);
    return m;
  }, [previews]);

  const slotByIndex = useMemo(() => {
    const m = new Map<number, (typeof loadoutRows)[number]>();
    for (const r of loadoutRows) m.set(r.slotIndex, r);
    return m;
  }, [loadoutRows]);

  const equippedActionIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of loadoutRows) s.add(r.actionId);
    return s;
  }, [loadoutRows]);

  const sortedKnown = useMemo(() => {
    return [...knownActions].sort((a, b) => {
      const ad = defById.get(a.actionId);
      const bd = defById.get(b.actionId);
      return (ad?.sortOrder ?? 999) - (bd?.sortOrder ?? 999);
    });
  }, [knownActions, defById]);

  const onSlotTap = async (slotIndex: number) => {
    if (busy) return;
    const occupant = slotByIndex.get(slotIndex);
    // If a known action is selected, place/replace it in this slot.
    if (selectedKnownActionId) {
      // If the selected action is already in another slot, the server will reject.
      // We could pre-clear, but the explicit error helps the player understand.
      setBusy(true);
      try {
        await setSlot({ slotIndex, actionId: selectedKnownActionId });
        setSelectedKnownActionId(null);
      } catch {
        /* server rejected; selection stays so player can try elsewhere */
      } finally {
        setBusy(false);
      }
      return;
    }
    // Otherwise tap on an occupied slot clears it.
    if (occupant) {
      setBusy(true);
      try {
        await clearSlot({ slotIndex });
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    }
  };

  const onKnownActionTap = (actionId: string) => {
    setSelectedKnownActionId(prev => (prev === actionId ? null : actionId));
  };

  const formatPreview = (actionId: string): string => {
    const preview = previewById.get(actionId);
    const def = defById.get(actionId);
    if (!def) return '';
    if (!preview) return '';
    if (preview.kind === 'damage') {
      return `${preview.resolvedMin}–${preview.resolvedMax} dmg`;
    }
    if (preview.kind === 'healAmount') {
      return `+${preview.resolvedMin}–${preview.resolvedMax} HP`;
    }
    if (preview.kind === 'healFull') {
      return 'Full heal';
    }
    if (preview.kind === 'ward') {
      return `${preview.resolvedCount}× ward`;
    }
    return '';
  };

  return (
    <View className="flex-1 gap-3">
      {selectedKnownActionId ? (
        <View className="rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-2">
          <Text className="text-[11px] text-amber-300">
            Selected: {defById.get(selectedKnownActionId)?.displayName ?? selectedKnownActionId} — tap a slot to equip
          </Text>
          <SafePressable
            onPress={() => setSelectedKnownActionId(null)}
            className="self-start mt-1 rounded-md bg-slate-800 px-2 py-0.5"
          >
            <Text className="text-[10px] text-slate-300">Cancel</Text>
          </SafePressable>
        </View>
      ) : null}

      <Text className="text-xs uppercase tracking-widest text-slate-500">
        Loadout
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {Array.from({ length: SLOT_COUNT }).map((_, slotIndex) => {
          const occupant = slotByIndex.get(slotIndex);
          const occupantDef = occupant ? defById.get(occupant.actionId) : undefined;
          const isFilled = !!occupant;
          const slotWidth = compact ? 88 : 104;
          const slotHeight = compact ? 72 : 96;
          return (
            <SafePressable
              key={slotIndex}
              onPress={() => onSlotTap(slotIndex)}
              disabled={busy}
              style={{ width: slotWidth, height: slotHeight }}
              className={`rounded-xl px-2 py-1.5 border ${
                isFilled
                  ? 'border-emerald-700 bg-slate-900'
                  : 'border-dashed border-slate-700 bg-slate-950'
              } ${selectedKnownActionId ? 'border-amber-500/50' : ''}`}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-[9px] uppercase tracking-widest text-slate-500">
                  Slot {slotIndex + 1}
                </Text>
                {isFilled ? (
                  <Text className="text-[10px] text-rose-400">✕</Text>
                ) : null}
              </View>
              {isFilled && occupantDef ? (
                <View className="flex-1 justify-center">
                  <Text
                    className="text-[11px] font-semibold text-slate-100"
                    numberOfLines={1}
                  >
                    {occupantDef.displayName}
                  </Text>
                  <Text
                    className="text-[10px] text-amber-300 mt-0.5"
                    numberOfLines={1}
                  >
                    {formatPreview(occupant.actionId)}
                  </Text>
                </View>
              ) : (
                <View className="flex-1 items-center justify-center">
                  <Text className="text-2xl text-slate-600">+</Text>
                </View>
              )}
            </SafePressable>
          );
        })}
      </View>

      <Text className="text-xs uppercase tracking-widest text-slate-500 mt-2">
        Known Actions ({sortedKnown.length})
      </Text>
      <ScrollView
        className="max-h-72"
        contentContainerStyle={{ gap: 6 }}
      >
        {sortedKnown.length === 0 ? (
          <Text className="text-xs text-slate-500">
            No known actions yet.
          </Text>
        ) : (
          sortedKnown.map(known => {
            const def = defById.get(known.actionId);
            if (!def) return null;
            const isEquipped = equippedActionIds.has(known.actionId);
            const isSelected = selectedKnownActionId === known.actionId;
            const targetingLabel =
              TARGETING_LABEL[def.targeting.tag] ?? def.targeting.tag;
            return (
              <SafePressable
                key={known.actionId}
                onPress={() => onKnownActionTap(known.actionId)}
                disabled={busy || isEquipped}
                className={`rounded-xl px-3 py-2 border ${
                  isSelected
                    ? 'border-amber-500 bg-amber-500/10'
                    : isEquipped
                      ? 'border-slate-800 bg-slate-950 opacity-50'
                      : 'border-slate-700 bg-slate-900'
                }`}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-slate-100">
                    {def.displayName}
                  </Text>
                  <Text className="text-[10px] uppercase tracking-widest text-slate-500">
                    {isEquipped ? 'equipped' : targetingLabel}
                  </Text>
                </View>
                <Text className="text-[11px] text-slate-400 mt-0.5">
                  {def.description}
                </Text>
                <View className="flex-row items-center gap-2 mt-1">
                  <Text className="text-[11px] text-amber-300">
                    {formatPreview(known.actionId)}
                  </Text>
                </View>
              </SafePressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
