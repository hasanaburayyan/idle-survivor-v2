// Mirrors server's applyResourceYieldBonus + structure efficiency for non-
// scrap chains. Keep in sync with spacetimedb/src/structures.ts.
//
// Formula:
//   base       = 1 + floor(efficiencyPct / 100)   (structure efficiency upgrade)
//   withFlat   = base + minorLevel * 2            (skill chain Minor — flat)
//   withMajor  = withFlat * (100 + majorLevel * 75) / 100   (skill chain Major — %)

export interface YieldRow {
  upgradeId: string;
  level: number;
}

export interface UpgradeDef {
  upgradeId: string;
  structureId: string;
  kind: string;
  yieldPerLevelPer100: number;
}

export interface SkillRow {
  skillId: string;
  level: number;
}

export interface YieldBreakdown {
  baseYield: bigint;            // 1 + structure efficiency bonus
  efficiencyPct: number;        // % from structure efficiency upgrade
  minorLevel: number;
  majorLevel: number;
  flatBonus: bigint;            // minor level * 2
  majorPct: number;             // major level * 75
  finalYield: bigint;           // (baseYield + flatBonus) * (1 + majorPct/100)
}

export function computeStructureEfficiencyPct(
  structureId: string,
  upgrades: readonly UpgradeDef[],
  playerUpgrades: readonly YieldRow[]
): number {
  return upgrades.reduce((sum, up) => {
    if (up.structureId !== structureId || up.kind !== 'efficiency') return sum;
    const lvl = playerUpgrades.find((p) => p.upgradeId === up.upgradeId)?.level ?? 0;
    return sum + lvl * up.yieldPerLevelPer100;
  }, 0);
}

// Compute a non-scrap yield breakdown given the base unit (1 for a per-job
// payout, or batch size for the workbench fabric craft).
export function computeNonScrapYield(
  baseUnit: bigint,
  structureId: string | null,
  skillPrefix: string,
  upgrades: readonly UpgradeDef[],
  playerUpgrades: readonly YieldRow[],
  playerSkills: readonly SkillRow[]
): YieldBreakdown {
  const efficiencyPct = structureId
    ? computeStructureEfficiencyPct(structureId, upgrades, playerUpgrades)
    : 0;
  // Mirrors server: base = baseUnit + floor(efficiencyPct/100). For per-job
  // structures (refinery/smelter/garden) baseUnit is 1; for fabric batches
  // it's the batch count.
  const baseYield =
    structureId !== null
      ? baseUnit + BigInt(Math.floor(efficiencyPct / 100))
      : baseUnit;

  const minorLevel =
    playerSkills.find((s) => s.skillId === `${skillPrefix}_minor_multiplier`)?.level ?? 0;
  const majorLevel =
    playerSkills.find((s) => s.skillId === `${skillPrefix}_major_multiplier`)?.level ?? 0;
  const flatBonus = BigInt(minorLevel * 2);
  const majorPct = majorLevel * 75;
  const withFlat = baseYield + flatBonus;
  const finalYield = withFlat + (withFlat * BigInt(majorPct)) / 100n;

  return {
    baseYield,
    efficiencyPct,
    minorLevel,
    majorLevel,
    flatBonus,
    majorPct,
    finalYield,
  };
}
