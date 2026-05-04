import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import SafePressable from './SafePressable';

// ---------------------------------------------------------------------------
// Class identity constants — treeIds as defined in skill_tree_definition seeds
// ---------------------------------------------------------------------------

export const CLASS_TREE_IDS = new Set<string>([
  'brute',
  'generalist',
  'striker',
  'wanderer',
]);

// Unicode glyphs — emoji-free, renders on all mobile platforms
export const CLASS_GLYPH: Record<string, string> = {
  brute: '♦',
  generalist: '⊕',
  striker: '▲',
  wanderer: '✧',
};

// Tailwind text-color classes for class accents
export const CLASS_ACCENT_TEXT: Record<string, string> = {
  brute: 'text-orange-400',
  generalist: 'text-blue-400',
  striker: 'text-red-400',
  wanderer: 'text-emerald-400',
};

// Tailwind border-color classes for class accents
const CLASS_ACCENT_BORDER: Record<string, string> = {
  brute: 'border-orange-500/40',
  generalist: 'border-blue-500/40',
  striker: 'border-red-500/40',
  wanderer: 'border-emerald-500/40',
};

// Tailwind bg-color classes for equipped row highlight
const CLASS_ACCENT_BG: Record<string, string> = {
  brute: 'bg-orange-500/10',
  generalist: 'bg-blue-500/10',
  striker: 'bg-red-500/10',
  wanderer: 'bg-emerald-500/10',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClassTreeRef {
  treeId: string;
  displayName: string;
}

interface ClassEquipModalProps {
  visible: boolean;
  onClose: () => void;
  /** treeId of the currently equipped class, or empty string for none */
  equippedClassId: string;
  /** Classes the player has unlocked (visible in myVisibleSkillTrees) */
  unlockedClasses: ClassTreeRef[];
  /** True when player is in a minigame — disables equip actions */
  inMinigame: boolean;
  onEquip: (classId: string) => Promise<void>;
  onUnequip: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Bottom-sheet modal for selecting / confirming / unequipping a class.
 *
 * Phase 1: swap cost is displayed as a placeholder until classCraftCost
 * table ships (Phase 2 bindings). The reducer calls (onEquip / onUnequip)
 * are also stubs at the call site until reducers are regenerated.
 */
export default function ClassEquipModal({
  visible,
  onClose,
  equippedClassId,
  unlockedClasses,
  inMinigame,
  onEquip,
  onUnequip,
}: ClassEquipModalProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPendingId(null);
    setBusy(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleEquip = async (classId: string) => {
    if (busy || inMinigame) return;
    setBusy(true);
    try {
      await onEquip(classId);
      reset();
      onClose();
    } catch {
      /* errors surface in server logs; reducer throws SenderError */
    } finally {
      setBusy(false);
    }
  };

  const handleUnequip = async () => {
    if (busy || inMinigame) return;
    setBusy(true);
    try {
      await onUnequip();
      reset();
      onClose();
    } catch {
      /* errors surface in server logs */
    } finally {
      setBusy(false);
    }
  };

  const pendingClass = unlockedClasses.find(c => c.treeId === pendingId) ?? null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      {/* Backdrop — tap to close */}
      <SafePressable
        onPress={handleClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
      >
        {/* Sheet — separate pressable to absorb taps without closing */}
        <SafePressable
          onPress={() => {}}
          className="bg-slate-900 rounded-t-2xl border-t border-slate-700"
          style={{ paddingBottom: 32, paddingHorizontal: 16, paddingTop: 12 }}
        >
          {/* Handle bar */}
          <View className="self-center w-10 h-1 rounded-full bg-slate-700 mb-4" />

          <Text className="text-xs uppercase tracking-widest text-slate-500 mb-3">
            {pendingId ? 'Confirm Class Equip' : 'Change Class'}
          </Text>

          {inMinigame ? (
            <View className="mb-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <Text className="text-xs text-rose-400 text-center">
                Cannot change class during a minigame
              </Text>
            </View>
          ) : null}

          {pendingId !== null && pendingClass !== null ? (
            /* ── Confirmation view ── */
            <View style={{ gap: 12 }}>
              <View
                className={`flex-row items-center rounded-xl border px-4 py-3 gap-3 ${
                  CLASS_ACCENT_BORDER[pendingClass.treeId] ?? 'border-slate-700'
                } bg-slate-800`}
              >
                <Text
                  className={`text-2xl ${CLASS_ACCENT_TEXT[pendingClass.treeId] ?? 'text-amber-300'}`}
                >
                  {CLASS_GLYPH[pendingClass.treeId] ?? '?'}
                </Text>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-slate-100">
                    {pendingClass.displayName}
                  </Text>
                  {/* TODO (Phase 2): show actual swap cost from classCraftCost tier-0 row */}
                  <Text className="text-xs text-slate-500 mt-0.5">
                    Swap cost: check Class Crafting (Shelter) for current tier
                  </Text>
                </View>
              </View>

              <View className="flex-row gap-2">
                <SafePressable
                  onPress={() => setPendingId(null)}
                  disabled={busy}
                  className="flex-1 rounded-lg py-3 items-center bg-slate-800 border border-slate-700"
                >
                  <Text className="text-sm text-slate-300">Cancel</Text>
                </SafePressable>
                <SafePressable
                  onPress={() => handleEquip(pendingClass.treeId)}
                  disabled={busy || inMinigame}
                  className={`flex-1 rounded-lg py-3 items-center ${
                    busy || inMinigame ? 'bg-slate-800' : 'bg-amber-500'
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      busy || inMinigame ? 'text-slate-500' : 'text-slate-950'
                    }`}
                  >
                    {busy ? 'Equipping…' : `Equip ${pendingClass.displayName}`}
                  </Text>
                </SafePressable>
              </View>
            </View>
          ) : (
            /* ── Class list view ── */
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
              {unlockedClasses.length === 0 ? (
                <View className="py-10 items-center gap-2">
                  <Text className="text-2xl">🔒</Text>
                  <Text className="text-sm text-slate-400 text-center font-medium">
                    No classes unlocked
                  </Text>
                  <Text className="text-xs text-slate-500 text-center leading-5">
                    Max both Minor and Major nodes for a stat in{'\n'}
                    Intermediate to reveal that class's unlock node.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {unlockedClasses.map(cls => {
                    const isEquipped = cls.treeId === equippedClassId;
                    return (
                      <SafePressable
                        key={cls.treeId}
                        onPress={() => {
                          if (isEquipped || inMinigame) return;
                          setPendingId(cls.treeId);
                        }}
                        disabled={inMinigame}
                        accessibilityLabel={`${cls.displayName}${isEquipped ? ', currently equipped' : ''}`}
                        className={`flex-row items-center rounded-xl border px-4 py-3 gap-3 ${
                          isEquipped
                            ? `${CLASS_ACCENT_BG[cls.treeId] ?? 'bg-amber-500/10'} ${
                                CLASS_ACCENT_BORDER[cls.treeId] ?? 'border-amber-500/40'
                              }`
                            : 'bg-slate-800 border-slate-700'
                        }`}
                      >
                        <Text
                          className={`text-xl ${
                            CLASS_ACCENT_TEXT[cls.treeId] ?? 'text-amber-300'
                          }`}
                        >
                          {CLASS_GLYPH[cls.treeId] ?? '?'}
                        </Text>
                        <Text
                          className={`flex-1 text-sm font-medium ${
                            isEquipped ? 'text-slate-100' : 'text-slate-200'
                          }`}
                        >
                          {cls.displayName}
                        </Text>
                        {isEquipped ? (
                          <View className="rounded-full bg-amber-500/20 px-2 py-0.5">
                            <Text className="text-[10px] text-amber-300">◉ Equipped</Text>
                          </View>
                        ) : (
                          <Text className="text-slate-600 text-xs">▸</Text>
                        )}
                      </SafePressable>
                    );
                  })}
                </View>
              )}

              {equippedClassId !== '' ? (
                <SafePressable
                  onPress={handleUnequip}
                  disabled={busy || inMinigame}
                  className="mt-3 rounded-lg py-2.5 items-center border border-slate-700"
                >
                  <Text
                    className={`text-sm ${
                      busy || inMinigame ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    Unequip (free)
                  </Text>
                </SafePressable>
              ) : null}
            </ScrollView>
          )}
        </SafePressable>
      </SafePressable>
    </Modal>
  );
}
