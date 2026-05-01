import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb from './schema';
import { insertNotification, deleteNotificationByRef } from './notifications';
import { getStatTotals } from './stats';
import { resolveActionForBattle } from './actions';
import {
  defensiveBattleSession,
  defensiveBattleParticipant,
  defensiveBattleStatSnapshot,
  defensiveBattleZombie,
  defensiveBattleHandSlot,
  defensiveBattleLog,
  defensiveBattleVoteCancelJob,
  voteCancelRef,
} from './battle_tables';

// ---------- Tuning constants ----------

const VOTE_DEADLINE_MICROS = 60_000_000n; // 60s
const ZOMBIE_BASE_COUNT = 2;
const ZOMBIE_WAVE_SCALAR = 1;
const ZOMBIE_PER_PLAYER_BONUS = 1;

// ---------- Derivation formulas ----------

function hpFromVigor(vigor: number): number {
  return Math.max(20, 50 + vigor * 10);
}

function handSizeFromFocus(focus: number): number {
  const raw = 3 + Math.floor(focus / 8);
  return Math.max(3, Math.min(5, raw));
}

function lootMultiplierFromFortune(fortune: number): number {
  return 1 + fortune * 0.05;
}

// ---------- PRNG ----------
//
// Deterministic per-session. Seed is built from (sessionId, prngCounter) ONLY
// — never ctx.sender. Per devils-advocate's flag: mixing the caller's identity
// would make different killers produce different wave HP distributions across
// players' views of the same battle.

const MASK_64 = (1n << 64n) - 1n;
const FNV_PRIME = 1099511628211n;

function mixBigInt(acc: bigint, value: bigint): bigint {
  let h = acc ^ (value & MASK_64);
  h = (h * FNV_PRIME) & MASK_64;
  return h;
}

function buildBattleSeed(sessionId: bigint, counter: bigint): bigint {
  let h = 14695981039346656037n;
  h = mixBigInt(h, sessionId);
  h = mixBigInt(h, counter);
  return h === 0n ? 1n : h;
}

interface BattleRng {
  state: bigint;
}

function nextU64(rng: BattleRng): bigint {
  rng.state = (rng.state * 6364136223846793005n + 1442695040888963407n) & MASK_64;
  return rng.state;
}

function rngUniform(rng: BattleRng): number {
  return Number(nextU64(rng) >> 11n) / 2 ** 53;
}

function rngIntInRange(rng: BattleRng, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rngUniform(rng) * (max - min + 1));
}

// Builds an RNG seeded from the session's current counter, then bumps the
// counter by `draws` for the next caller. Pass an estimate; over-estimates
// are harmless, under-estimates desync future draws — better to err generous.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rngForSession(ctx: any, session: any, draws: number): { rng: BattleRng; updatedSession: any } {
  const seed = buildBattleSeed(session.sessionId, session.prngCounter);
  const rng: BattleRng = { state: seed };
  const newCounter = session.prngCounter + BigInt(draws);
  const updated = { ...session, prngCounter: newCounter };
  ctx.db.defensiveBattleSession.sessionId.update(updated);
  return { rng, updatedSession: updated };
}

// ---------- Snapshot lookup ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snapshotMap(ctx: any, sessionId: bigint, username: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of ctx.db.defensiveBattleStatSnapshot.defensive_battle_stat_snapshot_session.filter(sessionId)) {
    if (row.username === username) out[row.statId] = row.total;
  }
  return out;
}

// ---------- Resource grant helpers ----------
// Inlined to avoid circular imports with index.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grantScrap(ctx: any, username: string, amount: bigint): void {
  if (amount <= 0n) return;
  const ps = ctx.db.playerState.username.find(username);
  if (ps === null) return;
  ctx.db.playerState.username.update({
    ...ps,
    scrap: ps.scrap + amount,
    updatedAt: ctx.timestamp,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grantResource(ctx: any, username: string, resourceId: string, amount: bigint): void {
  if (amount <= 0n) return;
  if (resourceId === 'scrap') {
    grantScrap(ctx, username, amount);
    return;
  }
  for (const r of ctx.db.playerResource.player_resource_username.filter(username)) {
    if (r.resourceId === resourceId) {
      ctx.db.playerResource.id.update({ ...r, amount: r.amount + amount });
      return;
    }
  }
  ctx.db.playerResource.insert({ id: 0n, username, resourceId, amount });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grantXp(ctx: any, username: string, amount: bigint): void {
  if (amount <= 0n) return;
  const ps = ctx.db.playerState.username.find(username);
  if (ps === null) return;
  ctx.db.playerState.username.update({
    ...ps,
    xp: ps.xp + amount,
    updatedAt: ctx.timestamp,
  });
}

// ---------- Log helper ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  sessionId: bigint,
  actorUsername: string,
  eventKind: string,
  payload: Record<string, unknown>
): void {
  ctx.db.defensiveBattleLog.insert({
    id: 0n,
    sessionId,
    eventAt: ctx.timestamp,
    actorUsername,
    eventKind: { tag: eventKind },
    payload: JSON.stringify(payload),
  });
}

// ---------- Session / participant lookup helpers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findActiveSessionForGroup(ctx: any, groupId: bigint) {
  for (const s of ctx.db.defensiveBattleSession.defensive_battle_session_group.filter(groupId)) {
    if (s.state.tag === 'voting' || s.state.tag === 'inProgress') return s;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findActiveSessionForUsername(ctx: any, username: string) {
  for (const p of ctx.db.defensiveBattleParticipant.defensive_battle_participant_username.filter(username)) {
    const s = ctx.db.defensiveBattleSession.sessionId.find(p.sessionId);
    if (s === null) continue;
    if (s.state.tag === 'voting' || s.state.tag === 'inProgress') return { session: s, participant: p };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function participantsOf(ctx: any, sessionId: bigint) {
  return [...ctx.db.defensiveBattleParticipant.defensive_battle_participant_session.filter(sessionId)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function liveZombiesOf(ctx: any, sessionId: bigint, waveNumber: number) {
  const out = [];
  for (const z of ctx.db.defensiveBattleZombie.defensive_battle_zombie_session.filter(sessionId)) {
    if (z.waveNumber === waveNumber && !z.isDead) out.push(z);
  }
  return out;
}

// ---------- Vote-invite notification cleanup ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanupVoteNotifications(ctx: any, sessionId: bigint) {
  // Iterate notifications by every participant of the session and remove any
  // with kind defensiveBattleVote that ref this sessionId.
  for (const p of participantsOf(ctx, sessionId)) {
    deleteNotificationByRef(ctx, p.username, 'defensiveBattleVote', sessionId);
  }
}

// ---------- Wave generation ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spawnWave(ctx: any, session: any, livingCount: number): any {
  const wave = session.currentWave + 1;
  const count = ZOMBIE_BASE_COUNT + ZOMBIE_WAVE_SCALAR * wave + ZOMBIE_PER_PLAYER_BONUS * livingCount;
  // Reserve 'count' draws for HP rolls.
  const { rng, updatedSession } = rngForSession(ctx, session, count);
  for (let i = 0; i < count; i++) {
    const hp = rngIntInRange(rng, 1, wave);
    ctx.db.defensiveBattleZombie.insert({
      id: 0n,
      sessionId: session.sessionId,
      waveNumber: wave,
      currentHp: hp,
      maxHp: hp,
      isDead: false,
    });
  }
  const next = { ...updatedSession, currentWave: wave };
  ctx.db.defensiveBattleSession.sessionId.update(next);
  logEvent(ctx, session.sessionId, '', 'waveStarted', {
    wave,
    zombieCount: count,
  });
  return next;
}

// ---------- Hand draw ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawActionForUsername(ctx: any, rng: BattleRng, username: string): string | null {
  const slots = [...ctx.db.playerActionLoadout.player_action_loadout_username.filter(username)];
  if (slots.length === 0) return null;
  const idx = rngIntInRange(rng, 0, slots.length - 1);
  return slots[idx]!.actionId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function refillHand(ctx: any, session: any, username: string, handIndex: number): any {
  const { rng, updatedSession } = rngForSession(ctx, session, 1);
  const newAction = drawActionForUsername(ctx, rng, username);
  for (const slot of ctx.db.defensiveBattleHandSlot.defensive_battle_hand_slot_session.filter(session.sessionId)) {
    if (slot.username === username && slot.handIndex === handIndex) {
      ctx.db.defensiveBattleHandSlot.id.update({
        ...slot,
        actionId: newAction ?? slot.actionId,
      });
      break;
    }
  }
  return updatedSession;
}

// ---------- Battle-start helper ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function startBattle(ctx: any, sessionId: bigint): void {
  const session = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
  if (session === null) return;
  if (session.state.tag !== 'voting') return;
  const participants = participantsOf(ctx, sessionId);

  // 1. Snapshot stats per participant.
  for (const p of participants) {
    const totals = getStatTotals(ctx, p.username);
    for (const [statId, total] of Object.entries(totals)) {
      ctx.db.defensiveBattleStatSnapshot.insert({
        id: 0n,
        sessionId,
        username: p.username,
        statId,
        total,
      });
    }
  }

  // 2/3. Compute HP + hand size per participant; populate hand slots.
  let updatedSession = session;
  for (const p of participants) {
    const totals = snapshotMap(ctx, sessionId, p.username);
    const vigor = totals['vigor'] ?? 0;
    const focus = totals['focus'] ?? 0;
    const maxHp = hpFromVigor(vigor);
    const handSize = handSizeFromFocus(focus);
    ctx.db.defensiveBattleParticipant.id.update({
      ...p,
      maxHp,
      currentHp: maxHp,
      wardCount: 0,
      isDefeated: false,
      waveAtDefeat: 0,
      handSize,
    });
    // Initial hand draws.
    const { rng, updatedSession: bumpedSession } = rngForSession(ctx, updatedSession, handSize);
    updatedSession = bumpedSession;
    for (let i = 0; i < handSize; i++) {
      const actionId = drawActionForUsername(ctx, rng, p.username);
      if (actionId === null) continue; // empty loadout — slot intentionally absent
      ctx.db.defensiveBattleHandSlot.insert({
        id: 0n,
        sessionId,
        username: p.username,
        handIndex: i,
        actionId,
      });
    }
  }

  // 4. Spawn wave 1.
  updatedSession = spawnWave(ctx, updatedSession, participants.length);

  // 5. Transition session to inProgress.
  updatedSession = {
    ...updatedSession,
    state: { tag: 'inProgress' as const },
    livingParticipantCount: participants.length,
  };
  ctx.db.defensiveBattleSession.sessionId.update(updatedSession);

  // 6. Lock participants into the battle location (sentinel prefix).
  const sentinel = `defensive_battle:${sessionId.toString()}`;
  for (const p of participants) {
    const ps = ctx.db.playerState.username.find(p.username);
    if (ps !== null) {
      ctx.db.playerState.username.update({
        ...ps,
        location: sentinel,
        updatedAt: ctx.timestamp,
      });
    }
  }

  // 7. Cleanup vote-invite notifications.
  cleanupVoteNotifications(ctx, sessionId);

  // 8. Log battleStarted.
  logEvent(ctx, sessionId, '', 'battleStarted', {
    participantCount: participants.length,
  });

  // Cancel any pending vote-cancel job for this session.
  for (const job of ctx.db.defensiveBattleVoteCancelJob.iter()) {
    if (job.sessionId === sessionId) {
      ctx.db.defensiveBattleVoteCancelJob.scheduledId.delete(job.scheduledId);
    }
  }
}

// ---------- Game-over check ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runGameOverChecks(ctx: any, sessionId: bigint): void {
  const session = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
  if (session === null || session.state.tag !== 'inProgress') return;
  const participants = participantsOf(ctx, sessionId);
  const allDefeated = participants.every(p => p.isDefeated);
  if (!allDefeated) return;

  // Compute and grant loot per participant.
  for (const p of participants) {
    const totals = snapshotMap(ctx, sessionId, p.username);
    const fortune = totals['fortune'] ?? 0;
    const mult = lootMultiplierFromFortune(fortune);
    const wavesSurvived = p.waveAtDefeat > 0 ? Math.max(0, p.waveAtDefeat - 1) : Math.max(0, session.currentWave - 1);
    const scrap = BigInt(Math.floor((50 + 30 * wavesSurvived) * mult));
    const parts = BigInt(Math.floor(5 * Math.max(0, wavesSurvived - 2) * mult));
    const metal = BigInt(Math.floor(2 * Math.max(0, wavesSurvived - 5) * mult));
    const xp = BigInt(Math.floor(20 * wavesSurvived * mult));
    grantScrap(ctx, p.username, scrap);
    grantResource(ctx, p.username, 'parts', parts);
    grantResource(ctx, p.username, 'metal', metal);
    grantXp(ctx, p.username, xp);

    // Restore location.
    const ps = ctx.db.playerState.username.find(p.username);
    if (ps !== null) {
      ctx.db.playerState.username.update({
        ...ps,
        location: p.startLocation || 'the_wastes',
        updatedAt: ctx.timestamp,
      });
    }

    // Loot summary notification.
    const summary = `Battle ended. +${scrap.toString()} scrap, +${parts.toString()} parts, +${metal.toString()} metal, +${xp.toString()} XP across ${wavesSurvived} waves.`;
    insertNotification(
      ctx,
      p.username,
      'system',
      summary,
      undefined,
      `battle_loot:${sessionId.toString()}:${p.username}`
    );
  }

  ctx.db.defensiveBattleSession.sessionId.update({
    ...session,
    state: { tag: 'completed' as const },
    endedAt: ctx.timestamp,
    livingParticipantCount: 0,
  });

  logEvent(ctx, sessionId, '', 'battleEnded', {
    finalWave: session.currentWave,
  });
}

// ---------- Defeat helpers ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function markParticipantDefeated(ctx: any, sessionId: bigint, participant: any): void {
  if (participant.isDefeated) return;
  const session = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
  ctx.db.defensiveBattleParticipant.id.update({
    ...participant,
    isDefeated: true,
    currentHp: 0,
    waveAtDefeat: session?.currentWave ?? 0,
  });
  if (session !== null) {
    ctx.db.defensiveBattleSession.sessionId.update({
      ...session,
      livingParticipantCount: Math.max(0, session.livingParticipantCount - 1),
    });
  }
  logEvent(ctx, sessionId, participant.username, 'playerDefeated', {
    username: participant.username,
    wave: session?.currentWave ?? 0,
  });
}

// External entry point: called from clientDisconnected to handle a player
// disconnecting mid-battle. Marks defeated AND runs game-over check so the
// session doesn't stall forever (devils-advocate's flagged failure path).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleDefensiveBattleDisconnect(ctx: any, username: string): void {
  for (const p of ctx.db.defensiveBattleParticipant.defensive_battle_participant_username.filter(username)) {
    const session = ctx.db.defensiveBattleSession.sessionId.find(p.sessionId);
    if (session === null) continue;
    if (session.state.tag === 'voting') {
      // Treat as nay vote — cancel session.
      cancelSessionAsNay(ctx, p.sessionId);
      return;
    }
    if (session.state.tag === 'inProgress') {
      markParticipantDefeated(ctx, p.sessionId, p);
      runGameOverChecks(ctx, p.sessionId);
      return;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cancelSessionAsNay(ctx: any, sessionId: bigint): void {
  const session = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
  if (session === null) return;
  if (session.state.tag !== 'voting') return;
  ctx.db.defensiveBattleSession.sessionId.update({
    ...session,
    state: { tag: 'cancelled' as const },
    endedAt: ctx.timestamp,
  });
  cleanupVoteNotifications(ctx, sessionId);
  // Cancel the vote-cancel job (it would no-op anyway, but keeping the table tidy).
  for (const job of ctx.db.defensiveBattleVoteCancelJob.iter()) {
    if (job.sessionId === sessionId) {
      ctx.db.defensiveBattleVoteCancelJob.scheduledId.delete(job.scheduledId);
    }
  }
}

// ---------- Reducers ----------

export const proposeDefensiveBattle = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');

  // Resolve participant roster. If the caller is in a group of 2+ members,
  // the battle is cooperative and every member is enrolled. Otherwise (no
  // group, or solo group of 1) the battle is solo with just the caller.
  const myMembership = ctx.db.groupMember.username.find(s.username);
  let groupId = 0n;
  let members: { username: string }[] = [{ username: s.username }];
  if (myMembership !== null) {
    const groupRoster = [
      ...ctx.db.groupMember.group_member_group_id.filter(myMembership.groupId),
    ];
    if (groupRoster.length >= 2) {
      groupId = myMembership.groupId;
      members = groupRoster.map(m => ({ username: m.username }));
      // Cooperative battle: ensure no other active session for this group.
      if (findActiveSessionForGroup(ctx, groupId) !== null) {
        throw new SenderError('A Defensive Battle is already in progress for this group');
      }
    }
    // Group of exactly 1 falls through to the solo path.
  }

  // Per-participant lock: nobody can be in two battles at once.
  for (const m of members) {
    if (findActiveSessionForUsername(ctx, m.username) !== null) {
      throw new SenderError(
        m.username === s.username
          ? 'You are already in a battle'
          : `${m.username} is already in another battle`
      );
    }
  }

  const voteDeadlineMicros = ctx.timestamp.microsSinceUnixEpoch + VOTE_DEADLINE_MICROS;

  const sessionRow = ctx.db.defensiveBattleSession.insert({
    sessionId: 0n,
    groupId,
    state: { tag: 'voting' as const },
    currentWave: 0,
    prngCounter: 0n,
    livingParticipantCount: members.length,
    createdAt: ctx.timestamp,
    voteDeadlineMicros,
    endedAt: undefined,
  });

  // Insert participant rows. Initiator auto-stamped yay; others pending.
  // Solo battles have only the initiator — auto-yay → unanimous → startBattle
  // fires immediately at the bottom of this reducer (no lobby flash).
  for (const m of members) {
    const ps = ctx.db.playerState.username.find(m.username);
    ctx.db.defensiveBattleParticipant.insert({
      id: 0n,
      sessionId: sessionRow.sessionId,
      username: m.username,
      vote: { tag: m.username === s.username ? ('yay' as const) : ('pending' as const) },
      startLocation: ps?.location ?? '',
      maxHp: 0,
      currentHp: 0,
      wardCount: 0,
      isDefeated: false,
      waveAtDefeat: 0,
      handSize: 0,
    });
    if (m.username !== s.username) {
      insertNotification(
        ctx,
        m.username,
        'defensiveBattleVote',
        `${s.username} called a Defensive Battle. Vote yay or nay.`,
        sessionRow.sessionId,
        `battle_vote:${sessionRow.sessionId.toString()}`
      );
    }
  }

  // Reject if proposer's loadout is empty (matches the same guard used in
  // voteDefensiveBattle for the cooperative path). Solo proposer is auto-yay,
  // so we'd otherwise crash inside startBattle when drawing from an empty
  // loadout.
  const proposerLoadout = [
    ...ctx.db.playerActionLoadout.player_action_loadout_username.filter(s.username),
  ];
  if (proposerLoadout.length === 0) {
    throw new SenderError(
      'Your loadout is empty. Equip at least one action in the Armory before calling a battle.'
    );
  }

  // Schedule auto-cancel.
  ctx.db.defensiveBattleVoteCancelJob.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(voteDeadlineMicros),
    sessionId: sessionRow.sessionId,
  });

  logEvent(ctx, sessionRow.sessionId, s.username, 'voteCast', {
    username: s.username,
    vote: 'yay',
    auto: true,
  });

  // Solo path: proposer is the only participant and auto-yay, so the
  // unanimous-yay condition is already satisfied. Start the battle in the
  // same transaction so there is no visible lobby flash.
  if (members.length === 1) {
    startBattle(ctx, sessionRow.sessionId);
  }
});

export const voteDefensiveBattle = spacetimedb.reducer(
  { sessionId: t.u64(), voteYay: t.bool() },
  (ctx, { sessionId, voteYay }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const session = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
    if (session === null) throw new SenderError('Session not found');
    if (session.state.tag !== 'voting') throw new SenderError('Session is not in voting state');

    let myParticipant = null;
    for (const p of ctx.db.defensiveBattleParticipant.defensive_battle_participant_session.filter(sessionId)) {
      if (p.username === s.username) {
        myParticipant = p;
        break;
      }
    }
    if (myParticipant === null) throw new SenderError('You are not a participant in this battle');
    if (myParticipant.vote.tag !== 'pending') {
      // Allow changing yay → nay (the spec's "Cancel-vote option").
      if (!voteYay && myParticipant.vote.tag === 'yay') {
        // fall through
      } else {
        throw new SenderError('You have already voted');
      }
    }

    // Reject yay if loadout is empty (per backend pushback).
    if (voteYay) {
      const loadoutRows = [
        ...ctx.db.playerActionLoadout.player_action_loadout_username.filter(s.username),
      ];
      if (loadoutRows.length === 0) {
        throw new SenderError(
          'Your loadout is empty. Equip at least one action in the Armory before joining a battle.'
        );
      }
    }

    ctx.db.defensiveBattleParticipant.id.update({
      ...myParticipant,
      vote: { tag: voteYay ? ('yay' as const) : ('nay' as const) },
    });

    logEvent(ctx, sessionId, s.username, 'voteCast', {
      username: s.username,
      vote: voteYay ? 'yay' : 'nay',
    });

    if (!voteYay) {
      cancelSessionAsNay(ctx, sessionId);
      return;
    }

    // Did this yay complete the unanimous-yay condition?
    const allYay = participantsOf(ctx, sessionId).every(p => p.vote.tag === 'yay');
    if (allYay) {
      startBattle(ctx, sessionId);
    }
  }
);

export const runVoteCancelJob = spacetimedb.reducer(
  { arg: defensiveBattleVoteCancelJob.rowType },
  (ctx, { arg }) => {
    const session = ctx.db.defensiveBattleSession.sessionId.find(arg.sessionId);
    if (session === null) return;
    if (session.state.tag !== 'voting') return;
    cancelSessionAsNay(ctx, arg.sessionId);
  }
);
voteCancelRef.reducer = runVoteCancelJob;

export const performAction = spacetimedb.reducer(
  {
    sessionId: t.u64(),
    handIndex: t.u32(),
    targetKind: t.string(), // 'zombie' | 'participant' | 'noTarget'
    targetId: t.u64(),
  },
  (ctx, { sessionId, handIndex, targetKind, targetId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    let session = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
    if (session === null) throw new SenderError('Session not found');
    if (session.state.tag !== 'inProgress') throw new SenderError('Battle is not in progress');

    let me = null;
    for (const p of ctx.db.defensiveBattleParticipant.defensive_battle_participant_session.filter(sessionId)) {
      if (p.username === s.username) {
        me = p;
        break;
      }
    }
    if (me === null) throw new SenderError('You are not a participant');
    if (me.isDefeated) throw new SenderError('You are defeated');

    let mySlot = null;
    for (const slot of ctx.db.defensiveBattleHandSlot.defensive_battle_hand_slot_session.filter(sessionId)) {
      if (slot.username === s.username && slot.handIndex === handIndex) {
        mySlot = slot;
        break;
      }
    }
    if (mySlot === null) throw new SenderError('Hand slot not found');

    const actionDef = ctx.db.actionDefinition.actionId.find(mySlot.actionId);
    if (actionDef === null) throw new SenderError('Unknown action');

    // Resolve effect using snapshot stats.
    const totals = snapshotMap(ctx, sessionId, s.username);
    const resolved = resolveActionForBattle(ctx, mySlot.actionId, totals);

    // Identify target set based on action.targeting.
    const targetingTag = actionDef.targeting.tag;
    const zombieTargets: { id: bigint; row: any }[] = [];
    const participantTargets: { id: bigint; row: any }[] = [];

    if (targetingTag === 'singleEnemy') {
      if (targetKind !== 'zombie') throw new SenderError('Action requires a zombie target');
      const z = ctx.db.defensiveBattleZombie.id.find(targetId);
      if (z === null || z.isDead || z.sessionId !== sessionId) {
        throw new SenderError('Invalid zombie target');
      }
      zombieTargets.push({ id: targetId, row: z });
    } else if (targetingTag === 'allEnemies') {
      for (const z of liveZombiesOf(ctx, sessionId, session.currentWave)) {
        zombieTargets.push({ id: z.id, row: z });
      }
    } else if (targetingTag === 'singleAlly') {
      if (targetKind !== 'participant') throw new SenderError('Action requires a participant target');
      const target = ctx.db.defensiveBattleParticipant.id.find(targetId);
      if (target === null || target.sessionId !== sessionId) {
        throw new SenderError('Invalid participant target');
      }
      participantTargets.push({ id: targetId, row: target });
    } else if (targetingTag === 'allAllies' || targetingTag === 'partyIncludingSelf') {
      for (const p of participantsOf(ctx, sessionId)) {
        participantTargets.push({ id: p.id, row: p });
      }
    } else {
      throw new SenderError('Unsupported targeting variant');
    }

    // Apply effect.
    let updatedSession = session;
    if (resolved.kind === 'damage') {
      // Roll once per zombie.
      const { rng, updatedSession: bumped } = rngForSession(ctx, updatedSession, zombieTargets.length);
      updatedSession = bumped;
      for (const tgt of zombieTargets) {
        const rolled = rngIntInRange(rng, resolved.resolvedMin, resolved.resolvedMax);
        const newHp = tgt.row.currentHp - rolled;
        const isDead = newHp <= 0;
        ctx.db.defensiveBattleZombie.id.update({
          ...tgt.row,
          currentHp: isDead ? 0 : newHp,
          isDead,
        });
        logEvent(ctx, sessionId, s.username, 'damageDealt', {
          source: 'action',
          actionId: mySlot.actionId,
          targetKind: 'zombie',
          targetId: tgt.id.toString(),
          amount: rolled,
        });
      }
    } else if (resolved.kind === 'healAmount') {
      const { rng, updatedSession: bumped } = rngForSession(ctx, updatedSession, participantTargets.length);
      updatedSession = bumped;
      for (const tgt of participantTargets) {
        const rolled = rngIntInRange(rng, resolved.resolvedMin, resolved.resolvedMax);
        const newHp = Math.min(tgt.row.maxHp, tgt.row.currentHp + rolled);
        const wasDefeated = tgt.row.isDefeated;
        const reviving = wasDefeated && newHp > 0;
        ctx.db.defensiveBattleParticipant.id.update({
          ...tgt.row,
          currentHp: newHp,
          isDefeated: reviving ? false : tgt.row.isDefeated,
          waveAtDefeat: reviving ? 0 : tgt.row.waveAtDefeat,
        });
        if (reviving) {
          updatedSession = {
            ...updatedSession,
            livingParticipantCount: updatedSession.livingParticipantCount + 1,
          };
          ctx.db.defensiveBattleSession.sessionId.update(updatedSession);
        }
      }
    } else if (resolved.kind === 'healFull') {
      for (const tgt of participantTargets) {
        const wasDefeated = tgt.row.isDefeated;
        ctx.db.defensiveBattleParticipant.id.update({
          ...tgt.row,
          currentHp: tgt.row.maxHp,
          isDefeated: false,
          waveAtDefeat: 0,
        });
        if (wasDefeated) {
          updatedSession = {
            ...updatedSession,
            livingParticipantCount: updatedSession.livingParticipantCount + 1,
          };
          ctx.db.defensiveBattleSession.sessionId.update(updatedSession);
        }
      }
    } else if (resolved.kind === 'ward') {
      for (const tgt of participantTargets) {
        ctx.db.defensiveBattleParticipant.id.update({
          ...tgt.row,
          wardCount: tgt.row.wardCount + resolved.resolvedCount,
        });
      }
    }

    logEvent(ctx, sessionId, s.username, 'actionResolved', {
      actionId: mySlot.actionId,
      kind: resolved.kind,
    });

    // Self-damage = current live zombie count.
    const liveCount = liveZombiesOf(ctx, sessionId, updatedSession.currentWave).length;
    let me2 = ctx.db.defensiveBattleParticipant.id.find(me.id);
    if (me2 !== null) {
      let damage = liveCount;
      if (me2.wardCount > 0) {
        ctx.db.defensiveBattleParticipant.id.update({ ...me2, wardCount: me2.wardCount - 1 });
        damage = 0;
      } else {
        const newHp = me2.currentHp - damage;
        const dies = newHp <= 0;
        ctx.db.defensiveBattleParticipant.id.update({
          ...me2,
          currentHp: dies ? 0 : newHp,
        });
        if (dies) {
          me2 = ctx.db.defensiveBattleParticipant.id.find(me.id);
          if (me2 !== null) {
            markParticipantDefeated(ctx, sessionId, me2);
            const refreshed = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
            if (refreshed !== null) updatedSession = refreshed;
          }
        }
      }
      logEvent(ctx, sessionId, s.username, 'damageDealt', {
        source: 'self',
        actionId: mySlot.actionId,
        amount: damage,
      });
    }

    // Refill the hand slot.
    updatedSession = refillHand(ctx, updatedSession ?? session, s.username, handIndex);

    // Wave-completion check.
    const liveAfter = liveZombiesOf(ctx, sessionId, updatedSession.currentWave).length;
    if (liveAfter === 0) {
      logEvent(ctx, sessionId, '', 'waveCompleted', {
        wave: updatedSession.currentWave,
      });
      // Spawn next wave only if any participants are still alive.
      const alive = participantsOf(ctx, sessionId).filter(p => !p.isDefeated).length;
      if (alive > 0) {
        spawnWave(ctx, updatedSession, alive);
      }
    }

    // Game-over check.
    runGameOverChecks(ctx, sessionId);
  }
);

export const forfeitBattle = spacetimedb.reducer(
  { sessionId: t.u64() },
  (ctx, { sessionId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const session = ctx.db.defensiveBattleSession.sessionId.find(sessionId);
    if (session === null) throw new SenderError('Session not found');
    if (session.state.tag !== 'inProgress') throw new SenderError('Battle is not in progress');
    let me = null;
    for (const p of ctx.db.defensiveBattleParticipant.defensive_battle_participant_session.filter(sessionId)) {
      if (p.username === s.username) {
        me = p;
        break;
      }
    }
    if (me === null) throw new SenderError('You are not a participant');
    if (me.isDefeated) return;
    markParticipantDefeated(ctx, sessionId, me);
    runGameOverChecks(ctx, sessionId);
  }
);

// ---------- Views ----------

export const myDefensiveBattleSession = spacetimedb.view(
  { name: 'my_defensive_battle_session', public: true },
  t.array(defensiveBattleSession.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const found = findActiveSessionForUsername(ctx, s.username);
    if (!found) return [];
    // Re-fetch by primary key so the returned row matches the view's declared
    // row type (helper signatures are typed as `any`).
    const session = ctx.db.defensiveBattleSession.sessionId.find(found.session.sessionId);
    return session ? [session] : [];
  }
);

export const myDefensiveBattleParticipants = spacetimedb.view(
  { name: 'my_defensive_battle_participants', public: true },
  t.array(defensiveBattleParticipant.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const found = findActiveSessionForUsername(ctx, s.username);
    if (!found) return [];
    return participantsOf(ctx, found.session.sessionId);
  }
);

export const myDefensiveBattleHand = spacetimedb.view(
  { name: 'my_defensive_battle_hand', public: true },
  t.array(defensiveBattleHandSlot.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const found = findActiveSessionForUsername(ctx, s.username);
    if (!found) return [];
    const out = [];
    for (const slot of ctx.db.defensiveBattleHandSlot.defensive_battle_hand_slot_session.filter(found.session.sessionId)) {
      if (slot.username === s.username) out.push(slot);
    }
    return out;
  }
);

export const myDefensiveBattleZombies = spacetimedb.view(
  { name: 'my_defensive_battle_zombies', public: true },
  t.array(defensiveBattleZombie.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const found = findActiveSessionForUsername(ctx, s.username);
    if (!found) return [];
    const out = [];
    for (const z of ctx.db.defensiveBattleZombie.defensive_battle_zombie_session.filter(found.session.sessionId)) {
      if (z.waveNumber === found.session.currentWave) out.push(z);
    }
    return out;
  }
);

export const myDefensiveBattleStatSnapshot = spacetimedb.view(
  { name: 'my_defensive_battle_stat_snapshot', public: true },
  t.array(defensiveBattleStatSnapshot.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const found = findActiveSessionForUsername(ctx, s.username);
    if (!found) return [];
    return [...ctx.db.defensiveBattleStatSnapshot.defensive_battle_stat_snapshot_session.filter(found.session.sessionId)];
  }
);

export const myDefensiveBattleLog = spacetimedb.view(
  { name: 'my_defensive_battle_log', public: true },
  t.array(defensiveBattleLog.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const found = findActiveSessionForUsername(ctx, s.username);
    if (!found) return [];
    return [...ctx.db.defensiveBattleLog.defensive_battle_log_session.filter(found.session.sessionId)];
  }
);
