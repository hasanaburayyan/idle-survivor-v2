import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  membersOf,
  requireActiveMinigame,
} from './framework';
import { CoinSide } from './tables';
import {
  registerHandler,
  type MinigameEndResult,
  type MinigameHandler,
} from './registry';

const REVEAL_TIMEOUT_MICROS = 30_000_000n; // 30s after the first bet is placed
const TICK_KIND_REVEAL = 'coinFlipReveal';

const coinFlipHandler: MinigameHandler = {
  kind: 'coinFlip',
  meta: {
    displayName: 'Coin Flip',
    description: 'Pick a side, wager any amount. Winners split losers’ pot. Play as many rounds as you like.',
    minPlayers: 1,
    maxPlayers: 8,
    style: 'turnBased',
    mode: 'competitive',
    soloAllowed: true,
  },
  init(ctx, session) {
    ctx.db.coinFlipGame.insert({
      sessionId: session.id,
      anteScrap: 0n,
      roundNumber: 1,
      pot: 0n,
      result: undefined,
      revealedAt: undefined,
    });
  },
  onStart(ctx, session) {
    console.log(`[coinFlip] onStart: session=${session.id}`);
    const game = ctx.db.coinFlipGame.sessionId.find(session.id);
    if (game === null) throw new SenderError('CoinFlip game state missing');
    ctx.db.coinFlipGame.sessionId.update({
      ...game,
      roundNumber: 1,
      pot: 0n,
      result: undefined,
      revealedAt: undefined,
    });
  },
  onTick(ctx, session, tickKind) {
    if (tickKind !== TICK_KIND_REVEAL) return;
    revealRound(ctx, session);
  },
  onPlayerLeave(ctx, session, member, _reason) {
    refundPendingBet(ctx, session.id, member.username);
    return 'kick';
  },
  onEnd(_ctx, _session): MinigameEndResult {
    // Continuous game — no winner/loser when the session ends. Bets still
    // pending (if any) were refunded by onPlayerLeave for each leaver.
    return { placements: [], rewards: [] };
  },
};

registerHandler(coinFlipHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clearRevealTicks(ctx: any, sessionId: bigint): void {
  for (const tick of ctx.db.minigameTick.minigame_tick_session_id.filter(sessionId)) {
    if (tick.kind === TICK_KIND_REVEAL) {
      ctx.db.minigameTick.scheduledId.delete(tick.scheduledId);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function refundPendingBet(ctx: any, sessionId: bigint, username: string): void {
  const game = ctx.db.coinFlipGame.sessionId.find(sessionId);
  if (game === null) return;
  if (game.result !== undefined) return; // Round already revealed; no pending bet.
  const bet = [...ctx.db.coinFlipBet.coin_flip_bet_session_id.filter(sessionId)].find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => b.username === username
  );
  if (!bet) return;
  const ps = ctx.db.playerState.username.find(username);
  if (ps !== null) {
    ctx.db.playerState.username.update({
      ...ps,
      scrap: ps.scrap + bet.wager,
      updatedAt: ctx.timestamp,
    });
  }
  ctx.db.coinFlipBet.id.delete(bet.id);
  ctx.db.coinFlipGame.sessionId.update({
    ...game,
    pot: game.pot >= bet.wager ? game.pot - bet.wager : 0n,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function revealRound(ctx: any, session: any): void {
  const game = ctx.db.coinFlipGame.sessionId.find(session.id);
  if (game === null) return;
  if (game.result !== undefined) return; // Already revealed.

  clearRevealTicks(ctx, session.id);

  const flip = ctx.random() < 0.5
    ? { tag: 'heads' as const }
    : { tag: 'tails' as const };

  const bets = [...ctx.db.coinFlipBet.coin_flip_bet_session_id.filter(session.id)];
  if (bets.length === 0) {
    ctx.db.coinFlipGame.sessionId.update({
      ...game,
      result: flip,
      revealedAt: ctx.timestamp,
    });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const winners = bets.filter((b: any) => b.pick.tag === flip.tag);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const losers = bets.filter((b: any) => b.pick.tag !== flip.tag);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const losersPot = losers.reduce((sum: bigint, b: any) => sum + b.wager, 0n);

  if (winners.length === 0 || losers.length === 0) {
    // No contest — refund every wager.
    for (const b of bets) {
      const ps = ctx.db.playerState.username.find(b.username);
      if (ps !== null) {
        ctx.db.playerState.username.update({
          ...ps,
          scrap: ps.scrap + b.wager,
          updatedAt: ctx.timestamp,
        });
      }
      ctx.db.coinFlipBet.id.update({ ...b, payout: b.wager });
    }
  } else {
    const winnersCount = BigInt(winners.length);
    for (const w of winners) {
      const share = losersPot / winnersCount;
      const payout = w.wager + share;
      const ps = ctx.db.playerState.username.find(w.username);
      if (ps !== null) {
        ctx.db.playerState.username.update({
          ...ps,
          scrap: ps.scrap + payout,
          updatedAt: ctx.timestamp,
        });
      }
      ctx.db.coinFlipBet.id.update({ ...w, payout });
    }
    for (const l of losers) {
      ctx.db.coinFlipBet.id.update({ ...l, payout: 0n });
    }
  }

  ctx.db.coinFlipGame.sessionId.update({
    ...game,
    result: flip,
    revealedAt: ctx.timestamp,
  });
}

// Either reveal-after-timeout or open a new round on the next bet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function startNextRound(ctx: any, sessionId: bigint): void {
  const game = ctx.db.coinFlipGame.sessionId.find(sessionId);
  if (game === null) return;
  for (const bet of ctx.db.coinFlipBet.coin_flip_bet_session_id.filter(sessionId)) {
    ctx.db.coinFlipBet.id.delete(bet.id);
  }
  ctx.db.coinFlipGame.sessionId.update({
    ...game,
    roundNumber: game.roundNumber + 1,
    pot: 0n,
    result: undefined,
    revealedAt: undefined,
  });
}

export const cfPick = spacetimedb.reducer(
  { pick: CoinSide, wager: t.u64() },
  (ctx, { pick, wager }) => {
    const { username, session } = requireActiveMinigame(ctx, 'coinFlip');
    if (wager === 0n) throw new SenderError('Wager must be greater than 0');

    let game = ctx.db.coinFlipGame.sessionId.find(session.id);
    if (game === null) throw new SenderError('CoinFlip game state missing');

    // If the previous round has been revealed, roll into a new round.
    if (game.result !== undefined) {
      startNextRound(ctx, session.id);
      game = ctx.db.coinFlipGame.sessionId.find(session.id);
      if (game === null) throw new SenderError('CoinFlip game state missing');
    }

    const existing = [...ctx.db.coinFlipBet.coin_flip_bet_session_id.filter(session.id)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (existing.some((b: any) => b.username === username)) {
      throw new SenderError('Already picked this round');
    }

    const ps = ctx.db.playerState.username.find(username);
    if (ps === null) throw new SenderError('Player state missing');
    if (ps.scrap < wager) {
      throw new SenderError(`Not enough scrap (have ${ps.scrap}, need ${wager})`);
    }

    ctx.db.playerState.username.update({
      ...ps,
      scrap: ps.scrap - wager,
      updatedAt: ctx.timestamp,
    });

    ctx.db.coinFlipBet.insert({
      id: 0n,
      sessionId: session.id,
      username,
      pick,
      wager,
      payout: 0n,
    });
    ctx.db.coinFlipGame.sessionId.update({
      ...game,
      pot: game.pot + wager,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeMembers = membersOf(ctx, session.id).filter((m: any) => m.active);
    const totalBets = existing.length + 1;

    if (totalBets >= activeMembers.length) {
      revealRound(ctx, session);
    } else if (existing.length === 0) {
      // First bet of the round — schedule reveal timeout.
      ctx.db.minigameTick.insert({
        scheduledId: 0n,
        scheduledAt: ScheduleAt.time(
          ctx.timestamp.microsSinceUnixEpoch + REVEAL_TIMEOUT_MICROS
        ),
        sessionId: session.id,
        kind: TICK_KIND_REVEAL,
        payload: '',
      });
    }
  }
);

export const cfReveal = spacetimedb.reducer(ctx => {
  // Manual early-reveal trigger: any player in the session can flip if at
  // least one bet is in. Useful when the lobby decides to fast-forward.
  const { session } = requireActiveMinigame(ctx, 'coinFlip');
  const game = ctx.db.coinFlipGame.sessionId.find(session.id);
  if (game === null) throw new SenderError('CoinFlip game state missing');
  if (game.result !== undefined) throw new SenderError('Round already revealed');
  const bets = [...ctx.db.coinFlipBet.coin_flip_bet_session_id.filter(session.id)];
  if (bets.length === 0) throw new SenderError('No bets to reveal');
  revealRound(ctx, session);
});
