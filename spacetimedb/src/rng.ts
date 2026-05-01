// Deterministic PRNG for crafting rolls.
// Reducers must be deterministic — no Math.random, no clock-based seeds outside ctx.
//
// Seed is derived from a hash of (ctx.timestamp + ctx.sender bytes + recipeId + craftCounter).
// The craftCounter (held on player_armory_state) guarantees distinct seeds even when two
// crafts happen in the same microsecond.
//
// Implementation: 64-bit linear congruential generator (mulberry32-style with a
// 64-bit state). Statistically sufficient for affix rolls; not cryptographic.

const MULT = 6364136223846793005n;
const INC = 1442695040888963407n;
const MASK = (1n << 64n) - 1n;

export class Rng {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed & MASK;
    if (this.state === 0n) this.state = 1n;
    // Burn one step so the first output isn't trivially correlated with the seed.
    this.uniform();
  }

  // Returns a uniform float in [0, 1).
  uniform(): number {
    this.state = (this.state * MULT + INC) & MASK;
    // Take the top 53 bits — JS Number can hold 53 bits of mantissa cleanly.
    const top = Number(this.state >> 11n) / 2 ** 53;
    return top;
  }

  // Returns an integer in [min, max] inclusive.
  intInRange(min: number, max: number): number {
    if (max <= min) return min;
    const span = max - min + 1;
    return min + Math.floor(this.uniform() * span);
  }
}

// FNV-1a-style hash that mixes a string into a 64-bit accumulator.
function mixString(acc: bigint, s: string): bigint {
  let h = acc;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 1099511628211n) & MASK;
  }
  return h;
}

// Builds a 64-bit seed from a list of inputs. Order matters.
export function buildSeed(parts: (string | bigint | number)[]): bigint {
  let h = 14695981039346656037n;
  for (const p of parts) {
    if (typeof p === 'string') {
      h = mixString(h, p);
    } else if (typeof p === 'bigint') {
      h ^= p & MASK;
      h = (h * 1099511628211n) & MASK;
    } else {
      h ^= BigInt(Math.floor(p)) & MASK;
      h = (h * 1099511628211n) & MASK;
    }
  }
  return h;
}

// Weighted selection without replacement.
// Picks `count` items from `pool` using each item's `weight`. If pool has fewer
// items than `count`, returns all of them (in original order).
export function pickWeightedWithoutReplacement<T>(
  rng: Rng,
  pool: { item: T; weight: number }[],
  count: number
): T[] {
  const remaining = pool.slice();
  const picks: T[] = [];
  while (picks.length < count && remaining.length > 0) {
    const totalWeight = remaining.reduce((s, x) => s + x.weight, 0);
    if (totalWeight <= 0) break;
    let r = rng.uniform() * totalWeight;
    let chosenIdx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      r -= remaining[i]!.weight;
      if (r <= 0) {
        chosenIdx = i;
        break;
      }
    }
    picks.push(remaining[chosenIdx]!.item);
    remaining.splice(chosenIdx, 1);
  }
  return picks;
}

// The roll formula from the Equipment & Armory Stat Rework spec.
// At armoryLevel 1, average is ~midpoint. At maxArmoryLevel, distribution skews
// toward max (avg ~85% of range).
export function rollAffixAmount(
  rng: Rng,
  min: number,
  max: number,
  armoryLevel: number,
  maxArmoryLevel: number
): number {
  if (max <= min) return min;
  const denom = Math.max(1, maxArmoryLevel - 1);
  const bias = Math.max(0, Math.min(1, (armoryLevel - 1) / denom));
  const u = rng.uniform();
  const exponent = 1 - bias * 0.7;
  const skewed = Math.pow(u, exponent);
  return Math.round(min + skewed * (max - min));
}
