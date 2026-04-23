import { schema, table, t, SenderError } from 'spacetimedb/server';
import { deriveSalt, hashPassword } from './auth';

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const INVALID_CREDENTIALS = 'Invalid username or password';

const account = table(
  { name: 'account' },
  {
    username: t.string().primaryKey(),
    passwordHash: t.string(),
    salt: t.string(),
    createdAt: t.timestamp(),
  }
);

const usernameDirectory = table(
  { name: 'username_directory', public: true },
  {
    username: t.string().primaryKey(),
  }
);

const session = table(
  {
    name: 'session',
    indexes: [
      {
        accessor: 'session_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    identity: t.identity().primaryKey(),
    username: t.string(),
    createdAt: t.timestamp(),
  }
);

const playerState = table(
  { name: 'player_state' },
  {
    username: t.string().primaryKey(),
    scrap: t.u64(),
    scavengeLevel: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  account,
  usernameDirectory,
  session,
  playerState,
});
export default spacetimedb;

export const init = spacetimedb.init(_ctx => {});

export const onConnect = spacetimedb.clientConnected(_ctx => {});

export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

export const mySession = spacetimedb.view(
  { name: 'my_session', public: true },
  t.array(session.rowType),
  ctx => {
    const row = ctx.db.session.identity.find(ctx.sender);
    return row ? [row] : [];
  }
);

export const myPlayerState = spacetimedb.view(
  { name: 'my_player_state', public: true },
  t.array(playerState.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const ps = ctx.db.playerState.username.find(s.username);
    return ps ? [ps] : [];
  }
);

function scavengePower(level: number): bigint {
  return BigInt(level) + 1n;
}

function upgradeCost(level: number): bigint {
  let cost = 10n;
  for (let i = 0; i < level; i++) {
    cost = (cost * 3n) / 2n;
  }
  return cost;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateUsername(username: string): void {
  if (
    username.length < MIN_USERNAME_LENGTH ||
    username.length > MAX_USERNAME_LENGTH
  ) {
    throw new SenderError(
      `Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters`
    );
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    throw new SenderError(
      'Username may only contain lowercase letters, numbers, and underscores'
    );
  }
}

function validatePassword(password: string): void {
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new SenderError(
      `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`
    );
  }
}

export const signup = spacetimedb.reducer(
  { username: t.string(), password: t.string() },
  (ctx, { username, password }) => {
    const u = normalizeUsername(username);
    validateUsername(u);
    validatePassword(password);

    if (ctx.db.account.username.find(u) !== null) {
      throw new SenderError('Username already taken');
    }

    const salt = deriveSalt(
      ctx.sender.toHexString(),
      ctx.timestamp.microsSinceUnixEpoch,
      u
    );
    const passwordHash = hashPassword(password, salt);

    ctx.db.account.insert({
      username: u,
      passwordHash,
      salt,
      createdAt: ctx.timestamp,
    });
    ctx.db.usernameDirectory.insert({ username: u });
    ctx.db.playerState.insert({
      username: u,
      scrap: 0n,
      scavengeLevel: 0,
      updatedAt: ctx.timestamp,
    });

    if (ctx.db.session.identity.find(ctx.sender) !== null) {
      ctx.db.session.identity.delete(ctx.sender);
    }
    ctx.db.session.insert({
      identity: ctx.sender,
      username: u,
      createdAt: ctx.timestamp,
    });
  }
);

export const login = spacetimedb.reducer(
  { username: t.string(), password: t.string() },
  (ctx, { username, password }) => {
    const u = normalizeUsername(username);
    const acct = ctx.db.account.username.find(u);
    if (acct === null) {
      throw new SenderError(INVALID_CREDENTIALS);
    }
    const candidate = hashPassword(password, acct.salt);
    if (candidate !== acct.passwordHash) {
      throw new SenderError(INVALID_CREDENTIALS);
    }

    if (ctx.db.session.identity.find(ctx.sender) !== null) {
      ctx.db.session.identity.delete(ctx.sender);
    }
    ctx.db.session.insert({
      identity: ctx.sender,
      username: u,
      createdAt: ctx.timestamp,
    });
  }
);

export const logout = spacetimedb.reducer(ctx => {
  if (ctx.db.session.identity.find(ctx.sender) !== null) {
    ctx.db.session.identity.delete(ctx.sender);
  }
});

export const scavenge = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const ps = ctx.db.playerState.username.find(s.username);
  if (ps === null) throw new SenderError('Player state missing');

  const gain = scavengePower(ps.scavengeLevel);
  ctx.db.playerState.username.update({
    ...ps,
    scrap: ps.scrap + gain,
    updatedAt: ctx.timestamp,
  });
});

export const upgradeScavenge = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const ps = ctx.db.playerState.username.find(s.username);
  if (ps === null) throw new SenderError('Player state missing');

  const cost = upgradeCost(ps.scavengeLevel);
  if (ps.scrap < cost) {
    throw new SenderError('Not enough scrap');
  }
  ctx.db.playerState.username.update({
    ...ps,
    scrap: ps.scrap - cost,
    scavengeLevel: ps.scavengeLevel + 1,
    updatedAt: ctx.timestamp,
  });
});
