import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import SafePressable from '../SafePressable';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { getDescriptor, type MinigameKindTag } from './registry';
import MinigameLobby from './MinigameLobby';
import MinigameResults from './MinigameResults';

export default function MinigameModal() {
  const [members] = useTable(tables.myMinigameMember);
  const [invites] = useTable(tables.myMinigameInvites);
  const [sessions] = useTable(tables.minigameSession);

  const member = members[0];
  const showInvites = !member && invites.length > 0;

  if (!member && !showInvites) return null;

  if (showInvites) {
    return (
      <View
        pointerEvents="auto"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        className="bg-slate-950/95 z-50"
      >
        <InvitesPanel />
      </View>
    );
  }

  if (!member) return null;
  const session = sessions.find(s => s.id === member.sessionId);
  if (!session) {
    console.warn('[minigame] modal: have member but session row not yet in cache; sessionId=', member.sessionId.toString());
    return null;
  }
  console.log('[minigame] modal render: session.id=', session.id.toString(), 'state.tag=', session.state.tag, 'kind.tag=', session.kind.tag);
  const descriptor = getDescriptor(session.kind.tag as MinigameKindTag);

  let body: ReactNode = null;
  if (session.state.tag === 'Lobby') {
    body = <MinigameLobby session={session} />;
  } else if (session.state.tag === 'InProgress') {
    if (descriptor) {
      const GameView = descriptor.View;
      body = <GameView session={session} />;
    } else {
      body = (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-slate-500">
            Unsupported minigame kind: {session.kind.tag}
          </Text>
        </View>
      );
    }
  } else {
    body = <MinigameResults session={session} />;
  }

  return (
    <View
      pointerEvents="auto"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      className="bg-slate-950/95 z-50"
    >
      <View className="flex-1 pt-12">
        <View className="flex-row items-center justify-between px-6 pb-3">
          <Text className="text-xs uppercase tracking-widest text-slate-500">
            {descriptor?.displayName ?? session.kind.tag}
          </Text>
          {(session.state.tag === 'Completed' || session.state.tag === 'Cancelled') ? (
            <DoneButton />
          ) : null}
        </View>
        <View className="flex-1">{body}</View>
      </View>
    </View>
  );
}

function DoneButton() {
  const leaveMinigame = useReducer(reducers.leaveMinigame);
  const [busy, setBusy] = useState(false);
  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try { await leaveMinigame(); } catch (e) { console.error('[minigame] leaveMinigame (Done) failed:', e); }
    finally { setBusy(false); }
  };
  return (
    <SafePressable
      onPress={onPress}
      disabled={busy}
      className="rounded-lg bg-amber-500 px-4 py-2"
    >
      <Text className="text-xs font-medium text-slate-950">Done</Text>
    </SafePressable>
  );
}

function InvitesPanel() {
  const [invites] = useTable(tables.myMinigameInvites);
  const [sessions] = useTable(tables.minigameSession);
  const accept = useReducer(reducers.acceptMinigameInvite);
  const decline = useReducer(reducers.declineMinigameInvite);
  const [busy, setBusy] = useState<bigint | null>(null);

  const onAccept = async (inviteId: bigint) => {
    if (busy !== null) return;
    setBusy(inviteId);
    try { await accept({ inviteId }); } catch (e) { console.error('[minigame] acceptMinigameInvite failed:', e); }
    finally { setBusy(null); }
  };

  const onDecline = async (inviteId: bigint) => {
    if (busy !== null) return;
    setBusy(inviteId);
    try { await decline({ inviteId }); } catch (e) { console.error('[minigame] declineMinigameInvite failed:', e); }
    finally { setBusy(null); }
  };

  return (
    <View className="flex-1 pt-12 px-6 gap-4">
      <Text className="text-xs uppercase tracking-widest text-amber-400">
        Minigame invites
      </Text>
      {invites.map(inv => {
        const session = sessions.find(s => s.id === inv.sessionId);
        const descriptor = session
          ? getDescriptor(session.kind.tag as MinigameKindTag)
          : undefined;
        return (
          <View
            key={inv.inviteId.toString()}
            className="rounded-2xl bg-slate-900 border border-slate-800 px-4 py-4 gap-3"
          >
            <View>
              <Text className="text-sm font-semibold text-slate-100">
                {inv.fromUsername} invited you to {descriptor?.displayName ?? 'a minigame'}
              </Text>
              {descriptor?.description ? (
                <Text className="text-xs text-slate-500 mt-1">
                  {descriptor.description}
                </Text>
              ) : null}
            </View>
            <View className="flex-row gap-2">
              <SafePressable
                onPress={() => onAccept(inv.inviteId)}
                disabled={busy !== null}
                className="flex-1 rounded-lg bg-emerald-500 py-2 items-center"
              >
                <Text className="text-xs font-medium text-slate-950">
                  {busy === inv.inviteId ? 'Joining…' : 'Accept'}
                </Text>
              </SafePressable>
              <SafePressable
                onPress={() => onDecline(inv.inviteId)}
                disabled={busy !== null}
                className="flex-1 rounded-lg bg-slate-800 py-2 items-center"
              >
                <Text className="text-xs font-medium text-slate-100">Decline</Text>
              </SafePressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}
