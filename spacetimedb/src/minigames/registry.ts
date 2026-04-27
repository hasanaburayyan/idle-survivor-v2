import type { MinigameKindTag } from './tables';

export type MinigameStyle = 'realtime' | 'turnBased';
export type MinigameMode = 'competitive' | 'coop';

export interface MinigameMeta {
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  style: MinigameStyle;
  mode: MinigameMode;
  soloAllowed: boolean;
}

export type Reward =
  | { kind: 'scrap'; amount: bigint }
  | { kind: 'xp'; amount: bigint }
  | { kind: 'item'; resourceId: string; quantity: bigint }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'custom'; description: string; apply: (ctx: any, username: string) => void };

export interface MinigameEndResult {
  placements: { username: string; placement: number; finalScore: bigint }[];
  rewards: { username: string; rewards: Reward[] }[];
}

export type LeaveReason = 'disconnect' | 'idle' | 'leave';
export type LeaveDecision = 'forfeit' | 'kick' | 'pause';

export interface MinigameHandler {
  kind: MinigameKindTag;
  meta: MinigameMeta;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(ctx: any, session: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStart(ctx: any, session: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onTick?(ctx: any, session: any, tickKind: string, payload: string): void;
  onPlayerLeave(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    member: any,
    reason: LeaveReason
  ): LeaveDecision;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEnd(ctx: any, session: any): MinigameEndResult;
}

const handlers: Partial<Record<MinigameKindTag, MinigameHandler>> = {};

export function registerHandler(handler: MinigameHandler): void {
  handlers[handler.kind] = handler;
}

export function getHandler(kind: MinigameKindTag): MinigameHandler | undefined {
  return handlers[kind];
}

export function listHandlers(): MinigameHandler[] {
  return Object.values(handlers).filter((h): h is MinigameHandler => h !== undefined);
}
