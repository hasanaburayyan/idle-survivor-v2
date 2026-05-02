import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { COLOR_DAMAGE, COLOR_HEAL_VIBRANT, Easing } from './tokens';

interface DamagePopProps {
  value: number;
  color?: string; // explicit color override; falls back to heal/damage auto-detection
                  // Per-game specs pass colors from tokens.ts (e.g. COLOR_DAMAGE, COLOR_HIT)
}

/**
 * Detects HP changes and pops the delta as an animated number that floats up
 * and fades out. Renders a tiny floating Animated.Text over the caller's location.
 *
 * Trigger pattern: the component observes the `value` prop; each change fires the
 * animation. This is the bumped-key pattern — no imperative ref needed at the call site.
 *
 * If no `color` is passed:
 *   - Positive delta (heal): COLOR_HEAL_VIBRANT (emerald-300)
 *   - Negative delta (damage): COLOR_DAMAGE (rose-500)
 *
 * Relocated from DefensiveBattleScreen.tsx (lines 637–695) and generalized.
 * The `kind: 'participant' | 'zombie'` prop is replaced by `color: string` so any
 * call site can supply the right token color without baking game-specific logic here.
 */
export default function DamagePop({ value, color }: DamagePopProps) {
  const prev = useRef(value);
  const [delta, setDelta] = useState<number | null>(null);
  const [seq, setSeq] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (value !== prev.current) {
      const diff = value - prev.current;
      prev.current = value;
      if (diff !== 0) {
        setDelta(diff);
        setSeq(s => s + 1);
        anim.setValue(0);
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 480,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setDelta(null);
        });
      }
    }
  }, [value, anim]);

  if (delta === null) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -16],
  });
  const opacity = anim.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 1, 0],
  });

  const isHeal = delta > 0;
  const resolvedColor = color ?? (isHeal ? COLOR_HEAL_VIBRANT : COLOR_DAMAGE);

  return (
    <Animated.Text
      key={seq}
      style={{
        fontSize: 12,
        fontWeight: '600',
        color: resolvedColor,
        transform: [{ translateY }],
        opacity,
      }}
    >
      {isHeal ? `+${delta}` : delta}
    </Animated.Text>
  );
}
