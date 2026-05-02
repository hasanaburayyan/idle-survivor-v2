import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import SafePressable from './SafePressable';

interface RefundCapstoneModalProps {
  visible: boolean;
  onClose: () => void;
  classId: string;
  capstoneBranchId: string;
  /** Display name of the currently-chosen capstone skill. */
  chosenSkillName: string;
  /** Pre-formatted cost string e.g. "500 Metal" — computed by parent. */
  refundCostLabel: string;
  inMinigame: boolean;
  onRefund: (classId: string, capstoneBranchId: string) => Promise<void>;
}

export default function RefundCapstoneModal({
  visible,
  onClose,
  classId,
  capstoneBranchId,
  chosenSkillName,
  refundCostLabel,
  inMinigame,
  onRefund,
}: RefundCapstoneModalProps) {
  const [busy, setBusy] = useState(false);

  const handleRefund = async () => {
    if (busy || inMinigame) return;
    setBusy(true);
    try {
      await onRefund(classId, capstoneBranchId);
      onClose();
    } catch {
      /* server will surface errors in logs */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center bg-black/75 px-6">
        <View className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 gap-4">
          {/* Title */}
          <View className="gap-1">
            <Text className="text-base font-semibold text-slate-100">
              Refund Capstone Choice
            </Text>
            <Text className="text-xs uppercase tracking-widest text-slate-500">
              Irreversible until you re-choose
            </Text>
          </View>

          {/* Description */}
          <Text className="text-sm text-slate-400 leading-5">
            Refund{' '}
            <Text className="font-medium text-amber-200">{chosenSkillName}</Text>
            {' '}and unlock all three capstone options again.
            The skill point cost is returned to your class pool.
          </Text>

          {/* Cost */}
          <View className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 gap-1">
            <Text className="text-[10px] uppercase tracking-widest text-slate-500">
              Refund cost
            </Text>
            <Text className="text-sm font-semibold text-amber-300">
              {refundCostLabel}
            </Text>
          </View>

          {/* Combat lock warning */}
          {inMinigame ? (
            <View className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2">
              <Text className="text-xs text-red-400 text-center">
                Cannot refund during a minigame session.
              </Text>
            </View>
          ) : null}

          {/* Actions */}
          <View className="flex-row gap-3 mt-1">
            <SafePressable
              onPress={onClose}
              className="flex-1 rounded-xl border border-slate-700 py-2.5 items-center"
            >
              <Text className="text-sm text-slate-300">Cancel</Text>
            </SafePressable>
            <SafePressable
              disabled={busy || inMinigame}
              onPress={handleRefund}
              className={`flex-1 rounded-xl py-2.5 items-center ${
                busy || inMinigame
                  ? 'bg-slate-800'
                  : 'border border-red-800 bg-red-950/80'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  busy || inMinigame ? 'text-slate-500' : 'text-red-300'
                }`}
              >
                {busy ? 'Refunding…' : 'Refund'}
              </Text>
            </SafePressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
