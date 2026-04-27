# Minigame Framework + Three Launch Games

## Goal

Add a **minigame framework** to idle-survivor that lets players opt into short, self-contained games (solo or with party/friends) without disrupting their idle progression. The framework must be **extremely extensible** — adding a new minigame should be one new file in `spacetimedb/src/minigames/`, one new file in `src/components/minigames/`, and two registry entries. No edits to framework code.

To prove the framework works across the design space, this spec ships **three launch games** that exercise every framework feature: turn-based PvP w/ ante (CoinFlip), real-time scoring (RhythmTap), and turn-based PvP w/ hidden info (CardDuel).

---

## Core Principles

1. **Framework, not games.** All session lifecycle, invites, hidden-info plumbing, modal routing, disconnect handling, and reward dispatch live in shared code. Each game only declares: metadata, init, onStart, optional onTick, onAction, onPlayerLeave, onEnd, and its own UI component.
2. **One minigame at a time per player.** Players can keep idle activities (Scavenge, etc.) running, but cannot be in two minigames simultaneously.
3. **Server is authoritative.** All game state lives on SpacetimeDB. Clients only render and call reducers.
4. **Hidden information is first-class.** A generic `MinigamePrivateState` table + private view ensures only the row's owner sees their hidden state.
5. **Rewards are open.** Games declare a per-player reward list at end-of-game; the framework dispatches to existing grant helpers.

---

## File Layout

### Backend

```
spacetimedb/src/
├── index.ts                      # Existing — imports + re-exports each minigame module's tables/reducers
├── minigames/
│   ├── framework.ts              # Shared tables, lifecycle reducers, dispatch, helpers
│   ├── registry.ts               # MinigameKind → handler module map
│   ├── coinFlip.ts               # CoinFlip game (~150 lines)
│   ├── rhythmTap.ts              # RhythmTap game (~250 lines)
│   └── cardDuel.ts               # CardDuel game (~400 lines)
```

### Frontend

```
src/components/
├── TabBar.tsx                    # Modified — add "Minigames" tab
├── MinigamesTab.tsx              # New — list of available games + "Play" buttons
└── minigames/
    ├── MinigameModal.tsx         # Generic shell (lobby + results)
    ├── MinigameLobby.tsx         # Member list, ready, invite party/friend, start
    ├── MinigameResults.tsx       # Placements, scores, "Done"
    ├── registry.ts               # MinigameKind → { name, View, optional LobbyOverride, ResultOverride }
    ├── CoinFlipView.tsx
    ├── RhythmTapView.tsx
    └── CardDuelView.tsx
```

---

## Backend Design

### Shared tables (`framework.ts`)

```ts
// Enums
const MinigameKind = t.enum('MinigameKind', {
  coinFlip:  t.unit(),
  rhythmTap: t.unit(),
  cardDuel:  t.unit(),
});

const MinigameSessionState = t.enum('MinigameSessionState', {
  lobby:      t.unit(),
  inProgress: t.unit(),
  completed:  t.unit(),
  cancelled:  t.unit(),
});

// Tables
const minigameSession = table({
  name: 'minigame_session',
  public: true,
}, {
  id:         t.u64().primaryKey().autoInc(),
  kind:       MinigameKind,
  state:      MinigameSessionState,
  hostId:     t.identity(),
  minPlayers: t.u8(),
  maxPlayers: t.u8(),
  createdAt:  t.timestamp(),
  startedAt:  t.timestamp().optional(),
  endedAt:    t.timestamp().optional(),
});

const minigameMember = table({
  name: 'minigame_member',
  public: true,
  indexes: [
    { name: 'minigame_member_session_id', algorithm: 'btree', columns: ['sessionId'] },
    { name: 'minigame_member_player_id',  algorithm: 'btree', columns: ['playerId'] }, // unique enforces 1-at-a-time
  ],
}, {
  id:        t.u64().primaryKey().autoInc(),
  sessionId: t.u64(),
  playerId:  t.identity(), // marked unique via separate constraint — see notes
  seatIndex: t.u8(),
  ready:     t.bool(),
  active:    t.bool(),     // false after disconnect/forfeit/kick
  joinedAt:  t.timestamp(),
});

const minigameInvite = table({
  name: 'minigame_invite',
  public: true,
  indexes: [
    { name: 'minigame_invite_invitee_id', algorithm: 'btree', columns: ['inviteeId'] },
  ],
}, {
  id:        t.u64().primaryKey().autoInc(),
  sessionId: t.u64(),
  inviterId: t.identity(),
  inviteeId: t.identity(),
  createdAt: t.timestamp(),
});

// Hidden state — only the owning player sees their rows (private view)
const minigamePrivateState = table({
  name: 'minigame_private_state',
  public: false, // private; surfaced via per-player view below
  indexes: [
    { name: 'minigame_private_state_session_id', algorithm: 'btree', columns: ['sessionId'] },
    { name: 'minigame_private_state_player_id',  algorithm: 'btree', columns: ['playerId'] },
  ],
}, {
  id:        t.u64().primaryKey().autoInc(),
  sessionId: t.u64(),
  playerId:  t.identity(),
  slot:      t.u8(),       // game-defined (0 = hand, 1 = deck, etc.)
  data:      t.bytes(),    // BSATN-encoded per-game struct
});

const minigameResult = table({
  name: 'minigame_result',
  public: true,
  indexes: [
    { name: 'minigame_result_session_id', algorithm: 'btree', columns: ['sessionId'] },
    { name: 'minigame_result_player_id',  algorithm: 'btree', columns: ['playerId'] },
  ],
}, {
  id:          t.u64().primaryKey().autoInc(),
  sessionId:   t.u64(),
  playerId:    t.identity(),
  kind:        MinigameKind,
  finalScore:  t.i64(),
  placement:   t.u8(),     // 1 = winner; 0 = co-op all-finished
  rewardsJson: t.string(), // human-readable summary; actual grants applied via helpers
  completedAt: t.timestamp(),
});
```

> **Note on the `playerId` uniqueness constraint:** SpacetimeDB TS uses a separate `.unique()` modifier in column definitions (`playerId: t.identity().unique()`). This enforces "one minigame at a time" at the DB level — `CreateMinigame` and `AcceptMinigameInvite` will throw on conflict.

### Private view for hidden state

```ts
export const myMinigamePrivateState = spacetimedb.view(
  { name: 'my_minigame_private_state', public: true },
  t.array(minigamePrivateState.rowType),
  (ctx) => [...ctx.db.minigamePrivateState.minigame_private_state_player_id.filter(ctx.sender)]
);
```

Clients subscribe to `my_minigame_private_state` and only ever see their own hidden rows.

### Game handler interface (`registry.ts`)

Every game module exports a `MinigameHandler` object that the framework dispatches to:

```ts
export interface MinigameHandler {
  kind: MinigameKindTag; // 'coinFlip' | 'rhythmTap' | 'cardDuel'
  meta: {
    displayName: string;
    minPlayers: number;
    maxPlayers: number;
    style: 'realtime' | 'turnBased';
    mode: 'competitive' | 'coop';
    soloAllowed: boolean;
  };

  // Called when host creates the session. Set up game-specific tables / hidden state.
  init(ctx: ReducerContext, session: MinigameSession): void;

  // Called when host clicks Start (after min-player + ready checks). Begin gameplay,
  // schedule first tick if real-time, deal hidden info, etc.
  onStart(ctx: ReducerContext, session: MinigameSession): void;

  // Optional. Real-time games schedule a tick row and route fires here.
  onTick?(ctx: ReducerContext, session: MinigameSession): void;

  // Optional. If the game registers per-action reducers (recommended for typed args),
  // this is the catch-all unused. Each game's named reducers (e.g. cdPlayCard) handle
  // their own validation and look up `session` via ctx.db.minigameMember...
  onAction?(ctx: ReducerContext, session: MinigameSession, member: MinigameMember, action: unknown): void;

  // Called when a member disconnects, AFK-times-out, or explicitly leaves.
  // Returns 'forfeit' (end immediately for competitive games), 'kick' (continue without them
  // for coop), or 'pause' (rare, e.g. wait-for-reconnect).
  onPlayerLeave(
    ctx: ReducerContext,
    session: MinigameSession,
    member: MinigameMember,
    reason: 'disconnect' | 'idle' | 'leave',
  ): 'forfeit' | 'kick' | 'pause';

  // Called by the game itself (or by framework after forfeit). Returns per-player rewards
  // for the framework to grant via existing helpers.
  onEnd(ctx: ReducerContext, session: MinigameSession): MinigameEndResult;
}

export interface MinigameEndResult {
  placements: { playerId: Identity; placement: number; finalScore: bigint }[];
  rewards:    { playerId: Identity; rewards: Reward[] }[];
}

export type Reward =
  | { kind: 'scrap'; amount: bigint }
  | { kind: 'xp'; amount: bigint }
  | { kind: 'item'; itemDefId: bigint; quantity: bigint }
  | { kind: 'custom'; description: string; apply: (ctx: ReducerContext, playerId: Identity) => void };

// Registry — each new game adds one entry here
export const handlers: Record<MinigameKindTag, MinigameHandler> = {
  coinFlip:  coinFlipHandler,
  rhythmTap: rhythmTapHandler,
  cardDuel:  cardDuelHandler,
};
```

### Shared lifecycle reducers (`framework.ts`)

```ts
export const createMinigame   = spacetimedb.reducer({ kind: MinigameKind }, (ctx, { kind }) => { ... });
export const inviteToMinigame = spacetimedb.reducer({ targetUsername: t.string() }, (ctx, { targetUsername }) => { ... });
export const acceptMinigameInvite  = spacetimedb.reducer({ inviteId: t.u64() }, ...);
export const declineMinigameInvite = spacetimedb.reducer({ inviteId: t.u64() }, ...);
export const setMinigameReady = spacetimedb.reducer({ ready: t.bool() }, ...);
export const startMinigame    = spacetimedb.reducer((ctx) => { ... }); // host only
export const leaveMinigame    = spacetimedb.reducer((ctx) => { ... });
export const cancelMinigame   = spacetimedb.reducer((ctx) => { ... }); // host, lobby only
```

`createMinigame` flow:
1. Reject if sender already has a `minigameMember` row (the `.unique()` on `playerId` enforces this at insert time too).
2. Look up handler via `handlers[kind]`.
3. If `meta.soloAllowed === false` and sender has no party (or party is solo), reject.
4. Insert `minigameSession` (state = `lobby`), insert `minigameMember` for sender (host, seat 0).
5. Call `handlers[kind].init(ctx, session)`.

`startMinigame` flow:
1. Sender must be host. State must be `lobby`. Member count must be ≥ `meta.minPlayers`.
2. All members must have `ready = true` (host is auto-ready).
3. Flip session to `inProgress`, stamp `startedAt`.
4. Call `handlers[session.kind].onStart(ctx, session)`.

### Per-game action reducers

Each game defines its own typed reducers (recommended over a generic `onAction`):

```ts
// coinFlip.ts
export const cfPick = spacetimedb.reducer({ pick: CoinSide }, (ctx, { pick }) => {
  const { session, member } = framework.requireActiveMinigame(ctx, 'coinFlip');
  // ... game logic
});

// cardDuel.ts
export const cdPlayCard = spacetimedb.reducer(
  { handIndex: t.u8(), targetSlot: t.u8() },
  (ctx, args) => {
    const { session, member } = framework.requireActiveMinigame(ctx, 'cardDuel');
    // ... game logic
  }
);
```

`framework.requireActiveMinigame(ctx, expectedKind)` is a helper that finds the sender's `minigameMember`, looks up the session, validates `state === inProgress` and `kind === expectedKind`, and throws `SenderError` otherwise.

### Disconnect / idle handling

- **Disconnect**: extend the existing `clientDisconnected` hook to call `framework.handleDisconnect(ctx, ctx.sender)`. Looks up sender's member row → looks up session → calls `handlers[kind].onPlayerLeave(ctx, session, member, 'disconnect')`. Acts on the return value.
- **Idle / AFK timeout**: turn-based games schedule a per-turn timeout tick. Real-time games' end-of-session safety tick handles this. Either way, the timeout reducer calls `handlers[kind].onPlayerLeave(..., 'idle')`.
- **`forfeit`**: framework calls `handlers[kind].onEnd(ctx, session)` with the leaver scored as the loser, then runs `framework.endSession(ctx, session, endResult)`.
- **`kick`**: framework sets `member.active = false` and continues. If all remaining members are inactive, framework auto-ends.
- **`pause`**: framework sets `member.active = false`. Game decides when to resume (out of scope for v1; only used if someone wires it up later).

### End-of-session helper

```ts
export function endSession(ctx: ReducerContext, session: MinigameSession, result: MinigameEndResult): void {
  // 1. Stamp endedAt, flip state to completed
  // 2. Insert one minigameResult per placement
  // 3. Apply rewards: for each reward, dispatch to grantScrap / grantExperience / grantItem / reward.apply
  // 4. Delete minigameInvite rows for this session
  // 5. Delete minigamePrivateState rows for this session
  // 6. Delete minigameMember rows (frees players for the next minigame)
}
```

Reward dispatch reuses existing helpers (e.g. the resource/XP grant pattern already established in `index.ts`). New reward kinds are added by extending the `Reward` union and the dispatch switch.

---

## Frontend Design

### New tab

`TabBar.tsx`: add `'minigames'` to `TabKey` and the `TABS` array. `Root.tsx` (or wherever the active tab routes to a screen) gets a new branch rendering `<MinigamesTab>`.

### MinigamesTab.tsx

Reads `frontend/registry.ts` for the list of games. Renders a card per game with name, description, min/max players, "Play" button. "Play" calls `reducers.createMinigame({ kind })`.

### MinigameModal.tsx — auto-mounted by subscription

The modal listens to the user's `minigameMember` row (via the existing subscription stack). When a row appears, the modal opens; when it disappears (session ended → member rows deleted), it closes. This means **no imperative navigation** — joining via accepted invite or by host action both auto-open the modal.

Inside the modal, given the current session state:
- `lobby` → render `<MinigameLobby>` (or per-game `LobbyOverride` from registry)
- `inProgress` → render the game's `View` from the registry
- `completed` | `cancelled` → render `<MinigameResults>` (or per-game `ResultOverride`)

### Per-game view contract (`registry.ts`)

```ts
export interface MinigameClientDescriptor {
  kind: MinigameKindTag;
  displayName: string;
  description: string;
  View: React.FC<{ session: MinigameSession }>; // rendered when state === inProgress
  LobbyOverride?: React.FC<{ session: MinigameSession }>;
  ResultOverride?: React.FC<{ session: MinigameSession }>;
}

export const registry: Record<MinigameKindTag, MinigameClientDescriptor> = {
  coinFlip:  coinFlipDescriptor,
  rhythmTap: rhythmTapDescriptor,
  cardDuel:  cardDuelDescriptor,
};
```

### Lobby UI (shared)

Lists members with ready toggles, host has "Start" + "Cancel" + "Invite" buttons. "Invite" opens a picker for party members and (when implemented) friends. "Start" calls `reducers.startMinigame()` — disabled until min-player + all-ready conditions are met.

### Hidden info on the client

Each game's `View` reads from its own public table(s) AND the `myMinigamePrivateState` view. Decoding the BSATN blob is per-game (e.g. CardDuelView decodes slot 0 as `CardDuelHand`). The framework provides a typed helper:

```ts
function readPrivate<T>(slot: number, decode: (data: Uint8Array) => T): T | null;
```

---

## The Three Launch Games

### 1. CoinFlip — turn-based, competitive, ante

Exercises: ante/staking, RNG reveal, pot-split rewards.

- **Meta**: `minPlayers=1`, `maxPlayers=4`, `competitive`, `turnBased`, `soloAllowed=true`.
- **Tables (public)**: `coinFlipGame { sessionId(pk), anteScrap, pot, result(optional CoinSide) }`, `coinFlipBet { id, sessionId, playerId(unique-per-session), pick }`.
- **No hidden info.**
- **Init**: insert one `coinFlipGame` row with default ante (e.g. 10 scrap).
- **OnStart**: deduct ante from each member's scrap (validate they have it; reject `startMinigame` if not). Sum into `pot`.
- **Action `cfPick(pick)`**: insert `coinFlipBet` for sender. When all members have bet, deterministic RNG (seeded from `ctx.timestamp.microsSinceUnixEpoch ^ session.id`) picks heads/tails, store in `coinFlipGame.result`, call `onEnd`.
- **OnEnd**: winners split the pot (placement 1, even split). Losers get placement 2.
- **OnPlayerLeave (any reason)**: if pre-bet → refund ante, end session (cancelled-style, no rewards). If post-bet → forfeit their bet (treated as wrong pick).

### 2. RhythmTap — real-time, solo or coop, score-based

Exercises: scheduled ticks, real-time reactive scoring, hidden-info-NOT-needed (chart is public).

- **Meta**: `minPlayers=1`, `maxPlayers=4`, `coop`, `realtime`, `soloAllowed=true`.
- **Tables (public)**: `rhythmTapGame { sessionId(pk), chartId, durationMs, startMicros }`, `rhythmTapNote { id, sessionId, lane, timeMs, hitByPlayerId(optional) }`, `rhythmTapScore { id, sessionId, playerId(unique-per-session), hits, misses, combo }`.
- **Init**: pick a chart deterministically by `session.id`. Pre-populate notes.
- **OnStart**: stamp `startMicros = ctx.timestamp.microsSinceUnixEpoch`. Insert one `rhythmTapScore` row per member. Schedule a single safety-net tick at `startMicros + durationMs + 2_000_000n`.
- **Action `rtTap(noteId, clientHitMicros)`**: validate `|note.timeMs * 1000 - (clientHitMicros - startMicros)| < HIT_WINDOW_MICROS` (±150ms). If valid + unhit, mark `hitByPlayerId`, increment `hits` and `combo`. Otherwise increment `misses`, reset `combo`.
- **OnTick** (single fire): call `onEnd`.
- **OnEnd**: placements by `hits` desc. Rewards: XP based on hits (e.g. `hits * 5`). Coop, so all participants finish the session even if one disconnected.
- **OnPlayerLeave**: returns `'kick'` (coop). Their score is final.

### 3. CardDuel — turn-based, competitive, hidden info

Exercises: hidden hand/deck via `minigamePrivateState`, turn timeouts, complex board state.

- **Meta**: `minPlayers=2`, `maxPlayers=2`, `competitive`, `turnBased`, `soloAllowed=false`.
- **Tables (public)**: `cardDuelBoard { sessionId(pk), activeSeat, turnNumber, turnDeadlineMicros }`, `cardDuelPlayer { id, sessionId, playerId(unique-per-session), seat, health, manaMax, manaCurrent }`, `cardDuelCardOnBoard { id, sessionId, ownerSeat, slot, cardDefId, health, attack }`.
- **Hidden tables (via `minigamePrivateState`)**: slot 0 = `CardDuelHand { cardDefIds: u64[] }`, slot 1 = `CardDuelDeck { cardDefIds: u64[] }`.
- **Static seed**: a `cardDefinition` table seeded at module init (~10 cards: id, name, cost, attack, health, effect-enum).
- **Init**: insert `cardDuelBoard` (turn 0), one `cardDuelPlayer` per member with `health=20, manaMax=1, manaCurrent=1`.
- **OnStart**: shuffle deck deterministically (seeded from session.id). Deal 4 cards to each player's hand. Pick starting seat by RNG. Schedule turn timeout (e.g. 60s).
- **Actions**:
  - `cdPlayCard({ handIndex, targetSlot })` — validate active seat, mana, slot empty. Move card from hand → board. Decrement mana.
  - `cdAttack({ attackerCardId, defenderCardId })` — validate active seat owns attacker, defender is enemy. Apply damage; if defender is null, target player health.
  - `cdEndTurn()` — flip activeSeat, increment turnNumber, increment manaMax (cap 10), refill manaCurrent, draw a card from deck → hand. Reschedule turn timeout.
  - `cdMulligan({ replaceIndices })` — only callable in lobby state, pre-start.
- **Turn timeout reducer**: if fires before player ends turn, auto `cdEndTurn` for them.
- **OnEnd**: when a player's `health <= 0`, declare opponent winner (placement 1), loser placement 2. Rewards: XP for both, bonus scrap for winner.
- **OnPlayerLeave (any reason)**: returns `'forfeit'` — surviving player wins.
- **v1 simplification**: same starter deck for both players. No deckbuilding/collection.

---

## Mutual Exclusion

Enforced by the unique constraint on `minigameMember.playerId`. `createMinigame` and `acceptMinigameInvite` throw on conflict. Idle activities (Scavenge, etc.) are unaffected — players can keep them running while in a minigame.

---

## Extensibility Checklist (adding a 4th game)

To add `Spades.ts`:
1. Add `'spades'` to the `MinigameKind` enum.
2. Create `spacetimedb/src/minigames/spades.ts` with: game-specific tables, action reducers, `spadesHandler: MinigameHandler` export.
3. Register: `handlers.spades = spadesHandler` in `registry.ts`.
4. Re-export tables/reducers from `index.ts` (one line per export).
5. Create `src/components/minigames/SpadesView.tsx`.
6. Register: `registry.spades = { kind: 'spades', displayName, description, View: SpadesView }` in client registry.
7. Run `spacetime publish` and `spacetime generate`.

**No edits to framework code.** No changes to other games. No changes to the modal, tab, or lobby.

---

## Verification (End-to-End)

1. **Build & publish**: `spacetime publish idle-survivor --module-path spacetimedb`.
2. **Generate bindings**: `spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb`.
3. **Solo CoinFlip**: log in, open Minigames tab, Play CoinFlip, ante deducted, pick heads, see reveal, see scrap balance update, modal closes on Done.
4. **Solo RhythmTap**: play through chart, score increments per tap, XP granted at end.
5. **2-player CoinFlip via party invite**: party host invites, party member accepts, both bet, reveal, both see results, pot split correctly.
6. **2-player CardDuel via party invite**: A invites B, both ready, A starts. Verify in dev tools that `myMinigamePrivateState` returns 4 rows on A's client and 4 rows on B's client (each player only sees own hand). Play through to a winner.
7. **Mutual exclusion**: while in a minigame, attempt `createMinigame` again → reject. Confirm Scavenge keeps ticking during minigame.
8. **Disconnect mid-CardDuel**: kill one client → survivor sees session end with them as winner. Verify all minigame tables for that session are cleaned up (member rows, private state, invites).
9. **Disconnect mid-RhythmTap (coop)**: kill one client → other player continues, session ends normally at chart-end with both scores recorded; disconnected player gets `active=false` and their final score.
10. **Idle timeout in CardDuel**: don't end turn for 60s → auto-end-turn fires, opponent's turn begins. After 3 missed turns or whatever rule, decide: leave at `pause` for v1, but document.
11. **Add a 4th game to verify extensibility**: spike a trivial "RPS" game (rock-paper-scissors) — should require zero edits to framework.ts, registry.ts (other than the entry), modal, lobby, or tab.

---

## Risks / Things to Validate Mid-Implementation

1. **`t.identity().unique()` for one-minigame-at-a-time**: confirm SpacetimeDB TS supports `.unique()` on identity columns and produces a clear error on conflict insert. If not, fall back to manually checking `.iter()` in `createMinigame`/`acceptMinigameInvite` (slower but works).
2. **Private view scope**: confirm `my_minigame_private_state` view filtering by `ctx.sender` works as expected — each subscriber sees only their rows. (CLAUDE.md indicates view-based filtering is the recommended approach over RLS.)
3. **BSATN encoding from server**: hidden state blobs are encoded server-side. Confirm there's a stable BSATN encode helper available; if not, use JSON for v1 and migrate to BSATN later (private view still hides it from other players).
4. **Determinism**: all RNG (CoinFlip reveal, deck shuffle, chart selection) seeds from `ctx.timestamp.microsSinceUnixEpoch ^ session.id`. No `Math.random()`, no `Date.now()`.
5. **Modal subscription race**: the local `minigameMember` row may arrive before the `minigameSession` row. Modal renders a loading state until both exist.
6. **Reward extension**: the `Reward.custom` variant takes a closure — confirm reducers can call closures. If not, use a tagged union of explicit reward kinds and add the new kind every time a game needs something new (still extensible, slightly more boilerplate).
7. **Friends not implemented yet**: the lobby's "Invite" UI invites party members for v1. When friends ship, add a second list to the picker — no framework changes needed.

---

## Files to Create/Modify

**Create:**
- `spacetimedb/src/minigames/framework.ts`
- `spacetimedb/src/minigames/registry.ts`
- `spacetimedb/src/minigames/coinFlip.ts`
- `spacetimedb/src/minigames/rhythmTap.ts`
- `spacetimedb/src/minigames/cardDuel.ts`
- `src/components/MinigamesTab.tsx`
- `src/components/minigames/MinigameModal.tsx`
- `src/components/minigames/MinigameLobby.tsx`
- `src/components/minigames/MinigameResults.tsx`
- `src/components/minigames/registry.ts`
- `src/components/minigames/CoinFlipView.tsx`
- `src/components/minigames/RhythmTapView.tsx`
- `src/components/minigames/CardDuelView.tsx`

**Modify:**
- `spacetimedb/src/index.ts` — re-export minigame tables/reducers/views into the schema; extend `clientDisconnected` to call `framework.handleDisconnect`.
- `src/components/TabBar.tsx` — add `'minigames'` tab.
- `src/Root.tsx` (or equivalent) — route `'minigames'` tab to `<MinigamesTab>` and mount `<MinigameModal>` at root.
