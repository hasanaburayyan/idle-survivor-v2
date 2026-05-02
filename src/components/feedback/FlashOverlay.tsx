import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { Easing, FLASH_FADE_IN_MS, FLASH_FADE_OUT_MS, FLASH_HOLD_MS } from './tokens';

interface FlashOverlayProps {
  trigger: number;               // bump on each event to replay the animation
  color: string;                 // import from tokens, e.g. COLOR_DAMAGE
  durationMs?: number;           // override total duration; default = sum of envelope constants
  fillMode?: 'tint' | 'border'; // 'tint' = fill parent container; 'border' = 2px stroke only
  intensity?: number;            // peak opacity 0..1; default 0.55
                                 // Use ~0.30 for high-frequency events (Rhythm Tap lane press)
                                 // to avoid strobe-like flicker
}

/**
 * Renders an absolutely-positioned Animated.View over the parent container.
 * Opacity envelope: 0 → intensity → 0 over FLASH_FADE_IN + FLASH_HOLD + FLASH_FADE_OUT.
 *
 * PARENT MUST have position: 'relative' (or equivalent) so absoluteFill works.
 * pointerEvents="none" ensures the overlay never blocks touch input.
 *
 * Bumping `trigger` while an animation is in-flight cancels it and restarts immediately.
 */
export default function FlashOverlay({
  trigger,
  color,
  durationMs,
  fillMode = 'tint',
  intensity = 0.55,
}: FlashOverlayProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (trigger === 0) return;

    // Cancel any in-flight animation and hard-reset before replaying.
    if (animRef.current) {
      animRef.current.stop();
    }
    opacity.setValue(0);

    const totalMs = durationMs ?? FLASH_FADE_IN_MS + FLASH_HOLD_MS + FLASH_FADE_OUT_MS;
    // Scale each phase proportionally if a custom total is given.
    const scale = durationMs != null ? totalMs / (FLASH_FADE_IN_MS + FLASH_HOLD_MS + FLASH_FADE_OUT_MS) : 1;
    const fadeIn = FLASH_FADE_IN_MS * scale;
    const hold = FLASH_HOLD_MS * scale;
    const fadeOut = FLASH_FADE_OUT_MS * scale;

    const anim = Animated.sequence([
      Animated.timing(opacity, {
        toValue: intensity,
        duration: fadeIn,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(hold),
      Animated.timing(opacity, {
        toValue: 0,
        duration: fadeOut,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    animRef.current = anim;
    anim.start(() => {
      animRef.current = null;
    });
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fillMode === 'border') {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.border,
          { borderColor: color, opacity },
        ]}
      />
    );
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  border: {
    borderWidth: 2,
    borderRadius: 8, // matches the most common card radius in the app
  },
});
