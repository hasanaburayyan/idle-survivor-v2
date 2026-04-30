import { table, t } from 'spacetimedb/server';

// Holder object for scheduled reducers so table closures can resolve them after
// the reducer is defined elsewhere. Cross-module assignment to a `let` binding
// is not allowed in ESM, so a mutable property is used instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const scheduledReducerRefs: { automation: any } = { automation: null };

export const account = table(
  { name: 'account' },
  {
    username: t.string().primaryKey(),
    passwordHash: t.string(),
    salt: t.string(),
    createdAt: t.timestamp(),
  }
);

export const usernameDirectory = table(
  { name: 'username_directory', public: true },
  {
    username: t.string().primaryKey(),
  }
);

export const session = table(
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

export const playerState = table(
  { name: 'player_state' },
  {
    username: t.string().primaryKey(),
    scrap: t.u64(),
    xp: t.u64(),
    playerLevel: t.u32(),
    skillPoints: t.u32(),
    location: t.string(),
    updatedAt: t.timestamp(),
  }
);

export const locationDefinition = table(
  { name: 'location_definition', public: true },
  {
    locationKey: t.string().primaryKey(),
    name: t.string(),
    icon: t.string(),
    description: t.string(),
    sortOrder: t.u32(),
    prerequisiteActivityId: t.string(),
    prerequisiteActivityUses: t.u32(),
  }
);

export const activityDefinition = table(
  {
    name: 'activity_definition',
    public: true,
    indexes: [
      {
        accessor: 'activity_definition_location',
        algorithm: 'btree',
        columns: ['locationKey'],
      },
    ],
  },
  {
    activityId: t.string().primaryKey(),
    name: t.string(),
    description: t.string(),
    icon: t.string(),
    locationKey: t.string(),
    kind: t.string(),
    maxUses: t.i32(),
    prerequisiteSkillId: t.string(),
    prerequisiteSkillLevel: t.u32(),
    progressTarget: t.u64(),
    maxPerClick: t.u64(),
    yieldResourceId: t.string(),
    skillChainPrefix: t.string(),
    sortOrder: t.u32(),
  }
);

export const resourceDefinition = table(
  { name: 'resource_definition', public: true },
  {
    resourceId: t.string().primaryKey(),
    name: t.string(),
    icon: t.string(),
    unlockSkillId: t.string(),
    unlockSkillLevel: t.u32(),
    sortOrder: t.u32(),
  }
);

export const playerResource = table(
  {
    name: 'player_resource',
    indexes: [
      {
        accessor: 'player_resource_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    resourceId: t.string(),
    amount: t.u64(),
  }
);

export const activityCost = table(
  {
    name: 'activity_cost',
    public: true,
    indexes: [
      {
        accessor: 'activity_cost_activity',
        algorithm: 'btree',
        columns: ['activityId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    activityId: t.string(),
    resourceId: t.string(),
    amount: t.u64(),
  }
);

export const playerActivity = table(
  {
    name: 'player_activity',
    indexes: [
      {
        accessor: 'player_activity_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    activityId: t.string(),
    timesUsed: t.u32(),
    progress: t.u64(),
    level: t.u32(),
  }
);

export const skillDefinition = table(
  { name: 'skill_definition', public: true },
  {
    skillId: t.string().primaryKey(),
    name: t.string(),
    description: t.string(),
    maxLevel: t.u32(),
    prerequisiteSkillId: t.string(),
    prerequisiteLevel: t.u32(),
    prerequisitePlayerLevel: t.u32(),
    costSkillPoints: t.u32(),
    positionX: t.i32(),
    positionY: t.i32(),
    sortOrder: t.u32(),
  }
);

export const skillPrerequisite = table(
  {
    name: 'skill_prerequisite',
    public: true,
    indexes: [
      {
        accessor: 'skill_prerequisite_skill',
        algorithm: 'btree',
        columns: ['skillId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    skillId: t.string(),
    requiredSkillId: t.string(),
    requiredLevel: t.u32(),
  }
);

export const playerSkill = table(
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

export const structureDefinition = table(
  { name: 'structure_definition', public: true },
  {
    structureId: t.string().primaryKey(),
    name: t.string(),
    description: t.string(),
    icon: t.string(),
    locationKey: t.string(),
    buildActivityId: t.string(),
    sortOrder: t.u32(),
  }
);

export const structureUpgradeDefinition = table(
  {
    name: 'structure_upgrade_definition',
    public: true,
    indexes: [
      {
        accessor: 'structure_upgrade_definition_structure',
        algorithm: 'btree',
        columns: ['structureId'],
      },
    ],
  },
  {
    upgradeId: t.string().primaryKey(),
    structureId: t.string(),
    name: t.string(),
    description: t.string(),
    kind: t.string(),
    targetActivityId: t.string(),
    maxLevel: t.u32(),
    costBase: t.u64(),
    costGrowthPer100: t.u32(),
    yieldPerLevelPer100: t.u32(),
    sortOrder: t.u32(),
  }
);

export const playerStructure = table(
  {
    name: 'player_structure',
    indexes: [
      {
        accessor: 'player_structure_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    structureId: t.string(),
    slottedActivityId: t.string(),
  }
);

export const playerStructureUpgrade = table(
  {
    name: 'player_structure_upgrade',
    indexes: [
      {
        accessor: 'player_structure_upgrade_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    upgradeId: t.string(),
    level: t.u32(),
  }
);

export const automationEvent = table(
  {
    name: 'automation_event',
    indexes: [
      {
        accessor: 'automation_event_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    eventId: t.u64().primaryKey().autoInc(),
    username: t.string(),
    structureId: t.string(),
    activityId: t.string(),
    resourceId: t.string(),
    amount: t.u64(),
    createdAt: t.timestamp(),
  }
);

export const automationTick = table(
  {
    name: 'automation_tick',
    scheduled: () => scheduledReducerRefs.automation,
    indexes: [
      {
        accessor: 'automation_tick_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    username: t.string(),
    structureId: t.string(),
    activityId: t.string(),
  }
);

export const group = table(
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

export const groupMember = table(
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

export const groupInvitation = table(
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

export const groupContributionEvent = table(
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
    resourceId: t.string(),
    amount: t.u64(),
    createdAt: t.timestamp(),
  }
);

export const TutorialTriggerCondition = t.enum('TutorialTriggerCondition', {
  chained: t.unit(),
  playerLevelAtLeast: t.object('PlayerLevelAtLeastPayload', {
    level: t.u32(),
  }),
  skillPurchased: t.object('SkillPurchasedPayload', {
    skillId: t.string(),
    minLevel: t.u32(),
  }),
  activityPerformed: t.object('ActivityPerformedPayload', {
    activityId: t.string(),
    minTimes: t.u32(),
  }),
  treeCompleted: t.object('TreeCompletedPayload', {
    treeId: t.string(),
  }),
});

export const TutorialTone = t.enum('TutorialTone', {
  inCharacter: t.unit(),
  meta: t.unit(),
});

export const tutorialStepDefinition = table(
  { name: 'tutorial_step_definition', public: true },
  {
    stepId: t.string().primaryKey(),
    sortOrder: t.u32(),
    prereqStepId: t.string(),
    triggerCondition: TutorialTriggerCondition,
    headline: t.string(),
    body: t.string(),
    primaryCtaLabel: t.string(),
    spotlightTargetKey: t.string(),
    tone: TutorialTone,
  }
);

export const playerTutorialProgress = table(
  {
    name: 'player_tutorial_progress',
    indexes: [
      {
        accessor: 'player_tutorial_progress_username',
        algorithm: 'btree',
        columns: ['username'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    stepId: t.string(),
    completedAt: t.timestamp(),
  }
);

export const NotificationKind = t.enum('NotificationKind', {
  groupInvite: t.unit(),
  guildInvite: t.unit(),
  minigameInvite: t.unit(),
  system: t.unit(),
});

export const notification = table(
  {
    name: 'notification',
    indexes: [
      {
        accessor: 'notification_recipient',
        algorithm: 'btree',
        columns: ['recipient'],
      },
    ],
  },
  {
    notificationId: t.u64().primaryKey().autoInc(),
    recipient: t.string(),
    kind: NotificationKind,
    summary: t.string(),
    createdAt: t.timestamp(),
    readAt: t.timestamp().optional(),
    actionableRefId: t.u64().optional(),
    dedupeKey: t.string().default(''),
  }
);

export const chatMessage = table(
  {
    name: 'chat_message',
    indexes: [
      {
        accessor: 'chat_message_channel_type',
        algorithm: 'btree',
        columns: ['channelType'],
      },
      {
        accessor: 'chat_message_channel_key',
        algorithm: 'btree',
        columns: ['channelKey'],
      },
    ],
  },
  {
    messageId: t.u64().primaryKey().autoInc(),
    channelType: t.string(),
    channelKey: t.string(),
    authorUsername: t.string(),
    body: t.string(),
    createdAt: t.timestamp(),
  }
);
