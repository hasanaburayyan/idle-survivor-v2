// Combat Feedback Primitives — public API
//
// Import from this file in all per-game specs and call sites.
// Do NOT import directly from individual primitive files.
//
// tokens.ts is also part of the public API — import colors and durations from
// there for any per-game customization rather than hardcoding inline literals.

export { default as DamagePop } from './DamagePop';
export { default as EventFloater } from './EventFloater';
export { default as FlashOverlay } from './FlashOverlay';
export { default as LaggingHpBar } from './LaggingHpBar';
export { default as ResultsPopup } from './ResultsPopup';
export { default as Wiggle } from './Wiggle';
export { PlayedCardPopout } from './PlayedCardPopout';
export type { PlayedCardPopoutAnchor } from './PlayedCardPopout';

// Token re-exports — colors, durations, easing
export * from './tokens';
