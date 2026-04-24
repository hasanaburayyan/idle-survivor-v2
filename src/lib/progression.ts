export function computeScavengeGain(
  baseBonus: number,
  multiplierLevel: number
): bigint {
  const base = 1n + BigInt(baseBonus);
  const gain = (base * (100n + BigInt(multiplierLevel * 25))) / 100n;
  return gain < 1n ? 1n : gain;
}

export function upgradeCost(level: number): bigint {
  let cost = 10n;
  for (let i = 0; i < level; i++) {
    cost = (cost * 3n) / 2n;
  }
  return cost;
}

export function xpToNextLevel(currentLevel: number): bigint {
  return BigInt(20 + currentLevel * 10);
}
