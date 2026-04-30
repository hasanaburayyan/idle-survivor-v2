import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpotlightContextValue {
  setTarget: (key: string, rect: SpotlightRect | null) => void;
  getTarget: (key: string) => SpotlightRect | null;
  targets: Record<string, SpotlightRect>;
}

const SpotlightContext = createContext<SpotlightContextValue | null>(null);

export function SpotlightTargetProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Record<string, SpotlightRect>>({});

  const setTarget = useCallback((key: string, rect: SpotlightRect | null) => {
    setTargets(prev => {
      if (rect === null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const existing = prev[key];
      if (
        existing &&
        existing.x === rect.x &&
        existing.y === rect.y &&
        existing.width === rect.width &&
        existing.height === rect.height
      ) {
        return prev;
      }
      return { ...prev, [key]: rect };
    });
  }, []);

  const getTarget = useCallback(
    (key: string) => targets[key] ?? null,
    [targets]
  );

  const value = useMemo(
    () => ({ setTarget, getTarget, targets }),
    [setTarget, getTarget, targets]
  );

  return (
    <SpotlightContext.Provider value={value}>
      {children}
    </SpotlightContext.Provider>
  );
}

export function useSpotlightRegistry() {
  const ctx = useContext(SpotlightContext);
  if (!ctx) {
    throw new Error('useSpotlightRegistry must be inside SpotlightTargetProvider');
  }
  return ctx;
}

import { useEffect, useRef } from 'react';
import { type View } from 'react-native';

/**
 * Registers a View ref under a stable spotlight key. The view's measured
 * window-relative rect is stored in the registry; when the ref unmounts or
 * the key changes, the registration is cleared.
 */
export function useSpotlightTarget(key: string) {
  const { setTarget } = useSpotlightRegistry();
  const ref = useRef<View | null>(null);

  const measure = useCallback(() => {
    if (!key) return;
    const view = ref.current;
    if (!view) return;
    view.measureInWindow((x, y, width, height) => {
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      setTarget(key, { x, y, width, height });
    });
  }, [key, setTarget]);

  useEffect(() => {
    if (!key) return undefined;
    return () => {
      setTarget(key, null);
    };
  }, [key, setTarget]);

  return { ref, onLayout: measure };
}
