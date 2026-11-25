'use client';

import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

type KronnerEntranceProps = {
  /** Called once the overlay finishes so the panel can trigger its staggered wave reveal */
  onComplete: () => void;
  /** If an error occurs while loading workspace data, dismiss immediately so errors are never hidden */
  hasError?: boolean;
};

let entrancePlayedInMemory = false;

/**
 * 6-stage branded Kronner entrance (~2.4s total):
 * 1. Full-screen Obsidian Carbon (#0B0E10) canvas (brand anchor)
 * 2. Progressive reveal of "KRONNER" wordmark
 * 3. Technological precision sweep/rotation on the K chronograph mark
 * 4. Smooth glide of the K mark toward the top-left header/sidebar anchor
 * 5. Re-reveal of KRONNER beside the K mark
 * 6. Clean dissolve + wave reveal of the panel
 *
 * Strictly GPU-composited (transform, opacity, clip-path), respects prefers-reduced-motion,
 * plays only once per authenticated panel load (never on internal tab switches),
 * and never blocks data fetching or hides errors.
 */
export function KronnerEntrance({ onComplete, hasError }: KronnerEntranceProps) {
  const [phase, setPhase] = useState<
    'idle' | 'write' | 'spin' | 'dock' | 'reveal' | 'done'
  >(() => (entrancePlayedInMemory ? 'done' : 'idle'));

  useEffect(() => {
    if (entrancePlayedInMemory) {
      onComplete();
      return;
    }

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      entrancePlayedInMemory = true;
      setPhase('done');
      onComplete();
      return;
    }

    entrancePlayedInMemory = true;
    const t1 = window.setTimeout(() => setPhase('write'), 60);
    const t2 = window.setTimeout(() => setPhase('spin'), 860);
    const t3 = window.setTimeout(() => setPhase('dock'), 1420);
    const t4 = window.setTimeout(() => setPhase('reveal'), 1940);
    const t5 = window.setTimeout(() => {
      setPhase('done');
      onComplete();
    }, 2420);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
    };
  }, [onComplete]);

  useEffect(() => {
    if (hasError && phase !== 'done') {
      setPhase('done');
      onComplete();
    }
  }, [hasError, phase, onComplete]);

  useEffect(() => {
    if (phase === 'done') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPhase('done');
        onComplete();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onComplete]);

  if (phase === 'done') return null;

  return (
    <div
      className={`kr-entrance kr-entrance--${phase}`}
      role="presentation"
      aria-hidden="true"
      onClick={() => {
        setPhase('done');
        onComplete();
      }}
    >
      <div className="kr-entrance-glow" />
      <div className="kr-entrance-stage">
        <div className="kr-entrance-mark">
          <BrandLogo variant="light" height={44} markOnly />
        </div>
        <div className="kr-entrance-word">
          <span>KRONNER</span>
        </div>
      </div>
    </div>
  );
}
