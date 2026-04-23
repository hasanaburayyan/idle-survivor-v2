export function computeScavengeGain(
  baseLevel: number,
  percentLevel: number
): bigint {
  const base = 1n + BigInt(baseLevel);
  const gain = (base * (100n + BigInt(percentLevel))) / 100n;
  return gain < 1n ? 1n : gain;
}

export function computeGroupShare(
  gain: bigint,
  groupBaseLevel: number,
  groupPercentLevel: number
): bigint {
  const base = gain / 10n + BigInt(groupBaseLevel);
  const share = (base * (100n + BigInt(groupPercentLevel))) / 100n;
  return share < 1n ? 1n : share;
}

export function xpToNextLevel(currentLevel: number): bigint {
  return BigInt(20 + currentLevel * 10);
}
