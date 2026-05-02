import { table, t } from 'spacetimedb/server';

// ---------- Tagged unions ----------

export const BattleState = t.enum('BattleState', {
  voting: t.unit(),
  inProgress: t.unit(),
  completed: t.unit(),
  cancelled: t.unit(),
});

export const ParticipantVote = t.enum('ParticipantVote', {
  pending: t.unit(),
  yay: t.unit(),
  nay: t.unit(),
});

export const TargetKind = t.enum('TargetKind', {
  zombie: t.object('TargetKindZombie', { zombieId: t.u64() }),
  participant: t.object('TargetKindParticipant', { participantId: t.u64() }),
  noTarget: t.unit(),
});

export const BattleEventKind = t.enum('BattleEventKind', {
  voteCast: t.unit(),
  battleStarted: t.unit(),
  actionResolved: t.unit(),
  damageDealt: t.unit(),
  playerDefeated: t.unit(),
  waveCompleted: t.unit(),
  waveStarted: t.unit(),
  battleEnded: t.unit(),
});

export const ZombieKind = t.enum('ZombieKind', {
  basic: t.unit(),
  armored: t.unit(),
  juggernaut: t.unit(),
});

// ---------- Session ----------

export const defensiveBattleSession = table(
  {
    name: 'defensive_battle_session',
    indexes: [
      {
        accessor: 'defensive_battle_session_group',
        algorithm: 'btree',
        columns: ['groupId'],
      },
    ],
  },
  {
    sessionId: t.u64().primaryKey().autoInc(),
    groupId: t.u64(),
    state: BattleState,
    currentWave: t.u32(),
    prngCounter: t.u64(),
    livingParticipantCount: t.u32(),
    createdAt: t.timestamp(),
    // voteDeadline stored as raw microsSinceUnixEpoch bigint (matches the
    // bigint contract of ScheduleAt.time and avoids the Timestamp object
    // construction friction in reducer code).
    voteDeadlineMicros: t.u64(),
    endedAt: t.timestamp().optional(),
  }
);

// ---------- Participants ----------

export const defensiveBattleParticipant = table(
  {
    name: 'defensive_battle_participant',
    indexes: [
      {
        accessor: 'defensive_battle_participant_session',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
      {
        accessor: 'defensive_battle_participant_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    vote: ParticipantVote,
    startLocation: t.string(),
    maxHp: t.u32(),
    currentHp: t.i32(),
    wardCount: t.u32(),
    isDefeated: t.bool(),
    waveAtDefeat: t.u32(),
    handSize: t.u32(),
  }
);

// ---------- Stat snapshot (frozen at battle start) ----------

export const defensiveBattleStatSnapshot = table(
  {
    name: 'defensive_battle_stat_snapshot',
    indexes: [
      {
        accessor: 'defensive_battle_stat_snapshot_session',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    statId: t.string(),
    total: t.i32(),
  }
);

// ---------- Zombies ----------

export const defensiveBattleZombie = table(
  {
    name: 'defensive_battle_zombie',
    indexes: [
      {
        accessor: 'defensive_battle_zombie_session',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    waveNumber: t.u32(),
    currentHp: t.i32(),
    maxHp: t.u32(),
    isDead: t.bool(),
    // Appended (not reordered) so existing rows can migrate without data loss.
    kind: ZombieKind.default({ tag: 'basic' }),
    // Default 1 (not 0) workaround: SpacetimeDB TS SDK drops falsy default
    // values (`if (meta.defaultValue)` check). spawnWave always sets armor
    // explicitly, so this default only applies to historical rows which are
    // already dead — no gameplay impact.
    armor: t.u32().default(1),
    // Per-zombie threat: sum of live attack values = self-damage tick on the
    // actor's next play. basic=1, armored=1, juggernaut=3 (set in spawnWave).
    // Default 1 happens to be the correct basic value; same falsy-default
    // workaround as armor.
    attack: t.u32().default(1),
  }
);

// ---------- Hand slots (DEPRECATED, kept for schema migration only) ----------
// Replaced by defensive_battle_deck_card under Cycling Deck. SpacetimeDB
// rejects table-drop migrations without --delete-data, so we leave the empty
// schema entry in place and stop reading/writing it. Drop in a future
// deliberate clear-database publish.
export const defensiveBattleHandSlot = table(
  {
    name: 'defensive_battle_hand_slot',
    indexes: [
      {
        accessor: 'defensive_battle_hand_slot_session',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    handIndex: t.u32(),
    actionId: t.string(),
  }
);

// ---------- Deck cards ----------
// Cycling Deck replaces the old random-refill hand_slot model. Each row is one
// card in a player's deck for the duration of a battle. Hand = the handSize
// rows with the lowest deckOrder; played cards get bumped to maxDeckOrder+1
// to cycle to the back. See specs/game-specs/Cycling Deck.md.

export const defensiveBattleDeckCard = table(
  {
    name: 'defensive_battle_deck_card',
    indexes: [
      {
        accessor: 'defensive_battle_deck_card_session',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    username: t.string(),
    deckOrder: t.u32(),
    actionId: t.string(),
  }
);

// ---------- Event log ----------

export const defensiveBattleLog = table(
  {
    name: 'defensive_battle_log',
    indexes: [
      {
        accessor: 'defensive_battle_log_session',
        algorithm: 'btree',
        columns: ['sessionId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64(),
    eventAt: t.timestamp(),
    actorUsername: t.string(),
    eventKind: BattleEventKind,
    payload: t.string(),
  }
);

// ---------- Scheduled vote-cancel job ----------
//
// Holder allows the table to forward-reference the reducer (defined in
// battle.ts). battle.ts must assign `voteCancelRef.reducer = runVoteCancelJob`
// at module load. Keeping the table here (rather than in battle.ts) avoids
// a circular import via schema.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const voteCancelRef: { reducer: any } = { reducer: null };

export const defensiveBattleVoteCancelJob = table(
  {
    name: 'defensive_battle_vote_cancel_job',
    scheduled: () => voteCancelRef.reducer,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    sessionId: t.u64(),
  }
);
