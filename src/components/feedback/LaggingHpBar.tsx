import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { COLOR_DAMAGE, COLOR_HP_BAR, COLOR_HP_TRACK, Easing, HP_LAG_DELAY_MS, HP_LAG_LERP_MS } from './tokens';

interface LaggingHpBarProps {
  currentHp: number;
  maxHp: number;
  height?: number;    // default 8
  fillColor?: string; // default: emerald-500 above 33%, rose-500 at or below 33%
  ghostColor?: string;// default COLOR_DAMAGE
}

/**
 * Three-layer HP bar:
 *   1. Background — slate-800, full width.
 *   2. Ghost (red lag bar) — lerps from prevHpPct to currentHpPct after HP_LAG_DELAY_MS.
 *      When HP increases (heal), the ghost snaps immediately — no red lag for heals.
 *      When HP drops rapidly in succession, ghost re-anchors to the new prevHpPct; we
 *      do NOT queue lag animations (queueing produces a misleading "stale" feel).
 *   3. Foreground (live HP) — snaps immediately to currentHpPct; this is the live bar.
 *
 * Replaces the inline HP-bar markup in DefensiveBattleScreen's ParticipantCard and
 * ZombieCard, and the inline bars in CardDuelView's player rows.
 */
export default function LaggingHpBar({
  currentHp,
  maxHp,
  height = 8,
  fillColor,
  ghostColor = COLOR_DAMAGE,
}: LaggingHpBarProps) {
  const safeCurrent = Math.max(0, currentHp);
  const currentPct = maxHp > 0 ? safeCurrent / maxHp : 0;

  const isLowHp = currentPct <= 0.33;
  const liveFillColor = fillColor ?? (isLowHp ? COLOR_DAMAGE : COLOR_HP_BAR);

  // Track previous HP percentage for the ghost bar.
  const prevPctRef = useRef(currentPct);
  const ghostAnim = useRef(new Animated.Value(currentPct)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const prev = prevPctRef.current;
    const next = currentPct;

    if (prev === next) return;

    if (animRef.current) {
      animRef.current.stop();
    }

    if (next > prev) {
      // Heal: ghost snaps immediately to match live bar — no red lag.
      ghostAnim.setValue(next);
      prevPctRef.current = next;
      forceRender(n => n + 1);
      return;
    }

    // Damage: ghost re-anchors to current prevPct (not queued from older prevPct).
    ghostAnim.setValue(prev);
    prevPctRef.current = next;

    const anim = Animated.sequence([
      Animated.delay(HP_LAG_DELAY_MS),
      Animated.timing(ghostAnim, {
        toValue: next,
        duration: HP_LAG_LERP_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // width % requires layout driver
      }),
    ]);

    animRef.current = anim;
    anim.start(() => {
      animRef.current = null;
    });
  }, [currentHp]); // eslint-disable-line react-hooks/exhaustive-deps

  const ghostWidth = ghostAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const liveWidth = `${currentPct * 100}%` as `${number}%`;

  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: COLOR_HP_TRACK,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Ghost (lag) bar — sits behind live bar */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: ghostWidth,
          backgroundColor: ghostColor,
          borderRadius: height / 2,
        }}
      />
      {/* Live bar — snaps immediately */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: liveWidth,
          backgroundColor: liveFillColor,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}
