// Combat Feedback Primitives — single source of truth for animation timings and colors.
// Every primitive imports from here. Per-game specs import from here for any inline tweak.
// Do NOT hardcode color literals or duration literals in primitive files.

import { Easing } from 'react-native';

// ---------------------------------------------------------------------------
// Durations (ms)
// ---------------------------------------------------------------------------

export const FLASH_FADE_IN_MS = 80;
export const FLASH_HOLD_MS = 100;
export const FLASH_FADE_OUT_MS = 200;       // total flash envelope ~380ms

export const WIGGLE_MS = 320;

export const HP_LAG_DELAY_MS = 220;         // pause before red ghost bar starts collapsing
export const HP_LAG_LERP_MS = 380;          // how long the ghost bar collapse takes

export const POPUP_OPEN_MS = 280;
export const POPUP_AUTO_DISMISS_MS = 4000;  // 0 = stay open until tapped

export const SHRINK_OUT_MS = 240;           // card-removal animation in CardDuel

// Played Card Popout — narrative feedback envelope, exempt from the 600ms
// in-loop responsiveness cap because this is a "what just happened" artifact,
// not a tap-feedback signal. Total ~1.7s (POPUP_OPEN_MS emerge + hold + slide).
export const POPOUT_HOLD_MS = 1000;
export const POPOUT_SLIDE_MS = 400;
export const POPOUT_SLIDE_DISTANCE = 40;    // px upward drift during slide+fade

// ---------------------------------------------------------------------------
// Colors — kept in sync with the Tailwind palette used across the app
// ---------------------------------------------------------------------------

// The two greens are intentionally distinct:
//   COLOR_HIT: mid-tone emerald-400 — "actor did something" / generic positive signal
//   COLOR_HEAL_VIBRANT: lighter emerald-300 — "recipient received a heal"
// When a player both deals and receives a heal in quick succession, the two reads
// as two separate beats. Do not collapse these into one value.
export const COLOR_HIT = '#34d399';           // emerald-400 — generic positive signal
export const COLOR_HP_BAR = '#10b981';        // emerald-500 — HP bar healthy fill
export const COLOR_HEAL_VIBRANT = '#6ee7b7';  // emerald-300 — heal applied to ally
export const COLOR_MISS = '#fb7185';          // rose-400 — missed input
export const COLOR_DAMAGE = '#f43f5e';        // rose-500 — damage taken
export const COLOR_SHIELD = '#38bdf8';        // sky-400 — ward / shield / protect
export const COLOR_PLAY = '#34d399';          // emerald-400 — actor "I played a card"
export const COLOR_ZOMBIE_HIT = '#fcd34d';    // amber-300 — zombie damage pop in Defensive Battle
export const COLOR_BG_TINT = 'rgba(15, 23, 42, 0.85)'; // slate-900/85 — popup backdrop
export const COLOR_CARD_BG = '#0f172a';       // slate-900 — popup card background
export const COLOR_CARD_BORDER = '#334155';   // slate-700 — popup card border
export const COLOR_HP_TRACK = '#1e293b';      // slate-800 — HP bar background track

// ---------------------------------------------------------------------------
// Easing — re-exported from RN to keep call sites short
// ---------------------------------------------------------------------------

export { Easing };

// ---------------------------------------------------------------------------
// Motion flag — reserved for a future reduced-motion settings toggle.
// Not wired to any UI in v1; primitives do not check this yet.
// ---------------------------------------------------------------------------

export const motionEnabled = true;
