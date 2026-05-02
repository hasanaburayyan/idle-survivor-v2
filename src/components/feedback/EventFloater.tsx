import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { COLOR_FORTUNE_PROC, Easing } from './tokens';

interface EventFloaterProps {
  label: string;
  trigger: number;
  color?: string;
  durationMs?: number;
}

/**
 * Free-text floater for event feedback (fortune procs, wide-net bursts, etc.).
 * Trigger pattern: caller bumps `trigger`, animation replays. `trigger === 0`
 * is a no-op on first mount, matching FlashOverlay convention.
 *
 * DamagePop is numeric-delta-only; this is the text-label variant.
 */
export default function EventFloater({
  label,
  trigger,
  color,
  durationMs = 700,
}: EventFloaterProps) {
  const [visible, setVisible] = useState(false);
  const [seq, setSeq] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const prevTrigger = useRef(0);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;
    if (trigger === 0) return;

    setVisible(true);
    setSeq(s => s + 1);
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
    });
  }, [trigger, anim, durationMs]);

  if (!visible) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -28],
  });
  const opacity = anim.interpolate({
    inputRange: [0, 0.15, 0.6, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <Animated.Text
      key={seq}
      style={{
        fontSize: 14,
        fontWeight: '600',
        color: color ?? COLOR_FORTUNE_PROC,
        transform: [{ translateY }],
        opacity,
      }}
    >
      {label}
    </Animated.Text>
  );
}
