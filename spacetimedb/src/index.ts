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
    xp: t.u64(),
    playerLevel: t.u32(),
    skillPoints: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const skillDefinition = table(
  { name: 'skill_definition', public: true },
  {
    skillId: t.string().primaryKey(),
    name: t.string(),
    description: t.string(),
    maxLevel: t.u32(),
    prerequisiteSkillId: t.string(),
    prerequisiteLevel: t.u32(),
    positionX: t.i32(),
    positionY: t.i32(),
    sortOrder: t.u32(),
  }
);

const playerSkill = table(
  {
    name: 'player_skill',
    indexes: [
      {
        accessor: 'player_skill_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    skillId: t.string(),
    level: t.u32(),
  }
);

const group = table(
  {
    name: 'group',
    public: true,
    indexes: [
      {
        accessor: 'group_owner',
        algorithm: 'btree',
        columns: ['ownerUsername'],
      },
    ],
  },
  {
    groupId: t.u64().primaryKey().autoInc(),
    ownerUsername: t.string(),
    createdAt: t.timestamp(),
  }
);

const groupMember = table(
  {
    name: 'group_member',
    public: true,
    indexes: [
      {
        accessor: 'group_member_group_id',
        algorithm: 'btree',
        columns: ['groupId'],
      },
    ],
  },
  {
    username: t.string().primaryKey(),
    groupId: t.u64(),
    joinedAt: t.timestamp(),
  }
);

const groupInvitation = table(
  {
    name: 'group_invitation',
    public: true,
    indexes: [
      {
        accessor: 'group_invitation_to_username',
        algorithm: 'btree',
        columns: ['toUsername'],
      },
      {
        accessor: 'group_invitation_group_id',
        algorithm: 'btree',
        columns: ['groupId'],
      },
    ],
  },
  {
    invitationId: t.u64().primaryKey().autoInc(),
    groupId: t.u64(),
    fromUsername: t.string(),
    toUsername: t.string(),
    createdAt: t.timestamp(),
  }
);

const groupContributionEvent = table(
  {
    name: 'group_contribution_event',
    public: true,
    indexes: [
      {
        accessor: 'group_contribution_event_group_id',
        algorithm: 'btree',
        columns: ['groupId'],
      },
    ],
  },
  {
    eventId: t.u64().primaryKey().autoInc(),
    groupId: t.u64(),
    contributor: t.string(),
    recipient: t.string(),
    amount: t.u64(),
    createdAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  account,
  usernameDirectory,
  session,
  playerState,
  skillDefinition,
  playerSkill,
  group,
  groupMember,
  groupInvitation,
  groupContributionEvent,
});
export default spacetimedb;

interface SkillSeed {
  skillId: string;
  name: string;
  description: string;
  maxLevel: number;
  prerequisiteSkillId: string;
  prerequisiteLevel: number;
  positionX: number;
  positionY: number;
  sortOrder: number;
}

const SKILL_SEEDS: SkillSeed[] = [
  {
    skillId: 'scavenge_base',
    name: 'Scavenge Base Value',
    description: '+1 per level to the base value of Scavenge.',
    maxLevel: 20,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
  },
  {
    skillId: 'scavenge_percent',
    name: 'Scavenge Percentage Scaling',
    description: '+1% per level to Scavenge value.',
    maxLevel: 20,
    prerequisiteSkillId: 'scavenge_base',
    prerequisiteLevel: 1,
    positionX: 180,
    positionY: 0,
    sortOrder: 1,
  },
  {
    skillId: 'group_base',
    name: 'Group Base Scaling',
    description: '+1 per level to base scrap shared with group members.',
    maxLevel: 20,
    prerequisiteSkillId: 'scavenge_percent',
    prerequisiteLevel: 1,
    positionX: 360,
    positionY: 0,
    sortOrder: 2,
  },
  {
    skillId: 'group_percent',
    name: 'Group Percent Scaling',
    description: '+1% per level to scrap shared with group members.',
    maxLevel: 20,
    prerequisiteSkillId: 'group_base',
    prerequisiteLevel: 1,
    positionX: 540,
    positionY: 0,
    sortOrder: 3,
  },
];

export const init = spacetimedb.init(ctx => {
  for (const seed of SKILL_SEEDS) {
    if (ctx.db.skillDefinition.skillId.find(seed.skillId) === null) {
      ctx.db.skillDefinition.insert(seed);
    }
  }
});

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

export const myGroupMembership = spacetimedb.view(
  { name: 'my_group_membership', public: true },
  t.array(groupMember.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const m = ctx.db.groupMember.username.find(s.username);
    return m ? [m] : [];
  }
);

export const myGroup = spacetimedb.view(
  { name: 'my_group', public: true },
  t.array(group.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const m = ctx.db.groupMember.username.find(s.username);
    if (m === null) return [];
    const g = ctx.db.group.groupId.find(m.groupId);
    return g ? [g] : [];
  }
);

export const myGroupMembers = spacetimedb.view(
  { name: 'my_group_members', public: true },
  t.array(groupMember.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const m = ctx.db.groupMember.username.find(s.username);
    if (m === null) return [];
    return [...ctx.db.groupMember.group_member_group_id.filter(m.groupId)];
  }
);

export const myGroupMemberStates = spacetimedb.view(
  { name: 'my_group_member_states', public: true },
  t.array(playerState.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const m = ctx.db.groupMember.username.find(s.username);
    if (m === null) return [];
    return [...ctx.db.groupMember.group_member_group_id.filter(m.groupId)]
      .map(mem => ctx.db.playerState.username.find(mem.username))
      .filter((ps): ps is NonNullable<typeof ps> => ps !== null);
  }
);

export const mySkills = spacetimedb.view(
  { name: 'my_skills', public: true },
  t.array(playerSkill.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.playerSkill.player_skill_username.filter(s.username)];
  }
);

export const myGroupContributions = spacetimedb.view(
  { name: 'my_group_contributions', public: true },
  t.array(groupContributionEvent.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const m = ctx.db.groupMember.username.find(s.username);
    if (m === null) return [];
    return [
      ...ctx.db.groupContributionEvent.group_contribution_event_group_id.filter(
        m.groupId
      ),
    ];
  }
);

export const myInvitations = spacetimedb.view(
  { name: 'my_invitations', public: true },
  t.array(groupInvitation.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.groupInvitation.group_invitation_to_username.filter(s.username),
    ];
  }
);

function computeScavengeGain(baseLevel: number, percentLevel: number): bigint {
  const base = 1n + BigInt(baseLevel);
  const gain = (base * (100n + BigInt(percentLevel))) / 100n;
  return gain < 1n ? 1n : gain;
}

function computeGroupShare(
  gain: bigint,
  groupBaseLevel: number,
  groupPercentLevel: number
): bigint {
  const base = gain / 10n + BigInt(groupBaseLevel);
  const share = (base * (100n + BigInt(groupPercentLevel))) / 100n;
  return share < 1n ? 1n : share;
}

function xpToNextLevel(currentLevel: number): bigint {
  return BigInt(20 + currentLevel * 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function skillLevel(ctx: any, username: string, skillId: string): number {
  for (const row of ctx.db.playerSkill.player_skill_username.filter(username)) {
    if (row.skillId === skillId) return row.level;
  }
  return 0;
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
      xp: 0n,
      playerLevel: 0,
      skillPoints: 0,
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

const MAX_GROUP_SIZE = 5;
const CONTRIBUTION_TTL_MICROS = 10_000_000n;

export const scavenge = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const ps = ctx.db.playerState.username.find(s.username);
  if (ps === null) throw new SenderError('Player state missing');

  const scavengeBase = skillLevel(ctx, s.username, 'scavenge_base');
  const scavengePct = skillLevel(ctx, s.username, 'scavenge_percent');
  const gain = computeScavengeGain(scavengeBase, scavengePct);

  let newXp = ps.xp + 1n;
  let newLevel = ps.playerLevel;
  let newSkillPoints = ps.skillPoints;
  let threshold = xpToNextLevel(newLevel);
  while (newXp >= threshold) {
    newXp -= threshold;
    newLevel += 1;
    newSkillPoints += 1;
    threshold = xpToNextLevel(newLevel);
  }

  ctx.db.playerState.username.update({
    ...ps,
    scrap: ps.scrap + gain,
    xp: newXp,
    playerLevel: newLevel,
    skillPoints: newSkillPoints,
    updatedAt: ctx.timestamp,
  });

  const myMembership = ctx.db.groupMember.username.find(s.username);
  if (myMembership === null) return;

  const groupBase = skillLevel(ctx, s.username, 'group_base');
  const groupPct = skillLevel(ctx, s.username, 'group_percent');
  const share = computeGroupShare(gain, groupBase, groupPct);
  const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

  for (const old of ctx.db.groupContributionEvent.group_contribution_event_group_id.filter(
    myMembership.groupId
  )) {
    if (nowMicros - old.createdAt.microsSinceUnixEpoch > CONTRIBUTION_TTL_MICROS) {
      ctx.db.groupContributionEvent.eventId.delete(old.eventId);
    }
  }

  for (const member of ctx.db.groupMember.group_member_group_id.filter(
    myMembership.groupId
  )) {
    if (member.username === s.username) continue;
    const recipientPs = ctx.db.playerState.username.find(member.username);
    if (recipientPs === null) continue;
    ctx.db.playerState.username.update({
      ...recipientPs,
      scrap: recipientPs.scrap + share,
      updatedAt: ctx.timestamp,
    });
    ctx.db.groupContributionEvent.insert({
      eventId: 0n,
      groupId: myMembership.groupId,
      contributor: s.username,
      recipient: member.username,
      amount: share,
      createdAt: ctx.timestamp,
    });
  }
});

export const upgradeSkill = spacetimedb.reducer(
  { skillId: t.string() },
  (ctx, { skillId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) throw new SenderError('Player state missing');
    if (ps.skillPoints < 1) throw new SenderError('No skill points available');

    const def = ctx.db.skillDefinition.skillId.find(skillId);
    if (def === null) throw new SenderError('Unknown skill');

    if (def.prerequisiteSkillId !== '') {
      const prereqLevel = skillLevel(ctx, s.username, def.prerequisiteSkillId);
      if (prereqLevel < def.prerequisiteLevel) {
        throw new SenderError('Prerequisite not met');
      }
    }

    let existing = null;
    for (const row of ctx.db.playerSkill.player_skill_username.filter(
      s.username
    )) {
      if (row.skillId === skillId) {
        existing = row;
        break;
      }
    }

    const currentLevel = existing?.level ?? 0;
    if (currentLevel >= def.maxLevel) {
      throw new SenderError('Skill already at max level');
    }

    if (existing !== null) {
      ctx.db.playerSkill.id.update({
        ...existing,
        level: existing.level + 1,
      });
    } else {
      ctx.db.playerSkill.insert({
        id: 0n,
        username: s.username,
        skillId,
        level: 1,
      });
    }

    ctx.db.playerState.username.update({
      ...ps,
      skillPoints: ps.skillPoints - 1,
      updatedAt: ctx.timestamp,
    });
  }
);

export const createGroup = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  if (ctx.db.groupMember.username.find(s.username) !== null) {
    throw new SenderError('Already in a group');
  }
  const row = ctx.db.group.insert({
    groupId: 0n,
    ownerUsername: s.username,
    createdAt: ctx.timestamp,
  });
  ctx.db.groupMember.insert({
    username: s.username,
    groupId: row.groupId,
    joinedAt: ctx.timestamp,
  });
});

export const inviteToGroup = spacetimedb.reducer(
  { targetUsername: t.string() },
  (ctx, { targetUsername }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const target = normalizeUsername(targetUsername);
    if (target === s.username) {
      throw new SenderError("Can't invite yourself");
    }
    if (ctx.db.usernameDirectory.username.find(target) === null) {
      throw new SenderError('User not found');
    }
    const myMembership = ctx.db.groupMember.username.find(s.username);
    if (myMembership === null) {
      throw new SenderError('Not in a group');
    }
    if (ctx.db.groupMember.username.find(target) !== null) {
      throw new SenderError('User is already in a group');
    }
    for (const inv of ctx.db.groupInvitation.group_invitation_to_username.filter(
      target
    )) {
      if (inv.groupId === myMembership.groupId) {
        throw new SenderError('Already invited');
      }
    }
    ctx.db.groupInvitation.insert({
      invitationId: 0n,
      groupId: myMembership.groupId,
      fromUsername: s.username,
      toUsername: target,
      createdAt: ctx.timestamp,
    });
  }
);

export const acceptInvitation = spacetimedb.reducer(
  { invitationId: t.u64() },
  (ctx, { invitationId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const invite = ctx.db.groupInvitation.invitationId.find(invitationId);
    if (invite === null || invite.toUsername !== s.username) {
      throw new SenderError('Invitation not found');
    }
    if (ctx.db.groupMember.username.find(s.username) !== null) {
      throw new SenderError('Already in a group');
    }
    const g = ctx.db.group.groupId.find(invite.groupId);
    if (g === null) {
      ctx.db.groupInvitation.invitationId.delete(invitationId);
      throw new SenderError('Group no longer exists');
    }
    const members = [
      ...ctx.db.groupMember.group_member_group_id.filter(invite.groupId),
    ];
    if (members.length >= MAX_GROUP_SIZE) {
      throw new SenderError('Group is full');
    }
    ctx.db.groupMember.insert({
      username: s.username,
      groupId: invite.groupId,
      joinedAt: ctx.timestamp,
    });
    ctx.db.groupInvitation.invitationId.delete(invitationId);
    for (const other of ctx.db.groupInvitation.group_invitation_to_username.filter(
      s.username
    )) {
      ctx.db.groupInvitation.invitationId.delete(other.invitationId);
    }
  }
);

export const declineInvitation = spacetimedb.reducer(
  { invitationId: t.u64() },
  (ctx, { invitationId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const invite = ctx.db.groupInvitation.invitationId.find(invitationId);
    if (invite === null || invite.toUsername !== s.username) {
      throw new SenderError('Invitation not found');
    }
    ctx.db.groupInvitation.invitationId.delete(invitationId);
  }
);

export const leaveGroup = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const myMembership = ctx.db.groupMember.username.find(s.username);
  if (myMembership === null) throw new SenderError('Not in a group');
  const groupId = myMembership.groupId;

  ctx.db.groupMember.username.delete(s.username);

  const remaining = [
    ...ctx.db.groupMember.group_member_group_id.filter(groupId),
  ];

  if (remaining.length === 0) {
    for (const inv of ctx.db.groupInvitation.group_invitation_group_id.filter(
      groupId
    )) {
      ctx.db.groupInvitation.invitationId.delete(inv.invitationId);
    }
    for (const ev of ctx.db.groupContributionEvent.group_contribution_event_group_id.filter(
      groupId
    )) {
      ctx.db.groupContributionEvent.eventId.delete(ev.eventId);
    }
    ctx.db.group.groupId.delete(groupId);
    return;
  }

  const g = ctx.db.group.groupId.find(groupId);
  if (g !== null && g.ownerUsername === s.username) {
    let oldest = remaining[0];
    for (const m of remaining) {
      if (
        m.joinedAt.microsSinceUnixEpoch < oldest.joinedAt.microsSinceUnixEpoch
      ) {
        oldest = m;
      }
    }
    ctx.db.group.groupId.update({ ...g, ownerUsername: oldest.username });
  }
});
