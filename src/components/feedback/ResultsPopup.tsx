import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { COLOR_BG_TINT, COLOR_CARD_BG, COLOR_CARD_BORDER, Easing, POPUP_AUTO_DISMISS_MS, POPUP_OPEN_MS } from './tokens';

interface ResultsPopupProps {
  visible: boolean;
  onDismiss: () => void;
  autoDismissMs?: number; // 0 = manual dismiss only; default POPUP_AUTO_DISMISS_MS
  children: React.ReactNode;
}

/**
 * Full-screen overlay popup with animated backdrop and a spring-scaled card.
 *
 * Animation:
 *   - Backdrop fades from 0 → 1 over POPUP_OPEN_MS.
 *   - Inner card scales from 0.85 → 1.0 over POPUP_OPEN_MS with a spring finish.
 *
 * Dismiss:
 *   - Tapping the backdrop calls onDismiss.
 *   - If autoDismissMs > 0, a timer fires onDismiss after that duration.
 *   - If the user dismisses manually before the timer fires, the timer is cleared.
 *
 * Z-index note: This is mounted inside a minigame view, not at the root level.
 * Ensure it renders above the minigame's hand strip. If it conflicts with a global
 * toast layer, wrap in a Portal when that layer is introduced.
 *
 * Children: the card body — game-specific content (CoinFlip result, card duel end screen,
 * etc.) lives there. The popup only owns backdrop, sizing, and animation.
 */
export default function ResultsPopup({
  visible,
  onDismiss,
  autoDismissMs = POPUP_AUTO_DISMISS_MS,
  children,
}: ResultsPopupProps) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.85)).current;
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      // Animate in.
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: POPUP_OPEN_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();

      // Schedule auto-dismiss if requested.
      if (autoDismissMs > 0) {
        dismissTimerRef.current = setTimeout(() => {
          onDismiss();
        }, autoDismissMs);
      }
    } else {
      // Clear any pending timer when dismissed externally (e.g. caller sets visible=false).
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      backdropOpacity.setValue(0);
      cardScale.setValue(0.85);
    }

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const handleBackdropPress = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    onDismiss();
  };

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={handleBackdropPress}
      accessible={false}
    >
      {/* Backdrop */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: COLOR_BG_TINT, opacity: backdropOpacity },
        ]}
        pointerEvents="none"
      />
      {/* Card — stops touch from propagating to backdrop */}
      <View style={styles.cardWrapper}>
        <Pressable onPress={() => { /* absorb press so backdrop doesn't fire */ }}>
          <Animated.View style={[styles.card, { transform: [{ scale: cardScale }] }]}>
            {children}
          </Animated.View>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: COLOR_CARD_BG,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: COLOR_CARD_BORDER,
  },
});
