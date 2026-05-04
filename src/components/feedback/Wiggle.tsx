import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Easing, WIGGLE_MS } from './tokens';

interface WiggleProps {
  trigger: number;               // bump on each event to replay the animation
  axis?: 'x' | 'rotate';        // 'x' = horizontal translation; 'rotate' = rotation
  amplitude?: number;            // px (axis='x') or degrees (axis='rotate'); default 4
  children: React.ReactNode;
}

/**
 * Wraps children in an Animated.View. On each `trigger` bump, runs a
 * 2-oscillation sequence: 0 → +amp → −amp → +amp/2 → 0 over WIGGLE_MS.
 *
 * Two oscillations is intentional — three reads as "the UI is broken."
 * Child position is guaranteed to return to exactly 0 after each run;
 * rapid triggers cancel in-flight and restart from 0, so resting position
 * never drifts.
 */
export default function Wiggle({
  trigger,
  axis = 'x',
  amplitude = 4,
  children,
}: WiggleProps) {
  const value = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (trigger === 0) return;

    if (animRef.current) {
      animRef.current.stop();
    }
    // Always reset to zero before replaying so resting position never drifts.
    value.setValue(0);

    const step = WIGGLE_MS / 4;

    const anim = Animated.sequence([
      Animated.timing(value, {
        toValue: amplitude,
        duration: step,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: -amplitude,
        duration: step,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: amplitude / 2,
        duration: step,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: 0,
        duration: step,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    animRef.current = anim;
    anim.start(() => {
      // Guarantee rest at exactly 0 after sequence completes.
      value.setValue(0);
      animRef.current = null;
    });
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const transform =
    axis === 'rotate'
      ? [{ rotate: value.interpolate({ inputRange: [-amplitude, amplitude], outputRange: [`-${amplitude}deg`, `${amplitude}deg`] }) }]
      : [{ translateX: value }];

  return (
    <Animated.View style={{ transform }}>
      {children}
    </Animated.View>
  );
}
