import { useState } from 'react';
import { Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';

export default function GroupLobby() {
  const [memberships] = useTable(tables.myGroupMembership);
  const [invitations] = useTable(tables.myInvitations);
  const [playerStates] = useTable(tables.myPlayerState);
  const [locations] = useTable(tables.locationDefinition);
  const inGroup = memberships.length > 0;
  const currentLocation = playerStates[0]?.location ?? 'the_wastes';
  const currentLocationName =
    locations.find(l => l.locationKey === currentLocation)?.name ??
    currentLocation;

  if (inGroup) {
    return (
      <View className="rounded-2xl bg-slate-900 border border-slate-800 px-5 py-5">
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Group
        </Text>
        <Text className="text-sm text-slate-300 mt-1">
          You&rsquo;re currently in a group. Manage members from the group bar
          at the bottom of the screen.
        </Text>
        <Text className="text-[11px] text-slate-500 mt-2">
          Your location: {currentLocationName}
        </Text>
      </View>
    );
  }

  return (
    <View className="rounded-2xl bg-slate-900 border border-slate-800 px-5 py-5 gap-3">
      <Text className="text-xs uppercase tracking-widest text-slate-500">
        Group
      </Text>
      <Text className="text-[11px] text-slate-500 -mt-1">
        Your location: {currentLocationName}
      </Text>
      {invitations.length > 0 ? (
        <View className="gap-2">
          {invitations.map(inv => (
            <InvitationRow
              key={inv.invitationId.toString()}
              invitationId={inv.invitationId}
              fromUsername={inv.fromUsername}
            />
          ))}
        </View>
      ) : null}
      <CreateGroupButton />
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
    <SafePressable
      onPress={onPress}
      disabled={submitting}
      className={`rounded-lg py-3 items-center ${
        submitting ? 'bg-emerald-700' : 'bg-emerald-500'
      }`}
    >
      <Text className="text-sm font-medium text-slate-950">
        {submitting ? 'Creating…' : 'Create group'}
      </Text>
    </SafePressable>
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
    <View className="flex-row items-center justify-between rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
      <Text className="text-sm text-slate-100">
        <Text className="font-semibold">{fromUsername}</Text> invited you
      </Text>
      <View className="flex-row gap-2">
        <SafePressable
          onPress={onAccept}
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-3 py-1.5"
        >
          <Text className="text-xs font-medium text-slate-950">Accept</Text>
        </SafePressable>
        <SafePressable
          onPress={onDecline}
          disabled={busy}
          className="rounded-lg bg-slate-800 px-3 py-1.5"
        >
          <Text className="text-xs font-medium text-slate-100">Decline</Text>
        </SafePressable>
      </View>
    </View>
  );
}
