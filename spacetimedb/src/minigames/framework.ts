import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { applyResourceYieldBonus } from '../structures';
import {
  MinigameKind,
  minigameMember,
  minigameInvite,
  minigamePrivateState,
  minigameTick,
  minigameScheduledReducers,
  type MinigameKindTag,
} from './tables';
import {
  getHandler,
  type MinigameEndResult,
  type Reward,
} from './registry';
import {
  insertNotification,
  deleteNotificationByRef,
} from '../notifications';

// ---------- Helpers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSenderUsername(ctx: any): string {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  return s.username;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireActiveMinigame(ctx: any, expectedKind: MinigameKindTag) {
  const username = getSenderUsername(ctx);
  const member = ctx.db.minigameMember.username.find(username);
  if (member === null) throw new SenderError('Not in a minigame');
  const session = ctx.db.minigameSession.id.find(member.sessionId);
  if (session === null) throw new SenderError('Session missing');
  if (session.state.tag !== 'inProgress') throw new SenderError('Session not in progress');
  if (session.kind.tag !== expectedKind) throw new SenderError('Wrong minigame');
  return { username, member, session };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function membersOf(ctx: any, sessionId: bigint): any[] {
  return [...ctx.db.minigameMember.minigame_member_session_id.filter(sessionId)];
}

// Grant scrap by mutating playerState directly (no level-up logic; matches the
// existing addResource('scrap', ...) shape from index.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grantScrap(ctx: any, username: string, delta: bigint): void {
  if (delta === 0n) return;
  const ps = ctx.db.playerState.username.find(username);
  if (ps === null) return;
  let next = ps.scrap + delta;
  if (next < 0n) next = 0n;
  ctx.db.playerState.username.update({
    ...ps,
    scrap: next,
    updatedAt: ctx.timestamp,
  });
}

// Grant XP. v1: bumps playerState.xp only; level-up loop in
// performScavengeActivity is not factored out yet (deferred).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function grantXp(ctx: any, username: string, amount: bigint): void {
  if (amount <= 0n) return;
  const ps = ctx.db.playerState.username.find(username);
  if (ps === null) return;
  ctx.db.playerState.username.update({
    ...ps,
    xp: ps.xp + amount,
    updatedAt: ctx.timestamp,
  });
}

// Grant a non-scrap resource via playerResource (mirrors index.ts addResource).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grantItem(ctx: any, username: string, resourceId: string, quantity: bigint): void {
  if (quantity <= 0n) return;
  const existing = [...ctx.db.playerResource.player_resource_username.filter(username)].find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.resourceId === resourceId
  );
  if (existing) {
    ctx.db.playerResource.id.update({ ...existing, amount: existing.amount + quantity });
  } else {
    ctx.db.playerResource.insert({ id: 0n, username, resourceId, amount: quantity });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyReward(ctx: any, username: string, reward: Reward): void {
  switch (reward.kind) {
    case 'scrap':
      grantScrap(ctx, username, reward.amount);
      return;
    case 'xp':
      grantXp(ctx, username, reward.amount);
      return;
    case 'item': {
      // Non-scrap resources route through their skill chain (Minor flat +
      // Major %) — so Medicine from minigames scales with the Medicine tree.
      // resourceId maps directly to the chain prefix for parts/metal/fabric/
      // food/medicine; scrap is never delivered as 'item' (uses 'scrap' kind).
      const yieldAmount = applyResourceYieldBonus(
        ctx,
        username,
        reward.resourceId,
        reward.quantity
      );
      grantItem(ctx, username, reward.resourceId, yieldAmount);
      return;
    }
    case 'custom':
      reward.apply(ctx, username);
      return;
  }
}

function rewardSummary(reward: Reward): unknown {
  switch (reward.kind) {
    case 'scrap':
      return { kind: 'scrap', amount: String(reward.amount) };
    case 'xp':
      return { kind: 'xp', amount: String(reward.amount) };
    case 'item':
      return { kind: 'item', resourceId: reward.resourceId, quantity: String(reward.quantity) };
    case 'custom':
      return { kind: 'custom', description: reward.description };
  }
}

// ---------- Session cleanup ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deleteSessionRows(ctx: any, sessionId: bigint): void {
  for (const inv of ctx.db.minigameInvite.minigame_invite_session_id.filter(sessionId)) {
    ctx.db.minigameInvite.inviteId.delete(inv.inviteId);
    deleteNotificationByRef(ctx, inv.toUsername, 'minigameInvite', inv.inviteId);
  }
  for (const ps of ctx.db.minigamePrivateState.minigame_private_state_session_id.filter(sessionId)) {
    ctx.db.minigamePrivateState.id.delete(ps.id);
  }
  for (const m of ctx.db.minigameMember.minigame_member_session_id.filter(sessionId)) {
    ctx.db.minigameMember.username.delete(m.username);
  }
  for (const tick of ctx.db.minigameTick.minigame_tick_session_id.filter(sessionId)) {
    ctx.db.minigameTick.scheduledId.delete(tick.scheduledId);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function endSession(ctx: any, session: any, result: MinigameEndResult): void {
  const completedAt = ctx.timestamp;
  for (const p of result.placements) {
    const matching = result.rewards.find(r => r.username === p.username);
    const rewards = matching?.rewards ?? [];
    const rewardsJson = JSON.stringify(rewards.map(rewardSummary));
    ctx.db.minigameResult.insert({
      id: 0n,
      sessionId: session.id,
      username: p.username,
      kind: session.kind,
      finalScore: p.finalScore,
      placement: p.placement,
      rewardsJson,
      completedAt,
    });
    for (const r of rewards) applyReward(ctx, p.username, r);
  }
  ctx.db.minigameSession.id.update({
    ...session,
    state: { tag: 'completed' as const },
    endedAt: completedAt,
  });
  deleteSessionRows(ctx, session.id);
}

// ---------- Disconnect / leave ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLeaveDecision(ctx: any, session: any, member: any, decision: 'forfeit' | 'kick' | 'pause'): void {
  if (decision === 'forfeit') {
    const handler = getHandler(session.kind.tag as MinigameKindTag);
    if (handler) {
      const result = handler.onEnd(ctx, session);
      endSession(ctx, session, result);
    } else {
      // Defensive: handler missing (shouldn't happen). Just clean up.
      deleteSessionRows(ctx, session.id);
      ctx.db.minigameSession.id.update({
        ...session,
        state: { tag: 'cancelled' as const },
        endedAt: ctx.timestamp,
      });
    }
    return;
  }
  // 'kick' or 'pause' — mark inactive; if all are inactive, end.
  ctx.db.minigameMember.username.update({ ...member, active: false });
  const remaining = membersOf(ctx, session.id).filter(m => m.active);
  if (remaining.length === 0) {
    const handler = getHandler(session.kind.tag as MinigameKindTag);
    if (handler) {
      const result = handler.onEnd(ctx, session);
      endSession(ctx, session, result);
    } else {
      deleteSessionRows(ctx, session.id);
      ctx.db.minigameSession.id.update({
        ...session,
        state: { tag: 'cancelled' as const },
        endedAt: ctx.timestamp,
      });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleDisconnect(ctx: any): void {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) return;
  const member = ctx.db.minigameMember.username.find(s.username);
  if (member === null) return;
  const session = ctx.db.minigameSession.id.find(member.sessionId);
  if (session === null) return;
  if (session.state.tag !== 'inProgress' && session.state.tag !== 'lobby') return;
  // Lobby disconnect: just remove the member; if host, cancel the session.
  if (session.state.tag === 'lobby') {
    ctx.db.minigameMember.username.delete(s.username);
    if (session.hostUsername === s.username) {
      deleteSessionRows(ctx, session.id);
      ctx.db.minigameSession.id.update({
        ...session,
        state: { tag: 'cancelled' as const },
        endedAt: ctx.timestamp,
      });
    }
    return;
  }
  const handler = getHandler(session.kind.tag as MinigameKindTag);
  const decision = handler ? handler.onPlayerLeave(ctx, session, member, 'disconnect') : 'forfeit';
  applyLeaveDecision(ctx, session, member, decision);
}

// ---------- Views ----------

export const myMinigameMember = spacetimedb.view(
  { name: 'my_minigame_member', public: true },
  t.array(minigameMember.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const m = ctx.db.minigameMember.username.find(s.username);
    return m ? [m] : [];
  }
);

export const myMinigameInvites = spacetimedb.view(
  { name: 'my_minigame_invites', public: true },
  t.array(minigameInvite.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.minigameInvite.minigame_invite_to_username.filter(s.username)];
  }
);

export const myMinigamePrivateState = spacetimedb.view(
  { name: 'my_minigame_private_state', public: true },
  t.array(minigamePrivateState.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.minigamePrivateState.minigame_private_state_username.filter(s.username)];
  }
);

// ---------- Lifecycle reducers ----------

export const createMinigame = spacetimedb.reducer(
  { kind: MinigameKind },
  (ctx, { kind }) => {
    const username = getSenderUsername(ctx);
    if (ctx.db.minigameMember.username.find(username) !== null) {
      throw new SenderError('Already in a minigame');
    }
    const handler = getHandler(kind.tag as MinigameKindTag);
    if (!handler) throw new SenderError('Unknown minigame');
    const session = ctx.db.minigameSession.insert({
      id: 0n,
      kind,
      state: { tag: 'lobby' as const },
      hostUsername: username,
      minPlayers: handler.meta.minPlayers,
      maxPlayers: handler.meta.maxPlayers,
      createdAt: ctx.timestamp,
      startedAt: undefined,
      endedAt: undefined,
    });
    ctx.db.minigameMember.insert({
      username,
      sessionId: session.id,
      seatIndex: 0,
      ready: true,
      active: true,
      joinedAt: ctx.timestamp,
    });
    handler.init(ctx, session);
  }
);

export const inviteToMinigame = spacetimedb.reducer(
  { targetUsername: t.string() },
  (ctx, { targetUsername }) => {
    const username = getSenderUsername(ctx);
    const member = ctx.db.minigameMember.username.find(username);
    if (member === null) throw new SenderError('Not in a minigame');
    const session = ctx.db.minigameSession.id.find(member.sessionId);
    if (session === null) throw new SenderError('Session missing');
    if (session.hostUsername !== username) throw new SenderError('Only the host can invite');
    if (session.state.tag !== 'lobby') throw new SenderError('Session is not in lobby');
    const target = targetUsername.trim();
    if (target.length === 0) throw new SenderError('Target username required');
    if (target === username) throw new SenderError('Cannot invite yourself');
    const targetEntry = ctx.db.usernameDirectory.username.find(target);
    if (targetEntry === null) throw new SenderError('User not found');
    if (ctx.db.minigameMember.username.find(target) !== null) {
      throw new SenderError('Target already in a minigame');
    }
    const memberCount = membersOf(ctx, session.id).length;
    if (memberCount >= session.maxPlayers) throw new SenderError('Session is full');
    const existingInvites = [
      ...ctx.db.minigameInvite.minigame_invite_to_username.filter(target),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ].filter((inv: any) => inv.sessionId === session.id);
    if (existingInvites.length > 0) throw new SenderError('Already invited');
    const inviteRow = ctx.db.minigameInvite.insert({
      inviteId: 0n,
      sessionId: session.id,
      fromUsername: username,
      toUsername: target,
      createdAt: ctx.timestamp,
    });
    insertNotification(
      ctx,
      target,
      'minigameInvite',
      `${username} invited you to ${session.kind.tag}`,
      inviteRow.inviteId,
      `minigameInvite:${username}`
    );
  }
);

export const acceptMinigameInvite = spacetimedb.reducer(
  { inviteId: t.u64() },
  (ctx, { inviteId }) => {
    const username = getSenderUsername(ctx);
    if (ctx.db.minigameMember.username.find(username) !== null) {
      throw new SenderError('Already in a minigame');
    }
    const invite = ctx.db.minigameInvite.inviteId.find(inviteId);
    if (invite === null) throw new SenderError('Invite not found');
    if (invite.toUsername !== username) throw new SenderError('Invite not for you');
    const session = ctx.db.minigameSession.id.find(invite.sessionId);
    if (session === null) throw new SenderError('Session missing');
    if (session.state.tag !== 'lobby') throw new SenderError('Session is not in lobby');
    const memberCount = membersOf(ctx, session.id).length;
    if (memberCount >= session.maxPlayers) throw new SenderError('Session is full');
    ctx.db.minigameMember.insert({
      username,
      sessionId: session.id,
      seatIndex: memberCount,
      ready: false,
      active: true,
      joinedAt: ctx.timestamp,
    });
    ctx.db.minigameInvite.inviteId.delete(inviteId);
    deleteNotificationByRef(ctx, username, 'minigameInvite', inviteId);
  }
);

export const declineMinigameInvite = spacetimedb.reducer(
  { inviteId: t.u64() },
  (ctx, { inviteId }) => {
    const username = getSenderUsername(ctx);
    const invite = ctx.db.minigameInvite.inviteId.find(inviteId);
    if (invite === null) throw new SenderError('Invite not found');
    if (invite.toUsername !== username) throw new SenderError('Invite not for you');
    ctx.db.minigameInvite.inviteId.delete(inviteId);
    deleteNotificationByRef(ctx, username, 'minigameInvite', inviteId);
  }
);

export const setMinigameReady = spacetimedb.reducer(
  { ready: t.bool() },
  (ctx, { ready }) => {
    const username = getSenderUsername(ctx);
    const member = ctx.db.minigameMember.username.find(username);
    if (member === null) throw new SenderError('Not in a minigame');
    const session = ctx.db.minigameSession.id.find(member.sessionId);
    if (session === null) throw new SenderError('Session missing');
    if (session.state.tag !== 'lobby') throw new SenderError('Session is not in lobby');
    ctx.db.minigameMember.username.update({ ...member, ready });
  }
);

export const startMinigame = spacetimedb.reducer(ctx => {
  const username = getSenderUsername(ctx);
  console.log(`[minigame] startMinigame: sender=${username}`);
  const member = ctx.db.minigameMember.username.find(username);
  if (member === null) throw new SenderError('Not in a minigame');
  const session = ctx.db.minigameSession.id.find(member.sessionId);
  if (session === null) throw new SenderError('Session missing');
  console.log(`[minigame] startMinigame: session=${session.id} kind=${session.kind.tag} state=${session.state.tag}`);
  if (session.hostUsername !== username) throw new SenderError('Only the host can start');
  if (session.state.tag !== 'lobby') throw new SenderError('Session is not in lobby');
  const members = membersOf(ctx, session.id);
  if (members.length < session.minPlayers) throw new SenderError('Not enough players');
  if (members.some(m => !m.ready)) throw new SenderError('Not all players ready');
  const handler = getHandler(session.kind.tag as MinigameKindTag);
  if (!handler) throw new SenderError('Unknown minigame');
  const updated = {
    ...session,
    state: { tag: 'inProgress' as const },
    startedAt: ctx.timestamp,
  };
  ctx.db.minigameSession.id.update(updated);
  console.log(`[minigame] startMinigame: state updated to inProgress; calling handler.onStart`);
  handler.onStart(ctx, updated);
  console.log(`[minigame] startMinigame: handler.onStart returned`);
});

export const leaveMinigame = spacetimedb.reducer(ctx => {
  const username = getSenderUsername(ctx);
  const member = ctx.db.minigameMember.username.find(username);
  if (member === null) throw new SenderError('Not in a minigame');
  const session = ctx.db.minigameSession.id.find(member.sessionId);
  if (session === null) throw new SenderError('Session missing');
  if (session.state.tag === 'lobby') {
    ctx.db.minigameMember.username.delete(username);
    if (session.hostUsername === username) {
      deleteSessionRows(ctx, session.id);
      ctx.db.minigameSession.id.update({
        ...session,
        state: { tag: 'cancelled' as const },
        endedAt: ctx.timestamp,
      });
    }
    return;
  }
  if (session.state.tag !== 'inProgress') return;
  const handler = getHandler(session.kind.tag as MinigameKindTag);
  const decision = handler ? handler.onPlayerLeave(ctx, session, member, 'leave') : 'forfeit';
  applyLeaveDecision(ctx, session, member, decision);
});

export const cancelMinigame = spacetimedb.reducer(ctx => {
  const username = getSenderUsername(ctx);
  const member = ctx.db.minigameMember.username.find(username);
  if (member === null) throw new SenderError('Not in a minigame');
  const session = ctx.db.minigameSession.id.find(member.sessionId);
  if (session === null) throw new SenderError('Session missing');
  if (session.hostUsername !== username) throw new SenderError('Only the host can cancel');
  if (session.state.tag !== 'lobby') throw new SenderError('Session is not in lobby');
  deleteSessionRows(ctx, session.id);
  ctx.db.minigameSession.id.update({
    ...session,
    state: { tag: 'cancelled' as const },
    endedAt: ctx.timestamp,
  });
});

// ---------- Scheduled tick reducer ----------

export const runMinigameTick = spacetimedb.reducer(
  { arg: minigameTick.rowType },
  (ctx, { arg }) => {
    const session = ctx.db.minigameSession.id.find(arg.sessionId);
    if (session === null) return;
    if (session.state.tag !== 'inProgress') return;
    const handler = getHandler(session.kind.tag as MinigameKindTag);
    if (!handler || !handler.onTick) return;
    handler.onTick(ctx, session, arg.kind, arg.payload);
  }
);
minigameScheduledReducers.tick = runMinigameTick;
