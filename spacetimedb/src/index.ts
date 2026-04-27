import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { deriveSalt, hashPassword } from './auth';
import spacetimedb from './schema';
import {
  scheduledReducerRefs,
  account,
  usernameDirectory,
  session,
  playerState,
  skillDefinition,
  skillPrerequisite,
  playerSkill,
  locationDefinition,
  activityDefinition,
  activityCost,
  resourceDefinition,
  playerResource,
  playerActivity,
  structureDefinition,
  structureUpgradeDefinition,
  playerStructure,
  playerStructureUpgrade,
  automationTick,
  automationEvent,
  group,
  groupMember,
  groupInvitation,
  groupContributionEvent,
  chatMessage,
} from './tables_core';
import { handleDisconnect as handleMinigameDisconnect } from './minigames/framework';
import './minigames/coinFlip';
import './minigames/rhythmTap';
import { seedCardDefinitions } from './minigames/cardDuel';
import './minigames/cardDuel';

export {
  createMinigame,
  inviteToMinigame,
  acceptMinigameInvite,
  declineMinigameInvite,
  setMinigameReady,
  startMinigame,
  leaveMinigame,
  cancelMinigame,
  runMinigameTick,
  myMinigameMember,
  myMinigameInvites,
  myMinigamePrivateState,
} from './minigames/framework';
export { cfPick, cfReveal } from './minigames/coinFlip';
export { rtTap } from './minigames/rhythmTap';
export {
  cdPlayCard,
  cdAttack,
  cdEndTurn,
  cdMulligan,
} from './minigames/cardDuel';

export default spacetimedb;

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const INVALID_CREDENTIALS = 'Invalid username or password';


interface SkillSeed {
  skillId: string;
  name: string;
  description: string;
  maxLevel: number;
  prerequisiteSkillId: string;
  prerequisiteLevel: number;
  prerequisitePlayerLevel: number;
  costSkillPoints: number;
  positionX: number;
  positionY: number;
  sortOrder: number;
}

const SKILL_SEEDS: SkillSeed[] = [
  {
    skillId: 'scavenge_multiplier',
    name: 'Scavenge Multiplier',
    description: '+25% per level to Scavenge yield.',
    maxLevel: 4,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
  },
  {
    skillId: 'unlock_shelter',
    name: 'Unlock Shelter',
    description: 'Unlocks the Build Shelter activity in the Wastes.',
    maxLevel: 1,
    prerequisiteSkillId: 'scavenge_multiplier',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 0,
    sortOrder: 1,
  },
  {
    skillId: 'unlock_parts',
    name: 'Unlock Parts',
    description: 'Unlocks the Parts resource and Scavenge for Parts activity.',
    maxLevel: 1,
    prerequisiteSkillId: 'scavenge_multiplier',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 160,
    sortOrder: 2,
  },
  {
    skillId: 'parts_multiplier',
    name: 'Parts Multiplier',
    description: '+25% per level to Scavenge for Parts yield.',
    maxLevel: 4,
    prerequisiteSkillId: 'unlock_parts',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 160,
    sortOrder: 3,
  },
  {
    skillId: 'unlock_metal',
    name: 'Unlock Metal',
    description: 'Unlocks the Metal resource and Scavenge for Metal activity.',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_parts',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 320,
    sortOrder: 4,
  },
  {
    skillId: 'metal_multiplier',
    name: 'Metal Multiplier',
    description: '+25% per level to Scavenge for Metal yield.',
    maxLevel: 4,
    prerequisiteSkillId: 'unlock_metal',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 320,
    sortOrder: 5,
  },
  {
    skillId: 'unlock_fabric',
    name: 'Unlock Fabric',
    description: 'Unlocks the Fabric resource and Scavenge for Fabric activity.',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_metal',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 480,
    sortOrder: 6,
  },
  {
    skillId: 'fabric_multiplier',
    name: 'Fabric Multiplier',
    description: '+25% per level to Scavenge for Fabric yield.',
    maxLevel: 4,
    prerequisiteSkillId: 'unlock_fabric',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 480,
    sortOrder: 7,
  },
  {
    skillId: 'unlock_food',
    name: 'Unlock Food',
    description: 'Unlocks the Food resource and Scavenge for Food activity.',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_fabric',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 640,
    sortOrder: 8,
  },
  {
    skillId: 'food_multiplier',
    name: 'Food Multiplier',
    description: '+25% per level to Scavenge for Food yield.',
    maxLevel: 4,
    prerequisiteSkillId: 'unlock_food',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 640,
    sortOrder: 9,
  },
  {
    skillId: 'unlock_medicine',
    name: 'Unlock Meds',
    description: 'Unlocks the Meds resource and Scavenge for Meds activity.',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_food',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 800,
    sortOrder: 10,
  },
  {
    skillId: 'medicine_multiplier',
    name: 'Meds Multiplier',
    description: '+25% per level to Scavenge for Meds yield.',
    maxLevel: 4,
    prerequisiteSkillId: 'unlock_medicine',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 800,
    sortOrder: 11,
  },
  {
    skillId: 'unlock_classes',
    name: 'Unlock Classes',
    description:
      'Completes the tutorial tree. Additional class system placeholder.',
    maxLevel: 1,
    prerequisiteSkillId: 'medicine_multiplier',
    prerequisiteLevel: 4,
    prerequisitePlayerLevel: 30,
    costSkillPoints: 0,
    positionX: 500,
    positionY: 400,
    sortOrder: 12,
  },
];

interface SkillPrereqSeed {
  skillId: string;
  requiredSkillId: string;
  requiredLevel: number;
}

const SKILL_PREREQ_SEEDS: SkillPrereqSeed[] = [
  { skillId: 'unlock_classes', requiredSkillId: 'unlock_shelter', requiredLevel: 1 },
  { skillId: 'unlock_classes', requiredSkillId: 'parts_multiplier', requiredLevel: 4 },
  { skillId: 'unlock_classes', requiredSkillId: 'metal_multiplier', requiredLevel: 4 },
  { skillId: 'unlock_classes', requiredSkillId: 'fabric_multiplier', requiredLevel: 4 },
  { skillId: 'unlock_classes', requiredSkillId: 'food_multiplier', requiredLevel: 4 },
];

interface LocationSeed {
  locationKey: string;
  name: string;
  icon: string;
  description: string;
  sortOrder: number;
  prerequisiteActivityId: string;
  prerequisiteActivityUses: number;
}

const LOCATION_SEEDS: LocationSeed[] = [
  {
    locationKey: 'the_wastes',
    name: 'The Wastes',
    icon: '🏜',
    description:
      'Scorched flats that stretch past sight. Scrap lives here for anyone with the patience to dig.',
    sortOrder: 0,
    prerequisiteActivityId: '',
    prerequisiteActivityUses: 0,
  },
];

interface ActivitySeed {
  activityId: string;
  name: string;
  description: string;
  icon: string;
  locationKey: string;
  kind: string;
  maxUses: number;
  prerequisiteSkillId: string;
  prerequisiteSkillLevel: number;
  progressTarget: bigint;
  maxPerClick: bigint;
  yieldResourceId: string;
  skillChainPrefix: string;
  sortOrder: number;
}

const ACTIVITY_SEEDS: ActivitySeed[] = [
  {
    activityId: 'scavenge',
    name: 'Scavenge',
    description: 'Dig scrap out of the Wastes. Infinite uses.',
    icon: '⛏',
    locationKey: 'the_wastes',
    kind: 'scavenge',
    maxUses: -1,
    prerequisiteSkillId: '',
    prerequisiteSkillLevel: 0,
    progressTarget: 0n,
    maxPerClick: 0n,
    yieldResourceId: 'scrap',
    skillChainPrefix: 'scavenge',
    sortOrder: 0,
  },
  {
    activityId: 'build_shelter',
    name: 'Build Shelter',
    description: 'Pour scrap into the build site until the shelter stands.',
    icon: '🔨',
    locationKey: 'the_wastes',
    kind: 'build_progress',
    maxUses: 1,
    prerequisiteSkillId: 'unlock_shelter',
    prerequisiteSkillLevel: 1,
    progressTarget: 1000n,
    maxPerClick: 100n,
    yieldResourceId: '',
    skillChainPrefix: '',
    sortOrder: 1,
  },
  {
    activityId: 'build_workbench',
    name: 'Build Workbench',
    description: 'Pour scrap into the workbench frame until it stands.',
    icon: '🧰',
    locationKey: 'the_shelter',
    kind: 'build_progress',
    maxUses: 1,
    prerequisiteSkillId: '',
    prerequisiteSkillLevel: 0,
    progressTarget: 1000n,
    maxPerClick: 100n,
    yieldResourceId: '',
    skillChainPrefix: '',
    sortOrder: 0,
  },
  {
    activityId: 'scavenge_for_parts',
    name: 'Scavenge for Parts',
    description: 'Break scrap down into parts.',
    icon: '🔩',
    locationKey: 'the_wastes',
    kind: 'scavenge',
    maxUses: -1,
    prerequisiteSkillId: 'unlock_parts',
    prerequisiteSkillLevel: 1,
    progressTarget: 0n,
    maxPerClick: 0n,
    yieldResourceId: 'parts',
    skillChainPrefix: 'parts',
    sortOrder: 2,
  },
  {
    activityId: 'scavenge_for_metal',
    name: 'Scavenge for Metal',
    description: 'Refine parts into usable metal.',
    icon: '🪙',
    locationKey: 'the_wastes',
    kind: 'scavenge',
    maxUses: -1,
    prerequisiteSkillId: 'unlock_metal',
    prerequisiteSkillLevel: 1,
    progressTarget: 0n,
    maxPerClick: 0n,
    yieldResourceId: 'metal',
    skillChainPrefix: 'metal',
    sortOrder: 3,
  },
  {
    activityId: 'scavenge_for_fabric',
    name: 'Scavenge for Fabric',
    description: 'Weave salvaged fibers into fabric.',
    icon: '🧵',
    locationKey: 'the_wastes',
    kind: 'scavenge',
    maxUses: -1,
    prerequisiteSkillId: 'unlock_fabric',
    prerequisiteSkillLevel: 1,
    progressTarget: 0n,
    maxPerClick: 0n,
    yieldResourceId: 'fabric',
    skillChainPrefix: 'fabric',
    sortOrder: 4,
  },
  {
    activityId: 'scavenge_for_food',
    name: 'Scavenge for Food',
    description: 'Scrounge and preserve edible rations.',
    icon: '🍖',
    locationKey: 'the_wastes',
    kind: 'scavenge',
    maxUses: -1,
    prerequisiteSkillId: 'unlock_food',
    prerequisiteSkillLevel: 1,
    progressTarget: 0n,
    maxPerClick: 0n,
    yieldResourceId: 'food',
    skillChainPrefix: 'food',
    sortOrder: 5,
  },
  {
    activityId: 'scavenge_for_medicine',
    name: 'Scavenge for Medicine',
    description: 'Synthesize the last of the old-world medicine.',
    icon: '💊',
    locationKey: 'the_wastes',
    kind: 'scavenge',
    maxUses: -1,
    prerequisiteSkillId: 'unlock_medicine',
    prerequisiteSkillLevel: 1,
    progressTarget: 0n,
    maxPerClick: 0n,
    yieldResourceId: 'medicine',
    skillChainPrefix: 'medicine',
    sortOrder: 6,
  },
];

interface ResourceSeed {
  resourceId: string;
  name: string;
  icon: string;
  unlockSkillId: string;
  unlockSkillLevel: number;
  sortOrder: number;
}

const RESOURCE_SEEDS: ResourceSeed[] = [
  {
    resourceId: 'scrap',
    name: 'Scrap',
    icon: '⚙️',
    unlockSkillId: '',
    unlockSkillLevel: 0,
    sortOrder: 0,
  },
  {
    resourceId: 'parts',
    name: 'Parts',
    icon: '🔩',
    unlockSkillId: 'unlock_parts',
    unlockSkillLevel: 1,
    sortOrder: 1,
  },
  {
    resourceId: 'metal',
    name: 'Metal',
    icon: '🪙',
    unlockSkillId: 'unlock_metal',
    unlockSkillLevel: 1,
    sortOrder: 2,
  },
  {
    resourceId: 'fabric',
    name: 'Fabric',
    icon: '🧵',
    unlockSkillId: 'unlock_fabric',
    unlockSkillLevel: 1,
    sortOrder: 3,
  },
  {
    resourceId: 'food',
    name: 'Food',
    icon: '🍖',
    unlockSkillId: 'unlock_food',
    unlockSkillLevel: 1,
    sortOrder: 4,
  },
  {
    resourceId: 'medicine',
    name: 'Medicine',
    icon: '💊',
    unlockSkillId: 'unlock_medicine',
    unlockSkillLevel: 1,
    sortOrder: 5,
  },
];

interface ActivityCostSeed {
  activityId: string;
  resourceId: string;
  amount: bigint;
}

const ACTIVITY_COST_SEEDS: ActivityCostSeed[] = [];

interface StructureSeed {
  structureId: string;
  name: string;
  description: string;
  icon: string;
  locationKey: string;
  buildActivityId: string;
  sortOrder: number;
}

const STRUCTURE_SEEDS: StructureSeed[] = [
  {
    structureId: 'workbench',
    name: 'Workbench',
    description:
      'A sturdy bench with one automation slot. Queue an activity to run it on a timer.',
    icon: '🧰',
    locationKey: 'the_shelter',
    buildActivityId: 'build_workbench',
    sortOrder: 0,
  },
];

interface StructureUpgradeSeed {
  upgradeId: string;
  structureId: string;
  name: string;
  description: string;
  kind: string;
  targetActivityId: string;
  maxLevel: number;
  costBase: bigint;
  costGrowthPer100: number;
  yieldPerLevelPer100: number;
  sortOrder: number;
}

const STRUCTURE_UPGRADE_SEEDS: StructureUpgradeSeed[] = [
  {
    upgradeId: 'workbench_apply_scavenge',
    structureId: 'workbench',
    name: 'Apply Scavenge',
    description:
      'Unlocks Scavenge so it can be placed in the workbench automation slot.',
    kind: 'unlock_activity',
    targetActivityId: 'scavenge',
    maxLevel: 1,
    costBase: 500n,
    costGrowthPer100: 100,
    yieldPerLevelPer100: 0,
    sortOrder: 0,
  },
  {
    upgradeId: 'workbench_efficiency',
    structureId: 'workbench',
    name: 'Activity Efficiency',
    description:
      '+20% yield per level for the activity currently slotted in this structure.',
    kind: 'efficiency',
    targetActivityId: '',
    maxLevel: 20,
    costBase: 50n,
    costGrowthPer100: 150,
    yieldPerLevelPer100: 20,
    sortOrder: 1,
  },
  ...applyUpgradeSeeds(),
];

function applyUpgradeSeeds(): StructureUpgradeSeed[] {
  const activities: { key: string; label: string; cost: bigint }[] = [
    { key: 'parts', label: 'Scavenge for Parts', cost: 500n },
    { key: 'metal', label: 'Scavenge for Metal', cost: 2000n },
    { key: 'fabric', label: 'Scavenge for Fabric', cost: 8000n },
    { key: 'food', label: 'Scavenge for Food', cost: 32000n },
    { key: 'medicine', label: 'Scavenge for Medicine', cost: 128000n },
  ];
  return activities.map((a, i) => ({
    upgradeId: `workbench_apply_${a.key}`,
    structureId: 'workbench',
    name: `Apply ${a.label}`,
    description: `Unlocks ${a.label} so it can be placed in the workbench automation slot.`,
    kind: 'unlock_activity',
    targetActivityId: `scavenge_for_${a.key}`,
    maxLevel: 1,
    costBase: a.cost,
    costGrowthPer100: 100,
    yieldPerLevelPer100: 0,
    sortOrder: 2 + i,
  }));
}

export const init = spacetimedb.init(ctx => {
  for (const seed of SKILL_SEEDS) {
    if (ctx.db.skillDefinition.skillId.find(seed.skillId) === null) {
      ctx.db.skillDefinition.insert(seed);
    }
  }
  for (const seed of SKILL_PREREQ_SEEDS) {
    let exists = false;
    for (const row of ctx.db.skillPrerequisite.skill_prerequisite_skill.filter(
      seed.skillId
    )) {
      if (row.requiredSkillId === seed.requiredSkillId) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      ctx.db.skillPrerequisite.insert({ id: 0n, ...seed });
    }
  }
  for (const seed of LOCATION_SEEDS) {
    if (ctx.db.locationDefinition.locationKey.find(seed.locationKey) === null) {
      ctx.db.locationDefinition.insert(seed);
    }
  }
  for (const seed of ACTIVITY_SEEDS) {
    if (ctx.db.activityDefinition.activityId.find(seed.activityId) === null) {
      ctx.db.activityDefinition.insert(seed);
    }
  }
  for (const seed of STRUCTURE_SEEDS) {
    if (
      ctx.db.structureDefinition.structureId.find(seed.structureId) === null
    ) {
      ctx.db.structureDefinition.insert(seed);
    }
  }
  for (const seed of STRUCTURE_UPGRADE_SEEDS) {
    if (
      ctx.db.structureUpgradeDefinition.upgradeId.find(seed.upgradeId) === null
    ) {
      ctx.db.structureUpgradeDefinition.insert(seed);
    }
  }
  for (const seed of RESOURCE_SEEDS) {
    if (ctx.db.resourceDefinition.resourceId.find(seed.resourceId) === null) {
      ctx.db.resourceDefinition.insert(seed);
    }
  }
  for (const seed of ACTIVITY_COST_SEEDS) {
    let exists = false;
    for (const row of ctx.db.activityCost.activity_cost_activity.filter(
      seed.activityId
    )) {
      if (row.resourceId === seed.resourceId) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      ctx.db.activityCost.insert({ id: 0n, ...seed });
    }
  }
  seedCardDefinitions(ctx);
});

export const onConnect = spacetimedb.clientConnected(_ctx => {});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  handleMinigameDisconnect(ctx);
});

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

export const myActivityState = spacetimedb.view(
  { name: 'my_activity_state', public: true },
  t.array(playerActivity.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.playerActivity.player_activity_username.filter(s.username),
    ];
  }
);

export const myVisibleActivities = spacetimedb.view(
  { name: 'my_visible_activities', public: true },
  t.array(activityDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) return [];
    return [
      ...ctx.db.activityDefinition.activity_definition_location.filter(
        ps.location
      ),
    ].filter(def => isActivityVisible(ctx, s.username, def, ps.location));
  }
);

export const myShelterActivities = spacetimedb.view(
  { name: 'my_shelter_activities', public: true },
  t.array(activityDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.activityDefinition.activity_definition_location.filter(
        'the_shelter'
      ),
    ].filter(def => {
      if (def.prerequisiteSkillId !== '') {
        const lvl = skillLevel(ctx, s.username, def.prerequisiteSkillId);
        if (lvl < def.prerequisiteSkillLevel) return false;
      }
      if (def.maxUses !== -1) {
        const pa = findPlayerActivity(ctx, s.username, def.activityId);
        const used = pa?.timesUsed ?? 0;
        if (used >= def.maxUses) return false;
      }
      return true;
    });
  }
);

export const myResources = spacetimedb.view(
  { name: 'my_resources', public: true },
  t.array(playerResource.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.playerResource.player_resource_username.filter(s.username),
    ];
  }
);

export const myAutomationEvents = spacetimedb.view(
  { name: 'my_automation_events', public: true },
  t.array(automationEvent.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.automationEvent.automation_event_username.filter(s.username),
    ];
  }
);

export const myStructures = spacetimedb.view(
  { name: 'my_structures', public: true },
  t.array(playerStructure.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.playerStructure.player_structure_username.filter(s.username),
    ];
  }
);

export const myStructureUpgrades = spacetimedb.view(
  { name: 'my_structure_upgrades', public: true },
  t.array(playerStructureUpgrade.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.playerStructureUpgrade.player_structure_upgrade_username.filter(
        s.username
      ),
    ];
  }
);

export const myTravelableLocations = spacetimedb.view(
  { name: 'my_travelable_locations', public: true },
  t.array(locationDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.locationDefinition.iter()].filter(loc =>
      isLocationTravelable(ctx, s.username, loc)
    );
  }
);

export const myGlobalChat = spacetimedb.view(
  { name: 'my_global_chat', public: true },
  t.array(chatMessage.rowType),
  ctx => {
    return [
      ...ctx.db.chatMessage.chat_message_channel_type.filter('global'),
    ];
  }
);

export const myPartyChat = spacetimedb.view(
  { name: 'my_party_chat', public: true },
  t.array(chatMessage.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const m = ctx.db.groupMember.username.find(s.username);
    if (m === null) return [];
    return [
      ...ctx.db.chatMessage.chat_message_channel_key.filter(
        m.groupId.toString()
      ),
    ].filter(msg => msg.channelType === 'party');
  }
);

export const myWhispers = spacetimedb.view(
  { name: 'my_whispers', public: true },
  t.array(chatMessage.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const needle = s.username;
    return [
      ...ctx.db.chatMessage.chat_message_channel_type.filter('whisper'),
    ].filter(msg => {
      const parts = msg.channelKey.split(':');
      return parts[0] === needle || parts[1] === needle;
    });
  }
);

function computeScavengeGain(
  baseBonus: number,
  multiplierLevel: number
): bigint {
  const base = 1n + BigInt(baseBonus);
  const gain = (base * (100n + BigInt(multiplierLevel * 25))) / 100n;
  return gain < 1n ? 1n : gain;
}

function upgradeCost(level: number): bigint {
  let cost = 10n;
  for (let i = 0; i < level; i++) {
    cost = (cost * 3n) / 2n;
  }
  return cost;
}

function computeGroupShare(gain: bigint): bigint {
  const share = gain / 10n;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPlayerResource(ctx: any, username: string, resourceId: string) {
  for (const row of ctx.db.playerResource.player_resource_username.filter(
    username
  )) {
    if (row.resourceId === resourceId) return row;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getResource(ctx: any, username: string, resourceId: string): bigint {
  if (resourceId === 'scrap') {
    const ps = ctx.db.playerState.username.find(username);
    return ps?.scrap ?? 0n;
  }
  const row = findPlayerResource(ctx, username, resourceId);
  return row?.amount ?? 0n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addResource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  resourceId: string,
  delta: bigint
): void {
  if (delta === 0n) return;
  if (resourceId === 'scrap') {
    const ps = ctx.db.playerState.username.find(username);
    if (ps === null) return;
    let next = ps.scrap + delta;
    if (next < 0n) next = 0n;
    ctx.db.playerState.username.update({
      ...ps,
      scrap: next,
      updatedAt: ctx.timestamp,
    });
    return;
  }
  const existing = findPlayerResource(ctx, username, resourceId);
  if (existing !== null) {
    let next = existing.amount + delta;
    if (next < 0n) next = 0n;
    ctx.db.playerResource.id.update({ ...existing, amount: next });
  } else {
    const initial = delta < 0n ? 0n : delta;
    ctx.db.playerResource.insert({
      id: 0n,
      username,
      resourceId,
      amount: initial,
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activityCostsAffordable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  activityId: string
): boolean {
  for (const cost of ctx.db.activityCost.activity_cost_activity.filter(
    activityId
  )) {
    if (getResource(ctx, username, cost.resourceId) < cost.amount) return false;
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debitActivityCosts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  activityId: string
): void {
  for (const cost of ctx.db.activityCost.activity_cost_activity.filter(
    activityId
  )) {
    addResource(ctx, username, cost.resourceId, -(cost.amount as bigint));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPlayerActivity(ctx: any, username: string, activityId: string) {
  for (const row of ctx.db.playerActivity.player_activity_username.filter(
    username
  )) {
    if (row.activityId === activityId) return row;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOrCreatePlayerActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  activityId: string
) {
  const existing = findPlayerActivity(ctx, username, activityId);
  if (existing !== null) return existing;
  return ctx.db.playerActivity.insert({
    id: 0n,
    username,
    activityId,
    timesUsed: 0,
    progress: 0n,
    level: 0,
  });
}

function canonicalWhisperKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isActivityVisible(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: any,
  playerLocation: string
): boolean {
  if (def.locationKey !== playerLocation) return false;
  if (def.prerequisiteSkillId !== '') {
    const lvl = skillLevel(ctx, username, def.prerequisiteSkillId);
    if (lvl < def.prerequisiteSkillLevel) return false;
  }
  if (def.maxUses !== -1) {
    const pa = findPlayerActivity(ctx, username, def.activityId);
    const used = pa?.timesUsed ?? 0;
    if (used >= def.maxUses) return false;
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLocationTravelable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loc: any
): boolean {
  if (loc.prerequisiteActivityId === '') return true;
  const pa = findPlayerActivity(ctx, username, loc.prerequisiteActivityId);
  const used = pa?.timesUsed ?? 0;
  return used >= loc.prerequisiteActivityUses;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPlayerStructure(ctx: any, username: string, structureId: string) {
  for (const row of ctx.db.playerStructure.player_structure_username.filter(
    username
  )) {
    if (row.structureId === structureId) return row;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function structureUpgradeLevel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  upgradeId: string
): number {
  for (const row of ctx.db.playerStructureUpgrade.player_structure_upgrade_username.filter(
    username
  )) {
    if (row.upgradeId === upgradeId) return row.level;
  }
  return 0;
}

function structureUpgradeCost(
  costBase: bigint,
  growthPer100: number,
  currentLevel: number
): bigint {
  let cost = costBase;
  const growth = BigInt(growthPer100);
  for (let i = 0; i < currentLevel; i++) {
    cost = (cost * growth) / 100n;
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
      xp: 0n,
      playerLevel: 0,
      skillPoints: 0,
      location: 'the_wastes',
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

interface ScavengeResult {
  gain: bigint;
  yieldResourceId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function performScavengeActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  activityId: string,
  yieldPer100: number,
  requireLocation: boolean
): ScavengeResult {
  const ps = ctx.db.playerState.username.find(username);
  if (ps === null) return { gain: 0n, yieldResourceId: '' };
  const def = ctx.db.activityDefinition.activityId.find(activityId);
  if (def === null || def.kind !== 'scavenge') {
    return { gain: 0n, yieldResourceId: '' };
  }
  if (requireLocation && !isActivityVisible(ctx, username, def, ps.location)) {
    return { gain: 0n, yieldResourceId: '' };
  }
  if (!activityCostsAffordable(ctx, username, activityId)) {
    return { gain: 0n, yieldResourceId: '' };
  }

  debitActivityCosts(ctx, username, activityId);

  const activityRow = getOrCreatePlayerActivity(ctx, username, activityId);
  ctx.db.playerActivity.id.update({
    ...activityRow,
    timesUsed: activityRow.timesUsed + 1,
  });

  const prefix = def.skillChainPrefix || 'scavenge';
  const multiplierLevel = skillLevel(ctx, username, `${prefix}_multiplier`);
  let gain = computeScavengeGain(activityRow.level, multiplierLevel);
  if (yieldPer100 !== 100) {
    gain = (gain * BigInt(yieldPer100)) / 100n;
    if (gain < 1n) gain = 1n;
  }

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
    xp: newXp,
    playerLevel: newLevel,
    skillPoints: newSkillPoints,
    updatedAt: ctx.timestamp,
  });

  addResource(ctx, username, def.yieldResourceId, gain);

  const myMembership = ctx.db.groupMember.username.find(username);
  if (myMembership !== null) {
    const share = computeGroupShare(gain);
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

    for (const old of ctx.db.groupContributionEvent.group_contribution_event_group_id.filter(
      myMembership.groupId
    )) {
      if (
        nowMicros - old.createdAt.microsSinceUnixEpoch >
        CONTRIBUTION_TTL_MICROS
      ) {
        ctx.db.groupContributionEvent.eventId.delete(old.eventId);
      }
    }

    for (const member of ctx.db.groupMember.group_member_group_id.filter(
      myMembership.groupId
    )) {
      if (member.username === username) continue;
      addResource(ctx, member.username, def.yieldResourceId, share);
      ctx.db.groupContributionEvent.insert({
        eventId: 0n,
        groupId: myMembership.groupId,
        contributor: username,
        recipient: member.username,
        resourceId: def.yieldResourceId,
        amount: share,
        createdAt: ctx.timestamp,
      });
    }
  }

  return { gain, yieldResourceId: def.yieldResourceId };
}

export const scavengeActivity = spacetimedb.reducer(
  { activityId: t.string() },
  (ctx, { activityId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const def = ctx.db.activityDefinition.activityId.find(activityId);
    if (def === null || def.kind !== 'scavenge') {
      throw new SenderError('Unknown activity');
    }
    const ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) throw new SenderError('Player state missing');
    if (!isActivityVisible(ctx, s.username, def, ps.location)) {
      throw new SenderError('Activity is not available here');
    }
    if (!activityCostsAffordable(ctx, s.username, activityId)) {
      throw new SenderError('Cannot afford costs');
    }
    performScavengeActivity(ctx, s.username, activityId, 100, true);
  }
);

export const advanceBuild = spacetimedb.reducer(
  { activityId: t.string(), amount: t.u64() },
  (ctx, { activityId, amount }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) throw new SenderError('Player state missing');
    const def = ctx.db.activityDefinition.activityId.find(activityId);
    if (def === null) throw new SenderError('Activity not defined');
    if (def.kind !== 'build_progress') {
      throw new SenderError('Not a build activity');
    }
    // Build activities check skill prereq + uses but aren't tied to the
    // player's current travel location (shelter-scoped builds run regardless).
    const effectiveLocation =
      def.locationKey === 'the_shelter' ? 'the_shelter' : ps.location;
    if (!isActivityVisible(ctx, s.username, def, effectiveLocation)) {
      throw new SenderError('Activity is not available');
    }

    const activityRow = getOrCreatePlayerActivity(ctx, s.username, activityId);
    const remaining = def.progressTarget - activityRow.progress;
    let cap = amount;
    if (cap > def.maxPerClick) cap = def.maxPerClick;
    if (cap > remaining) cap = remaining;
    if (cap > ps.scrap) cap = ps.scrap;
    if (cap <= 0n) throw new SenderError('Not enough scrap to contribute');

    const newProgress = activityRow.progress + cap;
    const complete = newProgress >= def.progressTarget;

    ctx.db.playerActivity.id.update({
      ...activityRow,
      progress: newProgress,
      timesUsed: complete ? activityRow.timesUsed + 1 : activityRow.timesUsed,
    });
    ctx.db.playerState.username.update({
      ...ps,
      scrap: ps.scrap - cap,
      updatedAt: ctx.timestamp,
    });

    if (complete) {
      for (const structureDef of ctx.db.structureDefinition.iter()) {
        if (structureDef.buildActivityId !== activityId) continue;
        if (findPlayerStructure(ctx, s.username, structureDef.structureId)) {
          continue;
        }
        ctx.db.playerStructure.insert({
          id: 0n,
          username: s.username,
          structureId: structureDef.structureId,
          slottedActivityId: '',
        });
      }
    }
  }
);

export const travelTo = spacetimedb.reducer(
  { location: t.string() },
  (ctx, { location }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) throw new SenderError('Player state missing');
    const loc = ctx.db.locationDefinition.locationKey.find(location);
    if (loc === null) throw new SenderError('Unknown location');
    if (!isLocationTravelable(ctx, s.username, loc)) {
      throw new SenderError('Location not yet available');
    }
    if (ps.location === location) return;
    ctx.db.playerState.username.update({
      ...ps,
      location,
      updatedAt: ctx.timestamp,
    });
  }
);

export const upgradeScavengeActivity = spacetimedb.reducer(
  { activityId: t.string() },
  (ctx, { activityId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const def = ctx.db.activityDefinition.activityId.find(activityId);
    if (def === null || def.kind !== 'scavenge') {
      throw new SenderError('Not an upgradable scavenge activity');
    }
    if (!def.yieldResourceId) {
      throw new SenderError('Activity has no yield resource');
    }
    const row = getOrCreatePlayerActivity(ctx, s.username, activityId);
    const cost = upgradeCost(row.level);
    const balance = getResource(ctx, s.username, def.yieldResourceId);
    if (balance < cost) {
      throw new SenderError('Not enough resources');
    }
    addResource(ctx, s.username, def.yieldResourceId, -cost);
    ctx.db.playerActivity.id.update({
      ...row,
      level: row.level + 1,
    });
  }
);

export const upgradeSkill = spacetimedb.reducer(
  { skillId: t.string() },
  (ctx, { skillId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) throw new SenderError('Player state missing');

    const def = ctx.db.skillDefinition.skillId.find(skillId);
    if (def === null) throw new SenderError('Unknown skill');

    if (ps.skillPoints < def.costSkillPoints) {
      throw new SenderError('Not enough skill points');
    }

    if (def.prerequisiteSkillId !== '') {
      const prereqLevel = skillLevel(ctx, s.username, def.prerequisiteSkillId);
      if (prereqLevel < def.prerequisiteLevel) {
        throw new SenderError('Prerequisite not met');
      }
    }
    if (def.prerequisitePlayerLevel > 0 && ps.playerLevel < def.prerequisitePlayerLevel) {
      throw new SenderError(
        `Requires player level ${def.prerequisitePlayerLevel}`
      );
    }
    for (const extra of ctx.db.skillPrerequisite.skill_prerequisite_skill.filter(
      skillId
    )) {
      const lvl = skillLevel(ctx, s.username, extra.requiredSkillId);
      if (lvl < extra.requiredLevel) {
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
      skillPoints: ps.skillPoints - def.costSkillPoints,
      updatedAt: ctx.timestamp,
    });
  }
);

const AUTOMATION_INTERVAL_MICROS = 1_000_000n;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scheduleAutomation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  structureId: string,
  activityId: string
) {
  const fireAt = ctx.timestamp.microsSinceUnixEpoch + AUTOMATION_INTERVAL_MICROS;
  ctx.db.automationTick.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(fireAt),
    username,
    structureId,
    activityId,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isActivityApplicable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  structureId: string,
  activityId: string
): boolean {
  for (const up of ctx.db.structureUpgradeDefinition.structure_upgrade_definition_structure.filter(
    structureId
  )) {
    if (up.kind !== 'unlock_activity') continue;
    if (up.targetActivityId !== activityId) continue;
    const lvl = structureUpgradeLevel(ctx, username, up.upgradeId);
    if (lvl >= 1) return true;
  }
  return false;
}

export const slotActivity = spacetimedb.reducer(
  { structureId: t.string(), activityId: t.string() },
  (ctx, { structureId, activityId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const structure = findPlayerStructure(ctx, s.username, structureId);
    if (structure === null) {
      throw new SenderError('Structure not built');
    }
    if (!isActivityApplicable(ctx, s.username, structureId, activityId)) {
      throw new SenderError('Activity not applicable here');
    }

    ctx.db.playerStructure.id.update({
      ...structure,
      slottedActivityId: activityId,
    });
    scheduleAutomation(ctx, s.username, structureId, activityId);
  }
);

export const clearSlot = spacetimedb.reducer(
  { structureId: t.string() },
  (ctx, { structureId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const structure = findPlayerStructure(ctx, s.username, structureId);
    if (structure === null) throw new SenderError('Structure not built');
    ctx.db.playerStructure.id.update({
      ...structure,
      slottedActivityId: '',
    });
  }
);

export const upgradeStructure = spacetimedb.reducer(
  { upgradeId: t.string() },
  (ctx, { upgradeId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) throw new SenderError('Player state missing');
    const def = ctx.db.structureUpgradeDefinition.upgradeId.find(upgradeId);
    if (def === null) throw new SenderError('Unknown upgrade');
    const structure = findPlayerStructure(ctx, s.username, def.structureId);
    if (structure === null) throw new SenderError('Structure not built');

    let existing = null;
    for (const row of ctx.db.playerStructureUpgrade.player_structure_upgrade_username.filter(
      s.username
    )) {
      if (row.upgradeId === upgradeId) {
        existing = row;
        break;
      }
    }
    const currentLevel = existing?.level ?? 0;
    if (currentLevel >= def.maxLevel) {
      throw new SenderError('Already at max level');
    }

    const cost = structureUpgradeCost(
      def.costBase,
      def.costGrowthPer100,
      currentLevel
    );
    if (ps.scrap < cost) throw new SenderError('Not enough scrap');

    ctx.db.playerState.username.update({
      ...ps,
      scrap: ps.scrap - cost,
      updatedAt: ctx.timestamp,
    });

    if (existing !== null) {
      ctx.db.playerStructureUpgrade.id.update({
        ...existing,
        level: existing.level + 1,
      });
    } else {
      ctx.db.playerStructureUpgrade.insert({
        id: 0n,
        username: s.username,
        upgradeId,
        level: 1,
      });
    }
  }
);

const AUTOMATION_EVENT_TTL_MICROS = 10_000_000n;

export const runAutomation = spacetimedb.reducer(
  { arg: automationTick.rowType },
  (ctx, { arg }) => {
    const structure = findPlayerStructure(ctx, arg.username, arg.structureId);
    if (structure === null) return;
    if (structure.slottedActivityId !== arg.activityId) return;

    let yieldPer100 = 100;
    for (const up of ctx.db.structureUpgradeDefinition.structure_upgrade_definition_structure.filter(
      arg.structureId
    )) {
      if (up.kind !== 'efficiency') continue;
      const lvl = structureUpgradeLevel(ctx, arg.username, up.upgradeId);
      yieldPer100 += lvl * up.yieldPerLevelPer100;
    }

    const result = performScavengeActivity(
      ctx,
      arg.username,
      arg.activityId,
      yieldPer100,
      false
    );

    if (result.gain > 0n) {
      const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
      for (const old of ctx.db.automationEvent.automation_event_username.filter(
        arg.username
      )) {
        if (
          nowMicros - old.createdAt.microsSinceUnixEpoch >
          AUTOMATION_EVENT_TTL_MICROS
        ) {
          ctx.db.automationEvent.eventId.delete(old.eventId);
        }
      }
      ctx.db.automationEvent.insert({
        eventId: 0n,
        username: arg.username,
        structureId: arg.structureId,
        activityId: arg.activityId,
        resourceId: result.yieldResourceId,
        amount: result.gain,
        createdAt: ctx.timestamp,
      });
    }

    scheduleAutomation(ctx, arg.username, arg.structureId, arg.activityId);
  }
);
scheduledReducerRefs.automation = runAutomation;

export const cheatAddLevel = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const ps = ctx.db.playerState.username.find(s.username);
  if (ps === null) throw new SenderError('Player state missing');
  ctx.db.playerState.username.update({
    ...ps,
    playerLevel: ps.playerLevel + 1,
    skillPoints: ps.skillPoints + 1,
    updatedAt: ctx.timestamp,
  });
});

export const cheatAddScrap = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const ps = ctx.db.playerState.username.find(s.username);
  if (ps === null) throw new SenderError('Player state missing');
  ctx.db.playerState.username.update({
    ...ps,
    scrap: ps.scrap + 10000n,
    updatedAt: ctx.timestamp,
  });
});

const MAX_CHAT_BODY = 500;

export const sendChatMessage = spacetimedb.reducer(
  {
    channelType: t.string(),
    targetUsername: t.string(),
    body: t.string(),
  },
  (ctx, { channelType, targetUsername, body }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new SenderError('Message cannot be empty');
    }
    if (trimmed.length > MAX_CHAT_BODY) {
      throw new SenderError(`Message too long (max ${MAX_CHAT_BODY})`);
    }

    let channelKey = '';
    if (channelType === 'global') {
      channelKey = '';
    } else if (channelType === 'party') {
      const m = ctx.db.groupMember.username.find(s.username);
      if (m === null) throw new SenderError('You are not in a group');
      channelKey = m.groupId.toString();
    } else if (channelType === 'whisper') {
      const target = normalizeUsername(targetUsername);
      if (target === '') throw new SenderError('Whisper target required');
      if (target === s.username) throw new SenderError('Cannot whisper yourself');
      if (ctx.db.usernameDirectory.username.find(target) === null) {
        throw new SenderError('User not found');
      }
      channelKey = canonicalWhisperKey(s.username, target);
    } else {
      throw new SenderError('Unknown channel');
    }

    ctx.db.chatMessage.insert({
      messageId: 0n,
      channelType,
      channelKey,
      authorUsername: s.username,
      body: trimmed,
      createdAt: ctx.timestamp,
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
