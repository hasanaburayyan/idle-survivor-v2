export type GroupColor = 'none' | 'blue' | 'green' | 'gold' | 'red';

interface Contribution {
  contributor: string;
  recipient: string;
  createdAt: { microsSinceUnixEpoch: bigint };
}

const TEN_SECONDS_MICROS = 10_000_000n;

export function groupColor(
  contributions: readonly Contribution[],
  viewerUsername: string,
  memberUsername: string,
  nowMicros: bigint
): GroupColor {
  let gave = false;
  let received = false;
  for (const e of contributions) {
    if (nowMicros - e.createdAt.microsSinceUnixEpoch > TEN_SECONDS_MICROS) {
      continue;
    }
    if (e.contributor === viewerUsername && e.recipient === memberUsername) {
      gave = true;
    } else if (
      e.contributor === memberUsername &&
      e.recipient === viewerUsername
    ) {
      received = true;
    }
    if (gave && received) return 'gold';
  }
  if (gave) return 'blue';
  if (received) return 'green';
  return 'none';
}

export function colorToClasses(color: GroupColor): string {
  switch (color) {
    case 'blue':
      return 'border-sky-500 bg-sky-500/20';
    case 'green':
      return 'border-emerald-500 bg-emerald-500/20';
    case 'gold':
      return 'border-amber-400 bg-amber-400/20';
    case 'red':
      return 'border-rose-500 bg-rose-500/20';
    case 'none':
    default:
      return 'border-slate-800 bg-slate-900';
  }
}
