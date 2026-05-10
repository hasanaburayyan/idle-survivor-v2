import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  endSession,
  membersOf,
  requireActiveMinigame,
} from './framework';
import {
  registerHandler,
  type MinigameEndResult,
  type MinigameHandler,
} from './registry';

const DURATION_MS = 30_000;
const HIT_WINDOW_MICROS = 150_000n; // ±150ms
const NUM_LANES = 4;
const NOTE_COUNT = 24;

const rhythmTapHandler: MinigameHandler = {
  kind: 'rhythmTap',
  meta: {
    displayName: 'Rhythm Tap',
    description: 'Tap notes as they reach the line. Co-op or solo.',
    minPlayers: 1,
    maxPlayers: 4,
    style: 'realtime',
    mode: 'coop',
    soloAllowed: true,
  },
  init(ctx, session) {
    ctx.db.rhythmTapGame.insert({
      sessionId: session.id,
      chartId: 'starter',
      durationMs: DURATION_MS,
      startMicros: 0n,
    });
    // Pre-populate notes deterministically from session.id.
    let s = Number(session.id % 2147483647n);
    if (s <= 0) s = 1;
    const rand = () => {
      // Mulberry-32 style; deterministic per session.id.
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 0) / 0xffffffff);
    };
    const spacingMs = Math.floor((DURATION_MS - 1500) / NOTE_COUNT);
    for (let i = 0; i < NOTE_COUNT; i++) {
      const lane = Math.floor(rand() * NUM_LANES);
      const timeMs = 1000 + i * spacingMs;
      ctx.db.rhythmTapNote.insert({
        id: 0n,
        sessionId: session.id,
        lane,
        timeMs,
        hitByUsername: undefined,
      });
    }
  },
  onStart(ctx, session) {
    const game = ctx.db.rhythmTapGame.sessionId.find(session.id);
    if (game === null) throw new SenderError('RhythmTap game state missing');
    const startMicros = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.rhythmTapGame.sessionId.update({ ...game, startMicros });
    for (const m of membersOf(ctx, session.id)) {
      ctx.db.rhythmTapScore.insert({
        id: 0n,
        sessionId: session.id,
        username: m.username,
        hits: 0,
        misses: 0,
        combo: 0,
      });
    }
    const endMicros = startMicros + BigInt(DURATION_MS) * 1000n + 2_000_000n;
    ctx.db.minigameTick.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(endMicros),
      sessionId: session.id,
      kind: 'rhythmTapEnd',
      payload: '',
    });
  },
  onTick(ctx, session, tickKind) {
    if (tickKind !== 'rhythmTapEnd') return;
    const result = rhythmTapHandler.onEnd(ctx, session);
    cleanupRhythmTap(ctx, session.id);
    endSession(ctx, session, result);
  },
  onPlayerLeave(_ctx, _session, _member, _reason) {
    return 'kick';
  },
  onEnd(ctx, session): MinigameEndResult {
    const scores = [
      ...ctx.db.rhythmTapScore.rhythm_tap_score_session_id.filter(session.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ].sort((a: any, b: any) => b.hits - a.hits);
    const placements: MinigameEndResult['placements'] = scores.map((s, i) => ({
      username: s.username,
      placement: i + 1,
      finalScore: BigInt(s.hits),
    }));
    // Medicine: floor(hits / 10). A perfect chart of ~50 notes → 5 Medicine.
    const rewards: MinigameEndResult['rewards'] = scores.map(s => {
      const medicine = BigInt(Math.floor(s.hits / 10));
      const r: import('./registry').Reward[] = [{ kind: 'xp', amount: BigInt(s.hits) * 5n }];
      if (medicine > 0n) {
        r.push({ kind: 'item', resourceId: 'medicine', quantity: medicine });
      }
      return { username: s.username, rewards: r };
    });
    return { placements, rewards };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanupRhythmTap(ctx: any, sessionId: bigint): void {
  for (const note of ctx.db.rhythmTapNote.rhythm_tap_note_session_id.filter(sessionId)) {
    ctx.db.rhythmTapNote.id.delete(note.id);
  }
  for (const score of ctx.db.rhythmTapScore.rhythm_tap_score_session_id.filter(sessionId)) {
    ctx.db.rhythmTapScore.id.delete(score.id);
  }
  ctx.db.rhythmTapGame.sessionId.delete(sessionId);
}

registerHandler(rhythmTapHandler);

export const rtTap = spacetimedb.reducer(
  { noteId: t.u64(), clientHitMicros: t.i64() },
  (ctx, { noteId, clientHitMicros }) => {
    const { username, session } = requireActiveMinigame(ctx, 'rhythmTap');
    const note = ctx.db.rhythmTapNote.id.find(noteId);
    if (note === null) throw new SenderError('Unknown note');
    if (note.sessionId !== session.id) throw new SenderError('Note from another session');
    const game = ctx.db.rhythmTapGame.sessionId.find(session.id);
    if (game === null) throw new SenderError('RhythmTap game state missing');
    const score = [
      ...ctx.db.rhythmTapScore.rhythm_tap_score_session_id.filter(session.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ].find((s: any) => s.username === username);
    if (score === undefined) throw new SenderError('No score row');
    if (note.hitByUsername !== undefined) {
      // Already hit — count as miss for this player.
      ctx.db.rhythmTapScore.id.update({ ...score, misses: score.misses + 1, combo: 0 });
      return;
    }
    const expectedMicros = game.startMicros + BigInt(note.timeMs) * 1000n;
    const elapsedMicros = clientHitMicros - game.startMicros;
    const noteOffsetMicros = clientHitMicros - expectedMicros;
    const absOffset = noteOffsetMicros < 0n ? -noteOffsetMicros : noteOffsetMicros;
    // Sanity: clientHitMicros must be within the song window.
    if (elapsedMicros < 0n || elapsedMicros > BigInt(game.durationMs) * 1000n + HIT_WINDOW_MICROS) {
      throw new SenderError('Tap outside song window');
    }
    if (absOffset <= HIT_WINDOW_MICROS) {
      ctx.db.rhythmTapNote.id.update({ ...note, hitByUsername: username });
      ctx.db.rhythmTapScore.id.update({
        ...score,
        hits: score.hits + 1,
        combo: score.combo + 1,
      });
    } else {
      ctx.db.rhythmTapScore.id.update({
        ...score,
        misses: score.misses + 1,
        combo: 0,
      });
    }
  }
);
