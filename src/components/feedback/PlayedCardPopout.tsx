import { useEffect, useMemo, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import {
  COLOR_CARD_BG,
  COLOR_CARD_BORDER,
  POPOUT_HOLD_MS,
  POPOUT_SLIDE_DISTANCE,
  POPOUT_SLIDE_MS,
  POPUP_OPEN_MS,
} from './tokens';

const CARD_WIDTH = 150;
const CARD_HEIGHT = 78;

// Targeting strings match the SpacetimeDB binding's enum variant casing
// (PascalCase) so callers can pass the action def's targeting.tag verbatim.
const TARGETING_LABELS: Record<string, string> = {
  SingleEnemy: '1 enemy',
  AllEnemies: 'all enemies',
  SingleAlly: '1 ally',
  AllAllies: 'all allies',
  PartyIncludingSelf: 'party',
};

function formatOutcome(
  kind: string,
  totalAmount: number,
  targetCount: number
): string {
  if (kind === 'damage') {
    if (targetCount <= 1) return `${totalAmount} dmg`;
    return `${totalAmount} dmg ×${targetCount} targets`;
  }
  if (kind === 'healAmount') {
    if (targetCount <= 1) return `+${totalAmount} HP`;
    return `+${totalAmount} HP ×${targetCount} allies`;
  }
  if (kind === 'healFull') {
    if (targetCount <= 1) return 'Full HP';
    return `Full HP ×${targetCount}`;
  }
  if (kind === 'ward') {
    const wardLabel = totalAmount === 1 ? 'ward' : 'wards';
    if (targetCount <= 1) return `+${totalAmount} ${wardLabel}`;
    return `+${totalAmount} ${wardLabel} ×${targetCount} party`;
  }
  return '';
}

export interface PlayedCardPopoutAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlayedCardPopoutProps {
  // Bumped per event to replay. Same primitive pattern as the other feedback
  // components — parent state increments this; the effect keys on it.
  trigger: number;
  // Action def fields. Resolved by the caller against actionDefinition.
  displayName: string;
  targetingTag: string;
  // Resolved outcome from the actionResolved log payload.
  kind: string;
  totalAmount: number;
  targetCount: number;
  // Screen-relative anchor (e.g. from useSpotlightTarget / measureInWindow).
  // null disables the popout — useful before first registration.
  anchor: PlayedCardPopoutAnchor | null;
}

/**
 * Played Card Popout — emerges from a participant's nameplate, displays the
 * resolved outcome of the played card, then slides upward and fades.
 *
 * Most-recent-wins per instance: a new trigger cancels the in-flight animation
 * and replays from scratch with the new payload. See spec Decision 4.
 *
 * Mounted at screen root with absolute positioning. Anchor uses screen-relative
 * coordinates from `View.measureInWindow`. If the anchor changes between runs
 * (e.g. layout reflow), the popout snaps to the new position on next trigger.
 */
export function PlayedCardPopout({
  trigger,
  displayName,
  targetingTag,
  kind,
  totalAmount,
  targetCount,
  anchor,
}: PlayedCardPopoutProps) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const anchorRef = useRef<PlayedCardPopoutAnchor | null>(anchor);

  // Snapshot the anchor at trigger time so mid-flight layout reflows don't
  // teleport the popout. The card stays where it spawned for its envelope.
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);

  useEffect(() => {
    if (trigger <= 0) return;
    if (!anchorRef.current) return;

    // Reset to start state. stopAnimation cancels any in-flight tween for
    // most-recent-wins — a rapid second trigger replaces, not stacks.
    scale.stopAnimation();
    opacity.stopAnimation();
    translateY.stopAnimation();
    scale.setValue(0.85);
    opacity.setValue(0);
    translateY.setValue(0);

    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          tension: 220,
          friction: 14,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: POPUP_OPEN_MS,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(POPOUT_HOLD_MS),
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -POPOUT_SLIDE_DISTANCE,
          duration: POPOUT_SLIDE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: POPOUT_SLIDE_MS,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const outcome = useMemo(
    () => formatOutcome(kind, totalAmount, targetCount),
    [kind, totalAmount, targetCount]
  );
  const targetingLabel = TARGETING_LABELS[targetingTag] ?? targetingTag;

  // No anchor or never triggered → render nothing.
  if (!anchor || trigger <= 0) return null;

  // Center horizontally on the nameplate; spawn just above its top edge so
  // the popout reads as "emerging from" the nameplate without occluding it.
  const left = anchor.x + anchor.width / 2 - CARD_WIDTH / 2;
  const top = anchor.y - CARD_HEIGHT - 4;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left,
        top,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        opacity,
        transform: [{ scale }, { translateY }],
        backgroundColor: COLOR_CARD_BG,
        borderColor: COLOR_CARD_BORDER,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
        zIndex: 100,
      }}
    >
      <Text
        className="text-[13px] font-semibold text-slate-100"
        numberOfLines={1}
      >
        {displayName}
      </Text>
      <View className="self-start rounded-md bg-slate-800 px-1.5 py-0.5 mt-1">
        <Text className="text-[9px] uppercase tracking-widest text-amber-300">
          {targetingLabel}
        </Text>
      </View>
      <Text
        className="text-[13px] font-semibold text-amber-300 mt-1"
        numberOfLines={1}
      >
        {outcome}
      </Text>
    </Animated.View>
  );
}
