import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { getDescriptor, type MinigameKindTag } from './registry';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
}

export default function MinigameLobby({ session }: Props) {
  const [members] = useTable(tables.minigameMember);
  const [mySessions] = useTable(tables.mySession);
  const myUsername = mySessions[0]?.username;
  const sessionMembers = members.filter(m => m.sessionId === session.id);
  const me = sessionMembers.find(m => m.username === myUsername);
  const isHost = session.hostUsername === myUsername;
  const allReady = sessionMembers.length > 0 && sessionMembers.every(m => m.ready);
  const enoughPlayers = sessionMembers.length >= session.minPlayers;
  const descriptor = getDescriptor(session.kind.tag as MinigameKindTag);

  const setReady = useReducer(reducers.setMinigameReady);
  const startMinigame = useReducer(reducers.startMinigame);
  const cancelMinigame = useReducer(reducers.cancelMinigame);
  const leaveMinigame = useReducer(reducers.leaveMinigame);

  const [busy, setBusy] = useState(false);

  const toggleReady = async () => {
    if (!me || busy) return;
    setBusy(true);
    try {
      await setReady({ ready: !me.ready });
    } catch (e) { console.error('[minigame] setReady failed:', e); }
    finally { setBusy(false); }
  };

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    console.log('[minigame] startMinigame: calling reducer; session=', session.id.toString(), 'state=', session.state.tag, 'members=', sessionMembers.length, 'allReady=', allReady);
    try {
      await startMinigame();
      console.log('[minigame] startMinigame: reducer resolved');
    } catch (e) {
      console.error('[minigame] startMinigame failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (busy) return;
    setBusy(true);
    try { await cancelMinigame(); } catch (e) { console.error('[minigame] cancelMinigame failed:', e); }
    finally { setBusy(false); }
  };

  const onLeave = async () => {
    if (busy) return;
    setBusy(true);
    try { await leaveMinigame(); } catch (e) { console.error('[minigame] leaveMinigame failed:', e); }
    finally { setBusy(false); }
  };

  return (
    <View className="flex-1 px-6 py-8 gap-5">
      <View>
        <Text className="text-xs uppercase tracking-widest text-amber-400">
          {descriptor?.displayName ?? 'Minigame'}
        </Text>
        <Text className="text-sm text-slate-400 mt-1">
          {descriptor?.description ?? ''}
        </Text>
        <Text className="text-[11px] text-slate-500 mt-2">
          Hosted by {session.hostUsername}
        </Text>
      </View>

      <View className="gap-2">
        <Text className="text-xs uppercase tracking-widest text-slate-500">
          Lobby ({sessionMembers.length} / {session.maxPlayers})
        </Text>
        {sessionMembers.map(m => (
          <View
            key={m.username}
            className="flex-row items-center justify-between rounded-lg bg-slate-900 border border-slate-800 px-3 py-2"
          >
            <Text className="text-sm text-slate-100">
              {m.username}{m.username === session.hostUsername ? ' (host)' : ''}
            </Text>
            <Text
              className={`text-xs font-medium ${
                m.ready ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              {m.ready ? 'Ready' : 'Not ready'}
            </Text>
          </View>
        ))}
      </View>

      {!isHost ? (
        <SafePressable
          onPress={toggleReady}
          disabled={busy}
          className={`rounded-2xl py-3 items-center ${
            me?.ready ? 'bg-slate-800' : 'bg-emerald-500'
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              me?.ready ? 'text-slate-100' : 'text-slate-950'
            }`}
          >
            {me?.ready ? 'Unready' : 'Ready up'}
          </Text>
        </SafePressable>
      ) : null}

      {isHost ? (
        <View className="gap-3">
          <InvitePicker session={session} sessionMembers={sessionMembers} />
          <View className="flex-row gap-3">
            <SafePressable
              onPress={onStart}
              disabled={busy || !allReady || !enoughPlayers}
              className={`flex-1 rounded-2xl py-3 items-center ${
                busy || !allReady || !enoughPlayers
                  ? 'bg-emerald-700'
                  : 'bg-emerald-500'
              }`}
            >
              <Text className="text-sm font-medium text-slate-950">
                {!enoughPlayers
                  ? `Need ${session.minPlayers} player${session.minPlayers > 1 ? 's' : ''}`
                  : !allReady
                  ? 'Waiting for ready'
                  : 'Start'}
              </Text>
            </SafePressable>
            <SafePressable
              onPress={onCancel}
              disabled={busy}
              className="rounded-2xl bg-slate-800 px-5 items-center justify-center"
            >
              <Text className="text-sm font-medium text-slate-100">Cancel</Text>
            </SafePressable>
          </View>
        </View>
      ) : (
        <SafePressable
          onPress={onLeave}
          disabled={busy}
          className="rounded-2xl bg-slate-800 py-3 items-center"
        >
          <Text className="text-sm font-medium text-slate-100">Leave</Text>
        </SafePressable>
      )}
    </View>
  );
}

function InvitePicker({
  session,
  sessionMembers,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionMembers: any[];
}) {
  const [groupMembers] = useTable(tables.myGroupMembers);
  const [invites] = useTable(tables.minigameInvite);
  const [members] = useTable(tables.minigameMember);
  const [pending, setPending] = useState<string | null>(null);
  const [manualUsername, setManualUsername] = useState('');
  const inviteToMinigame = useReducer(reducers.inviteToMinigame);

  const memberUsernames = new Set(sessionMembers.map(m => m.username));
  const sessionInvites = invites.filter(i => i.sessionId === session.id);
  const invitedUsernames = new Set(sessionInvites.map(i => i.toUsername));
  const inMinigameUsernames = new Set(members.map(m => m.username));

  const candidates = groupMembers.filter(
    gm =>
      !memberUsernames.has(gm.username) &&
      !invitedUsernames.has(gm.username) &&
      !inMinigameUsernames.has(gm.username)
  );

  const sendInvite = async (target: string) => {
    if (pending) return;
    setPending(target);
    try {
      await inviteToMinigame({ targetUsername: target });
    } catch (e) { console.error('[minigame] inviteToMinigame failed:', e); }
    finally { setPending(null); }
  };

  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-widest text-slate-500">
        Invite
      </Text>
      {candidates.length === 0 && sessionInvites.length === 0 ? (
        <Text className="text-[11px] text-slate-500">
          No party members available. Invite by username or form a party first.
          Friend invites coming soon.
        </Text>
      ) : null}
      {candidates.map(gm => (
        <SafePressable
          key={gm.username}
          onPress={() => sendInvite(gm.username)}
          disabled={pending !== null}
          className="flex-row items-center justify-between rounded-lg bg-slate-900 border border-slate-800 px-3 py-2"
        >
          <Text className="text-sm text-slate-100">{gm.username}</Text>
          <Text className="text-xs text-amber-400">
            {pending === gm.username ? 'Inviting…' : 'Invite'}
          </Text>
        </SafePressable>
      ))}
      {sessionInvites.map(inv => (
        <View
          key={inv.inviteId.toString()}
          className="flex-row items-center justify-between rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
        >
          <Text className="text-sm text-slate-300">{inv.toUsername}</Text>
          <Text className="text-xs text-slate-500">Invited</Text>
        </View>
      ))}
      <View className="flex-row gap-2 mt-2">
        <TextInput
          value={manualUsername}
          onChangeText={setManualUsername}
          placeholder="Username"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100"
        />
        <SafePressable
          onPress={() => {
            const u = manualUsername.trim();
            if (u.length === 0) return;
            sendInvite(u);
            setManualUsername('');
          }}
          disabled={pending !== null || manualUsername.trim().length === 0}
          className={`rounded-lg px-3 justify-center ${
            pending !== null || manualUsername.trim().length === 0
              ? 'bg-amber-700'
              : 'bg-amber-500'
          }`}
        >
          <Text className="text-xs font-medium text-slate-950">Send</Text>
        </SafePressable>
      </View>
    </View>
  );
}
