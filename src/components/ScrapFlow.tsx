import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { decomposeBurst, tierScale } from '../lib/scavenge';

const DISPERSE_MS = 180;
const ARRIVE_MS = 520;
const FADE_MS = 160;
const DISPERSE_MIN = 70;
const DISPERSE_MAX = 140;
const ICON_SIZE = 16;

interface Particle {
  id: number;
  power: number;
  icon: string;
  startX: number;
  startY: number;
  dispersedX: number;
  dispersedY: number;
  targetX: number;
  targetY: number;
}

interface CounterEntry {
  ref: View | null;
  icon: string;
}

interface ScrapFlowContextValue {
  setCounterRef: (resourceId: string, ref: View | null, icon: string) => void;
  spawnBurst: (
    fromRef: View | null,
    resourceId: string,
    amount: bigint
  ) => void;
  spawnReturnBurst: (resourceId: string, amount: bigint) => void;
}

const ScrapFlowContext = createContext<ScrapFlowContextValue | null>(null);

export function useScrapFlow() {
  const ctx = useContext(ScrapFlowContext);
  if (!ctx) {
    throw new Error('useScrapFlow must be used within ScrapFlowProvider');
  }
  return ctx;
}

export function ScrapFlowProvider({ children }: { children: ReactNode }) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const counters = useRef<Map<string, CounterEntry>>(new Map());
  const nextId = useRef(0);

  const setCounterRef = useCallback(
    (resourceId: string, ref: View | null, icon: string) => {
      if (ref === null) {
        counters.current.delete(resourceId);
      } else {
        counters.current.set(resourceId, { ref, icon });
      }
    },
    []
  );

  const spawnBurst = useCallback(
    (fromRef: View | null, resourceId: string, amount: bigint) => {
      if (!fromRef || amount <= 0n) return;
      const entry = counters.current.get(resourceId);
      if (!entry || !entry.ref) return;
      const target = entry.ref;
      const icon = entry.icon;
      fromRef.measureInWindow((fx, fy, fw, fh) => {
        target.measureInWindow((cx, cy, cw, ch) => {
          const startX = fx + fw / 2;
          const startY = fy + fh / 2;
          const targetX = cx + cw / 2;
          const targetY = cy + ch / 2;

          const spawned: Particle[] = [];
          for (const tier of decomposeBurst(amount)) {
            for (let i = 0; i < tier.count; i++) {
              const angle = Math.random() * Math.PI * 2;
              const distance =
                DISPERSE_MIN + Math.random() * (DISPERSE_MAX - DISPERSE_MIN);
              spawned.push({
                id: nextId.current++,
                power: tier.power,
                icon,
                startX,
                startY,
                dispersedX: startX + Math.cos(angle) * distance,
                dispersedY: startY + Math.sin(angle) * distance,
                targetX,
                targetY,
              });
            }
          }
          if (spawned.length > 0) {
            setParticles(prev => [...prev, ...spawned]);
          }
        });
      });
    },
    []
  );

  const spawnReturnBurst = useCallback(
    (resourceId: string, amount: bigint) => {
      const entry = counters.current.get(resourceId);
      if (!entry || !entry.ref) return;
      spawnBurst(entry.ref, resourceId, amount);
    },
    [spawnBurst]
  );

  const retire = useCallback((id: number) => {
    setParticles(prev => prev.filter(p => p.id !== id));
  }, []);

  const value: ScrapFlowContextValue = {
    setCounterRef,
    spawnBurst,
    spawnReturnBurst,
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrapFlowContext.Provider value={value}>
        {children}
      </ScrapFlowContext.Provider>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {particles.map(p => (
          <ScrapParticle
            key={p.id}
            particle={p}
            onComplete={() => retire(p.id)}
          />
        ))}
      </View>
    </View>
  );
}

function ScrapParticle({
  particle,
  onComplete,
}: {
  particle: Particle;
  onComplete: () => void;
}) {
  const dx = useRef(new Animated.Value(0)).current;
  const dy = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = tierScale(particle.power);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(dx, {
          toValue: particle.dispersedX - particle.startX,
          duration: DISPERSE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(dy, {
          toValue: particle.dispersedY - particle.startY,
          duration: DISPERSE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(dx, {
          toValue: particle.targetX - particle.startX,
          duration: ARRIVE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(dy, {
          toValue: particle.targetY - particle.startY,
          duration: ARRIVE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          delay: ARRIVE_MS - FADE_MS,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => onComplete());
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: particle.startX - ICON_SIZE / 2,
        top: particle.startY - ICON_SIZE / 2,
        opacity,
        transform: [{ translateX: dx }, { translateY: dy }, { scale }],
      }}
    >
      <Text style={{ fontSize: ICON_SIZE }}>{particle.icon}</Text>
    </Animated.View>
  );
}
