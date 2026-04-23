import { useEffect, useRef, useState } from 'react';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';
import {
  decomposeBurst,
  formatScrap,
  scavengePower,
  tierScale,
  upgradeCost,
} from '../lib/scavenge';

interface HomeScreenProps {
  username: string;
}

interface Particle {
  id: number;
  power: number;
  startX: number;
  startY: number;
  dispersedX: number;
  dispersedY: number;
  targetX: number;
  targetY: number;
}

const DISPERSE_MS = 180;
const ARRIVE_MS = 520;
const LIFE_MS = DISPERSE_MS + ARRIVE_MS + 40;
const DISPERSE_MIN = 70;
const DISPERSE_MAX = 140;

export default function HomeScreen({ username }: HomeScreenProps) {
  const [playerStates] = useTable(tables.myPlayerState);
  const ps = playerStates[0];

  const scavenge = useReducer(reducers.scavenge);
  const upgrade = useReducer(reducers.upgradeScavenge);
  const logout = useReducer(reducers.logout);

  const [particles, setParticles] = useState<Particle[]>([]);
  const [pressed, setPressed] = useState(false);
  const nextParticleId = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const counterRef = useRef<HTMLDivElement>(null);

  const level = ps?.scavengeLevel ?? 0;
  const scrap = ps?.scrap ?? 0n;
  const power = scavengePower(level);
  const nextCost = upgradeCost(level);
  const canAfford = scrap >= nextCost;

  const onScavenge = () => {
    setPressed(true);
    window.setTimeout(() => setPressed(false), 120);

    const btn = buttonRef.current;
    const counter = counterRef.current;
    if (btn && counter) {
      const btnRect = btn.getBoundingClientRect();
      const counterRect = counter.getBoundingClientRect();
      const startX = btnRect.left + btnRect.width / 2;
      const startY = btnRect.top + btnRect.height / 2;
      const targetX = counterRect.left + counterRect.width / 2;
      const targetY = counterRect.top + counterRect.height / 2;

      const spawned: Particle[] = [];
      for (const tier of decomposeBurst(power)) {
        for (let i = 0; i < tier.count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const distance =
            DISPERSE_MIN + Math.random() * (DISPERSE_MAX - DISPERSE_MIN);
          spawned.push({
            id: nextParticleId.current++,
            power: tier.power,
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
        const ids = new Set(spawned.map(p => p.id));
        window.setTimeout(() => {
          setParticles(prev => prev.filter(p => !ids.has(p.id)));
        }, LIFE_MS);
      }
    }

    scavenge().catch(() => {});
  };

  const onUpgrade = () => {
    upgrade().catch(() => {});
  };

  const onLogout = () => {
    logout().catch(() => {});
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="flex items-center justify-between px-8 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div
            ref={counterRef}
            className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-4 py-2"
          >
            <ScrapIcon className="w-5 h-5 text-amber-400" />
            <span className="font-semibold tabular-nums text-lg">
              {formatScrap(scrap)}
            </span>
            <span className="text-xs text-slate-500">scrap</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-500">
            signed in as <span className="text-slate-300">{username}</span>
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium transition"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-10 px-6">
        <button
          ref={buttonRef}
          type="button"
          onClick={onScavenge}
          className={`relative select-none rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-bold text-2xl w-48 h-48 shadow-[0_10px_30px_-10px_rgba(245,158,11,0.6)] ring-1 ring-amber-300/50 transition-transform duration-75 ${
            pressed ? 'scale-95 brightness-95' : 'hover:scale-[1.02]'
          }`}
        >
          Scavenge
        </button>

        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500">
                Scavenge power
              </p>
              <p className="text-lg font-semibold">
                {formatScrap(power)}{' '}
                <span className="text-sm text-slate-400 font-normal">
                  per click
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-widest text-slate-500">
                Level
              </p>
              <p className="text-lg font-semibold tabular-nums">{level}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onUpgrade}
            disabled={!canAfford}
            className={`w-full rounded-lg py-2.5 text-sm font-medium transition ${
              canAfford
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            Upgrade · {formatScrap(nextCost)} scrap
          </button>
        </div>
      </main>

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {particles.map(p => (
          <ScrapParticle key={p.id} particle={p} />
        ))}
      </div>
    </div>
  );
}

type ParticlePhase = 'start' | 'dispersed' | 'arrived';

function ScrapParticle({ particle }: { particle: Particle }) {
  const [phase, setPhase] = useState<ParticlePhase>('start');
  const scale = tierScale(particle.power);

  useEffect(() => {
    const r1 = requestAnimationFrame(() => setPhase('dispersed'));
    const t = window.setTimeout(() => setPhase('arrived'), DISPERSE_MS);
    return () => {
      cancelAnimationFrame(r1);
      window.clearTimeout(t);
    };
  }, []);

  const position =
    phase === 'start'
      ? { left: particle.startX, top: particle.startY, opacity: 1 }
      : phase === 'dispersed'
        ? { left: particle.dispersedX, top: particle.dispersedY, opacity: 1 }
        : { left: particle.targetX, top: particle.targetY, opacity: 0 };

  const transitionDuration =
    phase === 'arrived' ? `${ARRIVE_MS}ms` : `${DISPERSE_MS}ms`;
  const easing =
    phase === 'arrived'
      ? 'cubic-bezier(0.45, 0, 0.2, 1)'
      : 'cubic-bezier(0.16, 0.9, 0.3, 1)';

  return (
    <div
      className="absolute text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        opacity: position.opacity,
        transform: `translate(-50%, -50%) scale(${scale})`,
        transition: `left ${transitionDuration} ${easing}, top ${transitionDuration} ${easing}, opacity ${transitionDuration} linear`,
        willChange: 'left, top, opacity',
      }}
    >
      <ScrapIcon className="w-4 h-4" />
    </div>
  );
}

function ScrapIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6l-8-4Zm0 4.5 5 2.5v3c0 3.5-2.3 6.7-5 7.4-2.7-.7-5-3.9-5-7.4V9l5-2.5Z" />
    </svg>
  );
}
