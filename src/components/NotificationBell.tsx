import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type { Notification } from '../module_bindings/types';

const KIND_LABEL: Record<string, string> = {
  GroupInvite: 'Group invite',
  GuildInvite: 'Guild invite',
  MinigameInvite: 'Minigame invite',
  DefensiveBattleVote: 'Defensive Battle',
  System: 'System',
};

const KIND_GLYPH: Record<string, string> = {
  GroupInvite: '👥',
  GuildInvite: '🏰',
  MinigameInvite: '🎮',
  DefensiveBattleVote: '⚔',
  System: '✦',
};

interface NotificationBellProps {
  closeSignal?: unknown;
}

export default function NotificationBell({ closeSignal }: NotificationBellProps) {
  const [notifications] = useTable(tables.myNotifications);
  const [open, setOpen] = useState(false);
  const markAllRead = useReducer(reducers.markAllNotificationsRead);

  useEffect(() => {
    setOpen(false);
  }, [closeSignal]);

  const unread = useMemo(
    () => notifications.filter(n => n.readAt === undefined).length,
    [notifications]
  );

  const sorted = useMemo(
    () =>
      [...notifications].sort((a, b) =>
        a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch
          ? 1
          : -1
      ),
    [notifications]
  );

  const wiggle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (unread === 0) {
      wiggle.stopAnimation();
      wiggle.setValue(0);
      return;
    }
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(wiggle, {
          toValue: 1,
          duration: 90,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(wiggle, {
          toValue: -1,
          duration: 130,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(wiggle, {
          toValue: 1,
          duration: 130,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(wiggle, {
          toValue: 0,
          duration: 90,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (cancelled) return;
        setTimeout(loop, 3200);
      });
    };
    loop();
    return () => {
      cancelled = true;
      wiggle.stopAnimation();
      wiggle.setValue(0);
    };
  }, [unread, wiggle]);

  const rotate = wiggle.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-12deg', '0deg', '12deg'],
  });

  const onToggle = () => {
    setOpen(prev => {
      const next = !prev;
      if (next && unread > 0) {
        markAllRead().catch(() => {});
      }
      return next;
    });
  };

  const lit = unread > 0;

  return (
    <View>
      <SafePressable
        onPress={onToggle}
        className={`rounded-lg px-2 py-1.5 ${
          lit ? 'bg-amber-500' : 'bg-slate-800'
        }`}
      >
        <Animated.Text
          style={{ transform: [{ rotate }] }}
          className={`text-[13px] ${lit ? 'text-slate-950' : 'text-slate-400'}`}
        >
          🔔
        </Animated.Text>
      </SafePressable>
      {lit && unread > 0 ? (
        <View
          pointerEvents="none"
          className="absolute -top-1 -right-1 min-w-[16px] h-[16px] items-center justify-center rounded-full bg-rose-500 px-1"
        >
          <Text className="text-[10px] font-semibold text-slate-950">
            {unread > 9 ? '9+' : unread}
          </Text>
        </View>
      ) : null}
      {open ? (
        <View className="absolute right-0 top-9 w-80 max-h-96 rounded-xl border border-slate-700 bg-slate-900 shadow-lg z-50">
          <View className="flex-row items-center justify-between px-3 py-2 border-b border-slate-800">
            <Text className="text-xs uppercase tracking-widest text-slate-500">
              Notifications
            </Text>
            <SafePressable
              onPress={() => setOpen(false)}
              className="rounded-md px-2 py-0.5 bg-slate-800"
            >
              <Text className="text-[11px] text-slate-300">Close</Text>
            </SafePressable>
          </View>
          {sorted.length === 0 ? (
            <View className="px-3 py-6 items-center">
              <Text className="text-xs text-slate-500">
                No notifications yet.
              </Text>
            </View>
          ) : (
            <ScrollView className="max-h-80">
              {sorted.map(n => (
                <NotificationRow key={n.notificationId.toString()} notification={n} />
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

function NotificationRow({ notification }: { notification: Notification }) {
  const accept = useReducer(reducers.acceptInvitation);
  const decline = useReducer(reducers.declineInvitation);
  const acceptMg = useReducer(reducers.acceptMinigameInvite);
  const declineMg = useReducer(reducers.declineMinigameInvite);
  const voteBattle = useReducer(reducers.voteDefensiveBattle);
  const dismiss = useReducer(reducers.deleteNotification);
  const [busy, setBusy] = useState(false);

  const kindTag = notification.kind.tag;
  const label = KIND_LABEL[kindTag] ?? kindTag;
  const glyph = KIND_GLYPH[kindTag] ?? '•';

  const onDismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await dismiss({ notificationId: notification.notificationId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async () => {
    const refId = notification.actionableRefId;
    if (refId === undefined || busy) return;
    setBusy(true);
    try {
      if (kindTag === 'GroupInvite') {
        await accept({ invitationId: refId });
      } else if (kindTag === 'MinigameInvite') {
        await acceptMg({ inviteId: refId });
      } else if (kindTag === 'DefensiveBattleVote') {
        await voteBattle({ sessionId: refId, voteYay: true });
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    const refId = notification.actionableRefId;
    if (refId === undefined || busy) return;
    setBusy(true);
    try {
      if (kindTag === 'GroupInvite') {
        await decline({ invitationId: refId });
      } else if (kindTag === 'MinigameInvite') {
        await declineMg({ inviteId: refId });
      } else if (kindTag === 'DefensiveBattleVote') {
        await voteBattle({ sessionId: refId, voteYay: false });
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const isBattleVote = kindTag === 'DefensiveBattleVote';
  const showAcceptDecline =
    (kindTag === 'GroupInvite' ||
      kindTag === 'MinigameInvite' ||
      isBattleVote) &&
    notification.actionableRefId !== undefined;

  return (
    <View className="flex-row items-start gap-2 px-3 py-2 border-b border-slate-800">
      <Text className="text-base mt-0.5">{glyph}</Text>
      <View className="flex-1 gap-1">
        <Text className="text-[10px] uppercase tracking-widest text-slate-500">
          {label}
        </Text>
        <Text className="text-sm text-slate-100">{notification.summary}</Text>
        {showAcceptDecline ? (
          <View className="flex-row gap-2 mt-1">
            <SafePressable
              onPress={onAccept}
              disabled={busy}
              className="rounded-lg bg-emerald-500 px-3 py-1"
            >
              <Text className="text-[11px] font-medium text-slate-950">
                {isBattleVote ? 'Yay' : 'Accept'}
              </Text>
            </SafePressable>
            <SafePressable
              onPress={onDecline}
              disabled={busy}
              className="rounded-lg bg-slate-800 px-3 py-1"
            >
              <Text className="text-[11px] font-medium text-slate-100">
                {isBattleVote ? 'Nay' : 'Decline'}
              </Text>
            </SafePressable>
          </View>
        ) : null}
      </View>
      <SafePressable
        onPress={onDismiss}
        disabled={busy}
        className="rounded-md px-1.5 py-0.5"
      >
        <Text className="text-slate-500 text-sm">✕</Text>
      </SafePressable>
    </View>
  );
}
