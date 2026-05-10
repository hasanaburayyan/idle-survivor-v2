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
  notification,
  tutorialStepDefinition,
  playerTutorialProgress,
  playerOfflineEarning,
} from './tables_core';
import {
  insertNotification,
  deleteNotificationByRef,
} from './notifications';
import { handleDisconnect as handleMinigameDisconnect } from './minigames/framework';
import './minigames/coinFlip';
import './minigames/rhythmTap';
import { seedCardDefinitions } from './minigames/cardDuel';
import './minigames/cardDuel';
import './structures';
import { seedStatDefinitions, setStatSource, getStatTotals } from './stats';
import { seedClassSystem, CLASS_TREE_IDS, setCapability, CAPABILITY_KEYS, getCapabilityTotal, hasUnlockedClass } from './class';
import { buildSeed, Rng } from './rng';
import { seedArmory } from './armory';
import {
  seedActions,
  initializeDefaultActionsAndLoadout,
  migrateExistingPlayersToDefaults,
} from './actions';
import { handleDefensiveBattleDisconnect } from './battle';
import {
  seedSkillTrees,
  validateSkillTreeIntegrity,
  isTreeCompleted,
  addPoolBalance,
  getPoolBalanceRow,
} from './skill_tree';

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
export { myStatTotals, myStatBreakdown } from './stats';
export { myVisibleSkillTrees, myPointBalances } from './skill_tree';
export {
  myKnownActions,
  myActionLoadout,
  myActionPreviews,
  setLoadoutSlot,
  clearLoadoutSlot,
  swapLoadoutSlots,
} from './actions';
export {
  myDefensiveBattleSession,
  myDefensiveBattleParticipants,
  myDefensiveBattleHand,
  partyDefensiveBattleDecks,
  myDefensiveBattleZombies,
  myDefensiveBattleStatSnapshot,
  myDefensiveBattleLog,
  proposeDefensiveBattle,
  voteDefensiveBattle,
  performAction,
  forfeitBattle,
  runVoteCancelJob,
} from './battle';
export {
  myAvailableRecipes,
  myVisibleEquipmentSlots,
  myArmoryState,
  myItemInstances,
  myItemInstanceAffixes,
  myEquipment,
  myArmoryUpgradeCost,
  upgradeArmory,
  craftItem,
  equipItem,
  unequipItem,
  trashItem,
} from './armory';
export {
  equipClass,
  unequipClass,
  craftClassPoint,
  refundCapstoneChoice,
  myEquippedClass,
  myClassCraftProgress,
  myCapstoneChoices,
  myClassCraftTier,
  myCapabilityTotals,
} from './class';
export {
  loadRefinery,
  startRefinery,
  claimRefineryParts,
  startSmelterJob,
  collectSmelterJob,
  startGardenJob,
  collectGardenJob,
  craftFabric,
  myRefineryState,
  mySmelterJobs,
  myGardenJobs,
} from './structures';
import { applyResourceYieldBonus } from './structures';

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

// Beginner tree introduces new content only — resource multipliers live in
// Intermediate as minor/major chains alongside the core stats.
const SKILL_SEEDS: SkillSeed[] = [
  {
    skillId: 'unlock_shelter',
    name: 'Unlock Shelter',
    description: 'Unlocks the Build Shelter activity in the Wastes.',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
  },
  {
    skillId: 'unlock_parts',
    name: 'Unlock Parts',
    description: 'Unlocks the Parts resource and the Refinery (build it in The Shelter).',
    maxLevel: 1,
    prerequisiteSkillId: '',
    prerequisiteLevel: 0,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 0,
    sortOrder: 1,
  },
  {
    skillId: 'unlock_metal',
    name: 'Unlock Metal',
    description: 'Unlocks the Metal resource and the Smelter (build it in The Shelter).',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_parts',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 160,
    sortOrder: 2,
  },
  {
    skillId: 'unlock_fabric',
    name: 'Unlock Fabric',
    description: 'Unlocks the Fabric resource and the Craft Fabric recipe at the Workbench.',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_metal',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 320,
    sortOrder: 3,
  },
  {
    skillId: 'unlock_food',
    name: 'Unlock Food',
    description: 'Unlocks the Food resource: a small chance to drop from Scavenge plus the Garden multiplier (build it in The Shelter).',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_fabric',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 480,
    sortOrder: 4,
  },
  {
    skillId: 'unlock_medicine',
    name: 'Unlock Meds',
    description: 'Unlocks the Meds resource — earned from minigame rewards (CoinFlip, RhythmTap, CardDuel).',
    maxLevel: 1,
    prerequisiteSkillId: 'unlock_food',
    prerequisiteLevel: 1,
    prerequisitePlayerLevel: 0,
    costSkillPoints: 1,
    positionX: 220,
    positionY: 640,
    sortOrder: 5,
  },
];

interface SkillPrereqSeed {
  skillId: string;
  requiredSkillId: string;
  requiredLevel: number;
}

const SKILL_PREREQ_SEEDS: SkillPrereqSeed[] = [];

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
  {
    locationKey: 'the_shelter',
    name: 'The Shelter',
    icon: '🏠',
    description:
      'Walls, a roof, and enough room to build something worth keeping.',
    sortOrder: 1,
    prerequisiteActivityId: 'build_shelter',
    prerequisiteActivityUses: 1,
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
    activityId: 'build_armory',
    name: 'Build Armory',
    description: 'Pour scrap into the armory frame until it stands.',
    icon: '⚒',
    locationKey: 'the_shelter',
    kind: 'build_progress',
    maxUses: 1,
    prerequisiteSkillId: '',
    prerequisiteSkillLevel: 0,
    progressTarget: 2000n,
    maxPerClick: 200n,
    yieldResourceId: '',
    skillChainPrefix: '',
    sortOrder: 1,
  },
  {
    activityId: 'build_refinery',
    name: 'Build Refinery',
    description: 'Pour scrap into the refinery frame until it stands.',
    icon: '🔧',
    locationKey: 'the_shelter',
    kind: 'build_progress',
    maxUses: 1,
    prerequisiteSkillId: 'unlock_parts',
    prerequisiteSkillLevel: 1,
    progressTarget: 1500n,
    maxPerClick: 150n,
    yieldResourceId: '',
    skillChainPrefix: '',
    sortOrder: 2,
  },
  {
    activityId: 'build_smelter',
    name: 'Build Smelter',
    description: 'Pour scrap into the smelter frame until it stands.',
    icon: '🔥',
    locationKey: 'the_shelter',
    kind: 'build_progress',
    maxUses: 1,
    prerequisiteSkillId: 'unlock_metal',
    prerequisiteSkillLevel: 1,
    progressTarget: 4000n,
    maxPerClick: 400n,
    yieldResourceId: '',
    skillChainPrefix: '',
    sortOrder: 3,
  },
  {
    activityId: 'build_garden',
    name: 'Build Garden',
    description: 'Pour scrap into the garden frame until it stands.',
    icon: '🌱',
    locationKey: 'the_shelter',
    kind: 'build_progress',
    maxUses: 1,
    prerequisiteSkillId: 'unlock_food',
    prerequisiteSkillLevel: 1,
    progressTarget: 4000n,
    maxPerClick: 400n,
    yieldResourceId: '',
    skillChainPrefix: '',
    sortOrder: 4,
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
  {
    structureId: 'armory',
    name: 'Armory',
    description:
      'Workbench, anvil, and crates of salvaged plates. Crafts gear that boosts your stats.',
    icon: '⚒',
    locationKey: 'the_shelter',
    buildActivityId: 'build_armory',
    sortOrder: 1,
  },
  {
    structureId: 'class_crafting',
    name: 'Class Crafting',
    description:
      'A dedicated station for spending resources to craft class points and deepen your chosen path.',
    icon: '⚗️',
    locationKey: 'the_shelter',
    buildActivityId: '',
    sortOrder: 2,
  },
  {
    structureId: 'refinery',
    name: 'Refinery',
    description:
      'Refines scrap into parts on a timer. Queue a job, come back when it is done.',
    icon: '🔧',
    locationKey: 'the_shelter',
    buildActivityId: 'build_refinery',
    sortOrder: 3,
  },
  {
    structureId: 'smelter',
    name: 'Smelter',
    description:
      'Smelts scrap and parts into metal. Slower than the refinery, but the only way to get metal.',
    icon: '🔥',
    locationKey: 'the_shelter',
    buildActivityId: 'build_smelter',
    sortOrder: 4,
  },
  {
    structureId: 'garden',
    name: 'Garden',
    description:
      'Multiplies stored food. Harvest within the Ripe window for a bonus tier; Stale yields a smaller (but still positive) return.',
    icon: '🌱',
    locationKey: 'the_shelter',
    buildActivityId: 'build_garden',
    sortOrder: 5,
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
  {
    upgradeId: 'refinery_capacity',
    structureId: 'refinery',
    name: 'Refinery Capacity',
    description:
      '+20 scrap capacity per level. Larger loads run longer between visits.',
    kind: 'capacity',
    targetActivityId: '',
    maxLevel: 9,
    costBase: 100n,
    costGrowthPer100: 175,
    yieldPerLevelPer100: 20,
    sortOrder: 0,
  },
  {
    upgradeId: 'refinery_efficiency',
    structureId: 'refinery',
    name: 'Refinery Efficiency',
    description:
      '+25% Parts yield per level on each refinery job.',
    kind: 'efficiency',
    targetActivityId: '',
    maxLevel: 4,
    costBase: 250n,
    costGrowthPer100: 175,
    yieldPerLevelPer100: 25,
    sortOrder: 1,
  },
  {
    upgradeId: 'smelter_efficiency',
    structureId: 'smelter',
    name: 'Smelter Efficiency',
    description:
      '+25% Metal yield per level on each smelter job.',
    kind: 'efficiency',
    targetActivityId: '',
    maxLevel: 4,
    costBase: 1000n,
    costGrowthPer100: 175,
    yieldPerLevelPer100: 25,
    sortOrder: 0,
  },
  {
    upgradeId: 'garden_efficiency',
    structureId: 'garden',
    name: 'Garden Efficiency',
    description:
      '+25% Food multiplier per level on each garden harvest.',
    kind: 'efficiency',
    targetActivityId: '',
    maxLevel: 4,
    costBase: 1000n,
    costGrowthPer100: 175,
    yieldPerLevelPer100: 25,
    sortOrder: 0,
  },
];

interface TutorialStepSeed {
  stepId: string;
  sortOrder: number;
  prereqStepId: string;
  triggerCondition:
    | { tag: 'chained' }
    | { tag: 'playerLevelAtLeast'; value: { level: number } }
    | { tag: 'skillPurchased'; value: { skillId: string; minLevel: number } }
    | { tag: 'activityPerformed'; value: { activityId: string; minTimes: number } }
    | { tag: 'treeCompleted'; value: { treeId: string } };
  headline: string;
  body: string;
  primaryCtaLabel: string;
  spotlightTargetKey: string;
  tone: { tag: 'inCharacter' } | { tag: 'meta' };
}

const TUTORIAL_STEP_SEEDS: TutorialStepSeed[] = [
  {
    stepId: 'welcome',
    sortOrder: 1,
    prereqStepId: '',
    triggerCondition: { tag: 'chained' },
    headline: 'The wastes.',
    body: "It's quiet for now. You're going to need scrap — bottle caps, scrap metal, anything that survived. Start by scavenging at your feet.",
    primaryCtaLabel: 'Begin.',
    spotlightTargetKey: '',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'try_scavenge',
    sortOrder: 2,
    prereqStepId: 'welcome',
    triggerCondition: { tag: 'chained' },
    headline: 'Scavenge.',
    body: 'Tap the Scavenge button to gather scrap. Keep tapping — every press counts.',
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: 'activity_button:scavenge',
    tone: { tag: 'meta' },
  },
  {
    stepId: 'first_level_up',
    sortOrder: 3,
    prereqStepId: 'try_scavenge',
    triggerCondition: { tag: 'playerLevelAtLeast', value: { level: 1 } },
    headline: "You're learning.",
    body: 'All that scavenging taught you something. You earned a skill point — somewhere out there, you should figure out how to spend it.',
    primaryCtaLabel: 'Show me.',
    spotlightTargetKey: 'tab:skill_tree',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'first_skill_spend',
    sortOrder: 4,
    prereqStepId: 'first_level_up',
    triggerCondition: { tag: 'chained' },
    headline: 'Spend your point.',
    body: 'A skill point is yours to spend. Tap Unlock Shelter — a roof of your own is the gateway to every workshop and farm you\'ll build later.',
    primaryCtaLabel: 'Continue.',
    spotlightTargetKey: 'skill_node:unlock_shelter',
    tone: { tag: 'meta' },
  },
  {
    stepId: 'unlock_shelter_taken',
    sortOrder: 5,
    prereqStepId: 'first_skill_spend',
    triggerCondition: { tag: 'skillPurchased', value: { skillId: 'unlock_shelter', minLevel: 1 } },
    headline: 'Shelter, in theory.',
    body: "You unlocked the Shelter. That puts a Build Shelter activity on the Wastes — pour scrap into it until it stands. Inside, you'll have room for a Workbench, a Refinery, a Smelter, a Garden — every later resource lives behind a wall you build yourself.",
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: '',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'unlock_parts_taken',
    sortOrder: 6,
    prereqStepId: 'first_skill_spend',
    triggerCondition: { tag: 'skillPurchased', value: { skillId: 'unlock_parts', minLevel: 1 } },
    headline: 'Parts.',
    body: "Bolts, gears, broken machinery — worth more than scrap to anyone who can fix things. With this unlock, the Refinery is buildable in your Shelter. Load it with scrap, hit Refine, and Parts tick out on a 30-second timer. Claim them whenever you want; the buffer keeps working.",
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: '',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'unlock_metal_taken',
    sortOrder: 7,
    prereqStepId: 'unlock_parts_taken',
    triggerCondition: { tag: 'skillPurchased', value: { skillId: 'unlock_metal', minLevel: 1 } },
    headline: 'Metal.',
    body: "Heavier than scrap and harder to come by. With this unlock, the Smelter is buildable in your Shelter. It eats scrap and parts together and gives back metal — slower than the Refinery, but the only path to metal there is.",
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: '',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'unlock_fabric_taken',
    sortOrder: 8,
    prereqStepId: 'unlock_metal_taken',
    triggerCondition: { tag: 'skillPurchased', value: { skillId: 'unlock_fabric', minLevel: 1 } },
    headline: 'Fabric.',
    body: "Scraps of cloth and tarp. With this unlock, your Workbench gains a Craft Fabric recipe — instant turnover. Spend scrap, parts, and metal; receive fabric, single or by the ten.",
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: '',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'unlock_food_taken',
    sortOrder: 9,
    prereqStepId: 'unlock_fabric_taken',
    triggerCondition: { tag: 'skillPurchased', value: { skillId: 'unlock_food', minLevel: 1 } },
    headline: 'Food.',
    body: "Canned. Mostly. With this unlock, food drops occasionally from Scavenging — a small chance per click — and the Garden becomes buildable in your Shelter. The Garden multiplies what you plant; harvest within the Ripe window for the bigger payout.",
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: '',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'unlock_meds_taken',
    sortOrder: 10,
    prereqStepId: 'unlock_food_taken',
    triggerCondition: { tag: 'skillPurchased', value: { skillId: 'unlock_medicine', minLevel: 1 } },
    headline: 'Medicine.',
    body: "Painkillers, antibiotics, the occasional miracle. With this unlock, every minigame yields Meds — CoinFlip, RhythmTap, CardDuel. There's no scavenge for it, and there's no daily cap; the only way to stockpile is to play.",
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: '',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'shelter_built',
    sortOrder: 11,
    prereqStepId: 'unlock_shelter_taken',
    triggerCondition: { tag: 'activityPerformed', value: { activityId: 'build_shelter', minTimes: 1 } },
    headline: 'Shelter, built.',
    body: "Walls, a roof, a place to keep what you've gathered. Open the Shelter tab — the floor plan shows every structure you can build here. The Workbench is the first one; the Refinery, Smelter, and Garden each need their own resource unlocked first.",
    primaryCtaLabel: 'Got it.',
    spotlightTargetKey: 'tab:shelter',
    tone: { tag: 'inCharacter' },
  },
  {
    stepId: 'beginner_complete',
    sortOrder: 12,
    prereqStepId: 'shelter_built',
    triggerCondition: { tag: 'treeCompleted', value: { treeId: 'beginner' } },
    headline: 'Beginner skill tree complete.',
    body: "Resources mapped. Shelter standing. Open your Character tab next — your stats are the spine of classes, battles, and everything that follows.",
    primaryCtaLabel: 'Show me.',
    spotlightTargetKey: 'tab:character',
    tone: { tag: 'meta' },
  },
];

export const init = spacetimedb.init(ctx => {
  // Seed skill trees + pools first — Intermediate seed in seedSkillTrees()
  // depends on skillTreeDefinition rows being present for the validation pass.
  seedSkillTrees(ctx);
  for (const seed of SKILL_SEEDS) {
    if (ctx.db.skillDefinition.skillId.find(seed.skillId) === null) {
      // Stamp every existing skill seed with treeId: 'beginner' since
      // SKILL_SEEDS predate the tier system.
      ctx.db.skillDefinition.insert({
        ...seed,
        treeId: 'beginner',
        capstoneBranchId: '',
        infiniteScaling: false,
        prerequisiteStatId: '',
        prerequisiteStatValue: 0,
      });
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
  seedTutorialSteps(ctx);
  seedCardDefinitions(ctx);
  seedStatDefinitions(ctx);
  seedArmory(ctx);
  seedActions(ctx);
  // Class system must be seeded AFTER seedSkillTrees so the 'intermediate'
  // tree row already exists when unlock nodes are inserted.
  seedClassSystem(ctx);
  // Migration: ensure every existing player has the default action grants
  // and a populated loadout. Idempotent; safe to run on every init.
  migrateExistingPlayersToDefaults(ctx);
  validateSkillTreeIntegrity(ctx);
});

export const onConnect = spacetimedb.clientConnected(_ctx => {});

// One-shot migration reducer — re-runs the idempotent seeders so additions to
// SKILL_SEEDS / STAT_GRANT_SEEDS / class node seeds land on an already-
// initialized DB without --clear-database. Safe to call repeatedly. Anyone
// can call; the seed functions themselves only insert missing rows.
export const runSeedMigration = spacetimedb.reducer(ctx => {
  seedActivityDefinitions(ctx);
  seedStructureDefinitions(ctx);
  seedSkillTrees(ctx);
  seedClassSystem(ctx);
  seedArmory(ctx);
  seedActions(ctx);
  seedStatDefinitions(ctx);
  seedTutorialSteps(ctx);
  seedStructureUpgrades(ctx);
  purgeLegacyAcquisition(ctx);
  resetPlayerLocations(ctx);
});

// Travel UI is gone; with no way to switch locations, any player whose
// playerState.location is anything other than 'the_wastes' would be locked
// out of the Scavenge reducer (location check). Reset every player to the
// wastes. Idempotent — no-op when already there.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resetPlayerLocations(ctx: any) {
  for (const ps of ctx.db.playerState.iter()) {
    if (ps.location !== 'the_wastes') {
      ctx.db.playerState.username.update({
        ...ps,
        location: 'the_wastes',
        updatedAt: ctx.timestamp,
      });
    }
  }
}

// Upsert activity rows so description / cost / icon edits land via
// runSeedMigration. Insert-only behaviour in init() means existing live DBs
// would otherwise miss copy fixes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedActivityDefinitions(ctx: any) {
  for (const seed of ACTIVITY_SEEDS) {
    const existing = ctx.db.activityDefinition.activityId.find(seed.activityId);
    if (existing === null) {
      ctx.db.activityDefinition.insert(seed);
    } else {
      ctx.db.activityDefinition.activityId.update({ ...existing, ...seed });
    }
  }
}

// Same for structure definitions (icon / description / sortOrder edits).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedStructureDefinitions(ctx: any) {
  for (const seed of STRUCTURE_SEEDS) {
    const existing = ctx.db.structureDefinition.structureId.find(seed.structureId);
    if (existing === null) {
      ctx.db.structureDefinition.insert(seed);
    } else {
      ctx.db.structureDefinition.structureId.update({ ...existing, ...seed });
    }
  }
}

// Per-resource Scavenge variants (scavenge_for_parts/metal/fabric/food/medicine)
// were replaced by structure-based acquisition (Refinery, Smelter, Workbench
// recipe, Garden, minigame rewards). This drops the now-orphaned activity defs,
// their workbench-apply unlock upgrades, and any player rows that still
// reference them. Idempotent: rows that no longer exist are no-ops.
const LEGACY_SCAVENGE_ACTIVITY_IDS = [
  'scavenge_for_parts',
  'scavenge_for_metal',
  'scavenge_for_fabric',
  'scavenge_for_food',
  'scavenge_for_medicine',
] as const;
const LEGACY_WORKBENCH_APPLY_UPGRADE_IDS = [
  'workbench_apply_parts',
  'workbench_apply_metal',
  'workbench_apply_fabric',
  'workbench_apply_food',
  'workbench_apply_medicine',
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function purgeLegacyAcquisition(ctx: any) {
  const obsoleteActivities = new Set<string>(LEGACY_SCAVENGE_ACTIVITY_IDS);
  const obsoleteUpgrades = new Set<string>(LEGACY_WORKBENCH_APPLY_UPGRADE_IDS);

  for (const id of obsoleteActivities) {
    if (ctx.db.activityDefinition.activityId.find(id) !== null) {
      ctx.db.activityDefinition.activityId.delete(id);
    }
  }
  for (const id of obsoleteUpgrades) {
    if (ctx.db.structureUpgradeDefinition.upgradeId.find(id) !== null) {
      ctx.db.structureUpgradeDefinition.upgradeId.delete(id);
    }
  }

  // Drop any player progress rows tied to obsolete activities.
  const obsoletePlayerActivityIds: bigint[] = [];
  for (const row of ctx.db.playerActivity.iter()) {
    if (obsoleteActivities.has(row.activityId)) {
      obsoletePlayerActivityIds.push(row.id);
    }
  }
  for (const id of obsoletePlayerActivityIds) {
    ctx.db.playerActivity.id.delete(id);
  }

  const obsoletePlayerUpgradeIds: bigint[] = [];
  for (const row of ctx.db.playerStructureUpgrade.iter()) {
    if (obsoleteUpgrades.has(row.upgradeId)) {
      obsoletePlayerUpgradeIds.push(row.id);
    }
  }
  for (const id of obsoletePlayerUpgradeIds) {
    ctx.db.playerStructureUpgrade.id.delete(id);
  }

  // Workbench rows that had an old activity slotted lose their slot.
  for (const row of ctx.db.playerStructure.iter()) {
    if (obsoleteActivities.has(row.slottedActivityId)) {
      ctx.db.playerStructure.id.update({ ...row, slottedActivityId: '' });
    }
  }

  // Cancel any in-flight automation ticks targeting an obsolete activity.
  const obsoleteTickIds: bigint[] = [];
  for (const row of ctx.db.automationTick.iter()) {
    if (obsoleteActivities.has(row.activityId)) {
      obsoleteTickIds.push(row.scheduledId);
    }
  }
  for (const id of obsoleteTickIds) {
    ctx.db.automationTick.scheduledId.delete(id);
  }
}

// Insert-or-update so new upgrade kinds (e.g. refinery_capacity) and rebalances
// to existing rows (sortOrder, costBase, description copy) land on already-
// initialized DBs without --clear-database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedStructureUpgrades(ctx: any) {
  for (const seed of STRUCTURE_UPGRADE_SEEDS) {
    const existing = ctx.db.structureUpgradeDefinition.upgradeId.find(seed.upgradeId);
    if (existing === null) {
      ctx.db.structureUpgradeDefinition.insert(seed);
    } else {
      ctx.db.structureUpgradeDefinition.upgradeId.update({ ...existing, ...seed });
    }
  }
}

// Tutorial seeds are upserted (not insert-only) so copy edits, prereq
// re-wires, and new steps land on existing DBs via runSeedMigration.
function seedTutorialSteps(ctx: any) {
  for (const seed of TUTORIAL_STEP_SEEDS) {
    const existing = ctx.db.tutorialStepDefinition.stepId.find(seed.stepId);
    if (existing === null) {
      ctx.db.tutorialStepDefinition.insert(seed);
    } else {
      ctx.db.tutorialStepDefinition.stepId.update({ ...existing, ...seed });
    }
  }
}

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  handleMinigameDisconnect(ctx);
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s !== null) {
    handleDefensiveBattleDisconnect(ctx, s.username);
    // Clean up the per-identity session row. Without this, stale rows from
    // prior browser instances (Expo restart, hard reload, etc.) accumulate
    // and any of them timing out triggers spurious disconnect handling for
    // the same username.
    ctx.db.session.identity.delete(ctx.sender);
  }
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

export const myNotifications = spacetimedb.view(
  { name: 'my_notifications', public: true },
  t.array(notification.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.notification.notification_recipient.filter(s.username),
    ];
  }
);

export const myTutorialProgress = spacetimedb.view(
  { name: 'my_tutorial_progress', public: true },
  t.array(playerTutorialProgress.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [
      ...ctx.db.playerTutorialProgress.player_tutorial_progress_username.filter(
        s.username
      ),
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

// Powers the new ScavengePanel — same filtering as myVisibleActivities except
// location-agnostic. Shelter-located builds additionally require build_shelter
// to be done so they don't surface before the player has a shelter to put
// them in. Returns scavenge + every build the player has actually unlocked
// and not yet completed.
//
// We must NOT use .iter() in a view body (SpacetimeDB surfaces it as an
// opaque "Error materializing view"). All activities are at one of two
// locations, so we union the two location-indexed queries.
export const myAvailableActivities = spacetimedb.view(
  { name: 'my_available_activities', public: true },
  t.array(activityDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    const username = s.username;
    const shelterRow = findPlayerActivity(ctx, username, 'build_shelter');
    const shelterBuilt = (shelterRow?.timesUsed ?? 0) >= 1;
    const candidates = [
      ...ctx.db.activityDefinition.activity_definition_location.filter('the_wastes'),
      ...ctx.db.activityDefinition.activity_definition_location.filter('the_shelter'),
    ];
    return candidates.filter(def => {
      if (def.prerequisiteSkillId !== '') {
        if (skillLevel(ctx, username, def.prerequisiteSkillId) < def.prerequisiteSkillLevel) {
          return false;
        }
      }
      if (def.maxUses !== -1) {
        const pa = findPlayerActivity(ctx, username, def.activityId);
        if ((pa?.timesUsed ?? 0) >= def.maxUses) return false;
      }
      // Hide shelter-located builds (Workbench / Refinery / etc.) until the
      // shelter itself is up — otherwise the player sees a build pad they
      // can't use yet.
      if (def.locationKey === 'the_shelter' && !shelterBuilt) return false;
      return true;
    });
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

// Locations that have their own top-level tab and should NOT appear as Travel
// destinations even though they exist as locationDefinition rows (because
// structures live there). Add a locationKey here when promoting a location to a tab.
const TAB_BACKED_LOCATION_KEYS = new Set(['the_shelter']);

export const myTravelableLocations = spacetimedb.view(
  { name: 'my_travelable_locations', public: true },
  t.array(locationDefinition.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) return [];
    return [...ctx.db.locationDefinition.iter()].filter(
      loc =>
        !TAB_BACKED_LOCATION_KEYS.has(loc.locationKey) &&
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
      skillPoints: 0, // dead column — all reads/writes go through player_skill_point_balance
      location: 'the_wastes',
      updatedAt: ctx.timestamp,
      comboLastClickAtMicros: 0n,
      comboBp: 0,
      comboClickCount: 0,
      actionCount: 0n,
    });
    ctx.db.playerSkillPointBalance.insert({
      id: 0n,
      username: u,
      poolId: 'general',
      amount: 0,
    });
    initializeDefaultActionsAndLoadout(ctx, u);

    if (ctx.db.session.identity.find(ctx.sender) !== null) {
      ctx.db.session.identity.delete(ctx.sender);
    }
    ctx.db.session.insert({
      identity: ctx.sender,
      username: u,
      createdAt: ctx.timestamp,
    });

    insertNotification(
      ctx,
      u,
      'system',
      'Welcome to the wastes. Tap the bell to see notifications as they arrive.',
      undefined
    );
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

    surfaceOfflineEarnings(ctx, u);
  }
);

// Drain any accumulated offline earnings (forge_heart bonus) into a single
// system notification, then delete the rows. Resource display uses
// resourceDefinition.name when available; falls back to the resourceId.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function surfaceOfflineEarnings(ctx: any, username: string): void {
  const parts: string[] = [];
  for (const row of ctx.db.playerOfflineEarning.player_offline_earning_username.filter(username)) {
    if (row.amount > 0n) {
      const def = ctx.db.resourceDefinition.resourceId.find(row.resourceId);
      const label = def !== null ? def.name : row.resourceId;
      parts.push(`+${row.amount.toString()} ${label}`);
    }
    ctx.db.playerOfflineEarning.sourceKey.delete(row.sourceKey);
  }
  if (parts.length > 0) {
    insertNotification(
      ctx,
      username,
      'system',
      `Forge Heart: earned ${parts.join(', ')} while you were away.`,
      undefined
    );
  }
}

export const logout = spacetimedb.reducer(ctx => {
  if (ctx.db.session.identity.find(ctx.sender) !== null) {
    ctx.db.session.identity.delete(ctx.sender);
  }
});

const MAX_GROUP_SIZE = 5;
const CONTRIBUTION_TTL_MICROS = 10_000_000n;

// ---------- Capability post-processing helpers ----------

/**
 * Rolls the fortune proc for a given yield event and awards any bonus resource.
 * Accumulates the bonus into a dedup-keyed notification within a 5-second window
 * so multiple rapid procs merge into one toast rather than spamming the inbox.
 * Also handles the cascade (one re-roll after proc) and quartermaster drop.
 *
 * actionCount is used to vary the PRNG seed even when timestamp alone would
 * be identical (two consecutive clicks in the same microsecond-tick window).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFortuneProc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  resourceId: string,
  gain: bigint,
  actionCount: bigint
): void {
  if (gain <= 0n) return;
  const chanceBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.FORTUNE_PROC_CHANCE_BP);
  if (chanceBp <= 0) return;

  const seed = buildSeed([ctx.timestamp.microsSinceUnixEpoch, username, actionCount, resourceId, 'fortune']);
  const rng = new Rng(seed);
  if (rng.uniform() >= chanceBp / 10000) return;

  // Fortune proc fired — award bonus resource.
  const multBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.FORTUNE_PROC_MULTIPLIER_BP);
  const bonus = multBp > 0 ? (gain * BigInt(multBp)) / 10000n : gain;
  if (bonus > 0n) addResource(ctx, username, resourceId, bonus);

  // Cascade check — one extra re-roll, no further recursion.
  const cascadeChanceBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.FORTUNE_CASCADE_CHANCE_BP);
  let cascadeBonus = 0n;
  if (cascadeChanceBp > 0 && rng.uniform() < cascadeChanceBp / 10000) {
    cascadeBonus = bonus;
    if (cascadeBonus > 0n) addResource(ctx, username, resourceId, cascadeBonus);
  }

  // Quartermaster drop — on proc, small chance to award one 'parts' as bonus
  // loot. Routed through the Parts skill chain so the +flat / +% multipliers
  // apply, matching every other parts-grant surface in the game.
  const dropChanceBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.FORTUNE_PROC_DROPS_ITEM_BP);
  if (dropChanceBp > 0 && rng.uniform() < dropChanceBp / 10000) {
    const partsGain = applyResourceYieldBonus(ctx, username, 'parts', 1n);
    addResource(ctx, username, 'parts', partsGain);
  }

  // Echo (Wanderer capstone) — chance to grant a parallel proc to a random
  // group member. Recipient might not have unlocked this resource yet; the
  // grant is still applied (creates a balance row), interpreted as a
  // foreshadowing of what's coming. addResource doesn't gate on unlock.
  const echoChanceBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.FORTUNE_PROC_ECHO_CHANCE_BP);
  if (echoChanceBp > 0 && rng.uniform() < echoChanceBp / 10000) {
    const myMembership = ctx.db.groupMember.username.find(username);
    if (myMembership !== null) {
      const others: string[] = [];
      for (const member of ctx.db.groupMember.group_member_group_id.filter(myMembership.groupId)) {
        if (member.username !== username) others.push(member.username);
      }
      if (others.length > 0) {
        const pick = others[rng.intInRange(0, others.length - 1)]!;
        const echoAmount = bonus + cascadeBonus;
        if (echoAmount > 0n) {
          addResource(ctx, pick, resourceId, echoAmount);
          insertNotification(
            ctx,
            pick,
            'system',
            `Fortune Echo from ${username}! +${echoAmount.toString()} ${resourceId}`,
            undefined
          );
        }
      }
    }
  }

  // Dedup-accumulate notification: merge into existing entry within 5-second window.
  const epochWindow = ctx.timestamp.microsSinceUnixEpoch / 5_000_000n;
  const dedupeKey = `fortuneProc:${username}:${resourceId}:${epochWindow.toString()}`;
  let accumulated = bonus + cascadeBonus;
  for (const n of ctx.db.notification.notification_recipient.filter(username)) {
    if (n.dedupeKey !== dedupeKey) continue;
    const m = n.summary.match(/\+(\d+)/);
    if (m) accumulated += BigInt(m[1]!);
    ctx.db.notification.notificationId.delete(n.notificationId);
    break;
  }
  ctx.db.notification.insert({
    notificationId: 0n,
    recipient: username,
    kind: { tag: 'system' as const },
    summary: `Fortune! +${accumulated.toString()} ${resourceId}`,
    createdAt: ctx.timestamp,
    readAt: undefined,
    actionableRefId: undefined,
    dedupeKey,
  });
}

/**
 * Vein drop (Wanderer capstone `rich_veins`): on a manual click, small chance
 * to drop a "vein" — a flat burst of every unlocked resource scaled by player
 * level. Each unlocked resource grants `1 + floor(playerLevel / 5)` units.
 * Independent of yield modifiers; the burst is the whole reward.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyVeinDrop(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  actionCount: bigint
): void {
  const chanceBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.VEIN_DROP_CHANCE_BP);
  if (chanceBp <= 0) return;

  const seed = buildSeed([ctx.timestamp.microsSinceUnixEpoch, username, actionCount, 'vein']);
  const rng = new Rng(seed);
  if (rng.uniform() >= chanceBp / 10000) return;

  const ps = ctx.db.playerState.username.find(username);
  if (ps === null) return;
  const perResource = BigInt(1 + Math.floor(ps.playerLevel / 5));

  const grants: string[] = [];
  for (const resDef of ctx.db.resourceDefinition.iter()) {
    if (resDef.unlockSkillId !== '') {
      if (skillLevel(ctx, username, resDef.unlockSkillId) < resDef.unlockSkillLevel) continue;
    }
    addResource(ctx, username, resDef.resourceId, perResource);
    grants.push(`+${perResource.toString()} ${resDef.name}`);
  }

  if (grants.length > 0) {
    insertNotification(
      ctx,
      username,
      'system',
      `Vein! Discovered ${grants.join(', ')}.`,
      undefined
    );
  }
}

/**
 * Momentum (Striker capstone): grant one free class point. Targets the
 * equipped class; falls back to the first unlocked class when none equipped.
 * Skips silently if no class is unlocked yet (shouldn't happen — momentum
 * gates on Power 30 + Striker capstone).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grantMomentumClassPoint(ctx: any, username: string): void {
  let targetClassId = '';
  const equipped = ctx.db.playerEquippedClass.username.find(username);
  if (equipped !== null && equipped.classId !== '') {
    targetClassId = equipped.classId;
  } else {
    for (const classId of CLASS_TREE_IDS) {
      if (hasUnlockedClass(ctx, username, classId)) {
        targetClassId = classId;
        break;
      }
    }
  }
  if (targetClassId === '') return;
  const treeDef = ctx.db.skillTreeDefinition.treeId.find(targetClassId);
  if (treeDef === null) return;
  addPoolBalance(ctx, username, treeDef.pointPoolId, 1);
  const className = targetClassId.charAt(0).toUpperCase() + targetClassId.slice(1);
  insertNotification(
    ctx,
    username,
    'system',
    `Momentum! Free ${className} point granted.`,
    undefined
  );
}

/**
 * Wide-net: for each OTHER resource that the player has unlocked, awards
 * floor(primaryGain * wideNetBp / 10000) of that resource.
 * Hidden-caches overflow: each side-resource has a chance to also award one
 * unit of the next-tier resource (determined by sortOrder + 1).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyWideNet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  primaryResourceId: string,
  primaryGain: bigint,
  actionCount: bigint
): void {
  if (primaryGain <= 0n) return;
  const wideNetBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.WIDE_NET_PCT_BP);
  if (wideNetBp <= 0) return;

  const sideAmount = (primaryGain * BigInt(wideNetBp)) / 10000n;
  if (sideAmount <= 0n) return;

  const overflowBp = getCapabilityTotal(ctx, username, CAPABILITY_KEYS.WIDE_NET_OVERFLOW_BP);

  for (const resDef of ctx.db.resourceDefinition.iter()) {
    if (resDef.resourceId === primaryResourceId) continue;

    // Skip resources gated behind skills the player hasn't reached yet.
    if (resDef.unlockSkillId !== '') {
      if (skillLevel(ctx, username, resDef.unlockSkillId) < resDef.unlockSkillLevel) continue;
    }

    addResource(ctx, username, resDef.resourceId, sideAmount);

    // Hidden caches overflow: chance to award the next-tier resource.
    if (overflowBp > 0) {
      const overflowSeed = buildSeed([
        ctx.timestamp.microsSinceUnixEpoch, username, actionCount, resDef.resourceId, 'overflow',
      ]);
      const overflowRng = new Rng(overflowSeed);
      if (overflowRng.uniform() < overflowBp / 10000) {
        const targetSortOrder = resDef.sortOrder + 1;
        for (const above of ctx.db.resourceDefinition.iter()) {
          if (above.sortOrder === targetSortOrder) {
            addResource(ctx, username, above.resourceId, sideAmount);
            break;
          }
        }
      }
    }
  }
}

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
  // Effective multiplier level combines minor + major in a 1:3 ratio matching
  // the core stats pattern. Minor max 4 + Major max 4 = 16 effective levels =
  // +400% yield at full investment.
  const minorLevel = skillLevel(ctx, username, `${prefix}_minor_multiplier`);
  const majorLevel = skillLevel(ctx, username, `${prefix}_major_multiplier`);
  const multiplierLevel = minorLevel + 3 * majorLevel;
  let gain = computeScavengeGain(activityRow.level, multiplierLevel);
  if (yieldPer100 !== 100) {
    gain = (gain * BigInt(yieldPer100)) / 100n;
    if (gain < 1n) gain = 1n;
  }

  let newXp = ps.xp + 1n;
  let newLevel = ps.playerLevel;
  let pointsGained = 0;
  let threshold = xpToNextLevel(newLevel);
  while (newXp >= threshold) {
    newXp -= threshold;
    newLevel += 1;
    pointsGained += 1;
    threshold = xpToNextLevel(newLevel);
  }

  ctx.db.playerState.username.update({
    ...ps,
    xp: newXp,
    playerLevel: newLevel,
    updatedAt: ctx.timestamp,
  });

  if (newLevel > ps.playerLevel) {
    const newBalance = addPoolBalance(ctx, username, 'general', pointsGained);
    notifyLevelUp(ctx, username, newLevel, newBalance);
  }

  addResource(ctx, username, def.yieldResourceId, gain);

  // Food trickle — only fires on base scrap scavenges, gated on Food discovery.
  // 1% chance per tick to yield 1 Food. Deterministic per (timestamp, username,
  // activityId, actionCount) so re-running the reducer is reproducible.
  if (
    def.yieldResourceId === 'scrap' &&
    skillLevel(ctx, username, 'unlock_food') >= 1
  ) {
    const seed = buildSeed([
      ctx.timestamp.microsSinceUnixEpoch,
      username,
      activityId,
      ps.actionCount,
      'food_trickle',
    ]);
    const rng = new Rng(seed);
    if (rng.uniform() < 0.01) {
      // Food skill chain (minor flat +2/lvl + major +75%/lvl) applied to the
      // 1-food proc so trickle scales with skill investment.
      const foodGain = applyResourceYieldBonus(ctx, username, 'food', 1n);
      addResource(ctx, username, 'food', foodGain);
    }
  }

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
    let ps = ctx.db.playerState.username.find(s.username);
    if (ps === null) throw new SenderError('Player state missing');
    if (!isActivityVisible(ctx, s.username, def, ps.location)) {
      throw new SenderError('Activity is not available here');
    }
    if (!activityCostsAffordable(ctx, s.username, activityId)) {
      throw new SenderError('Cannot afford costs');
    }

    // Monotonic action counter — seeds fortune/crit PRNG uniquely per click
    // even if two clicks land in the same microsecond tick.
    const newActionCount = ps.actionCount + 1n;
    ctx.db.playerState.username.update({
      ...ps,
      actionCount: newActionCount,
      updatedAt: ctx.timestamp,
    });
    // Re-fetch after update so performScavengeActivity inherits the new counter.
    ps = ctx.db.playerState.username.find(s.username)!;

    // === Combo state (Striker path) + click count for momentum capstone ===
    // Click count increments unconditionally on consecutive clicks within the
    // window so Momentum works even without the Combo node — they are siblings
    // in the Striker tree, not strict prereqs.
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    const COMBO_WINDOW_MICROS = 3_000_000n;
    const elapsed = ps.comboLastClickAtMicros > 0n
      ? nowMicros - ps.comboLastClickAtMicros
      : COMBO_WINDOW_MICROS + 1n; // treat "never clicked" as expired
    const inWindow = elapsed <= COMBO_WINDOW_MICROS;

    const comboEnabled = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.MANUAL_CLICK_COMBO_ENABLED);
    let comboBp = 0;
    if (comboEnabled > 0 && inWindow) {
      const COMBO_BP_PER_CLICK = 500; // +5% per hit
      const MAX_COMBO_BP = 5000;      // cap at +50%
      comboBp = Math.min(ps.comboBp + COMBO_BP_PER_CLICK, MAX_COMBO_BP);
    }
    const newClickCount = inWindow ? ps.comboClickCount + 1 : 1;

    ctx.db.playerState.username.update({
      ...ctx.db.playerState.username.find(s.username)!,
      comboLastClickAtMicros: nowMicros,
      comboBp,
      comboClickCount: newClickCount,
      updatedAt: ctx.timestamp,
    });
    ps = ctx.db.playerState.username.find(s.username)!;

    // === Momentum (Striker capstone) — free craft point at every Nth click ===
    const momentumThreshold = getCapabilityTotal(
      ctx,
      s.username,
      CAPABILITY_KEYS.COMBO_FREE_CRAFT_THRESHOLD
    );
    if (momentumThreshold > 0 && newClickCount % momentumThreshold === 0) {
      grantMomentumClassPoint(ctx, s.username);
    }

    // === yieldPer100 assembly ===
    // Start at 100 (= normal yield). Each additive bonus adds percentage points.
    // MANUAL_CLICK_YIELD_PCT_BP: 1000 bp = +10% → +10 yield points.
    const clickYieldBp = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.MANUAL_CLICK_YIELD_PCT_BP);
    let yieldPer100 = 100 + Math.floor(clickYieldBp / 100) + Math.floor(comboBp / 100);

    // === Crit ===
    const critChanceBp = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.MANUAL_CLICK_CRIT_CHANCE_BP);
    const critMultiplierBp = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.MANUAL_CLICK_CRIT_MULTIPLIER_BP);
    if (critChanceBp > 0) {
      const critSeed = buildSeed([ctx.timestamp.microsSinceUnixEpoch, s.username, newActionCount, 'crit']);
      const critRng = new Rng(critSeed);
      if (critRng.uniform() < critChanceBp / 10000) {
        // Crit: multiply the accumulated yieldPer100 by (1 + multiplierBp/10000).
        const critMult = 1 + (critMultiplierBp > 0 ? critMultiplierBp : 10000) / 10000;
        yieldPer100 = Math.floor(yieldPer100 * critMult);
      }
    }

    // === Main click ===
    const mainResult = performScavengeActivity(ctx, s.username, activityId, yieldPer100, true);
    const resourceId = mainResult.yieldResourceId;
    let totalGain = mainResult.gain;

    // === Extra ticks (MANUAL_CLICK_TICK_COUNT) ===
    // Each extra tick is a free additional yield pass (costs checked independently).
    const tickCount = getCapabilityTotal(ctx, s.username, CAPABILITY_KEYS.MANUAL_CLICK_TICK_COUNT);
    for (let i = 0; i < tickCount; i++) {
      const extra = performScavengeActivity(ctx, s.username, activityId, 100, true);
      totalGain += extra.gain;
    }

    if (totalGain <= 0n || resourceId === '') return;

    // === Fortune proc ===
    applyFortuneProc(ctx, s.username, resourceId, totalGain, newActionCount);

    // === Wide net ===
    applyWideNet(ctx, s.username, resourceId, totalGain, newActionCount);

    // === Vein drop (Wanderer capstone rich_veins) ===
    applyVeinDrop(ctx, s.username, newActionCount);

    // === Progress all automation slots ===
    // MANUAL_CLICK_PROGRESSES_ALL_SLOTS: each manual click also fires one free
    // scavenge tick for every automation-slotted structure the player has.
    const progressAllSlots = getCapabilityTotal(
      ctx, s.username, CAPABILITY_KEYS.MANUAL_CLICK_PROGRESSES_ALL_SLOTS
    );
    if (progressAllSlots > 0) {
      for (const tick of ctx.db.automationTick.automation_tick_username.filter(s.username)) {
        if (tick.activityId === activityId) continue; // already handled above
        const slotResult = performScavengeActivity(ctx, s.username, tick.activityId, 100, false);
        if (slotResult.gain > 0n) {
          // Wide net applies to slot auto-fires too (fortune proc skipped to limit spam).
          applyWideNet(ctx, s.username, slotResult.yieldResourceId, slotResult.gain, newActionCount);
        }
      }
    }
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

    const treeDef = ctx.db.skillTreeDefinition.treeId.find(def.treeId);
    if (treeDef === null) throw new SenderError('Tree definition missing');

    const poolRow = getPoolBalanceRow(ctx, s.username, treeDef.pointPoolId);
    if (poolRow.amount < def.costSkillPoints) {
      throw new SenderError('Not enough skill points');
    }

    if (def.prerequisiteSkillId !== '') {
      const prereqLevel = skillLevel(ctx, s.username, def.prerequisiteSkillId);
      if (prereqLevel < def.prerequisiteLevel) {
        throw new SenderError('Prerequisite not met');
      }
    }
    // Stat-gate: takes precedence over prerequisitePlayerLevel when set.
    if (def.prerequisiteStatId !== '' && def.prerequisiteStatId !== undefined) {
      const totals = getStatTotals(ctx, s.username);
      const statVal = totals[def.prerequisiteStatId] ?? 0;
      const required = def.prerequisiteStatValue ?? 0;
      if (statVal < required) {
        throw new SenderError(
          `Requires ${required} ${def.prerequisiteStatId} (you have ${statVal})`
        );
      }
    } else if (def.prerequisitePlayerLevel > 0 && ps.playerLevel < def.prerequisitePlayerLevel) {
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

    // Capstone lock check: if this node belongs to a capstone branch and the
    // player has already committed to a different node in that branch, reject.
    const capstoneBranchId = def.capstoneBranchId;
    if (capstoneBranchId !== '' && capstoneBranchId !== undefined) {
      for (const choice of ctx.db.playerCapstoneChoice.player_capstone_choice_username.filter(s.username)) {
        if (choice.capstoneBranchId === capstoneBranchId && choice.chosenSkillId !== skillId) {
          throw new SenderError(
            `Already committed to a different node in capstone branch "${capstoneBranchId}"`
          );
        }
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
    // infiniteScaling nodes have no cap — skip the maxLevel check for them.
    if (def.infiniteScaling !== true && currentLevel >= def.maxLevel) {
      throw new SenderError('Skill already at max level');
    }

    // Snapshot Beginner completion state BEFORE the level increment so we can
    // detect the spend that just completed the tree. Avoids re-firing on
    // every subsequent spend.
    const beginnerCompletedBefore = isTreeCompleted(ctx, s.username, 'beginner');

    const newLevel = currentLevel + 1;
    if (existing !== null) {
      ctx.db.playerSkill.id.update({
        ...existing,
        level: newLevel,
      });
    } else {
      ctx.db.playerSkill.insert({
        id: 0n,
        username: s.username,
        skillId,
        level: newLevel,
      });
    }

    ctx.db.playerSkillPointBalance.id.update({
      ...poolRow,
      amount: poolRow.amount - def.costSkillPoints,
    });

    // Record capstone choice on first purchase of a capstone node.
    if (capstoneBranchId !== '' && capstoneBranchId !== undefined && currentLevel === 0) {
      let choiceExists = false;
      for (const choice of ctx.db.playerCapstoneChoice.player_capstone_choice_username.filter(s.username)) {
        if (choice.capstoneBranchId === capstoneBranchId) {
          choiceExists = true;
          break;
        }
      }
      if (!choiceExists) {
        ctx.db.playerCapstoneChoice.insert({
          id: 0n,
          username: s.username,
          capstoneBranchId,
          chosenSkillId: skillId,
          chosenAt: ctx.timestamp,
        });
      }
    }

    // Apply stat grants for this skill — upserts replace prior level's contribution.
    for (const grant of ctx.db.skillStatGrant.skill_stat_grant_skill.filter(skillId)) {
      const sourceKey = `${s.username}:skill:${skillId}:${grant.statId}`;
      setStatSource(
        ctx,
        sourceKey,
        s.username,
        grant.statId,
        newLevel * grant.amountPerLevel
      );
    }

    // Class tree live update: if this skill belongs to a class tree AND the
    // player currently has that class equipped, apply capability sources with
    // class-namespaced keys so the equipped class reflects the new level.
    // v1: capabilities-only — no class-namespaced stat sources until Phase 2.
    if (CLASS_TREE_IDS.has(def.treeId)) {
      const equipped = ctx.db.playerEquippedClass.username.find(s.username);
      if (equipped !== null && equipped.classId === def.treeId) {
        for (const effect of ctx.db.classNodeEffect.class_node_effect_skill_id.filter(skillId)) {
          const sourceKey = `${s.username}:class:${def.treeId}:${skillId}:${effect.effectKey}`;
          setCapability(ctx, sourceKey, s.username, effect.effectKey, newLevel * effect.amountPerLevel);
        }
      }
    }

    // Beginner-complete notification: fires once on the spend that maxes the
    // last Beginner node. dedupeKey ensures a single notification survives
    // re-deploys / refunds.
    if (def.treeId === 'beginner' && !beginnerCompletedBefore) {
      if (isTreeCompleted(ctx, s.username, 'beginner')) {
        insertNotification(
          ctx,
          s.username,
          'system',
          'Beginner Skill Tree complete — Intermediate tab unlocked.',
          undefined,
          'tree_complete:beginner'
        );
      }
    }
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

// Add to the per-(player, resource) offline-bonus accumulator. Read on login
// to fire a single Forge Heart toast and clear the rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function accumulateOfflineEarning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  resourceId: string,
  amount: bigint
): void {
  if (amount <= 0n) return;
  const sourceKey = `${username}:${resourceId}`;
  const existing = ctx.db.playerOfflineEarning.sourceKey.find(sourceKey);
  if (existing === null) {
    ctx.db.playerOfflineEarning.insert({ sourceKey, username, resourceId, amount });
  } else {
    ctx.db.playerOfflineEarning.sourceKey.update({
      ...existing,
      amount: existing.amount + amount,
    });
  }
}

export const runAutomation = spacetimedb.reducer(
  { arg: automationTick.rowType },
  (ctx, { arg }) => {
    const structure = findPlayerStructure(ctx, arg.username, arg.structureId);
    if (structure === null) return;
    if (structure.slottedActivityId !== arg.activityId) return;

    // AUTOMATION_SLOT: total allowed automation slots = 1 + capability total.
    // Count active ticks to enforce the cap (ticks don't carry a slot index,
    // so we measure via the live row count for this player).
    const maxSlots = 1 + getCapabilityTotal(ctx, arg.username, CAPABILITY_KEYS.AUTOMATION_SLOT);
    let tickCount = 0;
    for (const _ of ctx.db.automationTick.automation_tick_username.filter(arg.username)) {
      tickCount += 1;
    }
    // The current row has NOT been deleted yet (scheduled reducers auto-delete
    // after the reducer returns), so the live count includes this tick.
    if (tickCount > maxSlots) return;

    let yieldPer100 = 100;
    for (const up of ctx.db.structureUpgradeDefinition.structure_upgrade_definition_structure.filter(
      arg.structureId
    )) {
      if (up.kind !== 'efficiency') continue;
      const lvl = structureUpgradeLevel(ctx, arg.username, up.upgradeId);
      yieldPer100 += lvl * up.yieldPerLevelPer100;
    }
    // AUTOMATION_YIELD_PCT_BP: class-tree bonus on top of efficiency upgrades.
    const autoYieldBp = getCapabilityTotal(ctx, arg.username, CAPABILITY_KEYS.AUTOMATION_YIELD_PCT_BP);
    yieldPer100 += Math.floor(autoYieldBp / 100);

    // AUTOMATION_PHALANX_PCT_BP: per-other-slot synergy bonus. tickCount
    // includes this tick, so subtract one to count siblings only. Solo slots
    // get no bonus — the math intentionally rewards parallel_frame investment.
    const phalanxBp = getCapabilityTotal(ctx, arg.username, CAPABILITY_KEYS.AUTOMATION_PHALANX_PCT_BP);
    if (phalanxBp > 0) {
      const otherSlots = Math.max(0, tickCount - 1);
      yieldPer100 += Math.floor((otherSlots * phalanxBp) / 100);
    }

    // OFFLINE_AUTOMATION_MULTIPLIER_BP (forge_heart): when no client session is
    // alive for this player, multiply yieldPer100 by (1 + bonus). Applied last
    // so it scales the full boosted yield (not just the base).
    const offlineMultBp = getCapabilityTotal(
      ctx,
      arg.username,
      CAPABILITY_KEYS.OFFLINE_AUTOMATION_MULTIPLIER_BP
    );
    let offlineApplied = false;
    if (offlineMultBp > 0) {
      let hasSession = false;
      for (const _ of ctx.db.session.session_username.filter(arg.username)) {
        hasSession = true;
        break;
      }
      if (!hasSession) {
        yieldPer100 = Math.floor((yieldPer100 * (10000 + offlineMultBp)) / 10000);
        offlineApplied = true;
      }
    }

    const result = performScavengeActivity(
      ctx,
      arg.username,
      arg.activityId,
      yieldPer100,
      false
    );

    if (result.gain > 0n) {
      // Automation fortune proc and wide net — seed action count from timestamp
      // + structureId to keep seeds distinct across concurrent ticks.
      const autoActionCount = ctx.timestamp.microsSinceUnixEpoch ^ BigInt(arg.structureId.length);
      applyFortuneProc(ctx, arg.username, result.yieldResourceId, result.gain, autoActionCount);
      applyWideNet(ctx, arg.username, result.yieldResourceId, result.gain, autoActionCount);

      // forge_heart bookkeeping — surface the offline-only portion to the
      // player on next login. bonus = gain × (offlineMultBp / (10000 + offlineMultBp)).
      if (offlineApplied) {
        const denom = BigInt(10000 + offlineMultBp);
        const bonus = (result.gain * BigInt(offlineMultBp)) / denom;
        if (bonus > 0n) {
          accumulateOfflineEarning(ctx, arg.username, result.yieldResourceId, bonus);
        }
      }

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
  const newLevel = ps.playerLevel + 1;
  ctx.db.playerState.username.update({
    ...ps,
    playerLevel: newLevel,
    updatedAt: ctx.timestamp,
  });
  const newBalance = addPoolBalance(ctx, s.username, 'general', 1);
  notifyLevelUp(ctx, s.username, newLevel, newBalance);
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

// Idempotently seeds the four core stat definitions. Safe to call repeatedly —
// existing rows are skipped. Needed because init only runs on first publish, but
// stat_definition was added after the initial deployment.
export const seedStats = spacetimedb.reducer(ctx => {
  seedStatDefinitions(ctx);
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

// ---------- Notifications ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notifyLevelUp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  username: string,
  newLevel: number,
  unspentSkillPoints: number
): void {
  const points = `${unspentSkillPoints} skill point${unspentSkillPoints === 1 ? '' : 's'} unspent`;
  insertNotification(
    ctx,
    username,
    'system',
    `Level up! You're now level ${newLevel} (${points}).`,
    undefined,
    'levelUp'
  );
}

export const markNotificationRead = spacetimedb.reducer(
  { notificationId: t.u64() },
  (ctx, { notificationId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const row = ctx.db.notification.notificationId.find(notificationId);
    if (row === null || row.recipient !== s.username) {
      throw new SenderError('Notification not found');
    }
    if (row.readAt !== undefined) return;
    ctx.db.notification.notificationId.update({ ...row, readAt: ctx.timestamp });
  }
);

export const markAllNotificationsRead = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  for (const n of ctx.db.notification.notification_recipient.filter(s.username)) {
    if (n.readAt === undefined) {
      ctx.db.notification.notificationId.update({ ...n, readAt: ctx.timestamp });
    }
  }
});

export const deleteNotification = spacetimedb.reducer(
  { notificationId: t.u64() },
  (ctx, { notificationId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const row = ctx.db.notification.notificationId.find(notificationId);
    if (row === null || row.recipient !== s.username) {
      throw new SenderError('Notification not found');
    }
    ctx.db.notification.notificationId.delete(notificationId);
  }
);

// ---------- Tutorial ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evaluateTutorialTrigger(ctx: any, username: string, trigger: any): boolean {
  switch (trigger.tag) {
    case 'chained':
      return true;
    case 'playerLevelAtLeast': {
      const ps = ctx.db.playerState.username.find(username);
      if (ps === null) return false;
      return ps.playerLevel >= trigger.value.level;
    }
    case 'skillPurchased': {
      for (const skill of ctx.db.playerSkill.player_skill_username.filter(username)) {
        if (skill.skillId === trigger.value.skillId && skill.level >= trigger.value.minLevel) {
          return true;
        }
      }
      return false;
    }
    case 'activityPerformed': {
      for (const pa of ctx.db.playerActivity.player_activity_username.filter(username)) {
        if (pa.activityId === trigger.value.activityId && pa.timesUsed >= trigger.value.minTimes) {
          return true;
        }
      }
      return false;
    }
    case 'treeCompleted': {
      // v1 — only the Beginner tree exists; check that every skill_definition is at maxLevel for this player.
      // TODO: filter by trigger.value.treeId once skill_definition has a treeId column (Skill Tree Tiers spec).
      const playerSkills = new Map<string, number>();
      for (const ps of ctx.db.playerSkill.player_skill_username.filter(username)) {
        playerSkills.set(ps.skillId, ps.level);
      }
      for (const def of ctx.db.skillDefinition.iter()) {
        const lvl = playerSkills.get(def.skillId) ?? 0;
        if (lvl < def.maxLevel) return false;
      }
      return true;
    }
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findActiveTutorialStep(ctx: any, username: string): any | null {
  const completed = new Set<string>();
  for (const p of ctx.db.playerTutorialProgress.player_tutorial_progress_username.filter(username)) {
    completed.add(p.stepId);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: any[] = [...ctx.db.tutorialStepDefinition.iter()].sort(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a: any, b: any) => a.sortOrder - b.sortOrder
  );
  for (const step of steps) {
    if (completed.has(step.stepId)) continue;
    if (step.prereqStepId !== '' && !completed.has(step.prereqStepId)) continue;
    if (!evaluateTutorialTrigger(ctx, username, step.triggerCondition)) continue;
    return step;
  }
  return null;
}

export const completeTutorialStep = spacetimedb.reducer(
  { stepId: t.string() },
  (ctx, { stepId }) => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (s === null) throw new SenderError('Not signed in');
    const active = findActiveTutorialStep(ctx, s.username);
    if (active === null || active.stepId !== stepId) {
      throw new SenderError('Step is not currently active');
    }
    ctx.db.playerTutorialProgress.insert({
      id: 0n,
      username: s.username,
      stepId,
      completedAt: ctx.timestamp,
    });
  }
);

export const skipTutorial = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s === null) throw new SenderError('Not signed in');
  const completed = new Set<string>();
  for (const p of ctx.db.playerTutorialProgress.player_tutorial_progress_username.filter(s.username)) {
    completed.add(p.stepId);
  }
  for (const step of ctx.db.tutorialStepDefinition.iter()) {
    if (!completed.has(step.stepId)) {
      ctx.db.playerTutorialProgress.insert({
        id: 0n,
        username: s.username,
        stepId: step.stepId,
        completedAt: ctx.timestamp,
      });
    }
  }
});

// ---------- Groups ----------

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
    const inviteRow = ctx.db.groupInvitation.insert({
      invitationId: 0n,
      groupId: myMembership.groupId,
      fromUsername: s.username,
      toUsername: target,
      createdAt: ctx.timestamp,
    });
    insertNotification(
      ctx,
      target,
      'groupInvite',
      `${s.username} invited you to a group`,
      inviteRow.invitationId,
      `groupInvite:${s.username}`
    );
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
    deleteNotificationByRef(ctx, s.username, 'groupInvite', invitationId);
    for (const other of ctx.db.groupInvitation.group_invitation_to_username.filter(
      s.username
    )) {
      ctx.db.groupInvitation.invitationId.delete(other.invitationId);
      deleteNotificationByRef(ctx, s.username, 'groupInvite', other.invitationId);
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
    deleteNotificationByRef(ctx, s.username, 'groupInvite', invitationId);
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
      deleteNotificationByRef(ctx, inv.toUsername, 'groupInvite', inv.invitationId);
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
