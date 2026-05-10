import { useEffect, useRef } from 'react';
import { Animated, Easing, Text } from 'react-native';
import SafePressable from './SafePressable';

interface Props {
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  size?: 'sm' | 'md';
  // primary = emerald (most common upgrade), accent = amber (rare/special), danger = rose
  variant?: 'primary' | 'accent' | 'danger';
  accessibilityLabel?: string;
}

// Reusable single-purpose upgrade button. Small square footprint, clear up
// arrow, tactile press feedback (scale-down + brighter background). Designed
// for surfaces where the same button gets pressed repeatedly — refinery /
// smelter / armory / scavenge level — so the per-press feedback matters more
// than visual hierarchy with surrounding labels.
//
// Caller is responsible for showing cost / level / max-state text *next to*
// the button; this component renders only the action affordance.
const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'w-9 h-9',
  md: 'w-11 h-11',
};

const ARROW_SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
};

const VARIANT_BG: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-emerald-500 active:bg-emerald-300',
  accent: 'bg-amber-500 active:bg-amber-300',
  danger: 'bg-rose-500 active:bg-rose-300',
};

const VARIANT_BORDER: Record<NonNullable<Props['variant']>, string> = {
  primary: 'border-emerald-300',
  accent: 'border-amber-300',
  danger: 'border-rose-300',
};

export default function UpgradeButton({
  onPress,
  disabled = false,
  busy = false,
  size = 'md',
  variant = 'primary',
  accessibilityLabel = 'Upgrade',
}: Props) {
  const isInactive = disabled || busy;

  // Animated.Value driven scale: dips to 0.88 instantly on press-in, springs
  // back to 1.0 on press-out. Feels punchy without overshooting.
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    if (isInactive) return;
    Animated.timing(scale, {
      toValue: 0.88,
      duration: 60,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const onPressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 220,
      useNativeDriver: true,
    }).start();
  };

  // Subtle pulse while idle and affordable so the button stays visible without
  // the player having to scan for it. Only animates when the button is live.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isInactive) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isInactive, pulse]);

  const arrowOpacity = isInactive
    ? 0.5
    : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  return (
    <SafePressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={isInactive}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className={`${SIZE_CLASS[size]} rounded-lg items-center justify-center border-2 ${
        isInactive
          ? 'bg-slate-900 border-slate-800'
          : `${VARIANT_BG[variant]} ${VARIANT_BORDER[variant]}`
      }`}
    >
      <Animated.View style={{ transform: [{ scale }], opacity: arrowOpacity }}>
        <Text
          className={`${ARROW_SIZE_CLASS[size]} font-bold leading-none ${
            isInactive ? 'text-slate-700' : 'text-slate-950'
          }`}
          style={{ includeFontPadding: false }}
        >
          ↑
        </Text>
      </Animated.View>
    </SafePressable>
  );
}
