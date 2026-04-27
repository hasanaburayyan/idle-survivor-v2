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

const TURN_TIMEOUT_MS = 60_000;
const STARTING_HEALTH = 20;
const STARTING_HAND_SIZE = 4;
const MAX_BOARD_SLOTS = 5;

interface CardSeed {
  cardDefId: string;
  name: string;
  cost: number;
  attack: number;
  health: number;
  effect: string;
}

const CARD_SEEDS: CardSeed[] = [
  { cardDefId: 'rat',     name: 'Sewer Rat',    cost: 1, attack: 1, health: 1, effect: '' },
  { cardDefId: 'scout',   name: 'Wasteland Scout', cost: 2, attack: 2, health: 2, effect: '' },
  { cardDefId: 'raider',  name: 'Raider',       cost: 3, attack: 3, health: 2, effect: '' },
  { cardDefId: 'brute',   name: 'Junk Brute',   cost: 4, attack: 3, health: 5, effect: '' },
  { cardDefId: 'sniper',  name: 'Rooftop Sniper', cost: 4, attack: 5, health: 2, effect: '' },
  { cardDefId: 'titan',   name: 'Salvage Titan', cost: 6, attack: 6, health: 6, effect: '' },
];

const STARTER_DECK: string[] = [
  'rat', 'rat', 'rat',
  'scout', 'scout', 'scout',
  'raider', 'raider',
  'brute', 'brute',
  'sniper', 'sniper',
  'titan',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seedCardDefinitions(ctx: any): void {
  for (const seed of CARD_SEEDS) {
    if (ctx.db.cardDefinition.cardDefId.find(seed.cardDefId) === null) {
      ctx.db.cardDefinition.insert(seed);
    }
  }
}

interface CardListPayload {
  cardDefIds: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readPrivate(ctx: any, sessionId: bigint, username: string, slot: number): string[] {
  const row = [
    ...ctx.db.minigamePrivateState.minigame_private_state_username.filter(username),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ].find((r: any) => r.sessionId === sessionId && r.slot === slot);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.data) as CardListPayload;
    return parsed.cardDefIds ?? [];
  } catch {
    return [];
  }
}

function writePrivate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  sessionId: bigint,
  username: string,
  slot: number,
  cardDefIds: string[]
): void {
  const data = JSON.stringify({ cardDefIds } satisfies CardListPayload);
  const existing = [
    ...ctx.db.minigamePrivateState.minigame_private_state_username.filter(username),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ].find((r: any) => r.sessionId === sessionId && r.slot === slot);
  if (existing) {
    ctx.db.minigamePrivateState.id.update({ ...existing, data });
  } else {
    ctx.db.minigamePrivateState.insert({
      id: 0n,
      sessionId,
      username,
      slot,
      data,
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shuffleDeck(ctx: any, deck: string[]): string[] {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = ctx.random.integerInRange(0, i);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPlayer(ctx: any, sessionId: bigint, username: string): any {
  return [
    ...ctx.db.cardDuelPlayer.card_duel_player_session_id.filter(sessionId),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ].find((p: any) => p.username === username);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function playerBySeat(ctx: any, sessionId: bigint, seat: number): any {
  return [
    ...ctx.db.cardDuelPlayer.card_duel_player_session_id.filter(sessionId),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ].find((p: any) => p.seat === seat);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scheduleTurnTimeout(ctx: any, sessionId: bigint, board: any): void {
  const fireAt = ctx.timestamp.microsSinceUnixEpoch + BigInt(TURN_TIMEOUT_MS) * 1000n;
  ctx.db.minigameTick.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(fireAt),
    sessionId,
    kind: 'cardDuelTurnTimeout',
    payload: JSON.stringify({
      activeSeat: board.activeSeat,
      turnNumber: board.turnNumber,
    }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clearTurnTimeouts(ctx: any, sessionId: bigint): void {
  for (const tick of ctx.db.minigameTick.minigame_tick_session_id.filter(sessionId)) {
    if (tick.kind === 'cardDuelTurnTimeout') {
      ctx.db.minigameTick.scheduledId.delete(tick.scheduledId);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCardFor(ctx: any, sessionId: bigint, username: string): void {
  const hand = readPrivate(ctx, sessionId, username, 0);
  const deck = readPrivate(ctx, sessionId, username, 1);
  if (deck.length === 0) return;
  const top = deck[0];
  hand.push(top);
  writePrivate(ctx, sessionId, username, 0, hand);
  writePrivate(ctx, sessionId, username, 1, deck.slice(1));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function endTurn(ctx: any, session: any, board: any): void {
  const newSeat: number = board.activeSeat === 0 ? 1 : 0;
  const newTurn: number = board.turnNumber + 1;
  const updatedBoard = {
    ...board,
    activeSeat: newSeat,
    turnNumber: newTurn,
    turnDeadlineMicros:
      ctx.timestamp.microsSinceUnixEpoch + BigInt(TURN_TIMEOUT_MS) * 1000n,
  };
  ctx.db.cardDuelBoard.sessionId.update(updatedBoard);
  const newActive = playerBySeat(ctx, session.id, newSeat);
  if (newActive) {
    const nextManaMax = Math.min(10, newActive.manaMax + 1);
    // Going-second tempo bonus: only on the second player's first active turn (turn 2).
    const goingSecondBonus = newTurn === 2 ? 1 : 0;
    ctx.db.cardDuelPlayer.id.update({
      ...newActive,
      manaMax: nextManaMax,
      manaCurrent: nextManaMax + goingSecondBonus,
    });
    drawCardFor(ctx, session.id, newActive.username);
  }
  clearTurnTimeouts(ctx, session.id);
  scheduleTurnTimeout(ctx, session.id, updatedBoard);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkVictory(ctx: any, session: any): boolean {
  const players = [
    ...ctx.db.cardDuelPlayer.card_duel_player_session_id.filter(session.id),
  ];
  const dead = players.filter(p => p.health <= 0);
  if (dead.length === 0) return false;
  const result = cardDuelHandler.onEnd(ctx, session);
  cleanupCardDuel(ctx, session.id);
  endSession(ctx, session, result);
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanupCardDuel(ctx: any, sessionId: bigint): void {
  for (const c of ctx.db.cardDuelCardOnBoard.card_duel_card_on_board_session_id.filter(sessionId)) {
    ctx.db.cardDuelCardOnBoard.id.delete(c.id);
  }
  for (const p of ctx.db.cardDuelPlayer.card_duel_player_session_id.filter(sessionId)) {
    ctx.db.cardDuelPlayer.id.delete(p.id);
  }
  ctx.db.cardDuelBoard.sessionId.delete(sessionId);
}

const cardDuelHandler: MinigameHandler = {
  kind: 'cardDuel',
  meta: {
    displayName: 'Card Duel',
    description: '1v1 card duel. Same starter deck. Drop to 0 health to lose.',
    minPlayers: 2,
    maxPlayers: 2,
    style: 'turnBased',
    mode: 'competitive',
    soloAllowed: false,
  },
  init(ctx, session) {
    ctx.db.cardDuelBoard.insert({
      sessionId: session.id,
      activeSeat: 0,
      turnNumber: 0,
      turnDeadlineMicros: 0n,
    });
  },
  onStart(ctx, session) {
    const members = membersOf(ctx, session.id);
    if (members.length !== 2) throw new SenderError('CardDuel requires exactly 2 players');
    members.forEach((m, idx) => {
      ctx.db.cardDuelPlayer.insert({
        id: 0n,
        sessionId: session.id,
        username: m.username,
        seat: idx,
        health: STARTING_HEALTH,
        manaMax: 1,
        manaCurrent: 1,
      });
      const shuffled = shuffleDeck(ctx, STARTER_DECK);
      const hand = shuffled.slice(0, STARTING_HAND_SIZE);
      const deck = shuffled.slice(STARTING_HAND_SIZE);
      writePrivate(ctx, session.id, m.username, 0, hand);
      writePrivate(ctx, session.id, m.username, 1, deck);
    });
    const startingSeat = ctx.random.integerInRange(0, 1);
    const board = ctx.db.cardDuelBoard.sessionId.find(session.id);
    if (board === null) throw new SenderError('Board missing');
    const updated = {
      ...board,
      activeSeat: startingSeat,
      turnNumber: 1,
      turnDeadlineMicros:
        ctx.timestamp.microsSinceUnixEpoch + BigInt(TURN_TIMEOUT_MS) * 1000n,
    };
    ctx.db.cardDuelBoard.sessionId.update(updated);
    scheduleTurnTimeout(ctx, session.id, updated);
  },
  onTick(ctx, session, tickKind, payload) {
    if (tickKind !== 'cardDuelTurnTimeout') return;
    let parsed: { activeSeat: number; turnNumber: number };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const board = ctx.db.cardDuelBoard.sessionId.find(session.id);
    if (board === null) return;
    if (board.activeSeat !== parsed.activeSeat || board.turnNumber !== parsed.turnNumber) return;
    endTurn(ctx, session, board);
  },
  onPlayerLeave(_ctx, _session, _member, _reason) {
    return 'forfeit';
  },
  onEnd(ctx, session): MinigameEndResult {
    const players = [
      ...ctx.db.cardDuelPlayer.card_duel_player_session_id.filter(session.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ].sort((a: any, b: any) => b.health - a.health);
    const placements: MinigameEndResult['placements'] = players.map((p, i) => ({
      username: p.username,
      placement: i + 1,
      finalScore: BigInt(Math.max(0, p.health)),
    }));
    const rewards: MinigameEndResult['rewards'] = [];
    if (players.length === 2) {
      rewards.push({
        username: players[0].username,
        rewards: [
          { kind: 'xp', amount: 25n },
          { kind: 'scrap', amount: 25n },
        ],
      });
      rewards.push({
        username: players[1].username,
        rewards: [{ kind: 'xp', amount: 10n }],
      });
    }
    return { placements, rewards };
  },
};

registerHandler(cardDuelHandler);

// ---------- Action reducers ----------

export const cdPlayCard = spacetimedb.reducer(
  { handIndex: t.u8(), targetSlot: t.u8() },
  (ctx, { handIndex, targetSlot }) => {
    const { username, session } = requireActiveMinigame(ctx, 'cardDuel');
    const board = ctx.db.cardDuelBoard.sessionId.find(session.id);
    if (board === null) throw new SenderError('Board missing');
    const me = findPlayer(ctx, session.id, username);
    if (!me) throw new SenderError('Not a player in this duel');
    if (board.activeSeat !== me.seat) throw new SenderError('Not your turn');
    const hand = readPrivate(ctx, session.id, username, 0);
    if (handIndex >= hand.length) throw new SenderError('Bad hand index');
    const cardDefId = hand[handIndex];
    const cardDef = ctx.db.cardDefinition.cardDefId.find(cardDefId);
    if (cardDef === null) throw new SenderError('Unknown card');
    if (me.manaCurrent < cardDef.cost) throw new SenderError('Not enough mana');
    if (targetSlot >= MAX_BOARD_SLOTS) throw new SenderError('Bad slot');
    const slotOccupied = [
      ...ctx.db.cardDuelCardOnBoard.card_duel_card_on_board_session_id.filter(session.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ].some((c: any) => c.ownerSeat === me.seat && c.slot === targetSlot);
    if (slotOccupied) throw new SenderError('Slot occupied');
    ctx.db.cardDuelPlayer.id.update({
      ...me,
      manaCurrent: me.manaCurrent - cardDef.cost,
    });
    ctx.db.cardDuelCardOnBoard.insert({
      id: 0n,
      sessionId: session.id,
      ownerSeat: me.seat,
      slot: targetSlot,
      cardDefId,
      health: cardDef.health,
      attack: cardDef.attack,
    });
    const newHand = hand.filter((_, i) => i !== handIndex);
    writePrivate(ctx, session.id, username, 0, newHand);
  }
);

export const cdAttack = spacetimedb.reducer(
  { attackerCardId: t.u64(), defenderCardId: t.u64() },
  (ctx, { attackerCardId, defenderCardId }) => {
    const { username, session } = requireActiveMinigame(ctx, 'cardDuel');
    const board = ctx.db.cardDuelBoard.sessionId.find(session.id);
    if (board === null) throw new SenderError('Board missing');
    const me = findPlayer(ctx, session.id, username);
    if (!me) throw new SenderError('Not a player in this duel');
    if (board.activeSeat !== me.seat) throw new SenderError('Not your turn');
    const attacker = ctx.db.cardDuelCardOnBoard.id.find(attackerCardId);
    if (attacker === null) throw new SenderError('Attacker not found');
    if (attacker.sessionId !== session.id) throw new SenderError('Wrong session');
    if (attacker.ownerSeat !== me.seat) throw new SenderError('Not your card');
    if (defenderCardId === 0n) {
      // Attack opponent player directly.
      const opponent = playerBySeat(ctx, session.id, me.seat === 0 ? 1 : 0);
      if (!opponent) throw new SenderError('No opponent');
      ctx.db.cardDuelPlayer.id.update({
        ...opponent,
        health: opponent.health - attacker.attack,
      });
      checkVictory(ctx, session);
      return;
    }
    const defender = ctx.db.cardDuelCardOnBoard.id.find(defenderCardId);
    if (defender === null) throw new SenderError('Defender not found');
    if (defender.sessionId !== session.id) throw new SenderError('Wrong session');
    if (defender.ownerSeat === me.seat) throw new SenderError('Cannot attack your own card');
    const newDefHealth = defender.health - attacker.attack;
    const newAtkHealth = attacker.health - defender.attack;
    if (newDefHealth <= 0) {
      ctx.db.cardDuelCardOnBoard.id.delete(defender.id);
    } else {
      ctx.db.cardDuelCardOnBoard.id.update({ ...defender, health: newDefHealth });
    }
    if (newAtkHealth <= 0) {
      ctx.db.cardDuelCardOnBoard.id.delete(attacker.id);
    } else {
      ctx.db.cardDuelCardOnBoard.id.update({ ...attacker, health: newAtkHealth });
    }
  }
);

export const cdEndTurn = spacetimedb.reducer(ctx => {
  const { username, session } = requireActiveMinigame(ctx, 'cardDuel');
  const board = ctx.db.cardDuelBoard.sessionId.find(session.id);
  if (board === null) throw new SenderError('Board missing');
  const me = findPlayer(ctx, session.id, username);
  if (!me) throw new SenderError('Not a player in this duel');
  if (board.activeSeat !== me.seat) throw new SenderError('Not your turn');
  endTurn(ctx, session, board);
});

export const cdMulligan = spacetimedb.reducer(
  { replaceIndices: t.array(t.u8()) },
  (ctx, { replaceIndices }) => {
    const username = (() => {
      const s = ctx.db.session.identity.find(ctx.sender);
      if (s === null) throw new SenderError('Not signed in');
      return s.username;
    })();
    const member = ctx.db.minigameMember.username.find(username);
    if (member === null) throw new SenderError('Not in a minigame');
    const session = ctx.db.minigameSession.id.find(member.sessionId);
    if (session === null) throw new SenderError('Session missing');
    if (session.kind.tag !== 'cardDuel') throw new SenderError('Wrong minigame');
    if (session.state.tag !== 'lobby') throw new SenderError('Mulligan only in lobby');
    const hand = readPrivate(ctx, session.id, username, 0);
    const deck = readPrivate(ctx, session.id, username, 1);
    if (hand.length === 0) return; // nothing to mulligan; init not yet run for hand
    const indicesToReplace = new Set(replaceIndices.map(i => Number(i)));
    const kept: string[] = [];
    const replaced: string[] = [];
    hand.forEach((c, i) => {
      if (indicesToReplace.has(i)) replaced.push(c);
      else kept.push(c);
    });
    const shuffled = shuffleDeck(ctx, [...deck, ...replaced]);
    const newHand = [...kept, ...shuffled.slice(0, replaced.length)];
    const newDeck = shuffled.slice(replaced.length);
    writePrivate(ctx, session.id, username, 0, newHand);
    writePrivate(ctx, session.id, username, 1, newDeck);
  }
);
