import { table, t } from 'spacetimedb/server';

export const minigameKindTags = ['coinFlip', 'rhythmTap', 'cardDuel'] as const;
export type MinigameKindTag = (typeof minigameKindTags)[number];

export const MinigameKind = t.enum('MinigameKind', {
  coinFlip: t.unit(),
  rhythmTap: t.unit(),
  cardDuel: t.unit(),
});

export const MinigameSessionState = t.enum('MinigameSessionState', {
  lobby: t.unit(),
  inProgress: t.unit(),
  completed: t.unit(),
  cancelled: t.unit(),
});

export const CoinSide = t.enum('CoinSide', {
  heads: t.unit(),
  tails: t.unit(),
});

// Holder so the scheduled tick table can resolve its reducer after the reducer
// is defined. ESM bindings are read-only across modules, so a mutable property
// is used instead of a `let`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const minigameScheduledReducers: { tick: any } = { tick: null };

// ---------- Framework tables ----------

export const minigameSession = table(
  { name: 'minigame_session', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: MinigameKind,
    state: MinigameSessionState,
    hostUsername: t.string(),
    minPlayers: t.u8(),
    maxPlayers: t.u8(),
    createdAt: t.timestamp(),
    startedAt: t.timestamp().optional(),
    endedAt: t.timestamp().optional(),
  }
);

export const minigameMember = table(
  {
    name: 'minigame_member',
    public: true,
    indexes: [
      {
        accessor: 'minigame_member_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    username: t.string().primaryKey(),
    sessionId: t.u64(),
    seatIndex: t.u8(),
    ready: t.bool(),
    active: t.bool(),
    joinedAt: t.timestamp(),
  }
);

export const minigameInvite = table(
  {
    name: 'minigame_invite',
    public: true,
    indexes: [
      {
        accessor: 'minigame_invite_to_username',
        algorithm: 'btree',
        columns: ['toUsername'],
      },
      {
        accessor: 'minigame_invite_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    inviteId: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    fromUsername: t.string(),
    toUsername: t.string(),
    createdAt: t.timestamp(),
  }
);

export const minigamePrivateState = table(
  {
    name: 'minigame_private_state',
    indexes: [
      {
        accessor: 'minigame_private_state_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
      {
        accessor: 'minigame_private_state_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    slot: t.u8(),
    data: t.string(),
  }
);

export const minigameResult = table(
  {
    name: 'minigame_result',
    public: true,
    indexes: [
      {
        accessor: 'minigame_result_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
      {
        accessor: 'minigame_result_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    kind: MinigameKind,
    finalScore: t.i64(),
    placement: t.u8(),
    rewardsJson: t.string(),
    completedAt: t.timestamp(),
  }
);

export const minigameTick = table(
  {
    name: 'minigame_tick',
    scheduled: () => minigameScheduledReducers.tick,
    indexes: [
      {
        accessor: 'minigame_tick_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    sessionId: t.u64(),
    kind: t.string(),
    payload: t.string(),
  }
);

// ---------- CoinFlip tables ----------

export const coinFlipGame = table(
  { name: 'coin_flip_game', public: true },
  {
    sessionId: t.u64().primaryKey(),
    // Legacy column kept for migration compatibility; not used in continuous play.
    anteScrap: t.u64().default(0n),
    roundNumber: t.u32().default(1),
    pot: t.u64(),
    result: CoinSide.optional(),
    revealedAt: t.timestamp().optional(),
  }
);

export const coinFlipBet = table(
  {
    name: 'coin_flip_bet',
    public: true,
    indexes: [
      {
        accessor: 'coin_flip_bet_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    pick: CoinSide,
    wager: t.u64().default(0n),
    payout: t.u64().default(0n),
  }
);

// ---------- RhythmTap tables ----------

export const rhythmTapGame = table(
  { name: 'rhythm_tap_game', public: true },
  {
    sessionId: t.u64().primaryKey(),
    chartId: t.string(),
    durationMs: t.u32(),
    startMicros: t.i64(),
  }
);

export const rhythmTapNote = table(
  {
    name: 'rhythm_tap_note',
    public: true,
    indexes: [
      {
        accessor: 'rhythm_tap_note_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    lane: t.u8(),
    timeMs: t.u32(),
    hitByUsername: t.string().optional(),
  }
);

export const rhythmTapScore = table(
  {
    name: 'rhythm_tap_score',
    public: true,
    indexes: [
      {
        accessor: 'rhythm_tap_score_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    hits: t.u32(),
    misses: t.u32(),
    combo: t.u32(),
  }
);

// ---------- CardDuel tables ----------

export const cardDefinition = table(
  { name: 'card_definition', public: true },
  {
    cardDefId: t.string().primaryKey(),
    name: t.string(),
    cost: t.u8(),
    attack: t.u8(),
    health: t.u8(),
    effect: t.string(),
  }
);

export const cardDuelBoard = table(
  { name: 'card_duel_board', public: true },
  {
    sessionId: t.u64().primaryKey(),
    activeSeat: t.u8(),
    turnNumber: t.u32(),
    turnDeadlineMicros: t.i64(),
  }
);

export const cardDuelPlayer = table(
  {
    name: 'card_duel_player',
    public: true,
    indexes: [
      {
        accessor: 'card_duel_player_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    seat: t.u8(),
    health: t.i32(),
    manaMax: t.u8(),
    manaCurrent: t.u8(),
  }
);

export const cardDuelCardOnBoard = table(
  {
    name: 'card_duel_card_on_board',
    public: true,
    indexes: [
      {
        accessor: 'card_duel_card_on_board_session_id',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    ownerSeat: t.u8(),
    slot: t.u8(),
    cardDefId: t.string(),
    health: t.i32(),
    attack: t.u8(),
  }
);
