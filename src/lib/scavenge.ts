export function scavengePower(level: number): bigint {
  return BigInt(level) + 1n;
}

export function upgradeCost(level: number): bigint {
  let cost = 10n;
  for (let i = 0; i < level; i++) {
    cost = (cost * 3n) / 2n;
  }
  return cost;
}

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];

export function formatScrap(n: bigint): string {
  if (n < 1000n) return n.toString();
  let magnitude = 0;
  let value = n;
  while (value >= 1000n && magnitude < SUFFIXES.length - 1) {
    value /= 1000n;
    magnitude++;
  }
  const remainder = Number(n / pow10(magnitude * 3 - 2)) / 100;
  const display =
    remainder >= 100 ? remainder.toFixed(0) : remainder.toFixed(2);
  return `${display}${SUFFIXES[magnitude]}`;
}

function pow10(p: number): bigint {
  let v = 1n;
  for (let i = 0; i < p; i++) v *= 10n;
  return v;
}

export const BURST_BASE = 40n;

export interface BurstTier {
  power: number;
  count: number;
}

export function decomposeBurst(gain: bigint): BurstTier[] {
  if (gain <= 0n) return [];
  const tiers: BurstTier[] = [];
  let remaining = gain;
  let power = 0;
  while (remaining > 0n) {
    const digit = Number(remaining % BURST_BASE);
    if (digit > 0) tiers.push({ power, count: digit });
    remaining /= BURST_BASE;
    power++;
  }
  return tiers;
}

export function tierScale(power: number): number {
  return 1 + power * 0.6;
}

export function tierValue(power: number): bigint {
  let v = 1n;
  for (let i = 0; i < power; i++) v *= BURST_BASE;
  return v;
}
