import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { colorToClasses, groupColor } from '../lib/groupColor';
import { useScrapFlow } from './ScrapFlow';

const MAX_GROUP_SIZE = 5;

interface GroupPanelProps {
  username: string;
}

export default function GroupPanel({ username }: GroupPanelProps) {
  const [memberships] = useTable(tables.myGroupMembership);
  const [group] = useTable(tables.myGroup);
  const [members] = useTable(tables.myGroupMembers);
  const [memberStates] = useTable(tables.myGroupMemberStates);
  const [contributions] = useTable(tables.myGroupContributions);
  const [invitations] = useTable(tables.myInvitations);

  const inGroup = memberships.length > 0;

  if (!inGroup) {
    return (
      <View className="px-4 py-3 border-t border-slate-800 bg-slate-950">
        {invitations.length > 0 ? (
          <InvitationList invitations={invitations} />
        ) : (
          <CreateGroupButton />
        )}
      </View>
    );
  }

  const currentGroup = group[0];
  const isOwner = currentGroup?.ownerUsername === username;
  const isFull = members.length >= MAX_GROUP_SIZE;

  return (
    <View className="px-4 py-3 border-t border-slate-800 bg-slate-950 gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Group {isOwner ? '· Owner' : ''}
        </Text>
        <LeaveGroupButton />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10 }}
      >
        {members.map(m => (
          <MemberCard
            key={m.username}
            viewer={username}
            memberUsername={m.username}
            level={
              memberStates.find(ps => ps.username === m.username)
                ?.playerLevel ?? 0
            }
            contributions={contributions}
          />
        ))}
      </ScrollView>
      {!isFull ? <InviteByUsername /> : null}
    </View>
  );
}

function CreateGroupButton() {
  const createGroup = useReducer(reducers.createGroup);
  const [submitting, setSubmitting] = useState(false);
  const onPress = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await createGroup();
    } catch {
      /* ignore — user can tap again */
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={submitting}
      className={`rounded-lg py-3 items-center ${
        submitting ? 'bg-emerald-700' : 'bg-emerald-500'
      }`}
    >
      <Text className="text-sm font-medium text-slate-950">
        {submitting ? 'Creating…' : 'Create group'}
      </Text>
    </Pressable>
  );
}

function LeaveGroupButton() {
  const leave = useReducer(reducers.leaveGroup);
  const [submitting, setSubmitting] = useState(false);
  const onPress = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await leave();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={submitting}
      className="rounded-lg bg-slate-800 px-3 py-1.5"
    >
      <Text className="text-xs font-medium text-slate-100">
        {submitting ? 'Leaving…' : 'Leave'}
      </Text>
    </Pressable>
  );
}

function InviteByUsername() {
  const invite = useReducer(reducers.inviteToGroup);
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onPress = async () => {
    if (submitting || !target.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await invite({ targetUsername: target.trim().toLowerCase() });
      setTarget('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        <TextInput
          value={target}
          onChangeText={setTarget}
          placeholder="Invite by username"
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
          placeholderTextColor="#64748b"
        />
        <Pressable
          onPress={onPress}
          disabled={submitting || !target.trim()}
          className={`rounded-lg px-4 justify-center ${
            submitting || !target.trim() ? 'bg-slate-800' : 'bg-emerald-500'
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              submitting || !target.trim() ? 'text-slate-500' : 'text-slate-950'
            }`}
          >
            Invite
          </Text>
        </Pressable>
      </View>
      {error ? <Text className="text-xs text-rose-400">{error}</Text> : null}
    </View>
  );
}

interface InvitationListProps {
  invitations: readonly {
    invitationId: bigint;
    fromUsername: string;
  }[];
}

function InvitationList({ invitations }: InvitationListProps) {
  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-widest text-slate-500">
        Invitations
      </Text>
      {invitations.map(inv => (
        <InvitationRow
          key={inv.invitationId.toString()}
          invitationId={inv.invitationId}
          fromUsername={inv.fromUsername}
        />
      ))}
    </View>
  );
}

function InvitationRow({
  invitationId,
  fromUsername,
}: {
  invitationId: bigint;
  fromUsername: string;
}) {
  const accept = useReducer(reducers.acceptInvitation);
  const decline = useReducer(reducers.declineInvitation);
  const [busy, setBusy] = useState(false);
  const onAccept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await accept({ invitationId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };
  const onDecline = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await decline({ invitationId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="flex-row items-center justify-between rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
      <Text className="text-sm text-slate-100">
        <Text className="font-semibold">{fromUsername}</Text> invited you
      </Text>
      <View className="flex-row gap-2">
        <Pressable
          onPress={onAccept}
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-3 py-1.5"
        >
          <Text className="text-xs font-medium text-slate-950">Accept</Text>
        </Pressable>
        <Pressable
          onPress={onDecline}
          disabled={busy}
          className="rounded-lg bg-slate-800 px-3 py-1.5"
        >
          <Text className="text-xs font-medium text-slate-100">Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface MemberCardProps {
  viewer: string;
  memberUsername: string;
  level: number;
  contributions: readonly {
    eventId: bigint;
    contributor: string;
    recipient: string;
    amount: bigint;
    createdAt: { microsSinceUnixEpoch: bigint };
  }[];
}

function MemberCard({
  viewer,
  memberUsername,
  level,
  contributions,
}: MemberCardProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const color = useMemo(() => {
    const nowMicros = BigInt(Date.now()) * 1000n;
    return groupColor(contributions, viewer, memberUsername, nowMicros);
  }, [contributions, viewer, memberUsername, tick]);

  const classes = colorToClasses(color);
  const isSelf = memberUsername === viewer;

  const cardRef = useRef<View | null>(null);
  const seenIds = useRef<Set<string> | null>(null);
  const { spawnBurst } = useScrapFlow();

  useEffect(() => {
    if (seenIds.current === null) {
      seenIds.current = new Set(
        contributions.map(e => e.eventId.toString())
      );
      return;
    }
    for (const e of contributions) {
      const id = e.eventId.toString();
      if (seenIds.current.has(id)) continue;
      seenIds.current.add(id);
      if (e.contributor === memberUsername && e.recipient === viewer) {
        spawnBurst(cardRef.current, e.amount);
      }
    }
  }, [contributions, memberUsername, viewer, spawnBurst]);

  return (
    <View
      ref={r => (cardRef.current = r)}
      className={`w-36 rounded-xl border p-3 ${classes}`}
    >
      <Text
        className="text-sm font-semibold text-slate-100"
        numberOfLines={1}
      >
        {memberUsername}
        {isSelf ? ' (you)' : ''}
      </Text>
      <Text className="text-xs text-slate-400 mt-1">Lv {level}</Text>
      <Text className="text-[11px] text-slate-500 mt-2">The Wastes</Text>
      <View className="flex-row items-center gap-1 mt-1">
        <View className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <Text className="text-[11px] text-slate-500">Idle</Text>
      </View>
    </View>
  );
}
