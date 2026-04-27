import type { ComponentType } from 'react';
import CoinFlipView from './CoinFlipView';
import RhythmTapView from './RhythmTapView';
import CardDuelView from './CardDuelView';

export type MinigameKindTag = 'CoinFlip' | 'RhythmTap' | 'CardDuel';

export interface MinigameClientDescriptor {
  kind: MinigameKindTag;
  displayName: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  View: ComponentType<{ session: any }>;
}

export const minigameRegistry: Partial<Record<MinigameKindTag, MinigameClientDescriptor>> = {
  CoinFlip: {
    kind: 'CoinFlip',
    displayName: 'Coin Flip',
    description: 'Ante 10 scrap. Pick a side. Winners split the pot.',
    View: CoinFlipView,
  },
  RhythmTap: {
    kind: 'RhythmTap',
    displayName: 'Rhythm Tap',
    description: 'Tap notes as they reach the line. Co-op or solo. 30 seconds.',
    View: RhythmTapView,
  },
  CardDuel: {
    kind: 'CardDuel',
    displayName: 'Card Duel',
    description: '1v1 card duel. Same starter deck. Drop the opponent to 0 HP to win.',
    View: CardDuelView,
  },
};

export function getDescriptor(kind: MinigameKindTag): MinigameClientDescriptor | undefined {
  return minigameRegistry[kind];
}
